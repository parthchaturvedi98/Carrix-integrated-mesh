"""Yard agent — re-sequences the storage plan so the discharge fits without block overflow."""
from __future__ import annotations

import json
from typing import Any

import analysis
from agents import base
from agents.schemas import Action, AgentProposal

NAME = "Yard"
SYSTEM_PROMPT = base.load_prompt("yard")


def _fallback(snapshot: dict[str, Any]) -> AgentProposal:
    overflow = analysis.plan_overflow(snapshot)
    plan = analysis.resequence_plan(snapshot)
    plan.pop("_unplaced", None)
    blocks = ", ".join(f"{i['block']}={i['containers']}" for i in plan["sequence"])
    findings = (
        f"Current storage plan overflows {len(overflow)} block(s): "
        + "; ".join(f"{o['block']} +{o['overflow']} over capacity" for o in overflow)
        if overflow else "Storage plan is within capacity."
    )
    return AgentProposal(
        agent=NAME,
        findings=findings,
        proposed_actions=[Action(
            tool="tos.write_plan",
            args={"plan": plan},
            mutating=True,
            description=f"Re-sequence storage plan across blocks: {blocks}",
        )] if overflow else [],
        rationale=(
            "Spread the discharge across same-terminal blocks first, then relief blocks, so no "
            "block exceeds its remaining capacity — eliminating the yard congestion."
        ),
        evidence_ids=["tos.read_yard", "tos.read_storage_plan"],
    )


def run(snapshot: dict[str, Any], logger) -> AgentProposal:
    user_prompt = (
        "Reconciled world state (relevant slice):\n"
        + json.dumps({
            "yard_blocks": snapshot.get("yard_blocks", []),
            "storage_plan": snapshot.get("storage_plan"),
            "overflow": analysis.plan_overflow(snapshot),
        }, indent=2)
        + "\n\nProduce your AgentProposal JSON now."
    )
    return base.produce(NAME, SYSTEM_PROMPT, user_prompt, lambda: _fallback(snapshot), logger)
