import type { Snapshot } from '../types'

/** Yard block occupancy + the current storage plan's assignment, so the operator can see the
 *  congestion before approval (a plan that assigns more than a block can hold) and the
 *  spread-out, feasible plan after write-back. */
export function YardView({ snapshot }: { snapshot: Snapshot }) {
  const assigned = new Map<string, number>()
  for (const item of snapshot.storage_plan?.sequence ?? []) {
    assigned.set(item.block, (assigned.get(item.block) ?? 0) + item.containers)
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Yard blocks</h2>
        <span className="panel-sub">occupied vs capacity, with the current plan’s assignment</span>
      </div>
      <div className="yard-grid">
        {snapshot.yard_blocks.map((b) => {
          const free = b.capacity - b.occupied
          const plan = assigned.get(b.block) ?? 0
          const over = Math.max(0, plan - free) // containers the plan can't fit in this block
          const occPct = Math.min(100, (b.occupied / b.capacity) * 100)
          const planFitPct = Math.min(100 - occPct, (Math.min(plan, free) / b.capacity) * 100)
          const title =
            `${b.block}: ${b.occupied} occupied of ${b.capacity} (${free} free)` +
            (plan ? `; plan assigns ${plan}${over ? `, ${over} over capacity` : ' (fits)'}` : '')
          return (
            <div className="yard-row" key={b.block}>
              <span className="yard-name">{b.block}</span>
              <div className="bar" title={title}>
                <div className="bar-occ" style={{ width: `${occPct}%` }} />
                <div className={`bar-plan ${over ? 'bar-over' : ''}`} style={{ width: `${planFitPct}%` }} />
              </div>
              <div className="yard-num">
                <span className="yard-occ">{b.occupied}/{b.capacity}</span>
                {plan > 0 &&
                  (over > 0 ? (
                    <span className="yard-plan over">plan {plan} · {over} over</span>
                  ) : (
                    <span className="yard-plan fit">plan {plan} · fits</span>
                  ))}
              </div>
            </div>
          )
        })}
      </div>
      <div className="legend">
        <span><i className="sw sw-occ" /> occupied</span>
        <span><i className="sw sw-plan" /> planned discharge</span>
        <span><i className="sw sw-over" /> over capacity</span>
      </div>
    </section>
  )
}
