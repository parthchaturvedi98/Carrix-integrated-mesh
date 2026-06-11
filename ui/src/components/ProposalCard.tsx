import type { AgentProposal, Decision } from '../types'
import { AGENT_ICON, Icon } from './icons'

interface Props {
  p: AgentProposal
  decision?: Decision
  onDecide?: (agent: string, decision: Decision) => void
  outcome?: 'approved' | 'rejected'
  autoApproved?: boolean
}

function ConfidenceBar({ score }: { score: number }) {
  const color = score >= 85 ? 'var(--ok)' : score >= 65 ? '#f59e0b' : 'var(--alert)'
  return (
    <div className="conf-wrap" title={`Resolution confidence: ${score}%`}>
      <div className="conf-label">
        <span>Confidence</span>
        <span className="conf-pct" style={{ color }}>{score}%</span>
      </div>
      <div className="conf-track">
        <div className="conf-fill" style={{ width: `${score}%`, background: color }} />
      </div>
    </div>
  )
}

export function ProposalCard({ p, decision, onDecide, outcome, autoApproved }: Props) {
  const mutating = p.proposed_actions.some((a) => a.mutating)
  const showControls = mutating && !!onDecide && !outcome && !autoApproved

  return (
    <article className={`card ${outcome ? `card-${outcome}` : decision ? `card-pick-${decision}` : ''}`}>
      <header className="card-head">
        <span className="agent-icon"><Icon name={AGENT_ICON[p.agent] ?? 'mesh'} /></span>
        <h3>{p.agent} agent</h3>
        {outcome ? (
          <span className={`pill ${outcome === 'approved' ? 'pill-ok' : 'pill-alert'}`}>
            <Icon name={outcome === 'approved' ? 'check' : 'cross'} /> {outcome}
          </span>
        ) : autoApproved ? (
          <span className="pill pill-ok pill-auto"><Icon name="check" /> Auto-approved</span>
        ) : !mutating ? (
          <span className="pill pill-muted">compute only</span>
        ) : (
          <span className="pill pill-action">{p.proposed_actions.length} action</span>
        )}
      </header>

      {p.use_case && <div className="uc-chip">{p.use_case}</div>}

      <p className="findings">{p.findings}</p>
      <p className="rationale"><strong>Why:</strong> {p.rationale}</p>

      {p.confidence != null && <ConfidenceBar score={p.confidence} />}

      {!!p.targets?.length && (
        <div className="uc-meta">
          <div className="uc-line"><span className="uc-key">Targets</span> {p.targets.join(' · ')}</div>
        </div>
      )}

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
      {autoApproved && (
        <div className="decide auto-approved-note">
          <Icon name="check" /> Confidence {p.confidence}% — above threshold, write-back auto-approved.
        </div>
      )}
      {!mutating && !outcome && !autoApproved && (
        <div className="decide muted-note">Informational — no write-back to approve.</div>
      )}
    </article>
  )
}
