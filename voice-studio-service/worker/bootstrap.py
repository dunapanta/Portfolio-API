"""Materialize Python packages once per Lambda sandbox before ML imports.

The image filesystem loads small files and mmap pages lazily. A sequential
archive read avoids paying thousands of individual cold filesystem faults.
"""
from pathlib import Path
import sys
import tarfile
import time


def lambda_handler(event, context):
    root = Path('/tmp/voice-python')
    ready = root / '.ready'
    if not ready.exists():
        started = time.monotonic()
        print('Preparing local Python runtime', flush=True)
        root.mkdir(exist_ok=True)
        with tarfile.open('/opt/python-runtime.tar.gz', 'r:gz') as archive:
            archive.extractall(root, filter='data')
        ready.touch()
        print(f'Python runtime prepared in {time.monotonic()-started:.1f}s', flush=True)
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    import handler
    return handler.lambda_handler(event, context)
