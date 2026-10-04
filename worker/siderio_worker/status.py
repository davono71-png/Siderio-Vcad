"""status.json on disk and, when R2 is configured, in the bucket."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class StatusWriter:
    def __init__(self, project_id: str, path: str, hook=None):
        self.path = path
        self.hook = hook
        self.data = {
            "projectId": project_id,
            "ok": None,
            "stage": "avvio",
            "progress": 0,
            "message": "Avvio",
            "error": None,
            "timingsSec": {},
            "updatedAt": now_iso(),
        }
        self.write()

    def update(self, stage: str, progress: float, message: str, timings=None):
        self.data["stage"] = stage
        self.data["progress"] = int(max(0, min(100, round(progress))))
        self.data["message"] = message
        self.data["updatedAt"] = now_iso()
        if timings:
            self.data["timingsSec"] = {k: round(float(v), 2) for k, v in timings.items()}
        self.write()
        self._hook()

    def fail(self, message: str, stage: str | None = None):
        self.data["ok"] = False
        self.data["error"] = message
        if stage:
            self.data["stage"] = stage
        self.data["message"] = message
        self.data["updatedAt"] = now_iso()
        self.write()
        self._hook()

    def finish(self, message: str, timings=None):
        self.data["ok"] = True
        self.data["error"] = None
        self.data["stage"] = "completato"
        self.data["progress"] = 100
        self.data["message"] = message
        self.data["updatedAt"] = now_iso()
        if timings:
            self.data["timingsSec"] = {k: round(float(v), 2) for k, v in timings.items()}
        self.write()

    def write(self):
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(self.data, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, self.path)

    def _hook(self):
        if not self.hook:
            return
        try:
            self.hook(
                {
                    "stage": self.data["stage"],
                    "progress": self.data["progress"],
                    "message": self.data["message"],
                }
            )
        except Exception as exc:  # progress must never fail the job
            print(f"[status] progress hook: {exc}", flush=True)
