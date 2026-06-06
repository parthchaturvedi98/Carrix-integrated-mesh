"""Central configuration for the Carrix demo.

Everything is environment-overridable so the same code runs offline (deterministic
fallback) or against the real Anthropic API, and so adapters can be pointed at a real
system later without touching agent code.
"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader (no third-party deps). Lines like KEY=value; '#' comments."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        # don't override an explicitly-set environment variable
        os.environ.setdefault(key, value)


_load_dotenv(ROOT / ".env")

# --- LLM ---------------------------------------------------------------------
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()

# A stronger model reasons for the orchestrator; a faster model powers the workers.
# Exact strings are from docs.claude.com (Opus 4.8 / Sonnet 4.6).
ORCHESTRATOR_MODEL = os.getenv("CARRIX_ORCHESTRATOR_MODEL", "claude-opus-4-8")
WORKER_MODEL = os.getenv("CARRIX_WORKER_MODEL", "claude-sonnet-4-6")


def llm_enabled() -> bool:
    """True when a real API key is configured. Otherwise the demo uses the
    deterministic offline fallback so it always runs end-to-end."""
    return bool(ANTHROPIC_API_KEY)


def llm_mode() -> str:
    return "real" if llm_enabled() else "fallback"


# CA bundle for outbound HTTPS to the Anthropic API. On networks that intercept TLS, the
# corporate root CA must be trusted. Priority: explicit env override, else a `corp-ca.pem`
# placed next to this file (export it from the Windows cert store), else httpx's default.
def ca_bundle() -> str | bool:
    explicit = os.getenv("CARRIX_CA_BUNDLE") or os.getenv("SSL_CERT_FILE")
    if explicit and Path(explicit).exists():
        return explicit
    local = ROOT / "corp-ca.pem"
    if local.exists():
        return str(local)
    return True  # httpx default (certifi)


# --- Server bind (local dev defaults; deploy platforms inject HOST/PORT) ------
# Cloud hosts set $PORT and expect the app to listen on 0.0.0.0. Locally we keep
# 127.0.0.1:8000 so nothing changes for the dev workflow.
HOST = os.getenv("HOST", os.getenv("CARRIX_HOST", "127.0.0.1"))
PORT = int(os.getenv("PORT", os.getenv("CARRIX_PORT", "8000")))

# --- Mock systems (capability endpoints, one base path per system) -----------
# A real deployment swaps these base URLs for the real systems; nothing else changes.
# The orchestrator's adapters call these over HTTP on the SAME server, so the default
# base must track the actual listen port (loopback), whatever $PORT the host assigns.
MOCK_BASE = os.getenv("CARRIX_MOCK_BASE", f"http://127.0.0.1:{PORT}")
TOS_BASE = os.getenv("CARRIX_TOS_BASE", f"{MOCK_BASE}/tos")
EMODAL_BASE = os.getenv("CARRIX_EMODAL_BASE", f"{MOCK_BASE}/emodal")
AIS_BASE = os.getenv("CARRIX_AIS_BASE", f"{MOCK_BASE}/ais")
AS400_BASE = os.getenv("CARRIX_AS400_BASE", f"{MOCK_BASE}/as400")

# --- Storage / files ---------------------------------------------------------
DB_PATH = Path(os.getenv("CARRIX_DB_PATH", str(ROOT / "carrix.db")))
SCENARIO_PATH = Path(
    os.getenv("CARRIX_SCENARIO", str(ROOT / "scenarios" / "t18_collision.json"))
)
LOG_PATH = Path(os.getenv("CARRIX_LOG_PATH", str(ROOT / "carrix_trace.log")))

# --- UI -----------------------------------------------------------------------
# In production the built React app is served by this backend (single origin). When the
# folder exists, the server serves it; in dev it doesn't exist and the Vite server is used.
STATIC_DIR = Path(os.getenv("CARRIX_STATIC_DIR", str(ROOT / "ui" / "dist")))
UI_ORIGIN = os.getenv("CARRIX_UI_ORIGIN", "http://127.0.0.1:5173")
UI_ORIGIN_ALT = "http://localhost:5173"
