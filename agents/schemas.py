"""Schema-validated output contracts for the worker agents (stdlib only, no Pydantic).

Every agent returns an ``AgentProposal``. The orchestrator validates each one before it is
allowed into the assembled plan; invalid output is caught, logged, and (once) repaired or
rejected. Mutating actions are explicitly flagged so the HITL gate can stage them.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

AGENT_NAMES = {"Yard", "Gate", "Vessel", "Fees"}


class SchemaError(ValueError):
    """Raised when a raw agent output fails the output contract."""


@dataclass
class Action:
    """A single proposed action. ``tool`` is a capability name from the registry."""
    tool: str
    args: dict[str, Any] = field(default_factory=dict)
    mutating: bool = False
    description: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    # alias kept so call sites read naturally
    model_dump = to_dict


@dataclass
class AgentProposal:
    agent: str
    findings: str
    rationale: str
    proposed_actions: list[Action] = field(default_factory=list)
    evidence_ids: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "agent": self.agent,
            "findings": self.findings,
            "rationale": self.rationale,
            "proposed_actions": [a.to_dict() for a in self.proposed_actions],
            "evidence_ids": list(self.evidence_ids),
        }

    model_dump = to_dict


_ALLOWED_KEYS = {"agent", "findings", "rationale", "proposed_actions", "evidence_ids"}
_ALLOWED_ACTION_KEYS = {"tool", "args", "mutating", "description"}


def validate_proposal(raw: Any) -> AgentProposal:
    """Validate a raw dict into an AgentProposal, mirroring a strict (extra-forbidden) schema.
    Raises SchemaError on any contract violation."""
    if not isinstance(raw, dict):
        raise SchemaError(f"expected object, got {type(raw).__name__}")

    extra = set(raw) - _ALLOWED_KEYS
    if extra:
        raise SchemaError(f"unexpected field(s): {sorted(extra)}")

    agent = raw.get("agent")
    if agent not in AGENT_NAMES:
        raise SchemaError(f"agent must be one of {sorted(AGENT_NAMES)}, got {agent!r}")

    for key in ("findings", "rationale"):
        if not isinstance(raw.get(key), str) or not raw[key].strip():
            raise SchemaError(f"'{key}' must be a non-empty string")

    evidence = raw.get("evidence_ids", [])
    if not isinstance(evidence, list) or not all(isinstance(e, str) for e in evidence):
        raise SchemaError("'evidence_ids' must be a list of strings")

    raw_actions = raw.get("proposed_actions", [])
    if not isinstance(raw_actions, list):
        raise SchemaError("'proposed_actions' must be a list")

    actions: list[Action] = []
    for i, a in enumerate(raw_actions):
        if not isinstance(a, dict):
            raise SchemaError(f"proposed_actions[{i}] must be an object")
        extra_a = set(a) - _ALLOWED_ACTION_KEYS
        if extra_a:
            raise SchemaError(f"proposed_actions[{i}] unexpected field(s): {sorted(extra_a)}")
        if not isinstance(a.get("tool"), str) or not a["tool"]:
            raise SchemaError(f"proposed_actions[{i}].tool must be a non-empty string")
        args = a.get("args", {})
        if not isinstance(args, dict):
            raise SchemaError(f"proposed_actions[{i}].args must be an object")
        actions.append(Action(
            tool=a["tool"],
            args=args,
            mutating=bool(a.get("mutating", False)),
            description=str(a.get("description", "")),
        ))

    return AgentProposal(
        agent=agent,
        findings=raw["findings"],
        rationale=raw["rationale"],
        proposed_actions=actions,
        evidence_ids=list(evidence),
    )
