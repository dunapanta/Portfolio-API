FROM public.ecr.aws/lambda/python:3.12

RUN dnf install -y git && dnf clean all

ENV HF_HUB_DISABLE_XET=1 \
    HF_HOME=/opt/models/huggingface \
    TORCH_HOME=/opt/models/torch \
    TRANSFORMERS_CACHE=/opt/models/huggingface

# Install CPU-only PyTorch explicitly. This keeps the image below Lambda's
# limit and avoids shipping several gigabytes of unused NVIDIA libraries.
RUN pip install --no-cache-dir \
    --index-url https://download.pytorch.org/whl/cpu \
    "torch==2.7.1" \
    "torchvision==0.22.1"

RUN pip install --no-cache-dir \
    "git+https://github.com/CyberAgentAILab/LayerD.git@21aef937a0371614adb4d961f52d02409cb8ecc7" \
    "transformers==4.48.0" \
    "boto3>=1.35,<2"

# Bake the Apache-2.0 matting weights and LaMa checkpoint into the image so a
# cold Lambda never downloads models during a user's request.
RUN python -c "from layerd import LayerD; LayerD(matting_hf_card='cyberagent/layerd-birefnet', matting_process_size=(1024, 1024)).to('cpu')"

COPY handler.py ${LAMBDA_TASK_ROOT}/handler.py

CMD ["handler.lambda_handler"]
