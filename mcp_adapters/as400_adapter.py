"""MCP-shaped adapter for the AS/400 ERP (fees).

Read-only: ``as400.fee_schedule`` and ``as400.demurrage_rules``. The Fees agent only
*computes* figures from these — it never writes financial transactions.
"""
from __future__ import annotations

from typing import Any

import config

from . import _http

SYSTEM = "as400"
BASE = config.AS400_BASE


def fee_schedule() -> dict[str, Any]:
    return _http.get(BASE, "/fee_schedule")


def demurrage_rules() -> dict[str, Any]:
    return _http.get(BASE, "/demurrage_rules")
