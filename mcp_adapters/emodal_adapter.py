"""MCP-shaped adapter for the eModal gate/appointment layer.

Tools: ``emodal.list_appointments`` (read) and ``emodal.set_slots`` (mutating).
"""
from __future__ import annotations

from typing import Any

import config
from guardrails import hitl

from . import _http

SYSTEM = "emodal"
BASE = config.EMODAL_BASE


def list_appointments() -> dict[str, Any]:
    return _http.get(BASE, "/appointments")


def set_slots(updates: list[dict[str, Any]], hitl_token: str | None = None) -> dict[str, Any]:
    hitl.require_token(hitl_token, "emodal.set_slots")
    return _http.post(BASE, "/slots", {"updates": updates})
