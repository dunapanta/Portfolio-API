# Voice Studio cloud service

Isolated CloudFormation service for `/tools/voice-studio`, added 2026-09-15. Does not deploy or import the portfolio's existing dirty Serverless stack.

## Architecture

Browser → authenticated Lambda Function URL → private presigned S3 upload → DynamoDB job + FIFO SQS → container Lambda → S3 signed downloads.

- **Cloning:** Chatterbox Multilingual V3, CPU, reference-conditioned speech, WAV 24 kHz.
- **Dubbing:** faster-whisper small int8 → AWS Translate → Chatterbox reference-conditioned speech → FFmpeg time fitting and video/audio export, SRT and JSON script.
- One speaker per clip. Original audio (including music) is replaced. Timing adjustment is approximate, not lip-sync. No diarization, voice library/training, background separation or ElevenLabs-equivalent guarantee.
- Browser-only Supertonic mode stays independent and free of inference API charges.

## Bounds and data handling

- Private access with the existing SSM SecureString `/duportfolioapi/dev/magic-layers/access-key`; fetched by the controller. Never ship that value in web configuration, command output, commits or logs.
- One shared private studio, not a public multi-user service. Possession of the shared key authorizes access to that studio's jobs. Rotating the key changes job ownership hashes.
- Session key stored only in browser sessionStorage; last job ID in localStorage. Text/reference/media uploaded only after explicit form submission and rights checkbox. Translation text goes to AWS Translate.
- Reference: 3–30 seconds, max 10 MiB; first 15 seconds extracted. Dubbing input: max 60 seconds/30 MiB, 1,800 transcribed characters and 30 segments. Clone text: max 600 characters; internal fragments bounded to 160 (100 Japanese/Chinese).
- Server validates real duration/audio stream, MIME and size; FFmpeg receives argument arrays, restricted local protocols, bounded execution times and no shell.
- 20 starts/day UTC per studio, enforced by an atomic DynamoDB transaction; idempotent start, one FIFO message group, worker concurrency 1.
- Worker 10,240 MiB RAM, 8 GiB temporary disk, 900 seconds timeout. No provisioned concurrency. Cancellation is checked between processing steps, not inside a running model call.
- Job access expires after 24 hours. S3 1-day lifecycle and DynamoDB TTL delete asynchronously; not an exact physical deletion deadline. Result links last 15 minutes and can be refreshed during the job's availability period.
- Private encrypted S3, public access block, TLS-only; signed POST exact file length/type, 10-minute expiry. CORS production domains plus localhost:3017 only. Job errors/logs exclude submitted text, access keys and signed URLs.
- No permanent voice training/checkpoints are created. Reference conditionals and temp files are released after the job. S3 inputs follow lifecycle retention.

## Deploy

AWS CLI with access to the existing account, Python 3, region us-east-1:

```sh
python3 deploy.py --bucket duportfolioapi-dev-serverlessdeploymentbucket-pnhoffqq9vze --build
```

`--build` deploys the ECR/CodeBuild builder stack, uploads the worker source, builds on Linux amd64 and waits for success. Omit it to update the controller/infrastructure using the existing `latest` image, resolved to an immutable digest. API archives are content-addressed. The script never reads/prints the access secret.

Stacks: `duportfolioapi-voice-studio-builder`, `duportfolioapi-voice-studio`. Copy the output `ApiUrl` into the frontend's `public/voice-studio/cloud-config.json`, then build/deploy that existing Vercel project. The config contains only a public endpoint.

Changes to `worker/handler.py` or `worker/bootstrap.py` require an image rebuild and service deployment. Image builds download several GB of models; only the build needs Hugging Face network access. Runtime sets offline model flags.

```sh
python3 -m venv .venv
.venv/bin/pip install boto3
.venv/bin/python -m unittest discover -v
aws logs tail /aws/lambda/duportfolioapi-voice-studio-worker --since 30m --region us-east-1
```

To pause new processing, disable the stack's SQS event source mapping (queued jobs are retained for 6 hours). To remove the service, first export any needed results and deliberately empty its S3 bucket; CloudFormation will not silently destroy a populated bucket. The builder ECR repo similarly refuses deletion while non-empty.

## Costs

Models/code are open source, **AWS processing is not free**. CPU Lambda at 10 GiB consumes 10 GB-seconds per second billed, plus ephemeral storage above 512 MiB, API, S3, DynamoDB, SQS, Translate, ECR storage and CodeBuild builds. No always-running VM/GPU or provisioned concurrency was created. Daily job caps bound inference starts, not the entire AWS bill.

At the published first-tier x86 us-east-1 Lambda rate of $0.0000166667/GB-s (before credits/tax), 10 GiB × 60 s ≈ $0.01 and a 900 s invocation ≈ $0.15 of worker compute. Cold init can add billed duration. Use actual CloudWatch REPORT duration, not source clip length, for estimates. Translate standard text rate is $15/million characters; model storage/build costs exist even with few jobs.

Sources: https://aws.amazon.com/lambda/pricing/ and https://aws.amazon.com/translate/pricing/. Pricing checked 2026-09-15; consult current account billing.

## Model provenance

- Chatterbox code MIT, commit `5de7a54aa4e5e2baadb0182dde554908b48b85c2`; multilingual weights MIT, HF revision `5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18`. Original licenses are retained in the installed source/model downloads. Built-in PerTh watermarking stays enabled.
- Audio JIT dependencies pinned to numba 0.61.2 / llvmlite 0.44.0. Python dependencies are unpacked once into Lambda ephemeral storage; model weights are copied sequentially before safetensors loads to avoid cold image mmap overhead.
- PerTh dependency pinned at `ff1c8ac55a976971245cdd53c18d6131ca00d993`.
- faster-whisper 1.2.1, model `Systran/faster-whisper-small`, revision `536b0662742c02347bc0e980a01041f333bce120` (MIT).
- FFmpeg from Debian Bookworm, libx264 for MP4, corresponding package licenses in the container.
- The web/service does not incorporate the AGPL VoiceStudio application; it implements a separate pipeline with these engines. Model quality/languages are not all manually evaluated.

Primary sources: https://github.com/resemble-ai/chatterbox , https://huggingface.co/ResembleAI/chatterbox , https://github.com/SYSTRAN/faster-whisper , https://github.com/debpalash/VoiceStudio .

## Validation recorded 2026-09-15

Eight controller contract tests pass. Production frontend build passes TypeScript/ESLint (existing unrelated warnings remain).

Real AWS smoke test with a synthetic Supertonic F3 reference: Chatterbox generated the requested Spanish sentence, a 4.150 s / 199,244 byte PCM16 mono 24 kHz WAV. Cold Lambda billed 259.618 s (267 s observed end-to-end), including 134.8 s unpacking the Python runtime. The initial image without runtime materialization failed during startup; the deployed `runtime-v4` image uses the packaged runtime, sequential weight cache and accessible pkuseg cache.

That cloned WAV was then uploaded through the browser inside a 5 s MP4. Whisper recovered the requested Spanish words exactly; Translate produced the English equivalent. The service returned 5 s MP4 (H.264/AAC 640×360), WAV, SRT and JSON. Lambda duration 153.318 s, including first load of Whisper with Python runtime already cached. Audio/video playback and all four browser downloads passed; downloaded file SHA-256 hashes match the S3 outputs.

These are short-clip smoke tests, not a benchmark or a guarantee at the 60-second/600-character limits. The service is asynchronous and experimental, with a slow cold start. Voice resemblance, every language and maximum-length clips were not exhaustively evaluated. Logs reported a peak near the 10 GiB memory limit; retain the configured memory and execution bounds.
