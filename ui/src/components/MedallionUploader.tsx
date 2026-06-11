import { useRef, useState } from 'react'
import { runMedallion, type MedallionReport } from '../engine/medallion'
import { Icon } from './icons'

interface Props {
  onStarted?: () => void
  onLoaded: (report: MedallionReport) => void
}

type Stage = 'idle' | 'files-ready' | 'bronze' | 'silver' | 'gold' | 'done'

const ACCEPTED = [
  'tos_yard_blocks.csv', 'tos_storage_plan.csv',
  'emodal_appointments.csv',
  'ais_positions.csv', 'ais_manifests.csv',
  'as400_fees.csv',
  'ecs_equipment.csv', 'ecs_movement.csv',
  'scenario.json  (full state in one file)',
]

const MEDALLION_STAGES: { key: Stage; label: string; detail: string }[] = [
  { key: 'bronze', label: 'Bronze', detail: 'Raw ingestion — parsing files and counting rows' },
  { key: 'silver', label: 'Silver', detail: 'Validation & cleaning — schema checks, type coercion, null fills' },
  { key: 'gold',   label: 'Gold',   detail: 'Aggregation — building engine-ready scenario state' },
]

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function MedallionUploader({ onStarted, onLoaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)

  function onFilePick(picked: FileList | File[]) {
    const arr = Array.from(picked)
    if (!arr.length) return
    setFiles(arr)
    setStage('files-ready')
    setError(null)
  }

  async function startProcessing() {
    if (!files.length) return
    onStarted?.()
    setError(null)

    // ── Bronze ───────────────────────────────────────────────────────────────
    setStage('bronze')
    await sleep(600)

    // ── Silver ───────────────────────────────────────────────────────────────
    setStage('silver')
    await sleep(700)

    // ── Gold + actual pipeline ────────────────────────────────────────────────
    setStage('gold')
    let report: MedallionReport
    try {
      report = await runMedallion(files)
      if (report.errors.length && !report.bronze.files.length) {
        setError(report.errors.join('; '))
        setStage('files-ready')
        return
      }
    } catch (e) {
      setError(String(e))
      setStage('files-ready')
      return
    }
    await sleep(500)

    // ── Done — auto-load ──────────────────────────────────────────────────────
    setStage('done')
    await sleep(1200)
    onLoaded(report)
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
          onDrop={(e) => { e.preventDefault(); setDragging(false); onFilePick(e.dataTransfer.files) }}
        >
          <input
            ref={inputRef} type="file" multiple accept=".csv,.json"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files && onFilePick(e.target.files)}
          />
          <div className="drop-inner">
            <span className="drop-icon"><Icon name="mesh" /></span>
            <strong>Upload your terminal data files</strong>
            <span className="drop-hint">CSV or JSON · drag and drop or click to browse</span>
          </div>
        </div>
        <details className="schema-hint">
          <summary>Accepted file names</summary>
          <ul>{ACCEPTED.map((n) => <li key={n}><code>{n}</code></li>)}</ul>
        </details>
      </div>
    )
  }

  // ── files-ready: list + start button ─────────────────────────────────────────
  if (stage === 'files-ready') {
    return (
      <div className="medallion-upload-zone">
        <div className="med-files-ready">
          <div className="med-files-header">
            <span className="agent-icon"><Icon name="mesh" /></span>
            <div>
              <strong>{files.length} file{files.length !== 1 ? 's' : ''} selected</strong>
              <span className="med-files-sub">Review then start the processing pipeline</span>
            </div>
            <button className="btn ghost" onClick={() => { setFiles([]); setStage('idle') }}>
              Change
            </button>
          </div>
          <ul className="med-file-list-preview">
            {files.map((f) => (
              <li key={f.name}>
                <code>{f.name}</code>
                <span className="med-file-size">{(f.size / 1024).toFixed(1)} KB</span>
              </li>
            ))}
          </ul>
          {error && <div className="medallion-error">{error}</div>}
          <button className="btn primary med-start-btn" onClick={() => void startProcessing()}>
            Start data processing
          </button>
        </div>
      </div>
    )
  }

  // ── bronze / silver / gold / done: medallion pipeline stages ─────────────────
  const activeIdx = MEDALLION_STAGES.findIndex((s) => s.key === stage)

  return (
    <div className="medallion-upload-zone med-pipeline">
      <div className="med-pipeline-header">
        <span className="agent-icon"><Icon name="mesh" /></span>
        <div>
          <strong>Medallion pipeline</strong>
          <span className="med-files-sub">{files.length} file{files.length !== 1 ? 's' : ''}</span>
        </div>
        {stage !== 'done' && <span className="spinner" />}
        {stage === 'done' && <span className="pill pill-ok"><Icon name="check" /> Complete</span>}
      </div>

      <div className="med-stages">
        {MEDALLION_STAGES.map((s, i) => {
          const isDone    = activeIdx === -1 || i < activeIdx  // -1 = 'done', all passed
          const isRunning = i === activeIdx

          return (
            <div key={s.key} className={`med-stage ${isDone ? 'med-stage-done' : isRunning ? 'med-stage-running' : 'med-stage-pending'}`}>
              <div className="med-stage-icon">
                {isDone    ? <Icon name="check" />           :
                 isRunning ? <span className="spinner" />    :
                             <span className="med-dot" />}
              </div>
              <div className="med-stage-body">
                <span className={`med-stage-badge med-badge-${s.key}`}>{s.label}</span>
                <span className="med-stage-detail">{s.detail}</span>
              </div>
            </div>
          )
        })}
      </div>

      {stage === 'done' && (
        <div className="med-done-msg">
          Process completed — loading feeds into the operating picture…
        </div>
      )}
    </div>
  )
}
