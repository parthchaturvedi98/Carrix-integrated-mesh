"""MCP-shaped adapter for the Terminal Operating System.

Exposes capability-named tools (``tos.read_yard``, ``tos.read_storage_plan``,
``tos.write_plan``). Read tools are free; the mutating ``write_plan`` requires an approved
HITL token before it touches the system.
"""
from __future__ import annotations

from typing import Any

import config
from guardrails import hitl

from . import _http

SYSTEM = "tos"
BASE = config.TOS_BASE


def read_yard() -> dict[str, Any]:
    return _http.get(BASE, "/yard")


def read_storage_plan() -> dict[str, Any]:
    return _http.get(BASE, "/storage_plan")


def write_plan(plan: dict[str, Any], hitl_token: str | None = None) -> dict[str, Any]:
    hitl.require_token(hitl_token, "tos.write_plan")
    return _http.post(BASE, "/storage_plan", plan)
