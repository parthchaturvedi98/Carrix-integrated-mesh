"""Structured tracing with a correlation ID per run.

Every step of the loop (ingest, reason, each agent call, validation result, approval,
write-back) emits a structured JSON line to stdout and a log file, and persists a
``trace_events`` row so the command-centre UI can replay the run.
"""
from __future__ import annotations

import json
import sys
import time
from typing import Any

import config
from worldmodel import db


class RunLogger:
    """A logger bound to one correlation ID. Use via ``get_logger(correlation_id)``."""

    def __init__(self, correlation_id: str):
        self.correlation_id = correlation_id

    def event(self, step: str, message: str, level: str = "info",
              data: dict[str, Any] | None = None) -> dict[str, Any]:
        rec = db.add_trace(self.correlation_id, step, level, message, data)
        line = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(rec["ts"])),
            "correlation_id": self.correlation_id,
            "seq": rec["seq"],
            "step": step,
            "level": level,
            "message": message,
        }
        if data is not None:
            line["data"] = data
        text = json.dumps(line)
        stream = sys.stderr if level in ("error", "warning") else sys.stdout
        print(text, file=stream, flush=True)
        try:
            with open(config.LOG_PATH, "a", encoding="utf-8") as fh:
                fh.write(text + "\n")
        except OSError:
            pass
        return rec

    # convenience wrappers
    def info(self, step: str, message: str, data: dict | None = None):
        return self.event(step, message, "info", data)

    def warning(self, step: str, message: str, data: dict | None = None):
        return self.event(step, message, "warning", data)

    def error(self, step: str, message: str, data: dict | None = None):
        return self.event(step, message, "error", data)


def get_logger(correlation_id: str) -> RunLogger:
    return RunLogger(correlation_id)
