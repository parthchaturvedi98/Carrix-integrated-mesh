"""Vessel agent — confirms/adjusts the discharge window driving the surge."""
from __future__ import annotations

import json
from typing import Any

import analysis
from agents import base
from agents.schemas import Action, AgentProposal

NAME = "Vessel"
SYSTEM_PROMPT = base.load_prompt("vessel")


def _surge_vessel(snapshot: dict[str, Any]) -> dict[str, Any] | None:
    meta = analysis.scenario_meta()
    for v in snapshot.get("vessels", []):
        if v.get("terminal") == meta["terminal"] and v.get("discharge_window") == meta["focus_window"]:
            return v
    return None


def _fallback(snapshot: dict[str, Any]) -> AgentProposal:
    meta = analysis.scenario_meta()
    v = _surge_vessel(snapshot)
    if not v:
        return AgentProposal(
            agent=NAME, findings="No vessel discharging in the focus window.",
            proposed_actions=[], rationale="Nothing to confirm.",
            evidence_ids=["ais.positions", "ais.manifests"],
        )
    return AgentProposal(
        agent=NAME,
        findings=(
            f"{v.get('name', v['vessel_id'])} (ETA {v.get('eta')}) discharging "
            f"{v.get('discharge_count')} containers at {meta['terminal']} in {meta['focus_window']}; "
            f"manifest confirmed={bool(v.get('confirmed'))}."
        ),
        proposed_actions=[Action(
            tool="ais.confirm_window",
            args={"vessel_id": v["vessel_id"], "discharge_window": meta["focus_window"],
                  "confirmed": True},
            mutating=True,
            description=f"Confirm {v['vessel_id']} discharge window {meta['focus_window']}.",
        )],
        rationale=(
            "Confirming the discharge window gives the yard and gate plans a firm commitment to "
            "align to, closing the loop on the vessel side."
        ),
        evidence_ids=["ais.positions", "ais.manifests"],
    )


def run(snapshot: dict[str, Any], logger) -> AgentProposal:
    user_prompt = (
        "Reconciled world state (relevant slice):\n"
        + json.dumps({"vessels": snapshot.get("vessels", [])}, indent=2)
        + "\n\nProduce your AgentProposal JSON now."
    )
    return base.produce(NAME, SYSTEM_PROMPT, user_prompt, lambda: _fallback(snapshot), logger)
