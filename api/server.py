"""Backend API + mock systems on one stdlib HTTP server.

The React command centre calls ``/api/*``; the agents' adapters call the mock capability
routes (``/tos/...`` etc.) on the same server. Run with:

    python -m api.server
"""
from __future__ import annotations

import threading
import time
from typing import Any

import analysis
import config
from httpserver import HTTPError, Router, serve
from mcp_adapters import ais_adapter, as400_adapter, emodal_adapter, tos_adapter
from mocks.server import register_mocks, reseed
from orchestrator import loop
from tracing.logger import get_logger
from worldmodel import db

_TERMINAL_STATUSES = {"resolved", "applied", "rejected"}


# --- run view assembly -------------------------------------------------------

def _run_view(correlation_id: str) -> dict[str, Any]:
    run = db.get_run(correlation_id)
    if not run:
        raise HTTPError(404, f"unknown run {correlation_id}")
    conflicts = db.get_conflicts(correlation_id)
    proposal = db.get_proposal_for_run(correlation_id)
    return {
        "correlation_id": correlation_id,
        "status": run["status"],
        "llm_mode": run["llm_mode"],
        "conflicts": conflicts,
        "initial_conflict": conflicts[0] if conflicts else None,
        "latest_conflict": conflicts[-1] if conflicts else None,
        "proposal": proposal,
        "snapshot": db.get_snapshot(correlation_id),
    }


# --- API handlers ------------------------------------------------------------

def api_status(_params, _body):
    return 200, {
        "llm_mode": config.llm_mode(),
        "orchestrator_model": config.ORCHESTRATOR_MODEL,
        "worker_model": config.WORKER_MODEL,
        "scenario": analysis.scenario_meta(),
    }


def api_reset(_params, _body):
    reseed()
    db.reset_db()
    return 200, {"ok": True}


def api_sources(_params, _body):
    """Raw reads from the four (still disconnected) source systems, for the pre-run view that
    motivates clicking 'reconcile'. None of these systems sees the others."""
    return 200, {
        "tos": {
            "yard_blocks": tos_adapter.read_yard()["yard_blocks"],
            "storage_plan": tos_adapter.read_storage_plan(),
        },
        "emodal": {"appointments": emodal_adapter.list_appointments()["appointments"]},
        "ais": {
            "positions": ais_adapter.positions()["positions"],
            "manifests": ais_adapter.manifests()["manifests"],
        },
        "as400": {"fee_schedule": as400_adapter.fee_schedule()["fee_schedule"]},
        "scenario": analysis.scenario_meta(),
    }


def api_run(_params, _body):
    """Kick off the loop in the background and return immediately so the UI can stream each
    step (ingest, reason, every agent, assemble) live over SSE."""
    correlation_id = loop.begin_run()
    threading.Thread(target=loop.continue_run, args=(correlation_id,), daemon=True).start()
    return 200, {"correlation_id": correlation_id}


def api_get_run(params, _body):
    return 200, _run_view(params["id"])


def api_approve(params, _body):
    """Approve, then run the write-back + re-observe in the background so the UI can stream the
    write-back and resolution live. Status is flipped to 'applying' synchronously to avoid a race
    with the stream's terminal check."""
    proposal_id = params["id"]
    proposal = db.get_proposal(proposal_id)
    if not proposal:
        raise HTTPError(404, "proposal not found")
    correlation_id = proposal["correlation_id"]
    db.set_proposal_status(proposal_id, "approved")
    db.set_run_status(correlation_id, "applying")
    get_logger(correlation_id).info("approval", "Human APPROVED the proposed plan",
                                    {"proposal_id": proposal_id})

    def _work():
        try:
            loop.apply(proposal_id)
        except Exception as exc:  # pragma: no cover - defensive
            get_logger(correlation_id).error("act", f"write-back failed: {exc}",
                                             {"error": str(exc)})

    threading.Thread(target=_work, daemon=True).start()
    return 200, {"correlation_id": correlation_id}


def api_commit(params, body):
    """Per-agent HITL commit: body {"decisions": {"Yard":"approve","Gate":"reject",...}}.
    Only approved agents' write-backs execute; runs in the background to stream live."""
    proposal_id = params["id"]
    decisions = (body or {}).get("decisions") or {}
    if not isinstance(decisions, dict) or not decisions:
        raise HTTPError(400, "expected {'decisions': {agent: 'approve'|'reject'}}")
    proposal = db.get_proposal(proposal_id)
    if not proposal:
        raise HTTPError(404, "proposal not found")
    correlation_id = proposal["correlation_id"]
    approved = [a for a, d in decisions.items() if d == "approve"]
    rejected = [a for a, d in decisions.items() if d != "approve"]
    db.set_proposal_status(proposal_id, "approved")
    db.set_run_status(correlation_id, "applying")
    get_logger(correlation_id).info(
        "approval", f"Human committed per-agent decisions — approved {approved or 'none'}, "
        f"rejected {rejected or 'none'}",
        {"proposal_id": proposal_id, "approved": approved, "rejected": rejected})

    def _work():
        try:
            loop.apply(proposal_id, approved_agents=approved)
        except Exception as exc:  # pragma: no cover - defensive
            get_logger(correlation_id).error("act", f"write-back failed: {exc}", {"error": str(exc)})

    threading.Thread(target=_work, daemon=True).start()
    return 200, {"correlation_id": correlation_id}


def api_reject(params, _body):
    result = loop.reject(params["id"])
    return 200, {**result, "view": _run_view(result["correlation_id"])}


def api_traces(params, _body):
    return 200, {"traces": db.get_traces(params["id"])}


def api_stream(params, _body):
    """SSE: stream trace events for a run until it reaches a terminal status."""
    correlation_id = params["id"]
    last_seq = 0
    deadline = time.time() + 120
    while True:
        for t in db.get_traces(correlation_id, last_seq):
            last_seq = t["seq"]
            yield t
        run = db.get_run(correlation_id)
        status = run["status"] if run else None
        if status in _TERMINAL_STATUSES or status == "awaiting_approval":
            # drain any final events, then end this stream segment cleanly.
            for t in db.get_traces(correlation_id, last_seq):
                last_seq = t["seq"]
                yield t
            yield {"step": "_eof", "status": status, "seq": last_seq}
            return
        if time.time() > deadline:
            yield {"step": "_eof", "status": status or "timeout", "seq": last_seq}
            return
        time.sleep(0.3)


def health(_params, _body):
    return 200, {"service": "carrix-demo", "status": "ok", "llm_mode": config.llm_mode()}


def build_router() -> Router:
    router = Router()
    register_mocks(router)
    # NB: no "/" route — in production "/" falls through to the static SPA (index.html).
    router.get("/api/health", health)
    router.get("/api/status", api_status)
    router.get("/api/sources", api_sources)
    router.post("/api/reset", api_reset)
    router.post("/api/run", api_run)
    router.get("/api/runs/{id}", api_get_run)
    router.get("/api/runs/{id}/traces", api_traces)
    router.get("/api/runs/{id}/stream", api_stream, sse=True)
    router.post("/api/proposals/{id}/approve", api_approve)
    router.post("/api/proposals/{id}/commit", api_commit)
    router.post("/api/proposals/{id}/reject", api_reject)
    return router


def main() -> None:
    db.init_db()
    host, port = config.HOST, config.PORT
    static_dir = config.STATIC_DIR if config.STATIC_DIR.is_dir() else None
    httpd = serve(build_router(), host, port, static_dir=static_dir)
    ui = "serving built UI" if static_dir else "API only (run Vite separately)"
    print(f"Carrix demo on http://{host}:{port}  (LLM mode: {config.llm_mode()}; {ui})",
          flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("shutting down", flush=True)
        httpd.shutdown()


if __name__ == "__main__":
    main()
