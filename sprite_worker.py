"""AWS Lambda runner for the pinned aldegad/sprite-gen component-row pipeline.

The OpenAI provider is always named explicitly. API usage and calculated image
costs are persisted per call in DynamoDB, including runs that fail later.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import boto3

from sprite_gen.spec import layout

db = boto3.resource("dynamodb")
s3 = boto3.client("s3")
ssm = boto3.client("ssm")

STATE_ACTIONS = {
    "idle": (4, 4, True, "subtle breathing and one blink; stable grounded silhouette"),
    "walk": (4, 8, True, "four readable walking poses, alternating feet; experimental locomotion"),
    "run": (4, 10, True, "four distinct running poses with visible leg changes; experimental locomotion"),
    "jump": (4, 8, False, "crouch, takeoff, airborne, landing"),
    "attack": (4, 8, False, "windup, strike, follow-through, recovery with no detached effect"),
    "wave": (4, 6, False, "friendly wave with feet planted and clear arm movement"),
    "hurt": (4, 8, False, "impact, recoil, hold, recovery"),
    "celebrate": (4, 6, False, "anticipation, joyful pose, hold, settle"),
    "blink": (4, 6, True, "open eyes, half closed, closed, open; body still"),
    "talk": (4, 8, True, "four mouth shapes with consistent face and body"),
}
PRICING = {
    "text_input": Decimal("5"),
    "image_input": Decimal("8"),
    "image_output": Decimal("30"),
}


def now():
    return datetime.now(timezone.utc).isoformat()


def update(table, job_id, **values):
    values["updatedAt"] = now()
    names = {f"#k{i}": key for i, key in enumerate(values)}
    attrs = {f":v{i}": value for i, value in enumerate(values.values())}
    table.update_item(
        Key={"id": job_id},
        UpdateExpression="SET " + ", ".join(f"#k{i} = :v{i}" for i in range(len(values))),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=attrs,
    )


def run(*args, timeout=480):
    command = [sys.executable, "-m", "sprite_gen.cli", *map(str, args)]
    result = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
    if result.returncode:
        if "image request failed (HTTP 429)" in result.stdout:
            raise RuntimeError("OpenAI devolvió 429: la clave no tiene saldo o alcanzó su límite de solicitudes. Revisa la facturación y vuelve a intentar.")
        # The tool's last lines explain the failing state without logging credentials.
        raise RuntimeError(f"sprite-gen {args[0]} failed: {result.stdout[-1800:]}")
    return result.stdout


def cost_from_report(path):
    report = json.loads(path.read_text())
    usage = (report.get("extra") or {}).get("usage")
    if not isinstance(usage, dict):
        return None, None
    input_details = usage.get("input_tokens_details") or {}
    output_details = usage.get("output_tokens_details") or {}
    if "text_tokens" not in input_details or "image_tokens" not in input_details:
        return None, usage
    output = output_details.get("image_tokens", usage.get("output_tokens"))
    if output is None:
        return None, usage
    cached = usage.get("input_cached_tokens_details") or usage.get("cached_tokens_details") or {}
    cached_text = Decimal(str(cached.get("text_tokens", 0)))
    cached_image = Decimal(str(cached.get("image_tokens", 0)))
    text_tokens = Decimal(str(input_details["text_tokens"]))
    image_tokens = Decimal(str(input_details["image_tokens"]))
    output_tokens = Decimal(str(output))
    value = (
        (text_tokens - cached_text) * PRICING["text_input"]
        + cached_text * Decimal("1.25")
        + (image_tokens - cached_image) * PRICING["image_input"]
        + cached_image * Decimal("2")
        + output_tokens * PRICING["image_output"]
    ) / Decimal("1000000")
    return value.quantize(Decimal("0.000001")), usage


def handler(event, context):
    job_id = str(event["jobId"])
    table = db.Table(os.environ["spriteGenJobsTable"])
    response = table.get_item(Key={"id": job_id}, ConsistentRead=True)
    job = response.get("Item")
    if not job or job.get("status") != "queued":
        return {"jobId": job_id, "skipped": True}
    bucket = os.environ["spriteAssetsBucket"]
    prefix = job["resultPrefix"]
    costs = {}
    total = Decimal("0")
    missing_usage = False
    try:
        update(table, job_id, status="processing", stage="base")
        key_param = os.environ["OPENAI_API_KEY_PARAM"]
        os.environ["OPENAI_API_KEY"] = ssm.get_parameter(Name=key_param, WithDecryption=True)["Parameter"]["Value"]
        with tempfile.TemporaryDirectory(prefix="sprite-gen-", dir="/tmp") as temp:
            root = Path(temp)
            base = root / "base.png"
            if job.get("referenceKey"):
                key = job["referenceKey"]
                base = root / ("base." + key.rsplit(".", 1)[-1])
                s3.download_file(bucket, key, str(base))
            else:
                base_report = root / "base.report.json"
                base_prompt = (
                    f"Full body 2D game character, {job['description']}. "
                    f"Visual style: {job['style']}. Facing {job['direction']}. "
                    "Single character in a neutral idle pose, entirely inside the canvas, "
                    "consistent anatomy, clean silhouette, no text, no other objects."
                )
                run("gen", "--provider", "openai", "--model", job["model"],
                    "--quality", job["quality"], "--transparent", "--alpha-mode", "native",
                    "--prompt", base_prompt, "--out", base, "--report", base_report)
                base_cost, usage = cost_from_report(base_report)
                costs["base"] = {"costUsd": base_cost, "usage": usage}
                if base_cost is None:
                    missing_usage = True
                else:
                    total += base_cost
                update(table, job_id, costUsd=total, costStatus="partial" if missing_usage else "measured", stateCosts=costs)

            run_dir = root / "run"
            states = {state: {
                "frames": STATE_ACTIONS[state][0], "fps": STATE_ACTIONS[state][1],
                "loop": STATE_ACTIONS[state][2], "action": STATE_ACTIONS[state][3],
            } for state in job["states"]}
            recipe = {"states": states, "style": job["style"], "cell": {"size": 256}}
            run("prepare", "--out-dir", run_dir, "--character-id", job_id,
                "--base-image", base, "--description", job["description"],
                "--request-json", json.dumps(recipe))
            request = json.loads((run_dir / "sprite-request.json").read_text())
            reference = next(run_dir.glob("base-source.*"))
            for index, state in enumerate(job["states"]):
                update(table, job_id, stage=f"row:{state}")
                prompt = run_dir / layout.prompt_rel(request, state)
                guide = run_dir / layout.guide_rel(request, state)
                raw = run_dir / layout.raw_rel(request, state)
                report = run_dir / "reports" / "gen-set" / f"{state}.json"
                report.parent.mkdir(parents=True, exist_ok=True)
                raw.parent.mkdir(parents=True, exist_ok=True)
                run("gen", "--provider", "openai", "--model", job["model"],
                    "--quality", job["quality"], "--prompt-file", prompt,
                    "--ref", reference, "--ref", guide, "--out", raw, "--report", report)
                row_cost, usage = cost_from_report(report)
                costs[state] = {"costUsd": row_cost, "costPerFrameUsd": row_cost / 4 if row_cost is not None else None,
                                "frames": 4, "usage": usage}
                if row_cost is None:
                    missing_usage = True
                else:
                    total += row_cost
                update(table, job_id, costUsd=total, costStatus="partial" if missing_usage else "measured", stateCosts=costs)

            update(table, job_id, stage="extract")
            run("extract", "--run-dir", run_dir)
            update(table, job_id, stage="atlas")
            run("compose-atlas", "--run-dir", run_dir)
            run("compose-gif", "--run-dir", run_dir, "--out-dir", run_dir / "previews")
            run("inspect", "--run-dir", run_dir)
            files = {}
            publish = {
                "atlas": run_dir / "sprite-sheet-alpha.png",
                "manifest": run_dir / "manifest.json",
                "base": base,
            }
            for state in job["states"]:
                gif = run_dir / "previews" / f"{state}.gif"
                if gif.exists():
                    publish[f"preview_{state}"] = gif
            package = root / "sprites.zip"
            with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for path in run_dir.rglob("*"):
                    if path.is_file() and not path.name.endswith(".log"):
                        archive.write(path, path.relative_to(run_dir))
            publish["zip"] = package
            for name, path in publish.items():
                key = f"{prefix}/{name}{path.suffix}"
                mime = {".png": "image/png", ".gif": "image/gif", ".json": "application/json", ".zip": "application/zip"}.get(path.suffix, "application/octet-stream")
                s3.upload_file(str(path), bucket, key, ExtraArgs={"ContentType": mime})
                files[name] = key
            update(table, job_id, status="ready", stage="ready", files=files,
                   costUsd=total, costStatus="partial" if missing_usage else "measured", stateCosts=costs)
        return {"jobId": job_id, "status": "ready"}
    except Exception as exc:
        # Preserve spent calls and their usage when later stages fail.
        update(table, job_id, status="failed", stage="failed", error=str(exc)[-1200:],
               costUsd=total, costStatus="partial", stateCosts=costs)
        raise
    finally:
        os.environ.pop("OPENAI_API_KEY", None)
