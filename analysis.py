"""Domain analysis over the reconciled world model.

Pure functions shared by the orchestrator (collision detection) and the agents
(re-sequencing / staggering math). Kept dependency-free so it never imports agents or the
orchestrator — both import *it*.
"""
from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

import config


@lru_cache(maxsize=1)
def scenario_meta() -> dict[str, Any]:
    with open(config.SCENARIO_PATH, encoding="utf-8") as fh:
        seed = json.load(fh)
    return {
        "terminal": seed["terminal"],
        "focus_window": seed["focus_window"],
        "windows": seed["windows"],
        "thresholds": seed["thresholds"],
    }


def remaining_capacity(block: dict[str, Any]) -> int:
    return int(block["capacity"]) - int(block["occupied"])


def block_index(snapshot: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {b["block"]: b for b in snapshot.get("yard_blocks", [])}


def discharge_total(snapshot: dict[str, Any], terminal: str, window: str) -> int:
    return sum(
        int(v.get("discharge_count") or 0)
        for v in snapshot.get("vessels", [])
        if v.get("terminal") == terminal and v.get("discharge_window") == window
    )


def appointment_for(snapshot: dict[str, Any], terminal: str, window: str) -> dict[str, Any] | None:
    for a in snapshot.get("appointments", []):
        if a.get("terminal") == terminal and a.get("window") == window:
            return a
    return None


def plan_overflow(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    """Blocks where the current storage plan assigns more containers than the block has
    remaining capacity for. A non-empty list means the yard plan is infeasible (congested)."""
    idx = block_index(snapshot)
    plan = snapshot.get("storage_plan") or {}
    out = []
    for item in plan.get("sequence", []):
        blk = idx.get(item["block"])
        if not blk:
            continue
        rem = remaining_capacity(blk)
        assigned = int(item["containers"])
        if assigned > rem:
            out.append({
                "block": item["block"],
                "assigned": assigned,
                "remaining": rem,
                "overflow": assigned - rem,
            })
    return out


def detect_collision(snapshot: dict[str, Any]) -> dict[str, Any]:
    """The cross-silo T18 collision: a discharge surge coinciding with a trucker-appointment
    surge on already-congested yard blocks — three facts no single source system connects."""
    meta = scenario_meta()
    terminal = meta["terminal"]
    window = meta["focus_window"]
    surge_threshold = int(meta["thresholds"]["discharge_surge"])

    total = discharge_total(snapshot, terminal, window)
    surge = total >= surge_threshold

    appt = appointment_for(snapshot, terminal, window) or {}
    slots = int(appt.get("slots", 0))
    demand = int(appt.get("demand", 0))
    appt_exceeds = demand > slots

    overflow = plan_overflow(snapshot)
    congested = len(overflow) > 0

    detected = surge and (appt_exceeds or congested)

    if detected:
        summary = (
            f"T18 collision: {total} containers discharging at {terminal} in {window} "
            f"collide with a trucker-appointment surge ({demand} demand vs {slots} slots) "
            f"on {len(overflow)} over-capacity yard block(s)."
        )
    else:
        summary = (
            f"No collision at {terminal} {window}: discharge {total}, "
            f"appointments {demand}/{slots}, over-capacity blocks {len(overflow)}."
        )

    return {
        "detected": detected,
        "summary": summary,
        "detail": {
            "terminal": terminal,
            "window": window,
            "discharge_total": total,
            "surge_threshold": surge_threshold,
            "discharge_surge": surge,
            "appointment_slots": slots,
            "appointment_demand": demand,
            "appointment_surge": appt_exceeds,
            "overflow_blocks": overflow,
            "yard_congested": congested,
        },
    }


def resequence_plan(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Greedily spread the terminal's discharge across blocks by remaining capacity —
    same-terminal blocks first, then relief blocks elsewhere — so no block overflows."""
    meta = scenario_meta()
    terminal = meta["terminal"]
    window = meta["focus_window"]
    plan = snapshot.get("storage_plan") or {}
    vessel_id = plan.get("vessel_id", "")
    total = discharge_total(snapshot, terminal, window)

    blocks = snapshot.get("yard_blocks", [])
    same = sorted([b for b in blocks if b.get("terminal") == terminal],
                  key=remaining_capacity, reverse=True)
    relief = sorted([b for b in blocks if b.get("terminal") != terminal],
                    key=remaining_capacity, reverse=True)

    sequence: list[dict[str, Any]] = []
    to_place = total
    for blk in same + relief:
        if to_place <= 0:
            break
        take = min(remaining_capacity(blk), to_place)
        if take > 0:
            sequence.append({"block": blk["block"], "containers": take})
            to_place -= take

    return {
        "terminal": terminal,
        "window": window,
        "vessel_id": vessel_id,
        "sequence": sequence,
        "_unplaced": to_place,  # 0 when fully placed
    }


def stagger_slots(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    """Redistribute appointment demand out of the surge window into adjacent windows (and add
    headroom to the surge window) so no window's demand exceeds its slots."""
    meta = scenario_meta()
    terminal = meta["terminal"]
    focus = meta["focus_window"]

    appts = [dict(a) for a in snapshot.get("appointments", [])
             if a.get("terminal") == terminal]
    by_window = {a["window"]: a for a in appts}
    if focus not in by_window:
        return []

    focus_appt = by_window[focus]
    # give the surge window extra lanes, then move the remaining surplus to other windows.
    focus_slots = max(int(focus_appt["slots"]), 100)
    focus_appt["slots"] = focus_slots
    surplus = int(focus_appt["demand"]) - focus_slots

    others = [a for w, a in by_window.items() if w != focus]
    others.sort(key=lambda a: int(a["slots"]) - int(a["demand"]), reverse=True)
    i = 0
    while surplus > 0 and others:
        a = others[i % len(others)]
        headroom = int(a["slots"]) - int(a["demand"])
        if headroom > 0:
            move = min(headroom, surplus)
            a["demand"] = int(a["demand"]) + move
            focus_appt["demand"] = int(focus_appt["demand"]) - move
            surplus -= move
        i += 1
        if i > 1000:
            break

    return [
        {"window": a["window"], "terminal": terminal,
         "slots": int(a["slots"]), "demand": int(a["demand"])}
        for a in by_window.values()
    ]


def compute_fees(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Compute-only demurrage/congestion figures from the AS/400 fee schedule. No write-back."""
    fees = {f["code"]: f for f in snapshot.get("fees", [])}
    overflow = plan_overflow(snapshot)
    overflow_count = sum(o["overflow"] for o in overflow)

    congestion_rate = float(fees.get("CONGESTION_SURCHARGE", {}).get("amount", 0.0))
    demurrage_rate = float(fees.get("DEMURRAGE", {}).get("amount", 0.0))

    congestion_charge = overflow_count * congestion_rate
    # Illustrative: containers that cannot be placed risk demurrage for ~1 day.
    demurrage_risk = overflow_count * demurrage_rate

    return {
        "overflow_containers": overflow_count,
        "congestion_surcharge": round(congestion_charge, 2),
        "demurrage_risk_per_day": round(demurrage_risk, 2),
        "currency": fees.get("CONGESTION_SURCHARGE", {}).get("currency", "USD"),
    }
