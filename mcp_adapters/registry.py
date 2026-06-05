"""Capability tool catalog.

A single registry of capability-named tools across all systems, each classified as
read-only or mutating. The orchestrator uses this to execute approved actions by name and
to enforce that mutating tools carry an approved HITL token. Plugging in a real system
later means re-pointing an adapter — the tool names the agents emit do not change.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from . import ais_adapter, as400_adapter, emodal_adapter, tos_adapter


@dataclass(frozen=True)
class Tool:
    name: str
    system: str
    mutating: bool
    fn: Callable[..., Any]
    description: str


_TOOLS: dict[str, Tool] = {}


def _register(name: str, system: str, mutating: bool, fn: Callable, description: str) -> None:
    _TOOLS[name] = Tool(name, system, mutating, fn, description)


# read-only
_register("tos.read_yard", "tos", False, tos_adapter.read_yard, "Yard block occupancy/capacity")
_register("tos.read_storage_plan", "tos", False, tos_adapter.read_storage_plan, "Current storage plan")
_register("emodal.list_appointments", "emodal", False, emodal_adapter.list_appointments, "Appointment slots + demand by window")
_register("ais.positions", "ais", False, ais_adapter.positions, "Vessel positions/ETAs")
_register("ais.manifests", "ais", False, ais_adapter.manifests, "Stowage/discharge manifests")
_register("as400.fee_schedule", "as400", False, as400_adapter.fee_schedule, "Fee schedule")
_register("as400.demurrage_rules", "as400", False, as400_adapter.demurrage_rules, "Demurrage rules")

# mutating (require an approved HITL token)
_register("tos.write_plan", "tos", True, tos_adapter.write_plan, "Write re-sequenced storage plan")
_register("emodal.set_slots", "emodal", True, emodal_adapter.set_slots, "Set staggered appointment slots")
_register("ais.confirm_window", "ais", True, ais_adapter.confirm_window, "Confirm/adjust discharge window")


def get(name: str) -> Tool:
    if name not in _TOOLS:
        raise KeyError(f"unknown tool: {name}")
    return _TOOLS[name]


def is_mutating(name: str) -> bool:
    return get(name).mutating


def all_tools() -> list[Tool]:
    return list(_TOOLS.values())


def execute(name: str, args: dict[str, Any], hitl_token: str | None = None) -> Any:
    """Execute a registered tool by name. Mutating tools must carry a valid HITL token;
    the adapter itself re-checks, so there is no way to write back without approval."""
    tool = get(name)
    kwargs = dict(args)
    if tool.mutating:
        kwargs["hitl_token"] = hitl_token
    return tool.fn(**kwargs)
