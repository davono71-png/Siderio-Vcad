#!/usr/bin/env python3
"""RunPod Serverless entrypoint.

Input::

    {"projectId": "<uuid>", "options": {"downscale": 2, "roomOverrides": {}}}

The handler downloads the survey from R2, runs the GPU pipeline and uploads
``rilievi/<projectId>/risultati/``. Progress is written to ``status.json`` and
sent with ``runpod.serverless.progress_update``.
"""

from __future__ import annotations

import os
import traceback

try:
    import runpod
except ImportError:  # local smoke tests do not install the SDK
    runpod = None

from siderio_worker.options import parse_options
from siderio_worker.pipeline import PipelineError, run_job


def handler(job):
    job = job or {}
    raw = job.get("input") or {}
    if not isinstance(raw, dict):
        return {"ok": False, "error": "input deve essere un oggetto JSON."}
    project_id = raw.get("projectId") or raw.get("project_id")
    if not project_id:
        return {"ok": False, "error": "Manca projectId."}

    def hook(payload):
        if runpod is None:
            print(f"[progress] {payload}", flush=True)
            return
        try:
            runpod.serverless.progress_update(job, payload)
        except Exception as exc:
            print(f"[progress] {exc}", flush=True)

    try:
        options = parse_options(raw.get("options") or {})
        work_root = os.environ.get("SIDERIO_WORK_ROOT", "/tmp/siderio").strip() or "/tmp/siderio"
        return run_job(str(project_id), options, work_root, hook=hook, upload=not options.local_project_dir)
    except (PipelineError, ValueError, RuntimeError) as exc:
        return {"ok": False, "error": str(exc), "stage": getattr(exc, "stage", None)}
    except Exception as exc:
        traceback.print_exc()
        return {"ok": False, "error": str(exc) or exc.__class__.__name__}


if __name__ == "__main__":
    if runpod is None:
        raise SystemExit("Il pacchetto runpod non è installato. In locale usa worker/test_local.py.")
    runpod.serverless.start({"handler": handler})
