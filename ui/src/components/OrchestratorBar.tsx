import type { TraceEvent } from '../types'
import { Icon } from './icons'

type Phase = 'idle' | 'running' | 'awaiting' | 'applying' | 'done'

const STAGES = ['Ingest', 'Reason', 'Coordinate', 'Plan', 'Approve', 'Apply', 'Re-observe', 'Resolve']

// Which stage of the orchestrator loop is active, from the run phase + latest trace step.
function activeStage(phase: Phase, last: TraceEvent | null): number {
  const step = last?.step ?? ''
  if (phase === 'running') {
    if (step === 'reason') return 1
    if (step === 'fanout' || step.startsWith('agent:')) return 2
    if (step === 'assemble') return 3
    return 0 // start / ingest
  }
  if (phase === 'awaiting') return 4
  if (phase === 'applying') return step === 'ingest' || step === 'reason' ? 6 : 5
  return 7 // done
}

export function OrchestratorBar({ phase, traces }: { phase: Phase; traces: TraceEvent[] }) {
  const last = traces.length ? traces[traces.length - 1] : null
  const active = activeStage(phase, last)
  const working = phase === 'running' || phase === 'applying'
  const narration = last?.message ?? 'Starting the reconciliation loop…'

  return (
    <section className="panel orch">
      <div className="orch-head">
        <span className="orch-logo"><Icon name="mesh" /></span>
        <div className="orch-title">
          <strong>Orchestrator</strong>
          <span className="orch-sub">Claude · ingest → reason → fan-out → act</span>
        </div>
        <span className="orch-now">
          {working && <span className="spinner" />}
          <span className="orch-msg">{narration}</span>
        </span>
      </div>
      <ol className="orch-steps">
        {STAGES.map((s, i) => (
          <li key={s} className={`orch-step ${i < active ? 'done' : i === active ? 'active' : 'pending'}`}>
            <span className="orch-dot">{i < active ? <Icon name="check" /> : i + 1}</span>
            <span className="orch-label">{s}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
