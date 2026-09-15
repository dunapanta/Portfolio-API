#!/usr/bin/env python3
"""Deploy only this isolated service. Requires AWS CLI credentials and --bucket.
Use --build to rebuild the pinned ML container; otherwise reuse latest image.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time
import tempfile
import zipfile

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--bucket',required=True)
parser.add_argument('--region',default='us-east-1')
parser.add_argument('--build',action='store_true')
parser.add_argument('--image-tag',default='latest')
args=parser.parse_args()
base=Path(__file__).resolve().parent

def aws(*cmd, read=False):
    command=['aws',*cmd,'--region',args.region]
    if read:return json.loads(subprocess.check_output(command))
    subprocess.run(command,check=True)

def pack(source,dest):
    with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED) as archive:
        paths=source.rglob('*') if source.is_dir() else [source]
        for path in paths:
            if path.is_file() and '__pycache__' not in path.parts:
                archive.write(path,path.relative_to(source) if source.is_dir() else path.name)

with tempfile.TemporaryDirectory(prefix='voice-deploy-') as temp:
    temp=Path(temp)
    if args.build:
        pack(base/'worker',temp/'worker.zip')
        aws('s3','cp',str(temp/'worker.zip'),f's3://{args.bucket}/voice-studio/worker-source.zip')
        aws('cloudformation','deploy','--template-file',str(base/'builder.yml'),'--stack-name','duportfolioapi-voice-studio-builder','--capabilities','CAPABILITY_IAM','--parameter-overrides',f'SourceBucket={args.bucket}','SourceKey=voice-studio/worker-source.zip')
        build=aws('codebuild','start-build','--project-name','duportfolioapi-voice-studio-worker',read=True)['build']['id']
        print('Building',build,flush=True)
        while True:
            result=aws('codebuild','batch-get-builds','--ids',build,read=True)['builds'][0]
            if result['buildStatus']!='IN_PROGRESS':break
            print(result['currentPhase'],flush=True);time.sleep(30)
        if result['buildStatus']!='SUCCEEDED':raise SystemExit('Image build failed: inspect CodeBuild logs before deploying.')
    account=aws('sts','get-caller-identity',read=True)['Account']
    digest=aws('ecr','describe-images','--repository-name','duportfolioapi-voice-studio-worker','--image-ids','imageTag='+args.image_tag,read=True)['imageDetails'][0]['imageDigest']
    pack(base/'api.py',temp/'api.zip')
    codekey='voice-studio/api-'+hashlib.sha256((base/'api.py').read_bytes()).hexdigest()[:16]+'.zip'
    aws('s3','cp',str(temp/'api.zip'),f's3://{args.bucket}/{codekey}')
    aws('cloudformation','deploy','--template-file',str(base/'service.yml'),'--stack-name','duportfolioapi-voice-studio','--capabilities','CAPABILITY_IAM','--parameter-overrides',f'SourceBucket={args.bucket}',f'ApiCodeKey={codekey}',f'WorkerImageUri={account}.dkr.ecr.{args.region}.amazonaws.com/duportfolioapi-voice-studio-worker@{digest}')
    stack=aws('cloudformation','describe-stacks','--stack-name','duportfolioapi-voice-studio',read=True)['Stacks'][0]
    print(json.dumps({o['OutputKey']:o['OutputValue'] for o in stack['Outputs']},indent=2))
