"""Small control API. Uploads go directly to private S3; inference goes to SQS."""
import base64
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import hmac
import json
import os
import re
import time
import uuid

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

s3 = boto3.client('s3', config=Config(signature_version='s3v4'))
sqs = boto3.client('sqs')
ssm = boto3.client('ssm')
ddb = boto3.client('dynamodb')
table = boto3.resource('dynamodb').Table(os.environ['JOBS_TABLE'])
BUCKET = os.environ['ASSETS_BUCKET']
LANGUAGES = ['ar','da','de','el','en','es','fi','fr','he','hi','it','ja','ko','ms','nl','no','pl','pt','ru','sv','sw','tr','zh']
LIMITS = {'referenceBytes':10*1024*1024,'sourceBytes':30*1024*1024,'sourceSeconds':60,'textCharacters':600,'dailyJobs':20}
SECRET = None
SECRET_AT = 0
MIME_TYPES = {'audio/wav','audio/x-wav','audio/mpeg','audio/mp4','audio/x-m4a','audio/ogg','audio/webm','audio/flac','video/mp4','video/quicktime','video/webm'}


def response(status, data):
    return {'statusCode': status, 'headers': {'content-type':'application/json', 'cache-control':'no-store'},
            'body':json.dumps(data, default=lambda value: float(value) if isinstance(value, Decimal) else str(value))}


def authorize(event):
    global SECRET, SECRET_AT
    now = time.time()
    if SECRET is None or now - SECRET_AT > 300:
        SECRET = ssm.get_parameter(Name=os.environ['ACCESS_KEY_PARAM'], WithDecryption=True)['Parameter']['Value']
        SECRET_AT = now
    headers = {k.lower():v for k,v in event.get('headers',{}).items()}
    supplied = headers.get('x-voice-studio-key','')
    if not supplied or not hmac.compare_digest(supplied.encode(), SECRET.encode()):
        return None
    return hashlib.sha256(SECRET.encode()).hexdigest()[:24]


def file_spec(value, maximum):
    if not isinstance(value, dict): raise ValueError('Selecciona el archivo requerido.')
    mime = value.get('contentType')
    size = value.get('bytes')
    if mime not in MIME_TYPES: raise ValueError('Formato no compatible. Usa WAV, MP3, M4A, OGG, FLAC, MP4, MOV o WebM.')
    if not isinstance(size, int) or isinstance(size, bool) or not 0 < size <= maximum:
        raise ValueError(f'El archivo debe ocupar menos de {maximum // 1024 // 1024} MB.')
    return {'contentType': mime, 'bytes': size}


def create_job(body, owner):
    kind = body.get('kind')
    if kind not in ('clone','dub'): raise ValueError('Selecciona clonación o doblaje.')
    if body.get('consent') is not True: raise ValueError('Confirma que tienes permiso para utilizar la voz y el contenido.')
    language = body.get('language')
    source_language = body.get('sourceLanguage','auto')
    if language not in LANGUAGES or source_language not in LANGUAGES + ['auto']:
        raise ValueError('Selecciona un idioma compatible.')
    text = body.get('text','')
    if not isinstance(text,str): raise ValueError('Texto no válido.')
    text = text.strip()
    if kind == 'clone' and (not text or len(text)>LIMITS['textCharacters'] or not any(c.isalnum() for c in text)):
        raise ValueError('La clonación admite entre 1 y 600 caracteres con letras o números.')
    files = {}
    if kind == 'clone' or body.get('reference') is not None:
        files['reference'] = file_spec(body.get('reference'), LIMITS['referenceBytes'])
    if kind == 'dub': files['source'] = file_spec(body.get('source'), LIMITS['sourceBytes'])
    job_id = str(uuid.uuid4())
    now = int(time.time())
    job = {'id':job_id,'owner':owner,'kind':kind,'language':language,'sourceLanguage':source_language,
        'text':text,'status':'uploading','stage':'Esperando archivos','progress':0,'createdAt':now,
        'updatedAt':now,'expiresAt':now+86400,'consentedAt':now,'files':files}
    uploads = {}
    for role, spec in files.items():
        key = f'jobs/{job_id}/inputs/{role}'
        job[role+'Key'] = key
        uploads[role] = s3.generate_presigned_post(Bucket=BUCKET, Key=key,
            Fields={'Content-Type':spec['contentType']},
            Conditions=[{'Content-Type':spec['contentType']}, ['content-length-range',spec['bytes'],spec['bytes']]], ExpiresIn=600)
    table.put_item(Item=job, ConditionExpression='attribute_not_exists(id)')
    return {'job':public_job(job),'uploads':uploads}


def public_job(job):
    result = {key:job[key] for key in ['id','kind','language','sourceLanguage','status','stage','progress',
        'createdAt','updatedAt','expiresAt','error','duration','startedAt'] if key in job}
    if job.get('status') == 'completed':
        result['outputs'] = [{key:item[key] for key in ['name','bytes','contentType']} | {
            'url':s3.generate_presigned_url('get_object',Params={'Bucket':BUCKET,'Key':item['key'],
                'ResponseContentDisposition': f'inline; filename="{item["name"]}"'},ExpiresIn=900)}
            for item in job.get('outputs',[])]
    return result


def load_job(job_id, owner):
    if not re.fullmatch(r'[0-9a-f-]{36}',job_id): return None
    job = table.get_item(Key={'id':job_id}, ConsistentRead=True).get('Item')
    if not job or job.get('owner')!=owner or job.get('expiresAt',0)<=int(time.time()): return None
    if job['status'] in ('running','cancel_requested') and int(time.time())-job.get('startedAt',int(time.time()))>920:
        try:
            table.update_item(Key={'id':job_id}, UpdateExpression='SET #s=:failed, error=:error, stage=:stage',
                ConditionExpression='#s IN (:running,:cancel)', ExpressionAttributeNames={'#s':'status'},
                ExpressionAttributeValues={':failed':'failed',':error':'El trabajo agotó su tiempo. Prueba un clip más corto.',
                    ':stage':'Tiempo de procesamiento agotado',':running':'running',':cancel':'cancel_requested'})
            job['status']='failed'; job['error']='El trabajo agotó su tiempo. Prueba un clip más corto.'
        except ClientError: pass
    return job


def start_job(job, owner):
    if job['status'] != 'uploading': return public_job(job)
    for role, spec in job['files'].items():
        try: head=s3.head_object(Bucket=BUCKET,Key=job[role+'Key'])
        except ClientError: raise ValueError('Falta un archivo. Completa la subida antes de generar.')
        if head['ContentLength']!=spec['bytes'] or head.get('ContentType')!=spec['contentType']:
            raise ValueError('El archivo subido no coincide con el seleccionado.')
    now=int(time.time())
    day=datetime.now(timezone.utc).strftime('%Y-%m-%d')
    try:
        ddb.transact_write_items(TransactItems=[{'Update':{
            'TableName':os.environ['JOBS_TABLE'],'Key':{'id':{'S':f'quota-{owner}-{day}'}},
            'UpdateExpression':'SET #n=if_not_exists(#n,:zero)+:one, expiresAt=:ttl',
            'ConditionExpression':'attribute_not_exists(#n) OR #n < :limit',
            'ExpressionAttributeNames':{'#n':'count'},
            'ExpressionAttributeValues':{':zero':{'N':'0'},':one':{'N':'1'},':limit':{'N':str(LIMITS['dailyJobs'])},':ttl':{'N':str(now+172800)}}}},
            {'Update':{'TableName':os.environ['JOBS_TABLE'],'Key':{'id':{'S':job['id']}},
            'UpdateExpression':'SET #s=:queued, stage=:stage, updatedAt=:now',
            'ConditionExpression':'#s=:uploading AND #o=:owner',
            'ExpressionAttributeNames':{'#s':'status','#o':'owner'},
            'ExpressionAttributeValues':{':queued':{'S':'queued'},':stage':{'S':'En cola'},':now':{'N':str(now)},
                ':uploading':{'S':'uploading'},':owner':{'S':owner}}}}])
    except ddb.exceptions.TransactionCanceledException:
        current=load_job(job['id'],owner)
        if current and current['status']!='uploading': return public_job(current)
        raise ValueError('Se alcanzó el límite de 20 trabajos al día (UTC). Inténtalo mañana.')
    try:
        sqs.send_message(QueueUrl=os.environ['QUEUE_URL'], MessageBody=json.dumps({'jobId':job['id']}),
            MessageGroupId='voice-studio',MessageDeduplicationId=job['id'])
    except Exception:
        table.update_item(Key={'id':job['id']},UpdateExpression='SET #s=:s, error=:e',
            ExpressionAttributeNames={'#s':'status'},ExpressionAttributeValues={':s':'failed',':e':'No se pudo añadir el trabajo a la cola. Crea uno nuevo.'})
        raise
    return public_job(load_job(job['id'],owner))


def lambda_handler(event, context):
    try:
        method=event.get('requestContext',{}).get('http',{}).get('method','GET')
        path=event.get('rawPath','/').rstrip('/') or '/'
        if method=='OPTIONS': return response(204,{})
        owner=authorize(event)
        if not owner: return response(401,{'message':'Introduce la clave de acceso de SwipeForge / LayerLab.'})
        if method=='GET' and path=='/status':
            return response(200,{'available':True,'languages':LANGUAGES,'limits':LIMITS,'retentionHours':24,'engine':'Chatterbox Multilingual V3'})
        payload=event.get('body') or '{}'
        if event.get('isBase64Encoded'):payload=base64.b64decode(payload).decode()
        if len(payload)>12000: return response(413,{'message':'Solicitud demasiado grande.'})
        body=json.loads(payload)
        if not isinstance(body,dict):raise ValueError('Solicitud no válida.')
        if method=='POST' and path=='/jobs':return response(201,create_job(body,owner))
        match=re.fullmatch(r'/jobs/([0-9a-f-]{36})(/start|/cancel)?',path)
        if not match:return response(404,{'message':'Ruta no encontrada.'})
        job=load_job(match[1],owner)
        if not job:return response(404,{'message':'El trabajo no existe o ha caducado.'})
        action=match[2]
        if method=='GET' and action is None:return response(200,{'job':public_job(job)})
        if method=='POST' and action=='/start':return response(200,{'job':start_job(job,owner)})
        if method=='POST' and action=='/cancel':
            if job['status'] in ('uploading','queued','running'):
                new_status='cancel_requested' if job['status']=='running' else 'cancelled'
                try:
                    table.update_item(Key={'id':job['id']},UpdateExpression='SET #s=:s, stage=:stage, updatedAt=:now',
                        ConditionExpression='#s=:old',ExpressionAttributeNames={'#s':'status'},
                        ExpressionAttributeValues={':s':new_status,':stage':'Cancelación solicitada' if new_status=='cancel_requested' else 'Cancelado',':now':int(time.time()),':old':job['status']})
                except table.meta.client.exceptions.ConditionalCheckFailedException: pass
            return response(200,{'job':public_job(load_job(job['id'],owner))})
        return response(405,{'message':'Método no permitido.'})
    except (ValueError,TypeError) as error:
        return response(400,{'message':str(error)[:300]})
    except Exception as error:
        print(json.dumps({'errorType':type(error).__name__}))
        return response(500,{'message':'No se pudo completar la solicitud. Inténtalo nuevamente.'})
