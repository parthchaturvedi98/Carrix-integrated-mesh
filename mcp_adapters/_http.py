"""Tiny HTTP helper shared by the adapters.

Adapters are the ONLY layer that knows how to talk to a concrete system. Today that is a
mock over HTTP; swapping in a real system later changes only this layer (and the base URL),
never the agents. A single pooled client is reused across calls/threads to keep ingest fast.
"""
from __future__ import annotations

import threading
from typing import Any

import httpx

_TIMEOUT = httpx.Timeout(10.0)
_client: httpx.Client | None = None
_lock = threading.Lock()


def _get_client() -> httpx.Client:
    global _client
    if _client is None:
        with _lock:
            if _client is None:
                _client = httpx.Client(timeout=_TIMEOUT)
    return _client


def get(base: str, path: str) -> Any:
    resp = _get_client().get(f"{base}{path}")
    resp.raise_for_status()
    return resp.json()


def post(base: str, path: str, payload: dict) -> Any:
    resp = _get_client().post(f"{base}{path}", json=payload)
    resp.raise_for_status()
    return resp.json()
