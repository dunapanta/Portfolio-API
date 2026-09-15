from huggingface_hub import snapshot_download

snapshot_download(
    'ResembleAI/chatterbox', revision='5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18',
    local_dir='/opt/models/chatterbox',
    allow_patterns=['ve.pt', 't3_mtl23ls_v3.safetensors', 's3gen.pt',
                    'grapheme_mtl_merged_expanded_v1.json', 'conds.pt', 'Cangjie5_TC.json', 'README.md'],
)
snapshot_download(
    'Systran/faster-whisper-small', revision='536b0662742c02347bc0e980a01041f333bce120',
    local_dir='/opt/models/whisper-small',
    allow_patterns=['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.*', 'preprocessor_config.json', 'README.md'],
)
# Instantiate both engines during image creation: missing assets/dependencies fail
# the build, rather than the first user job. No user recordings are used here.
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
engine = ChatterboxMultilingualTTS.from_local('/opt/models/chatterbox', device='cpu', t3_model='v3')
print('Chatterbox multilingual V3 loaded, sample rate', engine.sr)
del engine
from faster_whisper import WhisperModel
WhisperModel('/opt/models/whisper-small', device='cpu', compute_type='int8', cpu_threads=6)
print('Whisper small loaded; model preparation complete.')
