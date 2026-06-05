"""Gate agent — staggers trucker appointment slots so no window's demand exceeds its slots."""
from __future__ import annotations

import json
from typing import Any

import analysis
from agents import base
from agents.schemas import Action, AgentProposal

NAME = "Gate"
SYSTEM_PROMPT = base.load_prompt("gate")


def _fallback(snapshot: dict[str, Any]) -> AgentProposal:
    meta = analysis.scenario_meta()
    appt = analysis.appointment_for(snapshot, meta["terminal"], meta["focus_window"]) or {}
    surge = int(appt.get("demand", 0)) - int(appt.get("slots", 0))
    updates = analysis.stagger_slots(snapshot)
    has_surge = surge > 0 and updates
    return AgentProposal(
        agent=NAME,
        findings=(
            f"Surge window {meta['focus_window']}: demand {appt.get('demand')} vs "
            f"{appt.get('slots')} slots (+{surge} over)."
            if has_surge else "No appointment surge detected."
        ),
        proposed_actions=[Action(
            tool="emodal.set_slots",
            args={"updates": updates},
            mutating=True,
            description="Stagger appointments across windows and add lanes to the surge window.",
        )] if has_surge else [],
        rationale=(
            "Move surplus appointment demand into adjacent windows with headroom and add lanes to "
            "the surge window so every window satisfies demand <= slots."
        ),
        evidence_ids=["emodal.list_appointments"],
    )


def run(snapshot: dict[str, Any], logger) -> AgentProposal:
    user_prompt = (
        "Reconciled world state (relevant slice):\n"
        + json.dumps({"appointments": snapshot.get("appointments", [])}, indent=2)
        + "\n\nProduce your AgentProposal JSON now."
    )
    return base.produce(NAME, SYSTEM_PROMPT, user_prompt, lambda: _fallback(snapshot), logger)
