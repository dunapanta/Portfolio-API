"""Private, bounded voice cloning and single-speaker dubbing jobs on Lambda CPU."""
import gc
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import traceback
from decimal import Decimal

import boto3
import numpy as np
import soundfile as sf

BUCKET = os.environ.get('ASSETS_BUCKET', '')
TABLE = os.environ.get('JOBS_TABLE', '')
s3 = boto3.client('s3')
table = boto3.resource('dynamodb').Table(TABLE) if TABLE else None
translator = boto3.client('translate')
tts = None
asr = None


class Cancelled(Exception):
    pass


def update(job_id, **values):
    values['updatedAt'] = int(time.time())
    table.update_item(Key={'id': job_id},
        UpdateExpression='SET ' + ', '.join(f'#k{i} = :v{i}' for i in range(len(values))),
        ExpressionAttributeNames={f'#k{i}': key for i, key in enumerate(values)},
        ExpressionAttributeValues={f':v{i}': value for i, value in enumerate(values.values())})


def check(job_id, context):
    job = table.get_item(Key={'id': job_id}, ConsistentRead=True).get('Item', {})
    if job.get('status') in ('cancel_requested', 'cancelled'):
        raise Cancelled()
    if context.get_remaining_time_in_millis() < 40000:
        raise ValueError('El trabajo alcanzó el tiempo de procesamiento. Prueba un clip o un texto más corto.')


def command(args, timeout=45):
    # Arguments are never interpreted by a shell; media protocols cannot fetch URLs.
    result = subprocess.run(args, capture_output=True, timeout=timeout)
    if result.returncode:
        raise ValueError('No se pudo leer o convertir el archivo. Prueba un MP4 o WAV válido.')
    return result.stdout


def probe(path):
    data = json.loads(command(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe',
        '-show_format', '-show_streams', '-of', 'json', str(path)]))
    duration = float(data.get('format', {}).get('duration', 0))
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('No se pudo determinar la duración del archivo.')
    audio = any(s.get('codec_type') == 'audio' for s in data.get('streams', []))
    video = any(s.get('codec_type') == 'video' for s in data.get('streams', []))
    if not audio:
        raise ValueError('El archivo debe contener una pista de audio con voz.')
    return duration, video


def extract(source, dest, seconds=60, start=0):
    command(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe',
        '-ss', str(start), '-i', str(source), '-t', str(seconds), '-vn', '-ac', '1', '-ar', '24000',
        '-c:a', 'pcm_s16le', str(dest)])


def download(key, path, max_bytes):
    head = s3.head_object(Bucket=BUCKET, Key=key)
    if head['ContentLength'] <= 0 or head['ContentLength'] > max_bytes:
        raise ValueError('El archivo excede el tamaño permitido.')
    s3.download_file(BUCKET, key, str(path))


def local_models():
    # Lambda image files are fetched lazily. Sequentially materialize weights on
    # ephemeral disk before safetensors mmap, avoiding thousands of cold faults.
    source = Path('/opt/models/chatterbox')
    destination = Path('/tmp/chatterbox-models')
    destination.mkdir(exist_ok=True)
    for name in ('ve.pt', 't3_mtl23ls_v3.safetensors', 's3gen.pt', 'conds.pt', 'grapheme_mtl_merged_expanded_v1.json'):
        original, cached = source / name, destination / name
        if cached.exists() and cached.stat().st_size == original.stat().st_size:
            continue
        temporary = destination / (name + '.partial')
        with original.open('rb') as reader, temporary.open('wb') as writer:
            shutil.copyfileobj(reader, writer, length=8 * 1024 * 1024)
        temporary.replace(cached)
    # Tokenizer's HF cache is small and is already populated during image build.
    for name in ('models--ResembleAI--chatterbox', 'Cangjie5_TC.json'):
        original, cached = source / name, destination / name
        if original.exists() and not cached.exists(): cached.symlink_to(original)
    return str(destination)


def speech_model():
    global tts
    if tts is None:
        print('Loading speech dependencies', flush=True)
        import torch
        torch.set_num_threads(6)
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        print('Loading speech weights', flush=True)
        tts = ChatterboxMultilingualTTS.from_local(local_models(), device='cpu', t3_model='v3')
        print('Speech model ready', flush=True)
    return tts


def transcriber():
    global asr
    if asr is None:
        from faster_whisper import WhisperModel
        asr = WhisperModel('/opt/models/whisper-small', device='cpu', compute_type='int8', cpu_threads=6)
    return asr


def chunks(text, limit=160):
    text = re.sub(r'\s+', ' ', text).strip()
    while len(text) > limit:
        cut = text.rfind(' ', 0, limit)
        if cut < limit // 3:
            cut = limit
        yield text[:cut]
        text = text[cut:].strip()
    if text:
        yield text


def synthesize(text, language, reference, job_id, context):
    import torch
    model = speech_model()
    pieces = []
    for piece in chunks(text, 100 if language in ('ja', 'zh') else 160):
        check(job_id, context)
        with torch.inference_mode():
            # Keep built-in PerTh watermarking. Do not claim perfect speaker identity.
            wav = model.generate(piece, language_id=language, audio_prompt_path=str(reference),
                exaggeration=0.5, cfg_weight=0.3)
        audio = wav.squeeze().detach().cpu().numpy()
        if not np.isfinite(audio).all() or not len(audio) or np.max(np.abs(audio)) < 0.0001:
            raise ValueError('No se generó audio válido. Usa una muestra de voz más clara.')
        if len(audio) > model.sr * 35:
            raise ValueError('La voz generada es demasiado larga. Reduce el texto.')
        pieces.extend([audio, np.zeros(int(model.sr * .15), dtype=np.float32)])
    return np.concatenate(pieces), model.sr


def srt_time(seconds):
    millis = max(0, round(float(seconds) * 1000))
    hours, millis = divmod(millis, 3600000)
    minutes, millis = divmod(millis, 60000)
    seconds, millis = divmod(millis, 1000)
    return f'{hours:02}:{minutes:02}:{seconds:02},{millis:03}'


def save_output(job, path, content_type):
    key = f"jobs/{job['id']}/outputs/{path.name}"
    s3.upload_file(str(path), BUCKET, key, ExtraArgs={'ContentType': content_type,
        'ContentDisposition': f'attachment; filename="{path.name}"'})
    return {'key': key, 'name': path.name, 'contentType': content_type, 'bytes': path.stat().st_size}


def process(job, context):
    job_id = job['id']
    with tempfile.TemporaryDirectory(prefix='voice-') as folder:
        folder = Path(folder)
        reference = folder / 'reference.wav'
        outputs = []
        source = None
        source_audio = None
        is_video = False
        duration = 0
        if job['kind'] == 'dub':
            update(job_id, stage='Leyendo el clip', progress=5)
            source = folder / 'source.media'
            download(job['sourceKey'], source, 30 * 1024 * 1024)
            duration, is_video = probe(source)
            if duration > 60.1:
                raise ValueError('El doblaje admite clips de hasta 60 segundos.')
            source_audio = folder / 'source.wav'
            extract(source, source_audio)
        if job.get('referenceKey'):
            original_ref = folder / 'reference.media'
            download(job['referenceKey'], original_ref, 10 * 1024 * 1024)
            ref_duration, _ = probe(original_ref)
            if not 3 <= ref_duration <= 30.1:
                raise ValueError('La muestra de voz debe durar entre 3 y 30 segundos.')
            extract(original_ref, reference, seconds=15)
        elif job['kind'] != 'dub':
            raise ValueError('Falta la muestra para clonar la voz.')

        check(job_id, context)
        if job['kind'] == 'clone':
            update(job_id, stage='Clonando la voz y generando audio', progress=25)
            audio, rate = synthesize(job['text'], job['language'], reference, job_id, context)
            result = folder / 'voz-clonada-ia.wav'
            sf.write(result, audio, rate, subtype='PCM_16')
            outputs.append(save_output(job, result, 'audio/wav'))
            duration = len(audio) / rate
        else:
            update(job_id, stage='Transcribiendo el audio original', progress=15)
            requested_source = job.get('sourceLanguage', 'auto')
            segments, info = transcriber().transcribe(str(source_audio),
                language=None if requested_source == 'auto' else requested_source,
                beam_size=3, vad_filter=True, condition_on_previous_text=False)
            rows = []
            for segment in segments:
                check(job_id, context)
                text = segment.text.strip()
                start, end = max(0, segment.start), min(duration, segment.end)
                if text and end > start:
                    rows.append({'start': start, 'end': end, 'original': text})
            if not rows:
                raise ValueError('No se detectó voz clara. Prueba un clip con una sola persona hablando.')
            if sum(len(row['original']) for row in rows) > 1800 or len(rows) > 30:
                raise ValueError('Hay demasiado diálogo para esta prueba. Usa un clip más corto.')
            if not reference.exists():
                # Use the first speech region, rather than leading silence/music.
                start = max(0, rows[0]['start'])
                available = duration - start
                if available < 3:
                    raise ValueError('Sube una muestra de voz de al menos 3 segundos para este clip.')
                extract(source_audio, reference, seconds=min(12, available), start=start)
            update(job_id, stage='Traduciendo los diálogos', progress=30)
            for row in rows:
                check(job_id, context)
                if info.language == job['language']:
                    row['translated'] = row['original']
                else:
                    row['translated'] = translator.translate_text(Text=row['original'],
                        SourceLanguageCode=info.language, TargetLanguageCode=job['language'])['TranslatedText']
            rate = 24000
            timeline = np.zeros(math.ceil(duration * rate), dtype=np.float32)
            for i, row in enumerate(rows):
                update(job_id, stage=f'Generando doblaje · diálogo {i+1}/{len(rows)}', progress=35 + int(50*i/len(rows)))
                audio, rate = synthesize(row['translated'], job['language'], reference, job_id, context)
                # Fit each translated line to its original time window. Audio/video
                # alignment is approximate, not lip-sync; original audio is replaced.
                segment_path, fitted = folder / 'segment.wav', folder / 'fitted.wav'
                sf.write(segment_path, audio, rate)
                span = max(.2, row['end'] - row['start'])
                ratio = len(audio) / rate / span
                tempos = []
                while ratio > 2:
                    tempos.append('atempo=2'); ratio /= 2
                while ratio < .5:
                    tempos.append('atempo=0.5'); ratio /= .5
                tempos.append(f'atempo={ratio:.8f}')
                command(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-i', str(segment_path),
                    '-af', ','.join(tempos) + ',apad', '-t', str(span), '-ar', str(rate), str(fitted)])
                fitted_audio, _ = sf.read(fitted, dtype='float32')
                start = int(row['start'] * rate)
                end = min(len(timeline), start + len(fitted_audio))
                timeline[start:end] += fitted_audio[:end-start]
            check(job_id, context)
            update(job_id, stage='Preparando audio, subtítulos y video', progress=90)
            result = folder / 'doblaje-ia.wav'
            sf.write(result, np.clip(timeline, -1, 1), rate, subtype='PCM_16')
            outputs.append(save_output(job, result, 'audio/wav'))
            subtitles = folder / 'subtitulos-traducidos.srt'
            subtitles.write_text('\n\n'.join(f"{i+1}\n{srt_time(row['start'])} --> {srt_time(row['end'])}\n{row['translated']}" for i, row in enumerate(rows)) + '\n')
            outputs.append(save_output(job, subtitles, 'application/x-subrip'))
            transcript = folder / 'guion-traducido.json'
            transcript.write_text(json.dumps({'sourceLanguage': info.language, 'targetLanguage': job['language'], 'aiGenerated': True, 'segments': rows}, ensure_ascii=False, indent=2))
            outputs.append(save_output(job, transcript, 'application/json'))
            if is_video:
                video = folder / 'video-doblado-ia.mp4'
                command(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe',
                    '-i', str(source), '-i', str(result), '-map', '0:v:0', '-map', '1:a:0',
                    '-vf', 'scale=w=min(1280\\,iw):h=min(720\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2',
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
                    '-c:a', 'aac', '-b:a', '160k', '-t', str(duration), '-movflags', '+faststart', str(video)], timeout=90)
                outputs.append(save_output(job, video, 'video/mp4'))
            update(job_id, sourceLanguage=info.language)
        check(job_id, context)
        update(job_id, status='completed', stage='Listo para descargar', progress=100,
            outputs=outputs, duration=Decimal(str(round(duration, 3))), completedAt=int(time.time()))


def lambda_handler(event, context):
    for record in event.get('Records', []):
        job_id = json.loads(record['body'])['jobId']
        job = table.get_item(Key={'id': job_id}, ConsistentRead=True).get('Item')
        if not job or job.get('status') != 'queued' or job['expiresAt'] <= int(time.time()):
            continue
        try:
            table.update_item(Key={'id': job_id},
                UpdateExpression='SET #s = :running, startedAt = :now, updatedAt = :now',
                ConditionExpression='#s = :queued',
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues={':running': 'running', ':queued': 'queued', ':now': int(time.time())})
        except table.meta.client.exceptions.ConditionalCheckFailedException:
            continue
        try:
            process(job, context)
        except Cancelled:
            update(job_id, status='cancelled', stage='Trabajo cancelado')
        except Exception as error:
            print(json.dumps({'jobId': job_id, 'errorType': type(error).__name__, 'errno': getattr(error, 'errno', None), 'frames': [{'function': frame.name, 'line': frame.lineno} for frame in traceback.extract_tb(error.__traceback__)[-8:]]}), flush=True)
            message = str(error) if isinstance(error, ValueError) else 'No se pudo completar el audio. Prueba una muestra más clara o un clip más corto.'
            update(job_id, status='failed', stage='No se pudo completar', error=message[:400])
        finally:
            # Conditioning includes the last reference voice; discard between jobs.
            global tts, asr
            tts = None
            asr = None
            gc.collect()
    return {'ok': True}
