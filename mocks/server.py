"""Mocked source systems as seeded HTTP stubs (stdlib only).

Four capability groups (TOS, eModal, AIS, AS/400) registered as routes on the shared
``httpserver.Router``, each backed by its own in-memory state seeded from
``scenarios/t18_collision.json``. Read endpoints return the seeded JSON; write endpoints
mutate the in-memory state so the loop visibly closes. A real deployment replaces each system
behind its MCP adapter — these stubs do not change agent code.
"""
from __future__ import annotations

import copy
import json
from typing import Any

import config
from httpserver import HTTPError, Router

_STATE: dict[str, Any] = {}


def _load_seed() -> dict[str, Any]:
    with open(config.SCENARIO_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def reseed() -> None:
    """(Re)load all four systems' state from the scenario seed."""
    seed = _load_seed()
    for system in ("tos", "emodal", "ais", "as400"):
        _STATE[system] = copy.deepcopy(seed[system])


reseed()


# --- Mock TOS ----------------------------------------------------------------

def tos_read_yard(_params, _body):
    return 200, {"yard_blocks": _STATE["tos"]["yard_blocks"]}


def tos_read_storage_plan(_params, _body):
    return 200, _STATE["tos"]["storage_plan"]


def tos_write_plan(_params, body):
    if not isinstance(body, dict) or "sequence" not in body:
        raise HTTPError(400, "storage plan must include a 'sequence'")
    _STATE["tos"]["storage_plan"] = body
    return 200, {"ok": True, "storage_plan": body}


# --- Mock eModal -------------------------------------------------------------

def emodal_list_appointments(_params, _body):
    return 200, {"appointments": _STATE["emodal"]["appointments"]}


def emodal_set_slots(_params, body):
    updates = (body or {}).get("updates")
    if not isinstance(updates, list):
        raise HTTPError(400, "expected {'updates': [...]}")
    appts = _STATE["emodal"]["appointments"]
    by_key = {(a["window"], a["terminal"]): a for a in appts}
    for u in updates:
        key = (u["window"], u["terminal"])
        if key not in by_key:
            appt = {"window": u["window"], "terminal": u["terminal"],
                    "slots": 0, "booked": 0, "demand": 0}
            appts.append(appt)
            by_key[key] = appt
        by_key[key]["slots"] = int(u["slots"])
        if u.get("demand") is not None:
            by_key[key]["demand"] = int(u["demand"])
    return 200, {"ok": True, "appointments": appts}


# --- Mock AIS ----------------------------------------------------------------

def ais_positions(_params, _body):
    return 200, {"positions": _STATE["ais"]["positions"]}


def ais_manifests(_params, _body):
    return 200, {"manifests": _STATE["ais"]["manifests"]}


def ais_confirm_window(_params, body):
    body = body or {}
    for m in _STATE["ais"]["manifests"]:
        if m["vessel_id"] == body.get("vessel_id"):
            m["discharge_window"] = body["discharge_window"]
            m["confirmed"] = bool(body.get("confirmed", True))
            return 200, {"ok": True, "manifest": m}
    raise HTTPError(404, "vessel not found")


# --- Mock AS/400 -------------------------------------------------------------

def as400_fee_schedule(_params, _body):
    return 200, {"fee_schedule": _STATE["as400"]["fee_schedule"]}


def as400_demurrage_rules(_params, _body):
    return 200, _STATE["as400"]["demurrage_rules"]


# --- admin -------------------------------------------------------------------

def admin_reset(_params, _body):
    reseed()
    return 200, {"ok": True}


def register_mocks(router: Router) -> None:
    router.get("/tos/yard", tos_read_yard)
    router.get("/tos/storage_plan", tos_read_storage_plan)
    router.post("/tos/storage_plan", tos_write_plan)

    router.get("/emodal/appointments", emodal_list_appointments)
    router.post("/emodal/slots", emodal_set_slots)

    router.get("/ais/positions", ais_positions)
    router.get("/ais/manifests", ais_manifests)
    router.post("/ais/discharge_window", ais_confirm_window)

    router.get("/as400/fee_schedule", as400_fee_schedule)
    router.get("/as400/demurrage_rules", as400_demurrage_rules)

    router.post("/admin/reset", admin_reset)
