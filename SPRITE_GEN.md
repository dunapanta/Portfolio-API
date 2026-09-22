# Sprite Gen

`/sprite-gen/jobs` creates a Lambda job that runs the pinned
[`aldegad/sprite-gen`](https://github.com/aldegad/sprite-gen) 2.6.0 component-row
pipeline (Apache-2.0, commit `34275ca5a9fc90d431c9790ae8eb20204f5d1d64`).
The worker generates a base image if none is supplied, runs `sprite-gen gen
--provider openai` once per state using the base and generated layout guide,
then runs the upstream `extract`, `compose-atlas`, `compose-gif`, and `inspect`
commands. `gen-set` is not used because upstream currently limits its provider
choices to `codex` and `grok`; the individual `gen` command supports `openai`.

The frontend defaults to `gpt-image-2.5-flare`. The API also permits
`gpt-image-2.5-sunburst` and `gpt-image-2`. The OpenAI key stays in the existing
`/duportfolioapi/dev/openai/api-key` SSM SecureString parameter and is fetched
only by the Python worker. A separate SSM SecureString holds the existing Sprite
Studio access key. API routes compare it server-side. No key is embedded in the
frontend bundle.

## Storage and cost

- Original reference, atlas PNG, manifest, GIF previews and ZIP live in the
  existing private sprite-assets S3 bucket under `sprite-gen/`.
- `dev-sprite-gen-jobs` stores progress, selected model, per-call token usage,
  per-state cost, per-frame row cost, and total cost. The table has point-in-time
  recovery and no TTL, so cost records remain after a browser session ends.
- Costs use OpenAI's published GPT Image 2/2.5 rates: $5 per million text input
  tokens, $8 per million image input tokens, $30 per million image output tokens;
  cached input uses the published lower rates when reported. If OpenAI omits
  usage, the job marks the cost `partial` instead of inventing a number.
- Download URLs are signed for 15 minutes and renewed by the status endpoint.

## Deploy

Run `./scripts/deploy-sprite-gen.sh dev` from this repository. It builds Linux
Python wheels and the pinned sprite-gen source into a Lambda ZIP, bundles the two
Node API handlers, uploads the artifacts to S3, deploys
`infrastructure/sprite-gen.yaml`, and adds `X-Sprite-Studio-Key` to the existing
HTTP API CORS configuration. The stack is independent of the main Serverless
stack because its current LayerLab image references an ECR repository that is no
longer present; deploying that stack currently fails during packaging.

`POST /sprite-gen/jobs` accepts `key`, `description`, `style`, `direction`,
`model`, `quality`, one to four `states`, and optional `referenceImage` data URL
(PNG/JPEG/WebP, 4 MB maximum). It returns a job ID. `GET
/sprite-gen/jobs/{jobId}` takes `X-Sprite-Studio-Key` and returns status, cost,
and signed files for the matching owner. Both routes are in the existing HTTP
API. `walk` and `run` remain experimental, following upstream guidance.
