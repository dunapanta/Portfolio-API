#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="${1:-dev}"
REGION="us-east-1"
BUCKET="${STAGE}-sprite-assets-du-portfolio"
API_ID="$(aws cloudformation describe-stack-resource --stack-name "duportfolioapi-${STAGE}" --logical-resource-id HttpApi --region "$REGION" --query 'StackResourceDetail.PhysicalResourceId' --output text)"
ACCESS_PARAM="/duportfolioapi/${STAGE}/sprite-studio/access-key"
OPENAI_PARAM="/duportfolioapi/${STAGE}/openai/api-key"
BUILD="$ROOT/.build"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PREVIEW_ORIGIN="${SPRITE_GEN_PREVIEW_ORIGIN:-https://portfolio-du-b9yo-8zxe-git-cod-421e57-daniel-unapantas-projects.vercel.app}"
mkdir -p "$BUILD/create" "$BUILD/get"

cd "$ROOT"
node scripts/ensure-sprite-gen-access.mjs "$STAGE"
./scripts/build-sprite-gen-worker.sh > "$BUILD/sprite-worker-build.log" 2>&1
./node_modules/.bin/esbuild src/functions/createSpriteGenJob/index.ts --bundle --platform=node --target=node22 --format=cjs --tsconfig=tsconfig.json --outfile="$BUILD/create/index.js"
./node_modules/.bin/esbuild src/functions/getSpriteGenJob/index.ts --bundle --platform=node --target=node22 --format=cjs --tsconfig=tsconfig.json --outfile="$BUILD/get/index.js"
(cd "$BUILD/create" && zip -q -j "$BUILD/create-sprite-gen-job.zip" index.js)
(cd "$BUILD/get" && zip -q -j "$BUILD/get-sprite-gen-job.zip" index.js)

CREATE_KEY="sprite-gen/deploy/${STAMP}/create.zip"
GET_KEY="sprite-gen/deploy/${STAMP}/get.zip"
WORKER_KEY="sprite-gen/deploy/${STAMP}/worker.zip"
aws s3 cp "$BUILD/create-sprite-gen-job.zip" "s3://${BUCKET}/${CREATE_KEY}" --region "$REGION" --quiet
aws s3 cp "$BUILD/get-sprite-gen-job.zip" "s3://${BUCKET}/${GET_KEY}" --region "$REGION" --quiet
aws s3 cp "$BUILD/sprite-gen-worker.zip" "s3://${BUCKET}/${WORKER_KEY}" --region "$REGION" --quiet

aws cloudformation deploy --region "$REGION" \
  --stack-name "duportfolioapi-${STAGE}-sprite-gen" \
  --template-file infrastructure/sprite-gen.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    Stage="$STAGE" ApiId="$API_ID" AssetsBucket="$BUCKET" \
    AccessKeyParameter="$ACCESS_PARAM" OpenAiKeyParameter="$OPENAI_PARAM" \
    CreateCodeKey="$CREATE_KEY" GetCodeKey="$GET_KEY" WorkerCodeKey="$WORKER_KEY"

aws apigatewayv2 get-api --api-id "$API_ID" --region "$REGION" --query CorsConfiguration --output json > "$BUILD/sprite-gen-cors.json"
python3 - "$BUILD/sprite-gen-cors.json" "$PREVIEW_ORIGIN" <<'PY'
import json, sys
path = sys.argv[1]
with open(path) as fh:
    cors = json.load(fh) or {}
headers = cors.setdefault('AllowHeaders', [])
if 'x-sprite-studio-key' not in [str(value).lower() for value in headers]:
    headers.append('X-Sprite-Studio-Key')
origins = cors.setdefault('AllowOrigins', [])
if sys.argv[2] not in origins:
    origins.append(sys.argv[2])
with open(path, 'w') as fh:
    json.dump(cors, fh)
PY
aws apigatewayv2 update-api --api-id "$API_ID" --region "$REGION" --cors-configuration "file://$BUILD/sprite-gen-cors.json" >/dev/null
echo "Sprite Gen deployed at https://${API_ID}.execute-api.${REGION}.amazonaws.com/sprite-gen/jobs"
