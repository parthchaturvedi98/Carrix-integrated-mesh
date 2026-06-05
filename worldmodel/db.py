"""Shared world model — the single source of reconciled truth.

A SQLite database that every agent and the orchestrator read from and write to, so they
never act on conflicting facts. The orchestrator's ``ingest`` step writes a reconciled
snapshot here from all four source systems; ``reason`` records detected conflicts; agents'
proposals and the human approval decision are persisted here too, alongside a full
correlation-ID trace of every step.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from typing import Any, Iterable

import config

_LOCAL = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    correlation_id TEXT PRIMARY KEY,
    created_at     REAL NOT NULL,
    status         TEXT NOT NULL,        -- running | awaiting_approval | applied | rejected | resolved
    llm_mode       TEXT NOT NULL
);

-- Reconciled snapshot rows are tagged with the run that ingested them.
CREATE TABLE IF NOT EXISTS vessels (
    correlation_id TEXT, vessel_id TEXT, name TEXT, terminal TEXT,
    eta TEXT, status TEXT, discharge_count INTEGER, discharge_window TEXT, confirmed INTEGER
);
CREATE TABLE IF NOT EXISTS yard_blocks (
    correlation_id TEXT, block TEXT, terminal TEXT, capacity INTEGER, occupied INTEGER
);
CREATE TABLE IF NOT EXISTS appointments (
    correlation_id TEXT, window TEXT, terminal TEXT, slots INTEGER, booked INTEGER, demand INTEGER
);
CREATE TABLE IF NOT EXISTS fees (
    correlation_id TEXT, code TEXT, unit TEXT, amount REAL, currency TEXT
);
CREATE TABLE IF NOT EXISTS storage_plan (
    correlation_id TEXT, terminal TEXT, window TEXT, vessel_id TEXT, sequence_json TEXT
);

CREATE TABLE IF NOT EXISTS conflicts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    correlation_id TEXT NOT NULL,
    detected       INTEGER NOT NULL,     -- 1 = collision present, 0 = resolved
    summary        TEXT,
    detail_json    TEXT,
    created_at     REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS proposals (
    id             TEXT PRIMARY KEY,
    correlation_id TEXT NOT NULL,
    status         TEXT NOT NULL,        -- pending | approved | rejected
    plan_json      TEXT NOT NULL,        -- assembled plan: per-agent proposals + actions
    created_at     REAL NOT NULL,
    decided_at     REAL
);

CREATE TABLE IF NOT EXISTS trace_events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    correlation_id TEXT NOT NULL,
    seq            INTEGER NOT NULL,
    ts             REAL NOT NULL,
    step           TEXT NOT NULL,
    level          TEXT NOT NULL,
    message        TEXT NOT NULL,
    data_json      TEXT
);
"""

_SNAPSHOT_TABLES = (
    "vessels",
    "yard_blocks",
    "appointments",
    "fees",
    "storage_plan",
    "conflicts",
)


def _connect() -> sqlite3.Connection:
    conn = getattr(_LOCAL, "conn", None)
    if conn is None:
        conn = sqlite3.connect(config.DB_PATH, check_same_thread=False, timeout=10.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout=10000;")
        _LOCAL.conn = conn
    return conn


@contextmanager
def _tx():
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def init_db() -> None:
    with _tx() as conn:
        conn.executescript(SCHEMA)


_APP_TABLES = (
    "runs", "vessels", "yard_blocks", "appointments", "fees", "storage_plan",
    "conflicts", "proposals", "trace_events",
)


def reset_db() -> None:
    """Clear all run/snapshot state — used by the scenario reset. Recreates the schema first
    in case the DB is new, then empties every application table (leaving SQLite internals)."""
    with _tx() as conn:
        conn.executescript(SCHEMA)
        for tbl in _APP_TABLES:
            conn.execute(f"DELETE FROM {tbl}")


# --- runs --------------------------------------------------------------------

def new_run(llm_mode: str) -> str:
    correlation_id = uuid.uuid4().hex[:12]
    with _tx() as conn:
        conn.execute(
            "INSERT INTO runs(correlation_id, created_at, status, llm_mode) VALUES (?,?,?,?)",
            (correlation_id, time.time(), "running", llm_mode),
        )
    return correlation_id


def set_run_status(correlation_id: str, status: str) -> None:
    with _tx() as conn:
        conn.execute(
            "UPDATE runs SET status=? WHERE correlation_id=?", (status, correlation_id)
        )


def get_run(correlation_id: str) -> dict[str, Any] | None:
    conn = _connect()
    row = conn.execute(
        "SELECT * FROM runs WHERE correlation_id=?", (correlation_id,)
    ).fetchone()
    return dict(row) if row else None


# --- reconciled snapshot -----------------------------------------------------

def reconcile(correlation_id: str, snapshot: dict[str, Any]) -> None:
    """Upsert the cross-system reconciled snapshot for a run. Clears any prior
    snapshot rows for this run first so a re-observe loop reflects the new state."""
    with _tx() as conn:
        for tbl in ("vessels", "yard_blocks", "appointments", "fees", "storage_plan"):
            conn.execute(f"DELETE FROM {tbl} WHERE correlation_id=?", (correlation_id,))

        for v in snapshot.get("vessels", []):
            conn.execute(
                "INSERT INTO vessels(correlation_id, vessel_id, name, terminal, eta, status,"
                " discharge_count, discharge_window, confirmed) VALUES (?,?,?,?,?,?,?,?,?)",
                (correlation_id, v["vessel_id"], v.get("name"), v.get("terminal"),
                 v.get("eta"), v.get("status"), v.get("discharge_count"),
                 v.get("discharge_window"), int(bool(v.get("confirmed")))),
            )
        for b in snapshot.get("yard_blocks", []):
            conn.execute(
                "INSERT INTO yard_blocks(correlation_id, block, terminal, capacity, occupied)"
                " VALUES (?,?,?,?,?)",
                (correlation_id, b["block"], b.get("terminal"), b["capacity"], b["occupied"]),
            )
        for a in snapshot.get("appointments", []):
            conn.execute(
                "INSERT INTO appointments(correlation_id, window, terminal, slots, booked, demand)"
                " VALUES (?,?,?,?,?,?)",
                (correlation_id, a["window"], a.get("terminal"), a["slots"],
                 a.get("booked", 0), a["demand"]),
            )
        for f in snapshot.get("fees", []):
            conn.execute(
                "INSERT INTO fees(correlation_id, code, unit, amount, currency) VALUES (?,?,?,?,?)",
                (correlation_id, f["code"], f.get("unit"), f["amount"], f.get("currency", "USD")),
            )
        sp = snapshot.get("storage_plan")
        if sp:
            conn.execute(
                "INSERT INTO storage_plan(correlation_id, terminal, window, vessel_id, sequence_json)"
                " VALUES (?,?,?,?,?)",
                (correlation_id, sp.get("terminal"), sp.get("window"),
                 sp.get("vessel_id"), json.dumps(sp.get("sequence", []))),
            )


def get_snapshot(correlation_id: str) -> dict[str, Any]:
    conn = _connect()

    def rows(sql: str) -> list[dict[str, Any]]:
        return [dict(r) for r in conn.execute(sql, (correlation_id,)).fetchall()]

    sp_row = conn.execute(
        "SELECT * FROM storage_plan WHERE correlation_id=?", (correlation_id,)
    ).fetchone()
    storage_plan = None
    if sp_row:
        storage_plan = {
            "terminal": sp_row["terminal"],
            "window": sp_row["window"],
            "vessel_id": sp_row["vessel_id"],
            "sequence": json.loads(sp_row["sequence_json"]),
        }

    return {
        "vessels": rows("SELECT * FROM vessels WHERE correlation_id=?"),
        "yard_blocks": rows("SELECT * FROM yard_blocks WHERE correlation_id=?"),
        "appointments": rows("SELECT * FROM appointments WHERE correlation_id=?"),
        "fees": rows("SELECT * FROM fees WHERE correlation_id=?"),
        "storage_plan": storage_plan,
    }


# --- conflicts ---------------------------------------------------------------

def save_conflict(correlation_id: str, detected: bool, summary: str, detail: dict) -> None:
    with _tx() as conn:
        conn.execute(
            "INSERT INTO conflicts(correlation_id, detected, summary, detail_json, created_at)"
            " VALUES (?,?,?,?,?)",
            (correlation_id, int(detected), summary, json.dumps(detail), time.time()),
        )


def get_conflicts(correlation_id: str) -> list[dict[str, Any]]:
    conn = _connect()
    rows = conn.execute(
        "SELECT * FROM conflicts WHERE correlation_id=? ORDER BY id", (correlation_id,)
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["detail"] = json.loads(d.pop("detail_json") or "{}")
        d["detected"] = bool(d["detected"])
        out.append(d)
    return out


# --- proposals ---------------------------------------------------------------

def save_proposal(correlation_id: str, plan: dict) -> str:
    proposal_id = uuid.uuid4().hex[:12]
    with _tx() as conn:
        conn.execute(
            "INSERT INTO proposals(id, correlation_id, status, plan_json, created_at)"
            " VALUES (?,?,?,?,?)",
            (proposal_id, correlation_id, "pending", json.dumps(plan), time.time()),
        )
    return proposal_id


def get_proposal(proposal_id: str) -> dict[str, Any] | None:
    conn = _connect()
    row = conn.execute("SELECT * FROM proposals WHERE id=?", (proposal_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["plan"] = json.loads(d.pop("plan_json"))
    return d


def get_proposal_for_run(correlation_id: str) -> dict[str, Any] | None:
    conn = _connect()
    row = conn.execute(
        "SELECT * FROM proposals WHERE correlation_id=? ORDER BY created_at DESC LIMIT 1",
        (correlation_id,),
    ).fetchone()
    if not row:
        return None
    d = dict(row)
    d["plan"] = json.loads(d.pop("plan_json"))
    return d


def save_proposal_plan(proposal_id: str, plan: dict) -> None:
    """Persist an updated plan (e.g. after recording per-agent approve/reject decisions)."""
    with _tx() as conn:
        conn.execute(
            "UPDATE proposals SET plan_json=? WHERE id=?",
            (json.dumps(plan), proposal_id),
        )


def set_proposal_status(proposal_id: str, status: str) -> None:
    with _tx() as conn:
        conn.execute(
            "UPDATE proposals SET status=?, decided_at=? WHERE id=?",
            (status, time.time(), proposal_id),
        )


# --- trace -------------------------------------------------------------------

def add_trace(correlation_id: str, step: str, level: str, message: str,
              data: dict | None = None) -> dict[str, Any]:
    with _tx() as conn:
        seq_row = conn.execute(
            "SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM trace_events WHERE correlation_id=?",
            (correlation_id,),
        ).fetchone()
        seq = seq_row["s"]
        ts = time.time()
        conn.execute(
            "INSERT INTO trace_events(correlation_id, seq, ts, step, level, message, data_json)"
            " VALUES (?,?,?,?,?,?,?)",
            (correlation_id, seq, ts, step, level, message,
             json.dumps(data) if data is not None else None),
        )
    return {"seq": seq, "ts": ts, "step": step, "level": level,
            "message": message, "data": data}


def get_traces(correlation_id: str, after_seq: int = 0) -> list[dict[str, Any]]:
    conn = _connect()
    rows = conn.execute(
        "SELECT * FROM trace_events WHERE correlation_id=? AND seq>? ORDER BY seq",
        (correlation_id, after_seq),
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["data"] = json.loads(d.pop("data_json")) if d.get("data_json") else None
        out.append(d)
    return out
