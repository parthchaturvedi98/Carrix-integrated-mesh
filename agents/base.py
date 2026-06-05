"""Dual-mode worker runner (stdlib + httpx only).

When ``ANTHROPIC_API_KEY`` is set, an agent asks the worker model (Sonnet) for a structured
proposal, which is schema-validated (with one repair attempt). Otherwise — or if the model's
output cannot be made valid — it falls back to a deterministic proposal so the demo always
runs and the conflict reliably resolves. Every validation outcome is traced.

The Anthropic call goes over httpx directly (no SDK dependency), with prompt caching on the
static agent brief.
"""
from __future__ import annotations

import json
from typing import Any, Callable

import httpx

import config
from agents.schemas import AgentProposal, SchemaError, validate_proposal

PROMPTS_DIR = config.ROOT / "orchestrator" / "prompts"
_ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"


def load_prompt(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")


def _extract_json(text: str) -> dict[str, Any]:
    """Pull a JSON object out of a model reply, tolerating ```json fences and prose."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.lstrip().startswith("json"):
            text = text.lstrip()[4:]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object found in model reply")
    return json.loads(text[start:end + 1])


def _call_model(system_prompt: str, user_prompt: str) -> dict[str, Any]:
    """Call the Anthropic Messages API over HTTP, with prompt caching on the system brief."""
    headers = {
        "x-api-key": config.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    payload = {
        "model": config.WORKER_MODEL,
        "max_tokens": 1500,
        "system": [{
            "type": "text",
            "text": system_prompt,
            "cache_control": {"type": "ephemeral"},  # cache the static agent brief
        }],
        "messages": [{"role": "user", "content": user_prompt}],
    }
    with httpx.Client(timeout=httpx.Timeout(60.0), verify=config.ca_bundle()) as client:
        resp = client.post(_ANTHROPIC_URL, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
    parts = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
    return _extract_json("\n".join(parts))


def produce(
    agent_name: str,
    system_prompt: str,
    user_prompt: str,
    fallback_fn: Callable[[], AgentProposal],
    logger,
) -> AgentProposal:
    """Return a schema-valid AgentProposal, via the model (if enabled) or the fallback."""
    step = f"agent:{agent_name.lower()}"

    def _done(proposal, note):
        # no 'state' here: the per-agent 'done' (with the proposal payload) is emitted by
        # the orchestrator's fan_out, so the UI card and the strip tick arrive together.
        return {"agent": agent_name, "actions": len(proposal.proposed_actions), "note": note}

    if not config.llm_enabled():
        proposal = fallback_fn()
        logger.info(step, f"{agent_name} agent proposed {len(proposal.proposed_actions)} action(s) "
                    f"(deterministic)", _done(proposal, "deterministic"))
        return proposal

    for attempt in (1, 2):
        try:
            raw = _call_model(system_prompt, user_prompt)
            proposal = validate_proposal(raw)
            logger.info(step, f"{agent_name} agent proposed {len(proposal.proposed_actions)} "
                        f"action(s) — schema-valid (Claude, attempt {attempt})",
                        _done(proposal, "llm"))
            return proposal
        except (SchemaError, ValueError, json.JSONDecodeError) as exc:
            logger.warning(step, f"{agent_name} agent output invalid (attempt {attempt}): {exc}",
                           {"agent": agent_name, "state": "retry", "error": str(exc)})
        except Exception as exc:  # API/network failure — degrade gracefully
            logger.error(step, f"{agent_name} agent LLM call failed: {exc}",
                         {"agent": agent_name, "state": "error", "error": str(exc)})
            break

    proposal = fallback_fn()
    logger.warning(step, f"{agent_name} agent fell back to deterministic proposal",
                   _done(proposal, "fallback"))
    return proposal
