import { useRef, useState } from 'react'
import { runMedallion, type MedallionReport } from '../engine/medallion'
import { runDataQualityAgent, type DQReport, type DQStep } from '../engine/dataQualityAgent'
import { DataQualityProcessing, DataQualityReport } from './DataQualityPanel'
import { Icon } from './icons'

interface Props {
  onStarted?: () => void
  onLoaded: (report: MedallionReport) => void
}

type Stage = 'idle' | 'parsing' | 'agent' | 'report'

const ACCEPTED = [
  'tos_yard_blocks.csv', 'tos_storage_plan.csv',
  'emodal_appointments.csv',
  'ais_positions.csv', 'ais_manifests.csv',
  'as400_fees.csv',
  'ecs_equipment.csv', 'ecs_movement.csv',
  'scenario.json (full RawMockState)',
]

export function MedallionUploader({ onStarted, onLoaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dqSteps, setDqSteps] = useState<DQStep[]>([])
  const [dqReport, setDqReport] = useState<DQReport | null>(null)
  const [medallion, setMedallion] = useState<MedallionReport | null>(null)

  async function process(files: FileList | File[]) {
    const arr = Array.from(files)
    if (!arr.length) return
    setError(null)
    setDqReport(null)
    setDqSteps([])

    // ── Bronze → Silver → Gold ───────────────────────────────────────────────
    setStage('parsing')
    onStarted?.()
    let report: MedallionReport
    try {
      report = await runMedallion(arr)
      if (report.errors.length && !report.bronze.files.length) {
        setError(report.errors.join('; '))
        setStage('idle')
        return
      }
    } catch (e) {
      setError(String(e))
      setStage('idle')
      return
    }
    setMedallion(report)

    // ── Data quality agent ───────────────────────────────────────────────────
    setStage('agent')
    const dqResult = await runDataQualityAgent(
      report.gold.state,
      report.bronze.files.length,
      report.bronze.total_rows,
      (_step, allSteps) => setDqSteps([...allSteps]),
    )

    setDqReport(dqResult)
    setStage('report')
  }

  // Called when user clicks "Load data into silos" after reviewing the report
  function proceed() {
    if (medallion) onLoaded(medallion)
  }

  // ── idle: drop zone ──────────────────────────────────────────────────────────
  if (stage === 'idle') {
    return (
      <div className="medallion-upload-zone">
        <div
          className={`drop-area ${dragging ? 'drag-over' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); void process(e.dataTransfer.files) }}
        >
          <input
            ref={inputRef} type="file" multiple accept=".csv,.json"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files && void process(e.target.files)}
          />
          <div className="drop-inner">
            <span className="drop-icon"><Icon name="mesh" /></span>
            <strong>Drop scenario files here</strong>
            <span className="drop-hint">CSV or JSON · click to browse</span>
          </div>
        </div>
        {error && <div className="medallion-error">{error}</div>}
        <details className="schema-hint">
          <summary>Accepted file names</summary>
          <ul>{ACCEPTED.map((n) => <li key={n}><code>{n}</code></li>)}</ul>
        </details>
      </div>
    )
  }

  // ── parsing: brief "running medallion" state ─────────────────────────────────
  if (stage === 'parsing') {
    return (
      <div className="medallion-upload-zone dq-parsing">
        <span className="spinner" />
        <span>Running Bronze → Silver → Gold pipeline…</span>
      </div>
    )
  }

  // ── agent: streaming steps ───────────────────────────────────────────────────
  if (stage === 'agent') {
    return <DataQualityProcessing steps={dqSteps} />
  }

  // ── report: full DQ report with proceed button ───────────────────────────────
  if (stage === 'report' && dqReport) {
    return <DataQualityReport report={dqReport} onProceed={proceed} />
  }

  return null
}
