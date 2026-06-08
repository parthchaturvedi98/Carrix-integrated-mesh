// Pure domain analysis — browser port of analysis.py. No dependencies, no I/O.
import { SCENARIO_META } from './scenario'
import type { Conflict, ConflictDetail, Snapshot, UseCaseOutcome, YardBlock } from '../types'

const M = SCENARIO_META

export function remainingCapacity(b: YardBlock): number {
  return b.capacity - b.occupied
}

export function dischargeTotal(s: Snapshot, terminal: string, window: string): number {
  return s.vessels
    .filter((v) => v.terminal === terminal && v.discharge_window === window)
    .reduce((sum, v) => sum + (v.discharge_count ?? 0), 0)
}

export function appointmentFor(s: Snapshot, terminal: string, window: string) {
  return s.appointments.find((a) => a.terminal === terminal && a.window === window) ?? null
}

export function planOverflow(s: Snapshot) {
  const idx = new Map(s.yard_blocks.map((b) => [b.block, b]))
  const out: ConflictDetail['overflow_blocks'] = []
  for (const item of s.storage_plan?.sequence ?? []) {
    const blk = idx.get(item.block)
    if (!blk) continue
    const rem = remainingCapacity(blk)
    if (item.containers > rem) {
      out.push({ block: item.block, assigned: item.containers, remaining: rem, overflow: item.containers - rem })
    }
  }
  return out
}

export function detectCollision(s: Snapshot): Conflict {
  const terminal = M.terminal
  const window = M.focus_window
  const total = dischargeTotal(s, terminal, window)
  const surge = total >= M.thresholds.discharge_surge
  const appt = appointmentFor(s, terminal, window)
  const slots = appt?.slots ?? 0
  const demand = appt?.demand ?? 0
  const apptExceeds = demand > slots
  const overflow = planOverflow(s)
  const congested = overflow.length > 0
  const detected = surge && (apptExceeds || congested)
  const focusVessel = s.vessels.find((v) => v.terminal === terminal && v.discharge_window === window)
  const mv = s.movement
  const idleEquip = (s.equipment ?? []).filter((e) => e.utilization_pct < 40).length

  const summary = detected
    ? `T18 collision: ${total} containers discharging at ${terminal} in ${window} collide with a ` +
      `trucker-appointment surge (${demand} demand vs ${slots} slots) on ${overflow.length} over-capacity yard block(s).`
    : `No collision at ${terminal} ${window}: discharge ${total}, appointments ${demand}/${slots}, ` +
      `over-capacity blocks ${overflow.length}.`

  return {
    detected,
    summary,
    detail: {
      terminal,
      window,
      discharge_total: total,
      surge_threshold: M.thresholds.discharge_surge,
      discharge_surge: surge,
      appointment_slots: slots,
      appointment_demand: demand,
      appointment_surge: apptExceeds,
      overflow_blocks: overflow,
      yard_congested: congested,
      vessel_confirmed: Boolean(focusVessel?.confirmed),
      moves: mv?.total_moves,
      shuffles: mv?.unnecessary_shuffles,
      idle_equipment: s.equipment ? idleEquip : undefined,
      avg_utilization: mv?.avg_utilization_pct,
      cycle_time: mv?.cycle_time_min,
    },
  }
}

// Optimized equipment-dispatch target (route optimization + task allocation): removes most
// redundant shuffles, balances utilization, and cuts cycle time.
export function optimizeMovement(m: {
  total_moves: number; unnecessary_shuffles: number; avg_utilization_pct: number; cycle_time_min: number
}) {
  const shuffles = Math.round(m.unnecessary_shuffles * 0.25)
  return {
    total_moves: m.total_moves - (m.unnecessary_shuffles - shuffles),
    unnecessary_shuffles: shuffles,
    avg_utilization_pct: 84,
    cycle_time_min: Math.round(m.cycle_time_min * 0.83),
  }
}

export function resequencePlan(s: Snapshot) {
  const terminal = M.terminal
  const window = M.focus_window
  const total = dischargeTotal(s, terminal, window)
  const vesselId = s.storage_plan?.vessel_id ?? ''
  const same = s.yard_blocks.filter((b) => b.terminal === terminal).sort((a, b) => remainingCapacity(b) - remainingCapacity(a))
  const relief = s.yard_blocks.filter((b) => b.terminal !== terminal).sort((a, b) => remainingCapacity(b) - remainingCapacity(a))
  const sequence: { block: string; containers: number }[] = []
  let toPlace = total
  for (const blk of [...same, ...relief]) {
    if (toPlace <= 0) break
    const take = Math.min(remainingCapacity(blk), toPlace)
    if (take > 0) {
      sequence.push({ block: blk.block, containers: take })
      toPlace -= take
    }
  }
  return { terminal, window, vessel_id: vesselId, sequence }
}

export function staggerSlots(s: Snapshot) {
  const terminal = M.terminal
  const focus = M.focus_window
  const appts = s.appointments.filter((a) => a.terminal === terminal).map((a) => ({ ...a }))
  const byWindow = new Map(appts.map((a) => [a.window, a]))
  const focusAppt = byWindow.get(focus)
  if (!focusAppt) return []
  focusAppt.slots = Math.max(focusAppt.slots, 100)
  let surplus = focusAppt.demand - focusAppt.slots
  const others = appts.filter((a) => a.window !== focus).sort((a, b) => b.slots - b.demand - (a.slots - a.demand))
  let i = 0
  while (surplus > 0 && others.length) {
    const a = others[i % others.length]
    const headroom = a.slots - a.demand
    if (headroom > 0) {
      const move = Math.min(headroom, surplus)
      a.demand += move
      focusAppt.demand -= move
      surplus -= move
    }
    i++
    if (i > 1000) break
  }
  return appts.map((a) => ({ window: a.window, terminal, slots: a.slots, demand: a.demand }))
}

// Digital-twin simulator: apply the proposed actions to a CLONE of the snapshot (never the live
// systems) so we can forecast the outcome before any write-back. Mirrors engine.applyAction.
export function simulatePlan(
  snapshot: Snapshot,
  actions: { tool: string; args: Record<string, any> }[],
): Snapshot {
  const s: Snapshot = structuredClone(snapshot)
  for (const a of actions) {
    if (a.tool === 'tos.write_plan') {
      s.storage_plan = a.args.plan
    } else if (a.tool === 'emodal.set_slots') {
      const updates = (a.args.updates ?? []) as { window: string; terminal: string; slots: number; demand?: number }[]
      for (const u of updates) {
        const ap = s.appointments.find((x) => x.window === u.window && x.terminal === u.terminal)
        if (ap) { ap.slots = u.slots; if (u.demand != null) ap.demand = u.demand }
      }
    } else if (a.tool === 'ais.confirm_window') {
      const v = s.vessels.find((x: any) => x.vessel_id === a.args.vessel_id)
      if (v) { v.discharge_window = a.args.discharge_window; v.confirmed = Boolean(a.args.confirmed) }
    } else if (a.tool === 'ecs.optimize_dispatch') {
      s.movement = a.args.plan
      if (s.equipment) s.equipment = s.equipment.map((e) => ({ ...e, utilization_pct: a.args.plan.avg_utilization_pct, status: 'busy' }))
    }
  }
  return s
}

// number of active bottlenecks in the operating picture (over-capacity blocks + appointment surge
// window + idle-equipment condition)
function bottlenecks(d: ConflictDetail): number {
  return d.overflow_blocks.length + (d.appointment_surge ? 1 : 0) + ((d.idle_equipment ?? 0) > 0 ? 1 : 0)
}

// Map the before/after conflict details to the client's use-case KPIs + benefit ranges.
export function computeOutcomes(
  initial: ConflictDetail,
  latest: ConflictDetail,
  fees: { code: string; amount: number }[],
): UseCaseOutcome[] {
  const rate = (code: string) => fees.find((f) => f.code === code)?.amount ?? 0
  const cong = rate('CONGESTION_SURCHARGE')
  const dem = rate('DEMURRAGE')
  const sumOverflow = (d: ConflictDetail) => d.overflow_blocks.reduce((s, o) => s + o.overflow, 0)
  const ovB = sumOverflow(initial)
  const ovA = sumOverflow(latest)
  const trucksB = Math.max(0, initial.appointment_demand - initial.appointment_slots)
  const trucksA = Math.max(0, latest.appointment_demand - latest.appointment_slots)
  const money = (n: number) => `$${Math.round(n).toLocaleString()}`

  return [
    {
      use_case: 'Digital twin / control tower',
      kpis: [
        { label: 'Active bottlenecks', before: `${bottlenecks(initial)}`, after: `${bottlenecks(latest)}`, achieved: bottlenecks(latest) < bottlenecks(initial) },
        { label: 'Scenario cycle time', before: 'hours (manual)', after: 'seconds (twin)', achieved: true },
      ],
      benefits: ['20-40% faster scenario decisions', '5-15% throughput uplift in constrained periods', '10-20% fewer planning errors'],
    },
    {
      use_case: 'Vessel planning & container placement',
      kpis: [
        { label: 'Non-revenue moves (yard rehandles)', before: `${ovB}`, after: `${ovA}`, achieved: ovA < ovB },
        { label: 'Over-capacity yard blocks', before: `${initial.overflow_blocks.length}`, after: `${latest.overflow_blocks.length}`, achieved: latest.overflow_blocks.length < initial.overflow_blocks.length },
        { label: 'Vessel discharge window', before: initial.vessel_confirmed ? 'confirmed' : 'unconfirmed', after: latest.vessel_confirmed ? 'confirmed' : 'unconfirmed', achieved: Boolean(latest.vessel_confirmed) && !initial.vessel_confirmed },
      ],
      benefits: ['5-15% fewer non-revenue moves', '10-25% higher yard productivity', '5-12% faster vessel turnaround'],
    },
    {
      use_case: 'Real-time inbound/outbound optimization',
      kpis: [
        { label: 'Trucks over slot capacity (surge window)', before: `${trucksB}`, after: `${trucksA}`, achieved: trucksA < trucksB },
        { label: 'Appointment demand vs slots', before: `${initial.appointment_demand}/${initial.appointment_slots}`, after: `${latest.appointment_demand}/${latest.appointment_slots}`, achieved: latest.appointment_demand <= latest.appointment_slots && initial.appointment_demand > initial.appointment_slots },
      ],
      benefits: ['15-30% lower truck wait time', '10-20% better appointment adherence', '5-10% fewer congestion delays'],
    },
    {
      use_case: 'Container movement optimization',
      kpis: [
        { label: 'Total container moves', before: `${initial.moves ?? 0}`, after: `${latest.moves ?? 0}`, achieved: (latest.moves ?? 0) < (initial.moves ?? 0) },
        { label: 'Unnecessary shuffles', before: `${initial.shuffles ?? 0}`, after: `${latest.shuffles ?? 0}`, achieved: (latest.shuffles ?? 0) < (initial.shuffles ?? 0) },
        { label: 'Equipment utilization (avg)', before: `${initial.avg_utilization ?? 0}%`, after: `${latest.avg_utilization ?? 0}%`, achieved: (latest.avg_utilization ?? 0) > (initial.avg_utilization ?? 0) },
        { label: 'Idle yard cranes', before: `${initial.idle_equipment ?? 0}`, after: `${latest.idle_equipment ?? 0}`, achieved: (latest.idle_equipment ?? 0) < (initial.idle_equipment ?? 0) },
        { label: 'Cycle time per move', before: `${initial.cycle_time ?? 0} min`, after: `${latest.cycle_time ?? 0} min`, achieved: (latest.cycle_time ?? 0) < (initial.cycle_time ?? 0) },
      ],
      benefits: ['10-20% fewer moves', '5-15% higher equipment utilization', '5-10% lower fuel/energy use'],
    },
    {
      use_case: 'Cost & demurrage impact',
      kpis: [
        { label: 'Congestion surcharge exposure', before: money(ovB * cong), after: money(ovA * cong), achieved: ovA * cong < ovB * cong },
        { label: 'Demurrage risk (per day)', before: money(ovB * dem), after: money(ovA * dem), achieved: ovA * dem < ovB * dem },
      ],
      benefits: ['Avoids congestion surcharge and demurrage exposure'],
    },
  ]
}

export function computeFees(s: Snapshot) {
  const fees = new Map(s.fees.map((f) => [f.code, f]))
  const overflow = planOverflow(s)
  const overflowCount = overflow.reduce((sum, o) => sum + o.overflow, 0)
  const congestionRate = fees.get('CONGESTION_SURCHARGE')?.amount ?? 0
  const demurrageRate = fees.get('DEMURRAGE')?.amount ?? 0
  return {
    overflow_containers: overflowCount,
    congestion_surcharge: Math.round(overflowCount * congestionRate * 100) / 100,
    demurrage_risk_per_day: Math.round(overflowCount * demurrageRate * 100) / 100,
    currency: fees.get('CONGESTION_SURCHARGE')?.currency ?? 'USD',
  }
}
