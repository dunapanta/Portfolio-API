"""Contract checks without AWS calls: python -m unittest discover -v."""
import importlib.util
import json
import os
from pathlib import Path
import time
import unittest
from unittest.mock import MagicMock, patch

os.environ.update(JOBS_TABLE='test-jobs', ASSETS_BUCKET='test-assets', QUEUE_URL='test-queue', ACCESS_KEY_PARAM='test-key')
with patch('boto3.client'), patch('boto3.resource'):
    spec = importlib.util.spec_from_file_location('voice_api', Path(__file__).with_name('api.py'))
    api = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(api)

class ApiTests(unittest.TestCase):
    def setUp(self):
        api.SECRET='unit-test-key'; api.SECRET_AT=time.time()
        api.table=MagicMock(); api.s3=MagicMock(); api.ddb=MagicMock(); api.sqs=MagicMock()
        api.ddb.exceptions.TransactionCanceledException=type('TransactionCancelled',(Exception,),{})
        api.table.meta.client.exceptions.ConditionalCheckFailedException=type('ConditionalFailed',(Exception,),{})
        api.s3.generate_presigned_post.return_value={'url':'https://test.invalid','fields':{}}
        self.payload={'kind':'clone','language':'es','consent':True,'text':'Una voz de prueba','reference':{'bytes':100,'contentType':'audio/wav'}}
        self.owner=api.authorize({'headers':{'X-Voice-Studio-Key':'unit-test-key'}})

    def event(self,path,body=None,key='unit-test-key'):
        return {'rawPath':path,'requestContext':{'http':{'method':'GET' if body is None else 'POST'}},'headers':{'X-Voice-Studio-Key':key},'body':json.dumps(body) if body is not None else None}

    def test_auth_does_not_create_jobs(self):
        for key in ('','wrong'):
            self.assertEqual(api.lambda_handler(self.event('/jobs',self.payload,key),None)['statusCode'],401)
        api.table.put_item.assert_not_called()

    def test_consent_language_text_and_size(self):
        for override in ({'consent':False},{'language':'xx'},{'text':'x'*601},{'text':'!!!'},{'reference':{'bytes':True,'contentType':'audio/wav'}},{'reference':{'bytes':10485761,'contentType':'audio/wav'}},{'reference':{'bytes':100,'contentType':'text/html'}}):
            with self.subTest(override=override),self.assertRaises(ValueError):api.create_job(self.payload|override,self.owner)
        api.table.put_item.assert_not_called()

    def test_upload_is_bounded_and_response_excludes_secrets(self):
        result=api.create_job(self.payload,self.owner)
        stored=api.table.put_item.call_args.kwargs['Item']
        self.assertEqual(stored['status'],'uploading')
        self.assertEqual(stored['expiresAt']-stored['createdAt'],86400)
        self.assertNotIn('owner',result['job']); self.assertNotIn('referenceKey',result['job']);self.assertNotIn('text',result['job'])
        self.assertIn(['content-length-range',100,100],api.s3.generate_presigned_post.call_args.kwargs['Conditions'])

    def test_start_is_idempotent_and_cancelled_jobs_stay_cancelled(self):
        for status in ('queued','running','completed','cancelled','failed'):
            job={'id':'123','status':status}
            self.assertEqual(api.start_job(job,self.owner)['status'],status)
        api.sqs.send_message.assert_not_called();api.ddb.transact_write_items.assert_not_called()

    def test_start_rejects_mismatched_upload(self):
        job={'id':'123','status':'uploading','referenceKey':'ref','files':{'reference':{'bytes':100,'contentType':'audio/wav'}}}
        api.s3.head_object.return_value={'ContentLength':101,'ContentType':'audio/wav'}
        with self.assertRaises(ValueError):api.start_job(job,self.owner)
        api.sqs.send_message.assert_not_called()

    def test_owner_and_expiration(self):
        job={'id':'a'*36,'owner':self.owner,'expiresAt':int(time.time())+100,'status':'queued'}
        api.table.get_item.return_value={'Item':job}
        self.assertIsNone(api.load_job(job['id'],'another-owner'))
        job['expiresAt']=int(time.time())-1
        self.assertIsNone(api.load_job(job['id'],self.owner))

    def test_running_cancellation_is_requested(self):
        job={'id':'a'*36,'owner':self.owner,'expiresAt':int(time.time())+100,'status':'running','startedAt':int(time.time())}
        api.table.get_item.return_value={'Item':job}
        result=api.lambda_handler(self.event('/jobs/'+job['id']+'/cancel',{}),None)
        self.assertEqual(result['statusCode'],200)
        self.assertEqual(api.table.update_item.call_args.kwargs['ExpressionAttributeValues'][':s'],'cancel_requested')

    def test_invalid_json_and_payload_shape(self):
        event=self.event('/jobs',[])
        self.assertEqual(api.lambda_handler(event,None)['statusCode'],400)
        event['body']='{'
        self.assertEqual(api.lambda_handler(event,None)['statusCode'],400)

if __name__=='__main__':unittest.main()
