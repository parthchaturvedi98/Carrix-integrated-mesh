"""Schema validation guardrail (stdlib only).

Validates every agent output and every mutating tool call. On failure the error is returned
(and logged by the caller) so the orchestrator can repair or reject — never silently pass
malformed data into the plan or a write-back.
"""
from __future__ import annotations

from typing import Any

from agents.schemas import Action, AgentProposal, SchemaError, validate_proposal
from mcp_adapters import registry


def validate_agent_output(raw: dict[str, Any]) -> tuple[AgentProposal | None, str | None]:
    """Validate a raw agent output dict into an AgentProposal."""
    try:
        return validate_proposal(raw), None
    except SchemaError as exc:
        return None, str(exc)


def validate_mutating_action(action: Action) -> tuple[bool, str | None]:
    """Confirm a mutating action names a real, mutating tool. Mutating tools are gated by an
    approved HITL token at execution time (see guardrails.hitl)."""
    try:
        tool = registry.get(action.tool)
    except KeyError:
        return False, f"unknown tool '{action.tool}'"
    if action.mutating != tool.mutating:
        return False, (
            f"action.mutating={action.mutating} disagrees with registry "
            f"(tool '{action.tool}' mutating={tool.mutating})"
        )
    return True, None
