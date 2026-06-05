"""Fees agent — computes demurrage/congestion figures (compute only, no write-back)."""
from __future__ import annotations

import json
from typing import Any

import analysis
from agents import base
from agents.schemas import AgentProposal

NAME = "Fees"
SYSTEM_PROMPT = base.load_prompt("fees")


def _fallback(snapshot: dict[str, Any]) -> AgentProposal:
    fig = analysis.compute_fees(snapshot)
    cur = fig["currency"]
    findings = (
        f"{fig['overflow_containers']} containers at risk of congestion handling. "
        f"Estimated congestion surcharge {cur} {fig['congestion_surcharge']:,.2f}; "
        f"demurrage risk {cur} {fig['demurrage_risk_per_day']:,.2f}/day if left unplaced."
    )
    return AgentProposal(
        agent=NAME,
        findings=findings,
        proposed_actions=[],  # compute only — never writes financial transactions
        rationale=(
            "Figures derived from the AS/400 fee schedule (congestion surcharge, demurrage rate) "
            "applied to over-capacity containers. Resolving the yard overflow drives these to zero."
        ),
        evidence_ids=["as400.fee_schedule", "as400.demurrage_rules"],
    )


def run(snapshot: dict[str, Any], logger) -> AgentProposal:
    user_prompt = (
        "Reconciled world state (relevant slice):\n"
        + json.dumps({
            "fees": snapshot.get("fees", []),
            "overflow": analysis.plan_overflow(snapshot),
            "computed": analysis.compute_fees(snapshot),
        }, indent=2)
        + "\n\nProduce your AgentProposal JSON now."
    )
    return base.produce(NAME, SYSTEM_PROMPT, user_prompt, lambda: _fallback(snapshot), logger)
