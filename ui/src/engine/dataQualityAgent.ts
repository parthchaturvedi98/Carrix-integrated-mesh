// In-browser data-quality agent — runs after the medallion pipeline and streams
// check steps the way the reconciliation agents stream trace events.
// Produces a structured DQReport with per-domain findings.

import type { RawMockState } from './scenario'

export type Severity = 'critical' | 'warning' | 'info' | 'ok'

export interface DQFinding {
  domain: string        // TOS | eModal | AIS | AS/400 | ECS | Cross-file
  severity: Severity
  title: string
  detail: string
}

export interface DQReport {
  score: number           // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  summary: string
  findings: DQFinding[]
  files_checked: number
  rows_checked: number
}

export interface DQStep {
  id: string
  label: string
  status: 'pending' | 'running' | 'done'
  findingCount?: number
}

export type DQCallback = (step: DQStep, allSteps: DQStep[]) => void

const STEPS: Omit<DQStep, 'status'>[] = [
  { id: 'schema',      label: 'Checking schema completeness' },
  { id: 'capacity',    label: 'Validating yard block capacity ratios' },
  { id: 'plan',        label: 'Checking storage plan feasibility' },
  { id: 'gate',        label: 'Analysing gate appointment windows' },
  { id: 'vessel',      label: 'Verifying vessel manifest consistency' },
  { id: 'equipment',   label: 'Assessing equipment health' },
  { id: 'crossfile',   label: 'Running cross-file consistency checks' },
  { id: 'score',       label: 'Computing data quality score' },
]

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function grade(score: number): DQReport['grade'] {
  if (score >= 88) return 'A'
  if (score >= 72) return 'B'
  if (score >= 55) return 'C'
  if (score >= 30) return 'D'
  return 'F'
}

// ── individual checks ─────────────────────────────────────────────────────────

function checkSchema(state: RawMockState, fileCount: number): DQFinding[] {
  const findings: DQFinding[] = []

  if (!state.tos.yard_blocks.length)
    findings.push({ domain: 'TOS', severity: 'critical', title: 'No yard blocks', detail: 'tos_yard_blocks data is empty — the engine cannot reason about yard capacity.' })
  if (!state.emodal.appointments.length)
    findings.push({ domain: 'eModal', severity: 'critical', title: 'No appointment records', detail: 'emodal_appointments data is empty — gate surge detection will be skipped.' })
  if (!state.ais.manifests.length)
    findings.push({ domain: 'AIS', severity: 'critical', title: 'No vessel manifests', detail: 'ais_manifests data is empty — no discharge events can be modelled.' })
  if (!state.as400.fee_schedule.length)
    findings.push({ domain: 'AS/400', severity: 'warning', title: 'No fee schedule', detail: 'as400_fees is empty — demurrage and surcharge calculations will be skipped.' })
  if (fileCount === 1)
    findings.push({ domain: 'TOS', severity: 'info', title: 'Single-file upload', detail: 'Scenario loaded from one JSON file. All systems populated from this source.' })

  return findings
}

function checkCapacity(state: RawMockState): DQFinding[] {
  const findings: DQFinding[] = []
  for (const b of state.tos.yard_blocks) {
    const ratio = b.capacity > 0 ? b.occupied / b.capacity : 0
    if (b.occupied > b.capacity)
      findings.push({ domain: 'TOS', severity: 'critical', title: `Block ${b.block} over capacity`, detail: `Occupied ${b.occupied} exceeds capacity ${b.capacity} — auto-clamped by Silver layer.` })
    else if (ratio >= 0.9)
      findings.push({ domain: 'TOS', severity: 'warning', title: `Block ${b.block} near-full (${Math.round(ratio * 100)}%)`, detail: `Less than 10% headroom — any inbound discharge plan risks overflow.` })
    else if (ratio >= 0.75)
      findings.push({ domain: 'TOS', severity: 'info', title: `Block ${b.block} at ${Math.round(ratio * 100)}% utilisation`, detail: `Within acceptable range but worth monitoring during peak window.` })
  }
  if (!findings.length)
    findings.push({ domain: 'TOS', severity: 'ok', title: 'Yard blocks healthy', detail: 'All blocks within capacity limits.' })
  return findings
}

function checkPlan(state: RawMockState): DQFinding[] {
  const findings: DQFinding[] = []
  const plan = state.tos.storage_plan
  if (!plan) {
    findings.push({ domain: 'TOS', severity: 'warning', title: 'No storage plan', detail: 'No tos_storage_plan found — discharge placement will use defaults.' })
    return findings
  }
  const blockMap = new Map(state.tos.yard_blocks.map((b) => [b.block, b]))
  let totalOverflow = 0
  for (const seq of plan.sequence) {
    const b = blockMap.get(seq.block)
    if (!b) {
      findings.push({ domain: 'TOS', severity: 'warning', title: `Unknown block in plan: ${seq.block}`, detail: `Plan references ${seq.block} which is not in yard_blocks data.` })
      continue
    }
    const headroom = b.capacity - b.occupied
    if (seq.containers > headroom) {
      const overflow = seq.containers - headroom
      totalOverflow += overflow
      findings.push({ domain: 'TOS', severity: 'critical', title: `Plan overflow in ${seq.block}`, detail: `Plan assigns ${seq.containers} containers but only ${headroom} slots free — overflow of ${overflow}.` })
    }
  }
  if (totalOverflow === 0 && plan.sequence.length)
    findings.push({ domain: 'TOS', severity: 'ok', title: 'Storage plan fits within capacity', detail: `All ${plan.sequence.length} sequence items fit within block headroom.` })
  return findings
}

function checkGate(state: RawMockState): DQFinding[] {
  const findings: DQFinding[] = []
  for (const a of state.emodal.appointments) {
    if (a.demand > a.slots) {
      const pct = Math.round(((a.demand - a.slots) / a.slots) * 100)
      findings.push({ domain: 'eModal', severity: a.demand > a.slots * 1.5 ? 'critical' : 'warning',
        title: `Appointment surge ${a.window} (+${pct}% over capacity)`,
        detail: `${a.demand} demand vs ${a.slots} slots at ${a.terminal} — ${a.demand - a.slots} truckers cannot be accommodated.` })
    } else {
      findings.push({ domain: 'eModal', severity: 'ok', title: `${a.window} within slot capacity`, detail: `${a.demand}/${a.slots} slots used — no surge.` })
    }
  }
  return findings
}

function checkVessels(state: RawMockState): DQFinding[] {
  const findings: DQFinding[] = []
  const posIds = new Set(state.ais.positions.map((p) => p.vessel_id))
  for (const m of state.ais.manifests) {
    if (!posIds.has(m.vessel_id))
      findings.push({ domain: 'AIS', severity: 'warning', title: `No position for ${m.vessel_id}`, detail: `Manifest references ${m.vessel_id} but no AIS position record found — ETA unknown.` })
    if (!m.confirmed)
      findings.push({ domain: 'AIS', severity: 'info', title: `${m.vessel_id} discharge unconfirmed`, detail: `${m.discharge_count} containers at ${m.terminal} (${m.discharge_window}) — vessel has not confirmed the window.` })
    else
      findings.push({ domain: 'AIS', severity: 'ok', title: `${m.vessel_id} confirmed`, detail: `${m.discharge_count} containers confirmed for ${m.discharge_window} at ${m.terminal}.` })
  }
  return findings
}

function checkEquipment(state: RawMockState): DQFinding[] {
  const findings: DQFinding[] = []
  for (const e of state.ecs.equipment) {
    if (e.utilization_pct > 100)
      findings.push({ domain: 'ECS', severity: 'critical', title: `${e.id} overloaded (${e.utilization_pct}%)`, detail: `Equipment running above rated capacity — risk of breakdown and safety incident.` })
    else if (e.utilization_pct < 35)
      findings.push({ domain: 'ECS', severity: 'info', title: `${e.id} idle (${e.utilization_pct}%)`, detail: `Underutilised asset — could be redeployed to relieve congestion elsewhere.` })
  }
  const mv = state.ecs.movement
  if (mv.unnecessary_shuffles > 50)
    findings.push({ domain: 'ECS', severity: 'warning', title: `High rehandle count (${mv.unnecessary_shuffles} shuffles)`, detail: `Indicates poor yard placement plan — Movement agent will propose optimisation.` })
  if (!findings.some((f) => f.severity === 'critical' || f.severity === 'warning'))
    findings.push({ domain: 'ECS', severity: 'ok', title: 'Equipment within normal operating range', detail: `Avg utilisation ${mv.avg_utilization_pct}%, cycle time ${mv.cycle_time_min} min.` })
  return findings
}

function checkCrossFile(state: RawMockState): DQFinding[] {
  const findings: DQFinding[] = []
  const manifestTerminals = new Set(state.ais.manifests.map((m) => m.terminal))
  const blockTerminals = new Set(state.tos.yard_blocks.map((b) => b.terminal))
  const apptTerminals = new Set(state.emodal.appointments.map((a) => a.terminal))

  for (const t of manifestTerminals) {
    if (!blockTerminals.has(t))
      findings.push({ domain: 'Cross-file', severity: 'critical', title: `Terminal ${t} has no yard blocks`, detail: `Manifests reference ${t} but no yard blocks exist for this terminal.` })
    if (!apptTerminals.has(t))
      findings.push({ domain: 'Cross-file', severity: 'warning', title: `No appointments for terminal ${t}`, detail: `Vessels discharging at ${t} but eModal has no appointment windows for it.` })
  }

  const plan = state.tos.storage_plan
  if (plan) {
    const manifestVessels = new Set(state.ais.manifests.map((m) => m.vessel_id))
    if (!manifestVessels.has(plan.vessel_id))
      findings.push({ domain: 'Cross-file', severity: 'warning', title: `Storage plan vessel ${plan.vessel_id} not in manifests`, detail: 'The storage plan references a vessel that has no AIS manifest — plan may be stale.' })
  }

  if (!findings.length)
    findings.push({ domain: 'Cross-file', severity: 'ok', title: 'Cross-file references consistent', detail: 'Terminals, vessel IDs, and windows align across all uploaded files.' })
  return findings
}

function computeScore(findings: DQFinding[]): number {
  const criticals = findings.filter((f) => f.severity === 'critical').length
  const warnings  = findings.filter((f) => f.severity === 'warning').length
  // Penalty is capped so a realistic collision scenario (3-5 criticals) scores C/D
  // rather than F — the issues are expected and the loop exists to resolve them.
  const penalty = Math.min(criticals * 9, 45) + Math.min(warnings * 4, 20)
  return Math.max(0, Math.min(100, 100 - penalty))
}

// ── main export ───────────────────────────────────────────────────────────────

export async function runDataQualityAgent(
  state: RawMockState,
  fileCount: number,
  totalRows: number,
  onStep: DQCallback,
): Promise<DQReport> {
  const steps: DQStep[] = STEPS.map((s) => ({ ...s, status: 'pending' as const }))
  const allFindings: DQFinding[] = []

  const runStep = async (id: string, delay: number, check: () => DQFinding[]) => {
    const idx = steps.findIndex((s) => s.id === id)
    steps[idx] = { ...steps[idx], status: 'running' }
    onStep(steps[idx], [...steps])
    await sleep(delay)
    const found = check()
    allFindings.push(...found)
    steps[idx] = { ...steps[idx], status: 'done', findingCount: found.filter(f => f.severity !== 'ok').length }
    onStep(steps[idx], [...steps])
  }

  await runStep('schema',    420, () => checkSchema(state, fileCount))
  await runStep('capacity',  560, () => checkCapacity(state))
  await runStep('plan',      500, () => checkPlan(state))
  await runStep('gate',      480, () => checkGate(state))
  await runStep('vessel',    440, () => checkVessels(state))
  await runStep('equipment', 400, () => checkEquipment(state))
  await runStep('crossfile', 540, () => checkCrossFile(state))
  await runStep('score',     320, () => [])

  const score = computeScore(allFindings)
  const criticals = allFindings.filter((f) => f.severity === 'critical').length
  const warnings = allFindings.filter((f) => f.severity === 'warning').length

  const summary = criticals > 0
    ? `${criticals} critical issue${criticals > 1 ? 's' : ''} detected that will affect reconciliation accuracy.`
    : warnings > 0
    ? `Data loaded successfully with ${warnings} warning${warnings > 1 ? 's' : ''} — review before running the loop.`
    : 'All checks passed — data is clean and ready for reconciliation.'

  return { score, grade: grade(score), summary, findings: allFindings, files_checked: fileCount, rows_checked: totalRows }
}
