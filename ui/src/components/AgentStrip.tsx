import type { TraceEvent } from '../types'
import { AGENT_ICON, Icon } from './icons'

const AGENTS = ['Yard', 'Gate', 'Vessel', 'Movement', 'Fees'] as const

type State = 'pending' | 'working' | 'done'

/** Live status of each worker agent, derived from the trace stream:
 *  a `state:start` event → working; a `state:done` event → done. */
export function AgentStrip({ traces }: { traces: TraceEvent[] }) {
  const state: Record<string, State> = { Yard: 'pending', Gate: 'pending', Vessel: 'pending', Movement: 'pending', Fees: 'pending' }
  for (const t of traces) {
    const a = t.data?.agent
    if (!a || !(a in state)) continue
    if (t.data?.state === 'start' && state[a] === 'pending') state[a] = 'working'
    if (t.data?.state === 'done') state[a] = 'done'
  }

  return (
    <section className="panel agent-strip">
      <div className="panel-head"><h2>Worker agents</h2></div>
      <div className="agent-row">
        {AGENTS.map((a) => (
          <div key={a} className={`agent-chip ag-${state[a]}`}>
            <span className="agent-icon"><Icon name={AGENT_ICON[a]} /></span>
            <span className="agent-name">{a}</span>
            <span className="agent-state">
              {state[a] === 'working' && <span className="spinner" />}
              {state[a] === 'done' && <Icon name="check" />}
              {state[a] === 'working' ? 'working' : state[a] === 'done' ? 'done' : 'idle'}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
