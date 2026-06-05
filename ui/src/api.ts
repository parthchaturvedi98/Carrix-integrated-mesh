import type { RunView, Sources, Status, TraceEvent } from './types'

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json() as Promise<T>
}

async function jpost<T>(url: string): Promise<T> {
  const r = await fetch(url, { method: 'POST' })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json() as Promise<T>
}

async function jpostBody<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json() as Promise<T>
}

export const api = {
  status: () => jget<Status>('/api/status'),
  sources: () => jget<Sources>('/api/sources'),
  reset: () => jpost<{ ok: boolean }>('/api/reset'),
  // run/approve are async on the server: they return a correlation id and stream progress.
  run: () => jpost<{ correlation_id: string }>('/api/run'),
  getRun: (id: string) => jget<RunView>(`/api/runs/${id}`),
  traces: (id: string) => jget<{ traces: TraceEvent[] }>(`/api/runs/${id}/traces`),
  approve: (pid: string) => jpost<{ correlation_id: string }>(`/api/proposals/${pid}/approve`),
  reject: (pid: string) => jpost<{ rejected: boolean; view: RunView }>(`/api/proposals/${pid}/reject`),
  // per-agent HITL: decisions maps agent name -> 'approve' | 'reject'
  commit: (pid: string, decisions: Record<string, string>) =>
    jpostBody<{ correlation_id: string }>(`/api/proposals/${pid}/commit`, { decisions }),
}

/** Subscribe to the SSE trace stream for a run. Returns an unsubscribe fn. */
export function streamTraces(
  id: string,
  onEvent: (e: TraceEvent) => void,
  onDone?: () => void,
): () => void {
  const es = new EventSource(`/api/runs/${id}/stream`)
  es.onmessage = (msg) => {
    const data = JSON.parse(msg.data) as TraceEvent & { step: string }
    if (data.step === '_eof') {
      es.close()
      onDone?.()
      return
    }
    onEvent(data)
  }
  es.onerror = () => {
    es.close()
    onDone?.()
  }
  return () => es.close()
}
