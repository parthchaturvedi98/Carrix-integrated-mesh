import type { UseCaseOutcome } from '../types'
import { Icon } from './icons'

// Shared renderer for grouped use-case outcomes (used by both the live forecast and the
// post-execution actuals).
export function OutcomeGroups({ outcomes }: { outcomes: UseCaseOutcome[] }) {
  return (
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
                  {k.achieved ? <Icon name="check" /> : <span className="kpi-note">no change</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
