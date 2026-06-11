import { useRef, useState } from 'react'
import { runMedallion, type MedallionReport } from '../engine/medallion'
import { Icon } from './icons'

interface Props {
  onLoaded: (report: MedallionReport) => void
}

const ACCEPTED = [
  'tos_yard_blocks.csv', 'tos_storage_plan.csv',
  'emodal_appointments.csv',
  'ais_positions.csv', 'ais_manifests.csv',
  'as400_fees.csv',
  'ecs_equipment.csv', 'ecs_movement.csv',
  'scenario.json (full RawMockState)',
]

export function MedallionUploader({ onLoaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function process(files: FileList | File[]) {
    const arr = Array.from(files)
    if (!arr.length) return
    setRunning(true)
    setError(null)
    try {
      const report = await runMedallion(arr)
      if (report.errors.length && !report.bronze.files.length) {
        setError(report.errors.join('; '))
      } else {
        onLoaded(report)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setRunning(false)
    }
  }

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
          ref={inputRef}
          type="file"
          multiple
          accept=".csv,.json"
          style={{ display: 'none' }}
          onChange={(e) => e.target.files && void process(e.target.files)}
        />
        {running ? (
          <div className="drop-inner">
            <span className="spinner" />
            <span>Running medallion pipeline…</span>
          </div>
        ) : (
          <div className="drop-inner">
            <span className="drop-icon"><Icon name="mesh" /></span>
            <strong>Drop scenario files here</strong>
            <span className="drop-hint">CSV or JSON · click to browse</span>
          </div>
        )}
      </div>
      {error && <div className="medallion-error">{error}</div>}
      <details className="schema-hint">
        <summary>Accepted file names</summary>
        <ul>
          {ACCEPTED.map((n) => <li key={n}><code>{n}</code></li>)}
        </ul>
      </details>
    </div>
  )
}
