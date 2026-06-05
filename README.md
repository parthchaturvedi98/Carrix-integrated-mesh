# Carrix — Integrated Autonomous Mesh (demo)

A working demo of a **Claude-orchestrated multi-agent mesh** that sits above four fragmented
port systems, reconciles **plan vs. reality** into one shared world model, detects a cross-silo
conflict no single system can see, and routes a coordinated fix through a **human approval gate**
before any write-back.

Everything external is mocked, so the demo runs end-to-end with no real integrations.

```
Command centre (React)  →  Orchestrator (Claude)  →  Yard · Gate · Vessel · Fees agents
                                     │                         │
                              shared world model        MCP-shaped adapters
                                  (SQLite)                      │
                                                    Mock TOS · eModal · AIS · AS/400
```

## What it does — the "T18 collision"

The seeded scenario (`scenarios/t18_collision.json`) reproduces a conflict that no single source
system connects today:

- **AIS + TOS:** ~400 containers discharge at Terminal **T18** this afternoon (12:00–16:00).
- **eModal:** a trucker-appointment surge hits the **same window** (150 demand vs 80 slots).
- **TOS yard:** the current storage plan piles those containers onto **near-congested** blocks,
  overflowing them.

The loop: **ingest → reason → fan-out → act**

1. The orchestrator ingests all four systems into the world model and **detects the collision**.
2. It fans out to four worker agents, each returning a schema-validated proposal:
   - **Yard** re-sequences the storage plan to spread the discharge across blocks with capacity.
   - **Gate** staggers appointments so no window's demand exceeds its slots.
   - **Vessel** confirms the discharge window.
   - **Fees** computes the demurrage/congestion impact (compute only — never writes money).
3. It assembles one plan and shows it in the command centre with rationale + evidence.
4. A human reviews **each agent's proposed write-back and approves or rejects it individually**
   (per-agent HITL). Only the approved actions execute, each gated by a HITL token.
5. A second loop **re-observes** the new state: if every contributing action was approved the
   collision is **resolved**; if some were rejected it is **partially applied** and the panel
   shows what's still unresolved (e.g. rejecting the Gate agent leaves the appointment surge).

## Running it

**No `pip install` is required** — the backend runs on the Python standard library plus `httpx`
(already present), because the PyPI package CDN is blocked on this network. The UI dependencies are
already installed under `ui/node_modules`.

```powershell
# from the carrix-demo/ directory
./run_demo.ps1
```

This opens two windows:

- **Backend (mocks + API):** http://127.0.0.1:8000
- **Command centre (React):** http://127.0.0.1:5173  ← open this

In the UI: **Run reconciliation loop** → watch each step stream live (ingest, reason, every agent
working) → review each agent's proposal and **Approve or Reject it individually** → **Commit** the
approved write-backs → watch the second loop re-observe and the conflict resolve (or partially
resolve if you rejected an agent). **Reset scenario** restores the seed.

### Manual start (if you prefer)

```powershell
# backend
$env:PYTHONPATH = (Get-Location)
python -m api.server

# UI (separate shell)
cd ui ; npm run dev
```

### Real Claude vs. offline fallback

The agents and orchestrator are **dual-mode**:

- Set `ANTHROPIC_API_KEY` in `carrix-demo/.env` (copy from `.env.example`) → agents call the real
  Anthropic API (`claude-opus-4-8` orchestrator, `claude-sonnet-4-6` workers) over HTTP, with
  prompt caching, and their JSON output is schema-validated with one repair attempt.
- No key → a **deterministic fallback** produces schema-valid proposals so the demo always runs
  and the conflict reliably resolves.

The header shows the current mode.

## Tests

Acceptance criteria (brief §8) as stdlib `unittest` (no pytest needed):

```powershell
$env:PYTHONPATH = (Get-Location)
python -m unittest tests.test_acceptance -v
```

Covers: collision auto-detected from the seed; all four agents return schema-valid proposals and
invalid output is rejected; HITL blocks unapproved write-backs; reject changes nothing; approve
changes mock state and the second loop resolves; the run is fully traced; and swapping a mock
touches only its adapter.

## Layout

```
config.py            model strings, capability base URLs, paths (env-overridable)
analysis.py          collision detection + re-sequencing/staggering math (pure functions)
httpserver.py        tiny stdlib HTTP framework (routing, JSON, CORS, SSE)
orchestrator/loop.py ingest → reason → fan-out → assemble → act; prompts/ per agent
agents/              schemas (dataclass contracts), base (dual-mode runner), yard/gate/vessel/fees
mcp_adapters/        one capability adapter per system + registry (read vs mutating)
mocks/server.py      four seeded mock systems as route handlers
worldmodel/db.py     shared world model (SQLite): snapshot, conflicts, proposals, traces
guardrails/          validate.py (schema) + hitl.py (approval-token gate)
tracing/logger.py    structured JSON logs + trace_events, correlation ID per run
api/server.py        backend API + mounted mocks on one server
ui/                  React (Vite + TS) command centre
scenarios/           t18_collision.json seed
tests/               acceptance suite
```

## Design notes

- **Mock-first** removes integration risk; the demo proves the *intelligence*, not the plumbing.
- **One shared world model** is what makes cross-silo reconciliation work — agents never fragment
  onto separate state.
- **HITL before any write-back** keeps the highest-blast-radius action human-controlled.
- **Capability-named tools + per-system adapters** make this a credible path to production: plugging
  in a real TOS/eModal/AIS/AS-400 later changes only the adapter implementation (and its base URL),
  never the agents. See `test_7_adapter_swap_is_localised`.
