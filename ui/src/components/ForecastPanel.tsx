import { useMemo } from 'react'
import { engine } from '../engine/engine'
import type { Decision, RunView } from '../types'
import { Icon } from './icons'
import { OutcomeGroups } from './OutcomeGroups'

// Digital-twin forecast shown BEFORE any write-back. Simulates the operator's current selection
// (approve = include, reject = exclude) against the twin and predicts the result live.
export function ForecastPanel({
  view, decisions, mutatingAgents,
}: {
  view: RunView
  decisions: Record<string, Decision>
  mutatingAgents: string[]
}) {
  // undecided agents are treated as "would approve" so the forecast shows the full plan by default
  const approved = mutatingAgents.filter((a) => decisions[a] !== 'reject')
  const forecast = useMemo(
    () => engine.simulate(view.correlation_id, approved),
    [view.correlation_id, approved.join(',')],
  )
  if (!forecast) return null
  const resolved = !forecast.predicted_conflict.detected

  return (
    <section className="panel forecast">
      <div className="panel-head">
        <span className="forecast-badge"><Icon name="mesh" /> Digital twin forecast</span>
        <span className={`pill ${resolved ? 'pill-ok' : 'pill-muted'}`}>
          {resolved ? 'Predicted: collision resolved' : 'Predicted: not fully resolved'}
        </span>
      </div>
      <p className="forecast-lead">
        Simulated against the twin for the {approved.length} action(s) you would approve — <strong>no
        system has been changed yet</strong>. Toggle decisions above to see the forecast update.
      </p>
      <OutcomeGroups outcomes={forecast.outcomes} />
    </section>
  )
}
