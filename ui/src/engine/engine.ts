// In-browser orchestrator engine — a faithful, dependency-free port of the Python loop's
// deterministic (fallback) behaviour, so the demo runs fully client-side for GitHub Pages.
// It mirrors ingest -> reason -> fan-out -> assemble -> per-agent commit, and emits trace
// events on a timer so agent cards still stream in one by one.
import * as A from './analysis'
import { AGENTS, AGENT_TASKS, runAgent } from './agents'
import { SCENARIO_META, seedState, type RawMockState } from './scenario'
import type {
  Action, AgentProposal, Conflict, Proposal, RunView, Snapshot, Status, TraceEvent,
} from '../types'

const M = SCENARIO_META

interface RunState {
  correlation_id: string
  status: string
  traces: TraceEvent[]
  conflicts: Conflict[]
  proposal: Proposal | null
  snapshot: Snapshot
  seq: number
  listeners: Set<(e: TraceEvent) => void>
  doneListeners: Set<() => void>
}

let state: RawMockState = seedState()
const runs = new Map<string, RunState>()

const FINAL = new Set(['awaiting_approval', 'resolved', 'applied', 'rejected'])
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const rid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12)

function ingest(): Snapshot {
  const posById = new Map(state.ais.positions.map((p) => [p.vessel_id, p]))
  const vessels = state.ais.manifests.map((m) => {
    const p = posById.get(m.vessel_id)
    return {
      vessel_id: m.vessel_id, name: p?.name, terminal: m.terminal, eta: p?.eta,
      status: p?.status, discharge_count: m.discharge_count,
      discharge_window: m.discharge_window, confirmed: m.confirmed,
    }
  })
  return {
    vessels,
    yard_blocks: structuredClone(state.tos.yard_blocks),
    appointments: structuredClone(state.emodal.appointments),
    fees: structuredClone(state.as400.fee_schedule),
    storage_plan: structuredClone(state.tos.storage_plan),
    equipment: structuredClone(state.ecs.equipment),
    movement: structuredClone(state.ecs.movement),
  }
}

function addTrace(run: RunState, step: string, level: TraceEvent['level'], message: string, data?: Record<string, unknown>): void {
  run.seq += 1
  const ev: TraceEvent = { seq: run.seq, ts: Date.now() / 1000, step, level, message, data: data ?? null }
  run.traces.push(ev)
  ;[...run.listeners].forEach((l) => l(ev))
}

function fireDone(run: RunState): void {
  ;[...run.doneListeners].forEach((l) => l())
}

function applyAction(action: Action): void {
  if (action.tool === 'tos.write_plan') {
    state.tos.storage_plan = action.args.plan as RawMockState['tos']['storage_plan']
  } else if (action.tool === 'emodal.set_slots') {
    const updates = (action.args.updates ?? []) as { window: string; terminal: string; slots: number; demand?: number }[]
    for (const u of updates) {
      const a = state.emodal.appointments.find((x) => x.window === u.window && x.terminal === u.terminal)
      if (a) { a.slots = u.slots; if (u.demand != null) a.demand = u.demand }
    }
  } else if (action.tool === 'ais.confirm_window') {
    const m = state.ais.manifests.find((x) => x.vessel_id === action.args.vessel_id)
    if (m) { m.discharge_window = String(action.args.discharge_window); m.confirmed = Boolean(action.args.confirmed) }
  } else if (action.tool === 'ecs.optimize_dispatch') {
    const plan = action.args.plan as RawMockState['ecs']['movement']
    state.ecs.movement = plan
    // balance the fleet to the optimized average utilization
    state.ecs.equipment = state.ecs.equipment.map((e) => ({
      ...e, utilization_pct: plan.avg_utilization_pct, status: 'busy',
    }))
  }
}

async function runPipeline(run: RunState): Promise<void> {
  await sleep(300)
  addTrace(run, 'start', 'info', 'Orchestrator run started — ingesting the four source systems', { llm_mode: 'fallback' })
  await sleep(700)
  addTrace(run, 'ingest', 'info', 'Reading current state from TOS, eModal, AIS, AS/400 and ECS')
  await sleep(1400)
  run.snapshot = ingest()
  addTrace(run, 'ingest', 'info', 'Reconciled all systems into one shared world model', {
    vessels: run.snapshot.vessels.length, yard_blocks: run.snapshot.yard_blocks.length, appointments: run.snapshot.appointments.length,
  })
  await sleep(1000)
  addTrace(run, 'reason', 'info', 'Reasoning over the reconciled state — correlating plan vs reality across silos')
  await sleep(1600)
  const conflict = A.detectCollision(run.snapshot)
  run.conflicts.push(conflict)
  addTrace(run, 'reason', conflict.detected ? 'warning' : 'info', conflict.summary,
    { detected: conflict.detected, summary: conflict.summary, detail: conflict.detail })

  if (!conflict.detected) {
    run.status = 'resolved'
    addTrace(run, 'done', 'info', 'No collision detected; nothing to propose')
    fireDone(run)
    return
  }

  await sleep(1100)
  addTrace(run, 'fanout', 'info', `Cross-silo collision detected — orchestrator engaging ${AGENTS.length} specialist agents`, { agents: [...AGENTS] })
  const proposals: AgentProposal[] = []
  for (const name of AGENTS) {
    addTrace(run, `agent:${name.toLowerCase()}`, 'info', `${name} agent ${AGENT_TASKS[name]}...`, { agent: name, state: 'start' })
    await sleep(1700)
    const p = runAgent(name, run.snapshot)
    proposals.push(p)
    addTrace(run, `agent:${name.toLowerCase()}`, 'info',
      `${name} agent ready - ${p.proposed_actions.length} action(s) proposed`,
      { agent: name, state: 'done', proposal: p })
    await sleep(300)
  }

  await sleep(1000)
  const actions: (Action & { agent: string })[] = []
  for (const p of proposals) for (const a of p.proposed_actions) if (a.mutating) actions.push({ ...a, agent: p.agent })
  const proposalId = rid()
  run.proposal = { id: proposalId, correlation_id: run.correlation_id, status: 'pending', plan: { conflict, agents: proposals, actions } }
  run.status = 'awaiting_approval'
  addTrace(run, 'assemble', 'info', 'Assembled proposed plan; awaiting human approval (no write-back yet)',
    { proposal_id: proposalId, mutating_actions: actions.length })
  fireDone(run)
}

async function runApply(run: RunState, approved: string[], rejected: string[]): Promise<void> {
  const approvedSet = new Set(approved)
  await sleep(300)
  addTrace(run, 'approval', 'info',
    `Human committed per-agent decisions - approved ${approved.length ? approved.join(', ') : 'none'}, ` +
    `rejected ${rejected.length ? rejected.join(', ') : 'none'}`, { approved, rejected })
  await sleep(900)
  addTrace(run, 'act', 'info', 'Executing operator-approved write-backs with a HITL token', { approved, rejected })
  for (const action of run.proposal!.plan.actions) {
    await sleep(950)
    if (approvedSet.has(action.agent as string)) {
      action.decision = 'approved'
      applyAction(action)
      addTrace(run, 'writeback', 'info', `Applied ${action.tool} (${action.agent} agent) - operator-approved`, { tool: action.tool, agent: action.agent, ok: true })
    } else {
      action.decision = 'rejected'
      addTrace(run, 'writeback', 'warning', `Skipped ${action.tool} (${action.agent} agent) - operator rejected`, { tool: action.tool, agent: action.agent })
    }
  }
  await sleep(900)
  addTrace(run, 'ingest', 'info', 'Re-observing: reading the updated state back from the source systems')
  await sleep(1300)
  run.snapshot = ingest()
  addTrace(run, 'ingest', 'info', 'Reconciled the post-write-back state into the world model', {
    vessels: run.snapshot.vessels.length, yard_blocks: run.snapshot.yard_blocks.length, appointments: run.snapshot.appointments.length,
  })
  await sleep(1000)
  const conflict = A.detectCollision(run.snapshot)
  run.conflicts.push(conflict)
  addTrace(run, 'reason', conflict.detected ? 'warning' : 'info', conflict.summary,
    { detected: conflict.detected, summary: conflict.summary, detail: conflict.detail })
  await sleep(800)
  run.status = !conflict.detected ? 'resolved' : approved.length ? 'applied' : 'rejected'
  addTrace(run, 'done', 'info',
    run.status === 'resolved' ? 'Loop re-observed; collision resolved'
    : run.status === 'applied' ? 'Loop re-observed; approved write-backs applied but collision not fully resolved'
    : 'All decisions rejected; no write-back performed')
  fireDone(run)
}

function findByProposal(pid: string): RunState | undefined {
  for (const r of runs.values()) if (r.proposal?.id === pid) return r
  return undefined
}

function view(run: RunState): RunView {
  return {
    correlation_id: run.correlation_id,
    status: run.status,
    llm_mode: 'fallback',
    conflicts: run.conflicts,
    initial_conflict: run.conflicts[0] ?? null,
    latest_conflict: run.conflicts[run.conflicts.length - 1] ?? null,
    proposal: run.proposal,
    snapshot: run.snapshot,
  }
}

// ---- public engine API ------------------------------------------------------
export const engine = {
  status(): Status {
    return {
      llm_mode: 'fallback',
      orchestrator_model: 'deterministic engine (offline)',
      worker_model: 'deterministic engine (offline)',
      scenario: { terminal: M.terminal, focus_window: M.focus_window },
    }
  },

  getSources() {
    return {
      tos: { yard_blocks: structuredClone(state.tos.yard_blocks), storage_plan: structuredClone(state.tos.storage_plan) },
      emodal: { appointments: structuredClone(state.emodal.appointments) },
      ais: { positions: structuredClone(state.ais.positions), manifests: structuredClone(state.ais.manifests) },
      as400: { fee_schedule: structuredClone(state.as400.fee_schedule) },
      ecs: { equipment: structuredClone(state.ecs.equipment), movement: structuredClone(state.ecs.movement) },
      scenario: { terminal: M.terminal, focus_window: M.focus_window },
    }
  },

  reset(): void {
    state = seedState()
    runs.clear()
  },

  run(): string {
    const cid = rid()
    const run: RunState = {
      correlation_id: cid, status: 'running', traces: [], conflicts: [], proposal: null,
      snapshot: ingest(), seq: 0, listeners: new Set(), doneListeners: new Set(),
    }
    runs.set(cid, run)
    void runPipeline(run)
    return cid
  },

  getRun(cid: string): RunView {
    const run = runs.get(cid)
    if (!run) throw new Error(`unknown run ${cid}`)
    return view(run)
  },

  commit(pid: string, decisions: Record<string, string>): string {
    const run = findByProposal(pid)
    if (!run) throw new Error('proposal not found')
    const approved = Object.entries(decisions).filter(([, d]) => d === 'approve').map(([a]) => a)
    const rejected = Object.entries(decisions).filter(([, d]) => d !== 'approve').map(([a]) => a)
    run.proposal!.status = 'approved'
    run.status = 'applying'
    void runApply(run, approved, rejected)
    return run.correlation_id
  },

  reject(pid: string): { rejected: boolean; view: RunView } {
    const run = findByProposal(pid)
    if (!run) throw new Error('proposal not found')
    run.proposal!.status = 'rejected'
    run.proposal!.plan.actions.forEach((a) => { a.decision = 'rejected' })
    run.status = 'rejected'
    addTrace(run, 'approval', 'warning', 'Human REJECTED the proposed plan; no write-back performed', { proposal_id: pid })
    addTrace(run, 'done', 'info', 'All decisions rejected; no write-back performed')
    fireDone(run)
    return { rejected: true, view: view(run) }
  },

  subscribe(cid: string, onEvent: (e: TraceEvent) => void, onDone: () => void): () => void {
    const run = runs.get(cid)
    if (!run) { onDone(); return () => {} }
    run.traces.forEach(onEvent) // replay buffered
    if (FINAL.has(run.status)) { onDone(); return () => {} }
    const evL = (e: TraceEvent) => onEvent(e)
    let cleanup = () => {}
    const doneL = () => { cleanup(); onDone() }
    run.listeners.add(evL)
    run.doneListeners.add(doneL)
    cleanup = () => { run.listeners.delete(evL); run.doneListeners.delete(doneL) }
    return cleanup
  },
}
