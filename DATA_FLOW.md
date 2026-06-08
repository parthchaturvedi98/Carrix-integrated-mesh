# Carrix Demo — Data Flow

How data moves through the demo today, mapped to the Carrix systems and the 10 use-case flow.

> **All data is mocked/seeded — there is no live Carrix data in the demo.** The mock systems are
> generic stand-ins; in the production architecture they are swapped for the real feeds at the
> adapter layer, without changing the agents.

---

## The loop (current data flow)

```
        SOURCE SYSTEMS (mocked stand-ins)
   TOS · eModal · AIS · AS/400 · ECS (equipment / IoT)
                     │  (1) ingest  — read-only
                     v
        +------------------------------------+
        |   DIGITAL TWIN / world model        |   one reconciled operating picture
        |   (single source of truth)          |
        +------------------------------------+
                     │  (2) reason  — detect bottlenecks (the "T18 collision")
                     v
        (3) fan-out to domain-owner agents
        Yard · Gate · Vessel · Movement · (Fees = compute only)
                     │  each reads its slice of the twin, returns a proposed action
                     v
        (4) SIMULATE  — apply the plan to a CLONE of the twin
                        forecast the outcome (NO real writes)
                     v
        (5) HITL  — human reviews the forecast, approves / rejects per owner
                     │  (nothing has touched the real systems yet)
                     v
        (6) EXECUTE  — approved actions written back to the source systems
                     v
        (7) RE-OBSERVE  — re-ingest, compare actual vs forecast, resolve
```

**Key property:** reads flow in continuously; **writes only happen at step (6), and only after the
step (4) simulation and step (5) human approval.** Steps (4) and (5) never mutate the real systems —
that is the digital-twin "test before execute" behaviour.

---

## Mock systems mapped to Carrix's

| Demo mock system | Carrix equivalent | What flows in |
|---|---|---|
| **TOS** (yard blocks, storage plan) | Mainsail / TOS yard data | occupancy, capacity, current placement plan |
| **AIS** (vessel, manifest) | vessel feed / Forecast | inbound vessel, discharge count + window |
| **eModal** (appointments) | gate / appointment layer | slots vs demand per window |
| **AS/400** (fees) | ERP / billing | demurrage, storage, congestion rates |
| **ECS** (equipment / IoT) | equipment telemetry | crane utilization, moves, shuffles, cycle time |

**Where real systems plug in:** In the **deployed static demo**, these "systems" are a seeded
scenario object and `ingest()` builds the twin from it in the browser — there is no live
integration. In the **architecture** (the Python backend, not deployed), this is the MCP
**adapter layer** — the swap-in point where each mock is replaced by the real Mainsail / Forecast /
Spinnaker / eModal / AIS feed without changing the agents.

---

## The 10 use cases — where each sits in the flow today

| Layer / Use case | Status in the demo |
|---|---|
| **UC 1-3 — Availability truth (Mainsail + Forecast + Spinnaker)** | Represented as the **(1) ingest + reconcile into the twin** (single source of truth); not yet a distinct "availability confidence" agent |
| **UC 4 — Gate exception prediction** | Lightly present via the **Gate** agent (appointment / cut-off) |
| **UC 5 — Yard congestion prediction** | **Live** — the orchestrator's bottleneck detection |
| **UC 6 — Rehandle reduction / smart placement** | **Live** — the **Yard** agent re-sequence (non-revenue moves 353 to 0) |
| **UC 7 — VisionX safety** | Not built (shown as a "connected" domain placeholder in the control tower) |
| **UC 8 — Yard planner copilot** | Partial — the assembled multi-owner plan is a shift-plan precursor |
| **UC 9 — Equipment utilization** | **Live** — the **Movement** agent (utilization, cycle time) |
| **UC 10 — Control tower / Yard digital twin** | **The spine** — the whole loop above; the control-tower panel shows connected domains, risk, and recommended actions by owner |

So the demo currently realizes **UC 10 orchestrating live slices of UC 5, 6, and 9** (with a touch
of 4 and 8), **UC 1-3 implicit in the ingest/reconcile step**, and **UC 7 stubbed** as a
connectable domain.

---

## Read vs write paths

- **Read (ingest):** every run pulls the current state of all source systems into the twin. Pure,
  side-effect free.
- **Simulate (fork):** the proposed plan is applied to a *clone* of the twin to forecast the result.
  No source system is touched.
- **Write (execute):** only the human-approved actions are written back to the source systems
  (`tos.write_plan`, `emodal.set_slots`, `ais.confirm_window`, `ecs.optimize_dispatch`), each gated
  by a human-in-the-loop approval.
- **Verify:** the systems are re-ingested and the actual result is compared to the forecast.

---

*See `ASSUMPTIONS.md` (if present) for the seeded values and which numbers are computed vs
illustrative. All figures here are from a synthetic scenario, not real Carrix data.*
