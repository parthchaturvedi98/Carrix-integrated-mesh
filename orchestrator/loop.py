"""The orchestrator loop: ingest → reason → fan-out → act.

A Claude orchestrator (orchestrator–workers pattern) owns the loop. It ingests the four source
systems into the shared world model, reasons over the reconciled state to detect cross-silo
collisions, fans out to the relevant worker agents, and assembles their proposals into one plan.
It NEVER writes back without an approved human-in-the-loop decision; ``apply`` runs only after
approval and then re-observes the resolved state.
"""
from __future__ import annotations

from typing import Any

import analysis
import config
from agents import fees, gate, vessel, yard
from agents.schemas import AgentProposal
from guardrails import hitl, validate
from mcp_adapters import (
    ais_adapter,
    as400_adapter,
    emodal_adapter,
    registry,
    tos_adapter,
)
from tracing.logger import get_logger
from worldmodel import db

AGENTS = {"Yard": yard, "Gate": gate, "Vessel": vessel, "Fees": fees}


# --- ingest ------------------------------------------------------------------

def ingest(correlation_id: str, logger) -> dict[str, Any]:
    """Read all source systems via their adapters and reconcile into the world model."""
    logger.info("ingest", "Reading current state from all source systems")

    positions = ais_adapter.positions()["positions"]
    manifests = ais_adapter.manifests()["manifests"]
    pos_by_id = {p["vessel_id"]: p for p in positions}
    vessels = []
    for m in manifests:
        p = pos_by_id.get(m["vessel_id"], {})
        vessels.append({
            "vessel_id": m["vessel_id"],
            "name": p.get("name"),
            "terminal": m.get("terminal"),
            "eta": p.get("eta"),
            "status": p.get("status"),
            "discharge_count": m.get("discharge_count"),
            "discharge_window": m.get("discharge_window"),
            "confirmed": m.get("confirmed", False),
        })

    snapshot = {
        "vessels": vessels,
        "yard_blocks": tos_adapter.read_yard()["yard_blocks"],
        "storage_plan": tos_adapter.read_storage_plan(),
        "appointments": emodal_adapter.list_appointments()["appointments"],
        "fees": as400_adapter.fee_schedule()["fee_schedule"],
    }
    db.reconcile(correlation_id, snapshot)
    logger.info("ingest", "Reconciled snapshot written to world model", {
        "vessels": len(snapshot["vessels"]),
        "yard_blocks": len(snapshot["yard_blocks"]),
        "appointments": len(snapshot["appointments"]),
    })
    return db.get_snapshot(correlation_id)


# --- reason ------------------------------------------------------------------

def reason(correlation_id: str, snapshot: dict[str, Any], logger) -> dict[str, Any]:
    conflict = analysis.detect_collision(snapshot)
    db.save_conflict(correlation_id, conflict["detected"], conflict["summary"],
                     conflict["detail"])
    level = "warning" if conflict["detected"] else "info"
    # carry the full conflict on the event so the UI can render it live, before agents finish
    logger.event("reason", conflict["summary"], level, {
        "detected": conflict["detected"],
        "summary": conflict["summary"],
        "detail": conflict["detail"],
    })
    return conflict


# --- fan-out -----------------------------------------------------------------

_AGENT_TASKS = {
    "Yard": "reading yard occupancy + storage plan to re-sequence around congestion",
    "Gate": "reading appointment slots to stagger the trucker surge",
    "Vessel": "reading AIS positions + manifests to confirm the discharge window",
    "Fees": "reading the AS/400 fee schedule to compute demurrage/congestion impact",
}


def fan_out(correlation_id: str, snapshot: dict[str, Any], logger) -> list[AgentProposal]:
    logger.info("fanout", "Orchestrator fanning out to 4 worker agents", {"agents": list(AGENTS)})
    proposals: list[AgentProposal] = []
    for name, module in AGENTS.items():
        logger.info(f"agent:{name.lower()}", f"{name} agent {_AGENT_TASKS[name]}…",
                    {"agent": name, "state": "start"})
        proposal = module.run(snapshot, logger)
        # guardrail: validate every mutating action against the tool registry
        for action in proposal.proposed_actions:
            if action.mutating:
                ok, err = validate.validate_mutating_action(action)
                if not ok:
                    logger.warning("validate",
                                   f"{name} action rejected by guardrail: {err}",
                                   {"tool": action.tool})
                    proposal.proposed_actions = [
                        a for a in proposal.proposed_actions if a is not action
                    ]
        proposals.append(proposal)
        # emit the agent's completed proposal on the stream so the UI can render its card
        # the instant the agent's status turns to "done" (agents are independent — no need to
        # wait for the others or the final assemble step).
        logger.info(f"agent:{name.lower()}",
                    f"{name} agent ready — {len(proposal.proposed_actions)} action(s) proposed",
                    {"agent": name, "state": "done", "proposal": proposal.model_dump()})
    return proposals


# --- assemble ----------------------------------------------------------------

def assemble(correlation_id: str, conflict: dict[str, Any],
             proposals: list[AgentProposal], logger) -> str:
    actions = []
    for p in proposals:
        for a in p.proposed_actions:
            if a.mutating:
                actions.append({"agent": p.agent, **a.model_dump()})
    plan = {
        "conflict": conflict,
        "agents": [p.model_dump() for p in proposals],
        "actions": actions,
    }
    proposal_id = db.save_proposal(correlation_id, plan)
    db.set_run_status(correlation_id, "awaiting_approval")
    logger.info("assemble",
                "Assembled proposed plan; awaiting human approval (no write-back yet)",
                {"proposal_id": proposal_id, "mutating_actions": len(actions)})
    return proposal_id


# --- run (one pass of the loop, up to approval) ------------------------------

def _pipeline(correlation_id: str, logger) -> tuple[dict[str, Any], str | None]:
    snapshot = ingest(correlation_id, logger)
    conflict = reason(correlation_id, snapshot, logger)
    proposal_id = None
    if conflict["detected"]:
        proposals = fan_out(correlation_id, snapshot, logger)
        proposal_id = assemble(correlation_id, conflict, proposals, logger)
    else:
        db.set_run_status(correlation_id, "resolved")
        logger.info("done", "No collision detected; nothing to propose")
    return conflict, proposal_id


def begin_run() -> str:
    """Create the run row and return its id immediately (status 'running'), so the API can
    hand the correlation id to the UI and stream trace events as the pipeline executes."""
    return db.new_run(config.llm_mode())


def continue_run(correlation_id: str) -> None:
    """Execute the pipeline for an already-created run. Intended to run in a background
    thread so the UI sees each step (ingest, reason, each agent, assemble) live over SSE."""
    logger = get_logger(correlation_id)
    logger.info("start", "Orchestrator run started", {"llm_mode": config.llm_mode()})
    _pipeline(correlation_id, logger)


def run() -> dict[str, Any]:
    """Synchronous one-pass run (used by tests and any non-streaming caller)."""
    correlation_id = begin_run()
    continue_run(correlation_id)
    conflicts = db.get_conflicts(correlation_id)
    proposal = db.get_proposal_for_run(correlation_id)
    return {
        "correlation_id": correlation_id,
        "detected": conflicts[0]["detected"] if conflicts else False,
        "proposal_id": proposal["id"] if proposal else None,
    }


# --- act (write-back, only after approval) -----------------------------------

def apply(proposal_id: str, approved_agents: list[str] | None = None) -> dict[str, Any]:
    """Execute the write-back for the operator-APPROVED agents only.

    ``approved_agents`` is the set of agents whose proposed action the human approved. None
    means approve every mutating action (used by the bulk ``approve`` path / tests). Each
    approved action runs under a HITL token; rejected ones are skipped and logged. The
    decision is persisted onto each action so the UI can show it.
    """
    proposal = db.get_proposal(proposal_id)
    if not proposal:
        raise KeyError("proposal not found")
    correlation_id = proposal["correlation_id"]
    logger = get_logger(correlation_id)

    if proposal["status"] != "approved":
        logger.error("act", "Refusing to apply a proposal that is not approved",
                     {"status": proposal["status"]})
        raise hitl.HITLError("proposal is not approved")

    plan = proposal["plan"]
    actions = plan["actions"]
    if approved_agents is None:
        approved_set = {a["agent"] for a in actions}
    else:
        approved_set = set(approved_agents)

    db.set_run_status(correlation_id, "applying")
    token = hitl.mint_token(proposal_id)
    logger.info("act", "Executing operator-approved write-backs with a HITL token",
                {"approved": sorted(approved_set),
                 "rejected": sorted({a["agent"] for a in actions} - approved_set)})
    try:
        for action in actions:
            if action["agent"] in approved_set:
                action["decision"] = "approved"
                result = registry.execute(action["tool"], action.get("args", {}), token)
                logger.info("writeback",
                            f"Applied {action['tool']} ({action['agent']} agent) — operator-approved",
                            {"tool": action["tool"], "agent": action["agent"],
                             "ok": bool(result.get("ok", True))})
            else:
                action["decision"] = "rejected"
                logger.warning("writeback",
                               f"Skipped {action['tool']} ({action['agent']} agent) — operator rejected",
                               {"tool": action["tool"], "agent": action["agent"]})
    finally:
        hitl.revoke(token)

    db.save_proposal_plan(proposal_id, plan)  # persist per-agent decisions

    # re-observe the new state and report whether the conflict is (fully) resolved
    snapshot = ingest(correlation_id, logger)
    conflict = reason(correlation_id, snapshot, logger)
    if not conflict["detected"]:
        status = "resolved"
    elif approved_set:
        status = "applied"  # partial — some write-backs approved but conflict persists
    else:
        status = "rejected"  # nothing approved
    db.set_run_status(correlation_id, status)
    logger.info("done", {
        "resolved": "Loop re-observed; collision resolved",
        "applied": "Loop re-observed; approved write-backs applied but collision not fully resolved",
        "rejected": "All decisions rejected; no write-back performed",
    }[status])
    return {"correlation_id": correlation_id, "resolved": not conflict["detected"],
            "status": status, "conflict": conflict}


def commit(proposal_id: str, decisions: dict[str, str]) -> dict[str, Any]:
    """Per-agent HITL commit. ``decisions`` maps agent name -> 'approve'|'reject'."""
    proposal = db.get_proposal(proposal_id)
    if not proposal:
        raise KeyError("proposal not found")
    approved = [agent for agent, d in decisions.items() if d == "approve"]
    rejected = [agent for agent, d in decisions.items() if d != "approve"]
    db.set_proposal_status(proposal_id, "approved")
    get_logger(proposal["correlation_id"]).info(
        "approval", f"Human committed per-agent decisions — approved {approved or 'none'}, "
        f"rejected {rejected or 'none'}",
        {"proposal_id": proposal_id, "approved": approved, "rejected": rejected})
    return apply(proposal_id, approved_agents=approved)


def approve(proposal_id: str) -> dict[str, Any]:
    proposal = db.get_proposal(proposal_id)
    if not proposal:
        raise KeyError("proposal not found")
    db.set_proposal_status(proposal_id, "approved")
    get_logger(proposal["correlation_id"]).info(
        "approval", "Human APPROVED the proposed plan", {"proposal_id": proposal_id})
    return apply(proposal_id)


def reject(proposal_id: str) -> dict[str, Any]:
    proposal = db.get_proposal(proposal_id)
    if not proposal:
        raise KeyError("proposal not found")
    db.set_proposal_status(proposal_id, "rejected")
    db.set_run_status(proposal["correlation_id"], "rejected")
    get_logger(proposal["correlation_id"]).warning(
        "approval", "Human REJECTED the proposed plan; no write-back performed",
        {"proposal_id": proposal_id})
    return {"correlation_id": proposal["correlation_id"], "rejected": True}
