import type { MedallionReport } from '../engine/medallion'

interface Props {
  report: MedallionReport
  onDismiss: () => void
}

function LayerBadge({ label, color }: { label: string; color: string }) {
  return <span className="med-badge" style={{ background: color }}>{label}</span>
}

export function MedallionReportPanel({ report, onDismiss }: Props) {
  const { bronze, silver, gold } = report
  const s = gold.summary

  return (
    <div className="med-report">
      <div className="med-report-header">
        <h2>Medallion ingestion report</h2>
        <button className="btn ghost" onClick={onDismiss}>Dismiss</button>
      </div>

      {/* pipeline flow strip */}
      <div className="med-flow">
        <div className="med-layer bronze">
          <LayerBadge label="Bronze" color="#b45309" />
          <div className="med-layer-body">
            <strong>{bronze.files.length} file{bronze.files.length !== 1 ? 's' : ''} ingested</strong>
            <span>{bronze.total_rows} raw rows parsed</span>
            <ul className="med-file-list">
              {bronze.files.map((f) => (
                <li key={f.name}><code>{f.name}</code> · {f.rows.length} rows · {(f.rawSize / 1024).toFixed(1)} KB</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="med-arrow">→</div>

        <div className="med-layer silver">
          <LayerBadge label="Silver" color="#475569" />
          <div className="med-layer-body">
            <strong>Validated &amp; cleaned</strong>
            {silver.total_issues === 0
              ? <span className="med-ok">No issues — all fields valid</span>
              : <span className="med-warn">{silver.total_issues} issue{silver.total_issues !== 1 ? 's' : ''} auto-corrected</span>}
            {silver.files.flatMap((f) => f.issues).slice(0, 6).map((iss, i) => (
              <div key={i} className="med-issue">
                <code>{iss.file}</code> row {iss.row} · <em>{iss.field}</em>: {iss.problem} → {iss.fix}
              </div>
            ))}
            {silver.total_issues > 6 && (
              <div className="med-issue-more">+{silver.total_issues - 6} more corrections</div>
            )}
          </div>
        </div>

        <div className="med-arrow">→</div>

        <div className="med-layer gold">
          <LayerBadge label="Gold" color="#92400e" />
          <div className="med-layer-body">
            <strong>Ready for engine</strong>
            <table className="med-summary-table">
              <tbody>
                <tr><td>Yard blocks</td><td>{s.yard_blocks}</td></tr>
                <tr><td>Appointment windows</td><td>{s.appointments}</td></tr>
                <tr><td>Vessels</td><td>{s.vessels}</td></tr>
                <tr><td>Fee codes</td><td>{s.fees}</td></tr>
                <tr><td>Equipment units</td><td>{s.equipment}</td></tr>
                <tr><td>Storage plan sequences</td><td>{s.storage_plan_sequences}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {report.errors.length > 0 && (
        <div className="med-errors">
          <strong>Parse warnings:</strong>
          {report.errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      <div className="med-ready-banner">
        Gold layer loaded — run the reconciliation loop to process this scenario.
      </div>
    </div>
  )
}
