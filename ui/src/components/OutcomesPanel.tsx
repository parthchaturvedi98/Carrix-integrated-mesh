import { computeOutcomes } from '../engine/analysis'
import type { RunView } from '../types'
import { Icon } from './icons'

// Shown after the loop resolves: maps the before/after state to the client's use-case KPIs
// and estimated benefits, so the demo lands on outcomes, not just the operational fix.
export function OutcomesPanel({ view }: { view: RunView }) {
  const initial = view.initial_conflict?.detail
  const latest = view.latest_conflict?.detail
  if (!initial || !latest) return null

  const fees = (view.snapshot?.fees ?? []) as { code: string; amount: number }[]
  const outcomes = computeOutcomes(initial, latest, fees)

  return (
    <section className="panel outcomes">
      <div className="panel-head"><h2>Outcomes by use case</h2></div>
      <div className="outcome-groups">
        {outcomes.map((uc) => (
          <div key={uc.use_case} className="outcome-uc">
            <div className="outcome-uc-name">{uc.use_case}</div>
            <div className="outcome-kpis">
              {uc.kpis.map((k) => (
                <div key={k.label} className={`kpi-row ${k.achieved ? 'achieved' : 'pending'}`}>
                  <span className="kpi-label">{k.label}</span>
                  <span className="kpi-delta">
                    <span className="kpi-before">{k.before}</span>
                    <span className="kpi-arrow">to</span>
                    <span className="kpi-after">{k.after}</span>
                    {k.achieved
                      ? <Icon name="check" />
                      : <span className="kpi-note">not realized</span>}
                  </span>
                </div>
              ))}
            </div>
            <div className="outcome-benefits">
              {uc.benefits.map((b) => <span key={b} className="chip chip-benefit">{b}</span>)}
            </div>
          </div>
        ))}
      </div>
      <p className="outcomes-foot">Benefit ranges are illustrative estimates from the AI-Driven Yard &amp; Port Operations model.</p>
    </section>
  )
}
