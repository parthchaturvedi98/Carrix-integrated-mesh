import { useRef, useState } from 'react'
import { runMedallion, type MedallionReport } from '../engine/medallion'
import { Icon } from './icons'

interface Props {
  onStarted?: () => void
  onLoaded: (report: MedallionReport) => void
}

type Stage = 'idle' | 'files-ready' | 'bronze' | 'silver' | 'gold' | 'done'

interface StageResult {
  bronze?: string
  silver?: string
  gold?: string
}

const ACCEPTED = [
  'tos_yard_blocks.csv', 'tos_storage_plan.csv',
  'emodal_appointments.csv',
  'ais_positions.csv', 'ais_manifests.csv',
  'as400_fees.csv',
  'ecs_equipment.csv', 'ecs_movement.csv',
  'scenario.json  (full state in one file)',
]

const STAGE_META: { key: Stage; label: string; running: string }[] = [
  { key: 'bronze', label: 'Bronze', running: 'Parsing files and counting rows…' },
  { key: 'silver', label: 'Silver', running: 'Validating schema, coercing types, filling nulls…' },
  { key: 'gold',   label: 'Gold',   running: 'Aggregating into engine-ready scenario state…' },
]

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function MedallionUploader({ onStarted, onLoaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [stage, setStage] = useState<Stage>('idle')
  const [results, setResults] = useState<StageResult>({})
  const [error, setError] = useState<string | null>(null)

  function onFilePick(picked: FileList | File[]) {
    const arr = Array.from(picked)
    if (!arr.length) return
    setFiles(arr)
    setStage('files-ready')
    setError(null)
    setResults({})
  }

  async function startProcessing() {
    if (!files.length) return
    onStarted?.()
    setError(null)
    setResults({})

    setStage('bronze')
    await sleep(600)

    setStage('silver')
    // bronze result: file + row counts known from the file list at this point
    const totalKB = files.reduce((s, f) => s + f.size, 0) / 1024
    setResults((r) => ({
      ...r,
      bronze: `${files.length} file${files.length !== 1 ? 's' : ''} ingested · ${totalKB.toFixed(0)} KB read`,
    }))
    await sleep(700)

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

    const issues = report.silver.total_issues
    setResults((r) => ({
      ...r,
      silver: issues === 0
        ? `${report.bronze.total_rows} rows validated · no issues`
        : `${report.bronze.total_rows} rows · ${issues} issue${issues !== 1 ? 's' : ''} auto-corrected`,
    }))
    await sleep(500)

    const s = report.gold.summary
    const domains = [
      s.yard_blocks   && `${s.yard_blocks} yard blocks`,
      s.vessels       && `${s.vessels} vessel${s.vessels !== 1 ? 's' : ''}`,
      s.appointments  && `${s.appointments} gate windows`,
      s.equipment     && `${s.equipment} equipment units`,
      s.fees          && `${s.fees} fee codes`,
    ].filter(Boolean)
    setResults((r) => ({
      ...r,
      gold: domains.join(' · '),
    }))

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

  // ── bronze / silver / gold / done ─────────────────────────────────────────────
  const activeIdx = STAGE_META.findIndex((s) => s.key === stage)
  const resultMap: Record<string, string | undefined> = {
    bronze: results.bronze,
    silver: results.silver,
    gold:   results.gold,
  }

  return (
    <div className="medallion-upload-zone med-pipeline">
      <div className="med-pipeline-header">
        <span className="agent-icon"><Icon name="mesh" /></span>
        <div>
          <strong>Processing pipeline</strong>
          <span className="med-files-sub">{files.length} file{files.length !== 1 ? 's' : ''}</span>
        </div>
        {stage !== 'done' && <span className="spinner" />}
        {stage === 'done' && <span className="pill pill-ok"><Icon name="check" /> Complete</span>}
      </div>

      <div className="med-stages">
        {STAGE_META.map((s, i) => {
          const isDone    = activeIdx === -1 || i < activeIdx
          const isRunning = i === activeIdx
          const result    = resultMap[s.key]

          return (
            <div key={s.key} className={`med-stage med-stage-${s.key} ${isDone ? 'med-stage-done' : isRunning ? 'med-stage-running' : 'med-stage-pending'}`}>
              <div className="med-stage-top">
                <div className="med-stage-icon">
                  {isDone    ? <Icon name="check" />        :
                   isRunning ? <span className="spinner" /> :
                               <span className="med-dot" />}
                </div>
                <span className="med-stage-label">{s.label}</span>
              </div>
              <div className="med-stage-detail">
                {isDone && result ? result : isRunning ? s.running : ''}
              </div>
            </div>
          )
        })}
      </div>

      {stage === 'done' && (
        <div className="med-done-msg">
          Processing complete — loading feeds into the operating picture…
        </div>
      )}
    </div>
  )
}
