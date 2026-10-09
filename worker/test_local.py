#!/usr/bin/env python3
"""Run the worker on this machine.

Examples::

    python worker/test_local.py --smoke
    python worker/test_local.py --project-dir ./rilievo --out ./out --device cpu
    python worker/test_local.py --project-id <uuid> --device cpu

``--project-dir`` reads ``project.json`` plus the JPEGs (``foto/001.jpg`` or the
``r2Key`` file name) and does not upload. ``--project-id`` uses the R2 env vars
and uploads ``rilievi/<id>/risultati/``. Without a GPU the pipeline falls back
to CPU.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from siderio_worker.options import parse_options  # noqa: E402
from siderio_worker.pipeline import run_job  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser(description="Prova locale del worker Siderio Vcad")
    parser.add_argument("--smoke", action="store_true", help="import e test sintetico, senza foto")
    parser.add_argument("--project-dir", help="cartella con project.json e le foto")
    parser.add_argument("--project-id", help="UUID del rilievo su R2")
    parser.add_argument("--out", default="./out-siderio", help="cartella di lavoro")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--downscale", type=int, default=2)
    parser.add_argument("--skip-dense", action="store_true")
    parser.add_argument("--mode", choices=["stanza", "facciata"], help="stanza (default) o facciata")
    args = parser.parse_args(argv)
    if args.smoke or (not args.project_dir and not args.project_id):
        from smoke_test import main as smoke

        smoke()
        if not args.project_dir and not args.project_id:
            return
    raw = {"device": args.device, "downscale": args.downscale, "skipDense": args.skip_dense}
    if args.mode:
        raw["mode"] = args.mode
    if args.project_dir:
        raw["localProjectDir"] = os.path.abspath(args.project_dir)
        project_id = args.project_id or "00000000-0000-4000-8000-000000000000"
        result = run_job(project_id, parse_options(raw), os.path.abspath(args.out), upload=False)
    else:
        from handler import handler

        result = handler({"id": "local", "input": {"projectId": args.project_id, "options": raw}})
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not result.get("ok", True):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
