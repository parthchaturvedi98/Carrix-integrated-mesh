import type { AgentProposal, Decision } from '../types'
import { AGENT_ICON, Icon } from './icons'

interface Props {
  p: AgentProposal
  /** current local decision for this agent while awaiting commit */
  decision?: Decision
  /** set the local decision; absent when controls should not show (running/done) */
  onDecide?: (agent: string, decision: Decision) => void
  /** persisted outcome after commit ('approved' | 'rejected') */
  outcome?: 'approved' | 'rejected'
}

export function ProposalCard({ p, decision, onDecide, outcome }: Props) {
  const mutating = p.proposed_actions.some((a) => a.mutating)
  const showControls = mutating && !!onDecide && !outcome

  return (
    <article className={`card ${outcome ? `card-${outcome}` : decision ? `card-pick-${decision}` : ''}`}>
      <header className="card-head">
        <span className="agent-icon"><Icon name={AGENT_ICON[p.agent] ?? 'mesh'} /></span>
        <h3>{p.agent} agent</h3>
        {outcome ? (
          <span className={`pill ${outcome === 'approved' ? 'pill-ok' : 'pill-alert'}`}>
            <Icon name={outcome === 'approved' ? 'check' : 'cross'} /> {outcome}
          </span>
        ) : !mutating ? (
          <span className="pill pill-muted">compute only</span>
        ) : (
          <span className="pill pill-action">{p.proposed_actions.length} action</span>
        )}
      </header>
      <p className="findings">{p.findings}</p>
      <p className="rationale"><strong>Why:</strong> {p.rationale}</p>
      {p.proposed_actions.map((a, i) => (
        <div key={i} className="action">
          <code className="tool">{a.tool}</code>
          {a.mutating && <span className="chip chip-mut">mutating</span>}
          <span className="action-desc">{a.description}</span>
        </div>
      ))}
      <footer className="evidence">
        {p.evidence_ids.map((e) => (
          <span key={e} className="chip chip-evi">{e}</span>
        ))}
      </footer>

      {showControls && (
        <div className="decide">
          <span className="decide-label">Your decision:</span>
          <button
            className={`btn-sm reject ${decision === 'reject' ? 'sel' : ''}`}
            onClick={() => onDecide!(p.agent, 'reject')}
          >Reject</button>
          <button
            className={`btn-sm approve ${decision === 'approve' ? 'sel' : ''}`}
            onClick={() => onDecide!(p.agent, 'approve')}
          >Approve</button>
        </div>
      )}
      {!mutating && !outcome && (
        <div className="decide muted-note">Informational — no write-back to approve.</div>
      )}
    </article>
  )
}
