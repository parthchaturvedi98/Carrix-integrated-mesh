import type { Conflict } from '../types'
import { Icon } from './icons'

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className={`stat ${alert ? 'stat-alert' : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

export function ConflictPanel({ conflict }: { conflict: Conflict }) {
  const d = conflict.detail
  const resolved = !conflict.detected
  return (
    <section className={`panel conflict ${resolved ? 'resolved' : 'detected'}`}>
      <div className="panel-head">
        <span className={`pill ${resolved ? 'pill-ok' : 'pill-alert'}`}>
          <Icon name={resolved ? 'check' : 'warning'} /> {resolved ? 'Resolved' : 'Cross-silo collision'}
        </span>
        <h2>{d.terminal} · {d.window}</h2>
      </div>
      <p className="summary">{conflict.summary}</p>
      <div className="stat-row">
        <Stat label="Containers discharging" value={`${d.discharge_total}`} alert={d.discharge_surge} />
        <Stat
          label="Appointments (demand / slots)"
          value={`${d.appointment_demand} / ${d.appointment_slots}`}
          alert={d.appointment_surge}
        />
        <Stat
          label="Over-capacity yard blocks"
          value={`${d.overflow_blocks.length}`}
          alert={d.yard_congested}
        />
      </div>
      {d.overflow_blocks.length > 0 && (
        <div className="overflow-list">
          {d.overflow_blocks.map((b) => (
            <span key={b.block} className="chip chip-alert">
              {b.block}: {b.assigned} assigned vs {b.remaining} free (+{b.overflow})
            </span>
          ))}
        </div>
      )}
    </section>
  )
}
