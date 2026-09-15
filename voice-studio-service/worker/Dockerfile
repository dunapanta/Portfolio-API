FROM python:3.11-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ffmpeg libsndfile1 build-essential cmake libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /var/task
ENV HF_HOME=/opt/models/cache HF_HUB_DISABLE_XET=1 HF_HUB_DISABLE_TELEMETRY=1 \
    NUMBA_CACHE_DIR=/tmp/numba MPLCONFIGDIR=/tmp/matplotlib \
    OMP_NUM_THREADS=6 MKL_NUM_THREADS=6 TOKENIZERS_PARALLELISM=false
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.6.0 torchaudio==2.6.0
RUN git clone https://github.com/resemble-ai/chatterbox.git /opt/chatterbox \
    && cd /opt/chatterbox && git checkout 5de7a54aa4e5e2baadb0182dde554908b48b85c2 \
    && sed -i 's|Perth.git@master|Perth.git@ff1c8ac55a976971245cdd53c18d6131ca00d993|' pyproject.toml \
    && pip install --no-cache-dir . \
    && rm -rf .git
RUN pip install --no-cache-dir faster-whisper==1.2.1 boto3==1.40.40 awslambdaric==3.1.1
COPY warm_models.py .
RUN python warm_models.py && rm -rf /root/.cache/pip
# Pin the audio JIT dependency pair used for Lambda validation.
RUN pip install --no-cache-dir numba==0.61.2 llvmlite==0.44.0 \
    && cp -a /root/.pkuseg /opt/models/pkuseg \
    && chmod -R a+rX /opt/models/pkuseg
ENV PKUSEG_HOME=/opt/models/pkuseg PYTHONUNBUFFERED=1
ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 XDG_CACHE_HOME=/tmp/cache
# Pack dependencies for one sequential read into Lambda's ephemeral disk.
RUN tar --exclude='__pycache__' -czf /opt/python-runtime.tar.gz -C /usr/local/lib/python3.11/site-packages . \
    && du -sh /usr/local/lib/python3.11/site-packages /opt/python-runtime.tar.gz /opt/models
COPY handler.py bootstrap.py .
ENTRYPOINT ["python", "-m", "awslambdaric"]
CMD ["bootstrap.lambda_handler"]
