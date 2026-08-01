import io
import json
import os
import traceback
from datetime import datetime, timezone
from typing import Any

import boto3
import cv2
import numpy as np
from PIL import Image

s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")

BUCKET = os.environ["ASSETS_BUCKET"]
TABLE = dynamodb.Table(os.environ["JOBS_TABLE"])

# Created lazily inside the first invocation. Lambda only allows ten seconds
# for module initialization, while loading the two CPU models can take longer.
# Subsequent warm invocations still reuse this process-level instance.
PIPELINE: Any = None


def get_pipeline() -> Any:
    global PIPELINE
    if PIPELINE is None:
        # Importing LayerD also imports PyTorch and is itself too expensive for
        # Lambda's ten-second module-init window, so keep the import lazy too.
        from layerd import LayerD

        PIPELINE = LayerD(
            matting_hf_card="cyberagent/layerd-birefnet",
            matting_process_size=(1024, 1024),
            kernel_scale=0.010,
            use_unblend=True,
            fg_refine=True,
            bg_refine=True,
        ).to("cpu")
    return PIPELINE


def update_job(job_id: str, **values: Any) -> None:
    values["updatedAt"] = datetime.now(timezone.utc).isoformat()
    names = {f"#k{i}": key for i, key in enumerate(values)}
    attrs = {f":v{i}": value for i, value in enumerate(values.values())}
    TABLE.update_item(
        Key={"id": job_id},
        UpdateExpression="SET " + ", ".join(f"#k{i} = :v{i}" for i in range(len(values))),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=attrs,
    )


def png_bytes(image: Image.Image) -> bytes:
    output = io.BytesIO()
    image.save(output, "PNG", optimize=True)
    return output.getvalue()


def merge_title_fragments(boxes: list[tuple[int, int, int, int]], canvas_height: int, canvas_width: int):
    """Merge horizontally adjacent headline fragments without joining feature cards."""
    pending = sorted(boxes, key=lambda b: (b[1], b[0]))
    merged: list[tuple[int, int, int, int]] = []
    for box in pending:
        x, y, w, h = box
        did_merge = False
        if y < canvas_height * 0.36 and h > canvas_height * 0.07:
            for index, current in enumerate(merged):
                cx, cy, cw, ch = current
                overlap = max(0, min(y + h, cy + ch) - max(y, cy)) / max(1, min(h, ch))
                gap = max(x - (cx + cw), cx - (x + w), 0)
                if overlap > 0.65 and gap < canvas_width * 0.045:
                    left, top = min(x, cx), min(y, cy)
                    right, bottom = max(x + w, cx + cw), max(y + h, cy + ch)
                    merged[index] = (left, top, right - left, bottom - top)
                    did_merge = True
                    break
        if not did_merge:
            merged.append(box)
    return merged


def component_boxes(image: Image.Image) -> list[tuple[int, int, int, int]]:
    alpha = np.asarray(image.getchannel("A"))
    height, width = alpha.shape
    mask = (alpha > 12).astype(np.uint8)
    kernel_width = max(9, int(round(width * 0.028)) | 1)
    kernel_height = max(3, int(round(height * 0.006)) | 1)
    grouped = cv2.dilate(mask, np.ones((kernel_height, kernel_width), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(grouped, connectivity=8)
    boxes: list[tuple[int, int, int, int]] = []
    for label in range(1, count):
        x, y, w, h, _ = map(int, stats[label])
        # Dilation adds padding; calculate tight bounds from the original alpha.
        y0, y1 = max(0, y), min(height, y + h)
        x0, x1 = max(0, x), min(width, x + w)
        visible_y, visible_x = np.where(alpha[y0:y1, x0:x1] > 3)
        if visible_x.size < 16:
            continue
        tight_x = x0 + int(visible_x.min())
        tight_y = y0 + int(visible_y.min())
        tight_w = int(visible_x.max() - visible_x.min() + 1)
        tight_h = int(visible_y.max() - visible_y.min() + 1)
        boxes.append((tight_x, tight_y, tight_w, tight_h))
    return merge_title_fragments(boxes, height, width)


def layer_name(index: int, box: tuple[int, int, int, int], width: int, height: int) -> str:
    x, y, w, h = box
    if y < height * 0.34 and w > width * 0.35:
        return f"Heading {index}"
    if y > height * 0.72 and w > width * 0.4:
        return f"Call to action {index}"
    if w < width * 0.25 and h < height * 0.25:
        return f"Detail {index}"
    return f"Element {index}"


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    job_id = str(event["jobId"])
    input_key = str(event["inputKey"])
    iterations = max(3, min(12, int(event.get("maxIterations", 10))))
    prefix = f"magic-layers/jobs/{job_id}/output"
    try:
        update_job(job_id, status="processing")
        source = s3.get_object(Bucket=BUCKET, Key=input_key)["Body"].read()
        original = Image.open(io.BytesIO(source)).convert("RGB")
        if original.width * original.height > 18_000_000:
            raise ValueError("Image exceeds the 18 megapixel limit.")

        raw_layers = get_pipeline().decompose(original, max_iterations=iterations)
        if len(raw_layers) < 2:
            raise RuntimeError("LayerD did not find editable foreground elements.")

        background_key = f"{prefix}/background.png"
        s3.put_object(Bucket=BUCKET, Key=background_key, Body=png_bytes(raw_layers[0]), ContentType="image/png")
        manifest_layers = []
        layer_index = 1
        # LayerD's CLI result composites correctly in returned order.
        for raw in raw_layers[1:]:
            rgba = raw.convert("RGBA")
            for box in component_boxes(rgba):
                x, y, width, height = box
                crop = rgba.crop((x, y, x + width, y + height))
                key = f"{prefix}/layer-{layer_index:03d}.png"
                s3.put_object(Bucket=BUCKET, Key=key, Body=png_bytes(crop), ContentType="image/png")
                manifest_layers.append({
                    "key": key,
                    "name": layer_name(layer_index, box, original.width, original.height),
                    "x": x,
                    "y": y,
                    "width": width,
                    "height": height,
                })
                layer_index += 1

        manifest_key = f"{prefix}/manifest.json"
        manifest = {
            "width": original.width,
            "height": original.height,
            "backgroundKey": background_key,
            "layers": manifest_layers,
        }
        s3.put_object(Bucket=BUCKET, Key=manifest_key, Body=json.dumps(manifest).encode(), ContentType="application/json")
        update_job(job_id, status="ready", resultKey=manifest_key)
        return {"jobId": job_id, "status": "ready", "layers": len(manifest_layers)}
    except Exception as error:
        traceback.print_exc()
        update_job(job_id, status="failed", error=str(error)[:800])
        raise
