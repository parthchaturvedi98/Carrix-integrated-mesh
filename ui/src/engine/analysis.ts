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
    },
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
