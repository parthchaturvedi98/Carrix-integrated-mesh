// Deterministic worker agents — browser port of the Python fallback proposals.
import * as A from './analysis'
import { SCENARIO_META } from './scenario'
import type { AgentProposal, Snapshot } from '../types'

const M = SCENARIO_META

export const AGENT_TASKS: Record<string, string> = {
  Yard: 'reading yard occupancy and storage plan to re-sequence around congestion',
  Gate: 'reading appointment slots to stagger the trucker surge',
  Vessel: 'reading AIS positions and manifests to confirm the discharge window',
  Movement: 'reading equipment telemetry to optimize routes and balance crane workload',
  Fees: 'reading the AS/400 fee schedule to compute demurrage and congestion impact',
}

// Client use-case framing (from the "AI-Driven Yard & Port Operations" slide)
export const UC = {
  vessel: 'Vessel planning & container placement',
  inout: 'Real-time inbound/outbound optimization',
  movement: 'Container movement optimization',
  cost: 'Cost & demurrage impact',
}

const BENEFITS: Record<string, string[]> = {
  [UC.vessel]: [
    '5-15% fewer non-revenue moves',
    '10-25% higher yard productivity',
    '5-12% faster vessel turnaround',
  ],
  [UC.inout]: [
    '15-30% lower truck wait time',
    '10-20% better appointment adherence',
    '5-10% fewer congestion delays',
  ],
  [UC.movement]: [
    '10-20% fewer moves',
    '5-15% higher equipment utilization',
    '5-10% lower fuel/energy use',
  ],
  [UC.cost]: ['Avoids congestion surcharge and demurrage exposure'],
}

export function yardProposal(s: Snapshot): AgentProposal {
  const overflow = A.planOverflow(s)
  const plan = A.resequencePlan(s)
  const blocks = plan.sequence.map((i) => `${i.block}=${i.containers}`).join(', ')
  const findings = overflow.length
    ? `Current storage plan overflows ${overflow.length} block(s): ` +
      overflow.map((o) => `${o.block} ${o.overflow} over capacity`).join('; ') + '.'
    : 'Storage plan is within capacity.'
  // Confidence: high when relief blocks have clear headroom to absorb overflow
  const reliefHeadroom = s.yard_blocks
    .filter((b) => !overflow.find((o) => o.block === b.block))
    .reduce((sum, b) => sum + (b.capacity - b.occupied), 0)
  const totalOverflow = overflow.reduce((sum, o) => sum + o.overflow, 0)
  const confidence = overflow.length === 0 ? 95
    : reliefHeadroom >= totalOverflow * 1.5 ? 91
    : reliefHeadroom >= totalOverflow ? 82
    : 68
  return {
    agent: 'Yard',
    findings,
    rationale:
      'Spread the discharge across same-terminal blocks first, then relief blocks, so no block ' +
      'exceeds its remaining capacity, eliminating the yard congestion.',
    proposed_actions: overflow.length
      ? [{ tool: 'tos.write_plan', args: { plan }, mutating: true, description: `Re-sequence storage plan across blocks: ${blocks}` }]
      : [],
    evidence_ids: ['tos.read_yard', 'tos.read_storage_plan'],
    use_case: UC.vessel,
    targets: ['Yard rehandles / non-revenue moves', 'Yard productivity', 'Planned vs actual moves'],
    benefits: BENEFITS[UC.vessel],
    confidence,
  }
}

export function gateProposal(s: Snapshot): AgentProposal {
  const appt = A.appointmentFor(s, M.terminal, M.focus_window)
  const surge = (appt?.demand ?? 0) - (appt?.slots ?? 0)
  const updates = A.staggerSlots(s)
  const hasSurge = surge > 0 && updates.length > 0
  // Confidence: based on how much adjacent window slack can absorb the overflow
  const adjacentSlack = s.appointments
    .filter((a) => a.terminal === M.terminal && a.window !== M.focus_window)
    .reduce((sum, a) => sum + Math.max(0, a.slots - a.demand), 0)
  const confidence = !hasSurge ? 96
    : adjacentSlack >= surge ? 88
    : adjacentSlack >= surge * 0.6 ? 76
    : 62
  return {
    agent: 'Gate',
    findings: hasSurge
      ? `Surge window ${M.focus_window}: demand ${appt?.demand} versus ${appt?.slots} slots (${surge} over).`
      : 'No appointment surge detected.',
    rationale:
      'Move surplus appointment demand into adjacent windows with headroom and add lanes to the ' +
      'surge window so every window satisfies demand within slots.',
    proposed_actions: hasSurge
      ? [{ tool: 'emodal.set_slots', args: { updates }, mutating: true, description: 'Stagger appointments across windows and add lanes to the surge window.' }]
      : [],
    evidence_ids: ['emodal.list_appointments'],
    use_case: UC.inout,
    targets: ['Truck wait / gate wait time', 'Appointment SLA / cut-off adherence'],
    benefits: BENEFITS[UC.inout],
    confidence,
  }
}

export function vesselProposal(s: Snapshot): AgentProposal {
  const v = s.vessels.find((x) => x.terminal === M.terminal && x.discharge_window === M.focus_window)
  if (!v) {
    return {
      agent: 'Vessel',
      findings: 'No vessel discharging in the focus window.',
      rationale: 'Nothing to confirm.',
      proposed_actions: [],
      evidence_ids: ['ais.positions', 'ais.manifests'],
    }
  }
  // Confidence: lower if vessel is unconfirmed or discharge count is very large
  const confidence = v.confirmed ? 94
    : v.discharge_count > 350 ? 79
    : 85
  return {
    agent: 'Vessel',
    findings:
      `${v.name ?? v.vessel_id} (ETA ${v.eta}) discharging ${v.discharge_count} containers at ` +
      `${M.terminal} in ${M.focus_window}; manifest confirmed is ${Boolean(v.confirmed)}.`,
    rationale:
      'Confirming the existing discharge window gives the yard and gate plans a firm commitment to ' +
      'align to. The congestion is absorbed by the yard re-sequence and gate stagger, not by moving the vessel.',
    proposed_actions: [
      { tool: 'ais.confirm_window', args: { vessel_id: v.vessel_id, discharge_window: M.focus_window, confirmed: true }, mutating: true, description: `Confirm ${v.vessel_id} discharge window ${M.focus_window}.` },
    ],
    evidence_ids: ['ais.positions', 'ais.manifests'],
    use_case: UC.vessel,
    targets: ['Vessel turnaround time'],
    benefits: BENEFITS[UC.vessel],
    confidence,
  }
}

export function movementProposal(s: Snapshot): AgentProposal {
  const mv = s.movement
  const equip = s.equipment ?? []
  const idle = equip.filter((e) => e.utilization_pct < 40).length
  const optimized = mv ? A.optimizeMovement(mv) : undefined
  const hasWork = !!mv && (mv.unnecessary_shuffles > 0 || idle > 0)
  // Confidence: higher when shuffle count and imbalance are clearly measurable
  const shuffleRatio = mv ? mv.unnecessary_shuffles / Math.max(mv.total_moves, 1) : 0
  const confidence = !mv ? 55
    : idle > 0 && shuffleRatio > 0.1 ? 87
    : shuffleRatio > 0.05 ? 81
    : 74
  return {
    agent: 'Movement',
    findings: mv
      ? `${mv.total_moves} container moves planned, including ${mv.unnecessary_shuffles} unnecessary shuffles. ` +
        `${idle} of ${equip.length} yard cranes are idle (under 40 percent utilization) while others are overloaded; ` +
        `average utilization ${mv.avg_utilization_pct} percent, cycle time ${mv.cycle_time_min} minutes per move.`
      : 'No equipment telemetry available.',
    rationale:
      'Route optimization and task allocation balance the workload across all yard cranes, remove ' +
      'redundant shuffles, and cut equipment idle time, lowering moves per lift and cycle time.',
    proposed_actions: hasWork && optimized
      ? [{ tool: 'ecs.optimize_dispatch', args: { plan: optimized }, mutating: true, description: 'Rebalance equipment dispatch and optimize routes to cut redundant moves.' }]
      : [],
    evidence_ids: ['ecs.equipment_telemetry', 'ecs.move_log'],
    use_case: UC.movement,
    targets: ['Container moves per lift', 'Equipment utilization', 'Cycle time'],
    benefits: BENEFITS[UC.movement],
    confidence,
  }
}

export function feesProposal(s: Snapshot): AgentProposal {
  const f = A.computeFees(s)
  const cur = f.currency
  return {
    agent: 'Fees',
    findings:
      `${f.overflow_containers} containers at risk of congestion handling. Estimated congestion ` +
      `surcharge ${cur} ${f.congestion_surcharge.toLocaleString()}; demurrage risk ${cur} ` +
      `${f.demurrage_risk_per_day.toLocaleString()} per day if left unplaced.`,
    rationale:
      'Figures derived from the AS/400 fee schedule (congestion surcharge, demurrage rate) applied ' +
      'to over-capacity containers. Resolving the yard overflow drives these to zero.',
    proposed_actions: [],
    evidence_ids: ['as400.fee_schedule', 'as400.demurrage_rules'],
    use_case: UC.cost,
    targets: ['Congestion surcharge', 'Demurrage risk'],
    benefits: BENEFITS[UC.cost],
    confidence: f.overflow_containers > 0 ? 97 : 92, // fee computation is deterministic
  }
}

export const AGENTS = ['Yard', 'Gate', 'Vessel', 'Movement', 'Fees'] as const
export function runAgent(name: string, s: Snapshot): AgentProposal {
  switch (name) {
    case 'Yard': return yardProposal(s)
    case 'Gate': return gateProposal(s)
    case 'Vessel': return vesselProposal(s)
    case 'Movement': return movementProposal(s)
    default: return feesProposal(s)
  }
}
