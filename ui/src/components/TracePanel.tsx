import { useEffect, useRef } from 'react'
import type { TraceEvent } from '../types'

export function TracePanel({ traces }: { traces: TraceEvent[] }) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [traces.length])

  return (
    <section className="panel trace">
      <div className="panel-head">
        <h2>Trace</h2>
        {traces[0] && <span className="cid">cid {/* correlation id shown by parent header */}</span>}
      </div>
      <div className="trace-log">
        {traces.length === 0 && <div className="trace-empty">No events yet — run the loop.</div>}
        {traces.map((t) => (
          <div key={t.seq} className={`trace-line lvl-${t.level}`}>
            <span className="trace-seq">{String(t.seq).padStart(2, '0')}</span>
            <span className="trace-step">{t.step}</span>
            <span className="trace-msg">{t.message}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </section>
  )
}
