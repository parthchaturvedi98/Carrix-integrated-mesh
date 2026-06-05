"""MCP-shaped adapter for the AIS vessel feed (+ stowage/discharge manifests).

Tools: ``ais.positions`` (read), ``ais.manifests`` (read),
``ais.confirm_window`` (mutating — write back the confirmed/adjusted discharge window).
"""
from __future__ import annotations

from typing import Any

import config
from guardrails import hitl

from . import _http

SYSTEM = "ais"
BASE = config.AIS_BASE


def positions() -> dict[str, Any]:
    return _http.get(BASE, "/positions")


def manifests() -> dict[str, Any]:
    return _http.get(BASE, "/manifests")


def confirm_window(vessel_id: str, discharge_window: str, confirmed: bool = True,
                   hitl_token: str | None = None) -> dict[str, Any]:
    hitl.require_token(hitl_token, "ais.confirm_window")
    return _http.post(BASE, "/discharge_window", {
        "vessel_id": vessel_id,
        "discharge_window": discharge_window,
        "confirmed": confirmed,
    })
