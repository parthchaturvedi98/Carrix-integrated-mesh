import type { DQFinding, DQReport, DQStep, Severity } from '../engine/dataQualityAgent'
import { Icon } from './icons'

// ── severity helpers ──────────────────────────────────────────────────────────

const SEV_LABEL: Record<Severity, string> = {
  critical: 'Critical', warning: 'Warning', info: 'Info', ok: 'OK',
}
const SEV_CLASS: Record<Severity, string> = {
  critical: 'dq-sev-critical', warning: 'dq-sev-warning', info: 'dq-sev-info', ok: 'dq-sev-ok',
}

function SevBadge({ sev }: { sev: Severity }) {
  return <span className={`dq-sev-badge ${SEV_CLASS[sev]}`}>{SEV_LABEL[sev]}</span>
}

function ScoreRing({ score, grade }: { score: number; grade: string }) {
  const r = 28
  const circ = 2 * Math.PI * r
  const fill = (score / 100) * circ
  const color = score >= 75 ? 'var(--ok)' : score >= 50 ? '#f59e0b' : 'var(--alert)'
  return (
    <div className="dq-score-ring">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="var(--line)" strokeWidth="6" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${fill} ${circ - fill}`}
          strokeLinecap="round"
          transform="rotate(-90 36 36)" />
        <text x="36" y="38" textAnchor="middle" dominantBaseline="middle"
          fontSize="17" fontWeight="700" fill={color}>{grade}</text>
      </svg>
      <div className="dq-score-num" style={{ color }}>{score}/100</div>
    </div>
  )
}

// ── streaming steps ───────────────────────────────────────────────────────────

export function DataQualityProcessing({ steps }: { steps: DQStep[] }) {
  return (
    <div className="dq-panel">
      <div className="dq-agent-header">
        <span className="agent-icon"><Icon name="mesh" /></span>
        <div>
          <div className="dq-agent-title">Data Quality Agent</div>
          <div className="dq-agent-sub">Analysing uploaded files…</div>
        </div>
        <span className="spinner" />
      </div>
      <div className="dq-steps">
        {steps.map((s) => (
          <div key={s.id} className={`dq-step dq-step-${s.status}`}>
            <span className="dq-step-icon">
              {s.status === 'done'    ? <Icon name="check" />   :
               s.status === 'running' ? <span className="spinner" /> :
               <span className="dq-step-dot" />}
            </span>
            <span className="dq-step-label">{s.label}</span>
            {s.status === 'done' && s.findingCount != null && s.findingCount > 0 && (
              <span className="dq-step-count">{s.findingCount} issue{s.findingCount !== 1 ? 's' : ''}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── full report ───────────────────────────────────────────────────────────────

const DOMAINS = ['TOS', 'eModal', 'AIS', 'AS/400', 'ECS', 'Cross-file']

function FindingRow({ f }: { f: DQFinding }) {
  if (f.severity === 'ok') return null
  return (
    <div className={`dq-finding dq-finding-${f.severity}`}>
      <div className="dq-finding-head">
        <SevBadge sev={f.severity} />
        <span className="dq-finding-title">{f.title}</span>
      </div>
      <div className="dq-finding-detail">{f.detail}</div>
    </div>
  )
}

export function DataQualityReport({ report, onProceed }: { report: DQReport; onProceed: () => void }) {
  const criticals = report.findings.filter((f) => f.severity === 'critical').length
  const warnings  = report.findings.filter((f) => f.severity === 'warning').length
  const infos     = report.findings.filter((f) => f.severity === 'info').length
  const oks       = report.findings.filter((f) => f.severity === 'ok').length

  return (
    <div className="dq-panel dq-panel-report">
      {/* header */}
      <div className="dq-report-header">
        <div className="dq-agent-header">
          <span className="agent-icon"><Icon name="mesh" /></span>
          <div>
            <div className="dq-agent-title">Data Quality Agent — Report</div>
            <div className="dq-agent-sub">
              {report.files_checked} file{report.files_checked !== 1 ? 's' : ''} · {report.rows_checked} rows checked
            </div>
          </div>
          <span className={`pill ${criticals > 0 ? 'pill-alert' : warnings > 0 ? 'pill-warn' : 'pill-ok'}`}>
            {criticals > 0 ? `${criticals} critical` : warnings > 0 ? `${warnings} warning${warnings > 1 ? 's' : ''}` : 'Clean'}
          </span>
        </div>

        <div className="dq-summary-row">
          <ScoreRing score={report.score} grade={report.grade} />
          <div className="dq-summary-body">
            <p className="dq-summary-text">{report.summary}</p>
            <div className="dq-counts">
              {criticals > 0 && <span className="dq-count dq-count-critical">{criticals} critical</span>}
              {warnings  > 0 && <span className="dq-count dq-count-warning">{warnings} warning{warnings > 1 ? 's' : ''}</span>}
              {infos     > 0 && <span className="dq-count dq-count-info">{infos} info</span>}
              {oks       > 0 && <span className="dq-count dq-count-ok">{oks} passed</span>}
            </div>
          </div>
          <button className="btn primary" onClick={onProceed}>
            <Icon name="play" /> Load data into silos
          </button>
        </div>
      </div>

      {/* findings by domain */}
      <div className="dq-domains">
        {DOMAINS.map((dom) => {
          const domFindings = report.findings.filter((f) => f.domain === dom && f.severity !== 'ok')
          const domOk       = report.findings.filter((f) => f.domain === dom && f.severity === 'ok')
          if (!domFindings.length && !domOk.length) return null
          return (
            <div key={dom} className="dq-domain">
              <div className="dq-domain-title">{dom}</div>
              {domFindings.map((f, i) => <FindingRow key={i} f={f} />)}
              {domFindings.length === 0 && domOk.length > 0 && (
                <div className="dq-finding dq-finding-ok">
                  <div className="dq-finding-head">
                    <SevBadge sev="ok" />
                    <span className="dq-finding-title">{domOk[0].title}</span>
                  </div>
                  <div className="dq-finding-detail">{domOk[0].detail}</div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
