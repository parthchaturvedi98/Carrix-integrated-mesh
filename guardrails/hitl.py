"""Human-in-the-loop gate.

The highest-blast-radius action — writing back to a source system — is human-controlled.
Any mutating tool call requires a valid HITL token, and tokens are only minted when a human
explicitly approves a staged proposal. No silent writes.
"""
from __future__ import annotations

import uuid

# token -> proposal_id. A token is valid for the duration of one approved apply phase.
_TOKENS: dict[str, str] = {}


class HITLError(RuntimeError):
    """Raised when a mutating action is attempted without a valid approval token."""


def mint_token(proposal_id: str) -> str:
    token = "hitl-" + uuid.uuid4().hex
    _TOKENS[token] = proposal_id
    return token


def verify_token(token: str | None) -> bool:
    return bool(token) and token in _TOKENS


def require_token(token: str | None, tool_name: str) -> None:
    if not verify_token(token):
        raise HITLError(
            f"Mutating tool '{tool_name}' blocked: no approved HITL token. "
            "Write-back requires explicit human approval."
        )


def revoke(token: str) -> None:
    _TOKENS.pop(token, None)
