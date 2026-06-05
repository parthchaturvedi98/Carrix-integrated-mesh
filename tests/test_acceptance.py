"""Acceptance criteria (brief §8) as executable tests — stdlib unittest, fallback mode only.

Run from the repo root (with it on PYTHONPATH):
    python -m unittest tests.test_acceptance -v

A throwaway server (mocks + API) runs in-process on :8011 with a temp DB; the agents' adapters
call back into it over HTTP, exactly as in the real demo.
"""
from __future__ import annotations

import os
import tempfile
import threading
import time
import unittest

_PORT = 8011
_TMP_DB = os.path.join(tempfile.gettempdir(), "carrix_test.db")
BASE = f"http://127.0.0.1:{_PORT}"

# Configure BEFORE importing config-dependent modules.
os.environ["CARRIX_MOCK_BASE"] = BASE
os.environ["CARRIX_DB_PATH"] = _TMP_DB
os.environ.pop("ANTHROPIC_API_KEY", None)  # force deterministic fallback
for _ext in ("", "-wal", "-shm"):
    try:
        os.remove(_TMP_DB + _ext)
    except OSError:
        pass

import httpx  # noqa: E402

import analysis  # noqa: E402
from agents import fees, gate, vessel, yard  # noqa: E402
from agents.schemas import SchemaError, validate_proposal  # noqa: E402
from api.server import build_router  # noqa: E402
from guardrails import hitl  # noqa: E402
from httpserver import serve  # noqa: E402
from mcp_adapters import tos_adapter  # noqa: E402
from mocks.server import reseed  # noqa: E402
from orchestrator import loop  # noqa: E402
from tracing.logger import get_logger  # noqa: E402
from worldmodel import db  # noqa: E402

_httpd = None


def setUpModule():
    global _httpd
    db.init_db()
    _httpd = serve(build_router(), "127.0.0.1", _PORT)
    threading.Thread(target=_httpd.serve_forever, daemon=True).start()
    for _ in range(50):
        try:
            httpx.get(f"{BASE}/api/status", timeout=2.0)
            return
        except Exception:
            time.sleep(0.1)
    raise RuntimeError("test server did not start")


def tearDownModule():
    if _httpd:
        _httpd.shutdown()


class CarrixTest(unittest.TestCase):
    def setUp(self):
        reseed()
        db.reset_db()
        self.c = httpx.Client(base_url=BASE, timeout=30.0)

    def tearDown(self):
        self.c.close()

    def _wait(self, cid, statuses, timeout=90):
        deadline = time.time() + timeout
        view = {}
        while time.time() < deadline:
            view = self.c.get(f"/api/runs/{cid}").json()
            if view["status"] in statuses:
                return view
            time.sleep(0.2)
        raise AssertionError(f"run {cid} never reached {statuses}; last={view.get('status')}")

    def _run_to_proposal(self):
        cid = self.c.post("/api/run").json()["correlation_id"]
        view = self._wait(cid, {"awaiting_approval", "resolved"})
        return cid, view

    # 1. Collision auto-detected from the seed -------------------------------
    def test_1_collision_detected_from_seed(self):
        _cid, view = self._run_to_proposal()
        conflict = view["initial_conflict"]
        self.assertTrue(conflict["detected"])
        self.assertIn("T18 collision", conflict["summary"])
        d = conflict["detail"]
        self.assertEqual(d["discharge_total"], 400)
        self.assertTrue(d["appointment_surge"])
        self.assertTrue(d["yard_congested"])

    # 2. All four agents return schema-valid proposals -----------------------
    def test_2_all_agents_return_valid_proposals(self):
        cid = db.new_run("fallback")
        snapshot = loop.ingest(cid, get_logger(cid))
        logger = get_logger(cid)
        proposals = {
            "Yard": yard.run(snapshot, logger),
            "Gate": gate.run(snapshot, logger),
            "Vessel": vessel.run(snapshot, logger),
            "Fees": fees.run(snapshot, logger),
        }
        for name, p in proposals.items():
            self.assertEqual(p.agent, name)
            self.assertTrue(p.findings and p.rationale)
        self.assertEqual(proposals["Fees"].proposed_actions, [])
        self.assertTrue(all(a.mutating for a in proposals["Yard"].proposed_actions))

    # 2b. Invalid agent output is caught -------------------------------------
    def test_2b_invalid_agent_output_rejected(self):
        with self.assertRaises(SchemaError):
            validate_proposal({"agent": "Bogus", "findings": "x", "rationale": "y"})
        with self.assertRaises(SchemaError):
            validate_proposal({"agent": "Yard", "findings": "x", "rationale": "y", "junk": 1})

    # 4. HITL blocks unapproved write-back -----------------------------------
    def test_4_hitl_blocks_unapproved_writeback(self):
        with self.assertRaises(hitl.HITLError):
            tos_adapter.write_plan(
                {"terminal": "T18", "window": "w", "vessel_id": "v", "sequence": []},
                hitl_token=None,
            )

    def test_4b_reject_makes_no_state_change(self):
        before = self.c.get("/tos/storage_plan").json()["sequence"]
        cid, view = self._run_to_proposal()
        self.c.post(f"/api/proposals/{view['proposal']['id']}/reject")
        after = self.c.get("/tos/storage_plan").json()["sequence"]
        self.assertEqual(before, after)
        self.assertEqual(self.c.get(f"/api/runs/{cid}").json()["status"], "rejected")

    # 4/5. Approval changes state and the second loop resolves ---------------
    def test_5_approve_changes_state_and_resolves(self):
        before_plan = self.c.get("/tos/storage_plan").json()["sequence"]
        cid, view = self._run_to_proposal()
        self.c.post(f"/api/proposals/{view['proposal']['id']}/approve")
        resolved = self._wait(cid, {"resolved", "applied"})
        self.assertEqual(resolved["status"], "resolved")
        after_plan = self.c.get("/tos/storage_plan").json()["sequence"]
        self.assertNotEqual(after_plan, before_plan)
        self.assertEqual(analysis.plan_overflow(resolved["snapshot"]), [])
        self.assertFalse(resolved["latest_conflict"]["detected"])

    # 6. Every step is traceable via correlation-ID logs ---------------------
    def test_6_run_is_fully_traced(self):
        cid, view = self._run_to_proposal()
        self.c.post(f"/api/proposals/{view['proposal']['id']}/approve")
        self._wait(cid, {"resolved", "applied"})
        traces = self.c.get(f"/api/runs/{cid}/traces").json()["traces"]
        steps = {t["step"] for t in traces}
        for expected in ("start", "ingest", "reason", "fanout", "assemble",
                         "approval", "act", "writeback", "done"):
            self.assertIn(expected, steps)
        seqs = [t["seq"] for t in traces]
        self.assertEqual(seqs, sorted(seqs))

    # 5b. Per-agent HITL: rejecting one agent leaves its part unresolved -----
    def test_5b_partial_commit_per_agent(self):
        cid, view = self._run_to_proposal()
        pid = view["proposal"]["id"]
        # approve Yard + Vessel, REJECT Gate (the appointment-staggering action)
        decisions = {"Yard": "approve", "Gate": "reject", "Vessel": "approve"}
        self.c.post(f"/api/proposals/{pid}/commit", json={"decisions": decisions})
        result = self._wait(cid, {"applied", "resolved", "rejected"})

        # Gate was rejected → appointment surge persists → not fully resolved
        self.assertEqual(result["status"], "applied")
        self.assertTrue(result["latest_conflict"]["detail"]["appointment_surge"])
        # Yard was approved → the yard overflow is cleared
        self.assertEqual(analysis.plan_overflow(result["snapshot"]), [])
        # eModal was NOT written (Gate rejected): focus-window demand still exceeds slots
        appts = self.c.get("/emodal/appointments").json()["appointments"]
        focus = next(a for a in appts if a["window"] == "12:00-16:00" and a["terminal"] == "T18")
        self.assertGreater(focus["demand"], focus["slots"])
        # per-agent decisions are persisted on the proposal
        outcome = {a["agent"]: a["decision"] for a in result["proposal"]["plan"]["actions"]}
        self.assertEqual(outcome["Gate"], "rejected")
        self.assertEqual(outcome["Yard"], "approved")

    # 7. Swapping a mock touches only its adapter ----------------------------
    def test_7_adapter_swap_is_localised(self):
        from unittest.mock import patch
        captured = {}

        def fake_get(base, path):
            captured["base"] = base
            return {"yard_blocks": []}

        with patch.object(tos_adapter._http, "get", fake_get), \
                patch.object(tos_adapter, "BASE", "http://example.internal/tos"):
            tos_adapter.read_yard()
        self.assertEqual(captured["base"], "http://example.internal/tos")


if __name__ == "__main__":
    unittest.main(verbosity=2)
