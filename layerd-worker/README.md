# LayerD worker

Self-hosted CPU worker for Magic Layers. It uses the Apache-2.0 LayerD model,
bakes all weights into a Lambda container, reads source images from the private
S3 bucket, and writes cropped RGBA layers plus a manifest back to S3.

The worker needs at least 8 GB memory, a 15 minute timeout and 10 GB ephemeral
storage. `transformers==4.48.0` is intentionally pinned because LayerD's remote
BiRefNet class is not compatible with Transformers 5.x.

`codebuild-stack.yml` creates the private ECR repository and remote Docker
builder used when Docker is unavailable locally. The product never calls a
paid inference API: the image contains its model weights and runs entirely in
this project's AWS account.
