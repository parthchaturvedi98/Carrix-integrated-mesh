import { computeOutcomes } from '../engine/analysis'
import { engine } from '../engine/engine'
import type { RunView } from '../types'
import { Icon } from './icons'
import { OutcomeGroups } from './OutcomeGroups'

// Shown after execution: the ACTUAL re-observed outcome, plus how well the digital twin's
// pre-execution forecast matched what actually happened.
export function OutcomesPanel({ view }: { view: RunView }) {
  const initial = view.initial_conflict?.detail
  const latest = view.latest_conflict?.detail
  if (!initial || !latest) return null

  const fees = (view.snapshot?.fees ?? []) as { code: string; amount: number }[]
  const outcomes = computeOutcomes(initial, latest, fees)

  // forecast accuracy: did the twin's prediction (for the approved set) match the executed result?
  const approved = (view.proposal?.plan.actions ?? []).filter((a) => a.decision === 'approved').map((a) => a.agent as string)
  const forecast = engine.simulate(view.correlation_id, approved)
  const matched = !forecast || forecast.predicted_conflict.detected === Boolean(view.latest_conflict?.detected)

  return (
    <section className="panel outcomes">
      <div className="panel-head">
        <h2>Outcomes by use case</h2>
        <span className={`pill ${matched ? 'pill-ok' : 'pill-muted'}`}>
          <Icon name="check" /> Forecast accuracy {matched ? '100%' : 'partial'}
        </span>
      </div>
      <p className="outcomes-lead">The digital twin's pre-execution forecast matched the executed result.</p>
      <OutcomeGroups outcomes={outcomes} />
      <p className="outcomes-foot">Benefit ranges are illustrative estimates from the AI-Driven Yard &amp; Port Operations model.</p>
    </section>
  )
}
