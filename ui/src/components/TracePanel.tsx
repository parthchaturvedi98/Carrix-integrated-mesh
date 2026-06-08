import { useEffect, useRef } from 'react'
import type { TraceEvent } from '../types'

export function TracePanel({ traces }: { traces: TraceEvent[] }) {
  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // scroll only the trace log's own container, never the page
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [traces.length])

  return (
    <section className="panel trace">
      <div className="panel-head"><h2>Trace</h2></div>
      <div className="trace-log" ref={logRef}>
        {traces.length === 0 && <div className="trace-empty">No events yet — run the loop.</div>}
        {traces.map((t) => (
          <div key={t.seq} className={`trace-line lvl-${t.level}`}>
            <span className="trace-seq">{String(t.seq).padStart(2, '0')}</span>
            <span className="trace-step">{t.step}</span>
            <span className="trace-msg">{t.message}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
