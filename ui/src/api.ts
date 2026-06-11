import { engine } from './engine/engine'
import type { RawMockState } from './engine/scenario'
import type { RunView, Sources, Status, TraceEvent } from './types'

// Two backends for the same UI:
//   - default: the in-browser deterministic engine (static, no server — used on GitHub Pages)
//   - VITE_USE_BACKEND=true: the Python HTTP backend (live Claude, single-origin Docker deploy)
const USE_BACKEND = import.meta.env.VITE_USE_BACKEND === 'true'

// ---------------------------------------------------------------- HTTP backend
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
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json() as Promise<T>
}

const backendApi = {
  status: () => jget<Status>('/api/status'),
  sources: () => jget<Sources>('/api/sources'),
  reset: () => jpost<{ ok: boolean }>('/api/reset'),
  run: () => jpost<{ correlation_id: string }>('/api/run'),
  getRun: (id: string) => jget<RunView>(`/api/runs/${id}`),
  traces: (id: string) => jget<{ traces: TraceEvent[] }>(`/api/runs/${id}/traces`),
  approve: (pid: string) => jpost<{ correlation_id: string }>(`/api/proposals/${pid}/approve`),
  reject: (pid: string) => jpost<{ rejected: boolean; view: RunView }>(`/api/proposals/${pid}/reject`),
  commit: (pid: string, decisions: Record<string, string>) =>
    jpostBody<{ correlation_id: string }>(`/api/proposals/${pid}/commit`, { decisions }),
}

function backendStream(id: string, onEvent: (e: TraceEvent) => void, onDone?: () => void): () => void {
  const es = new EventSource(`/api/runs/${id}/stream`)
  es.onmessage = (msg) => {
    const data = JSON.parse(msg.data) as TraceEvent & { step: string }
    if (data.step === '_eof') { es.close(); onDone?.(); return }
    onEvent(data)
  }
  es.onerror = () => { es.close(); onDone?.() }
  return () => es.close()
}

// ------------------------------------------------------------- in-browser engine
const engineApi = {
  status: async (): Promise<Status> => engine.status(),
  sources: async (): Promise<Sources> => engine.getSources() as Sources,
  reset: async () => { engine.reset(); return { ok: true } },
  run: async () => ({ correlation_id: engine.run() }),
  getRun: async (id: string) => engine.getRun(id),
  traces: async (_id: string) => ({ traces: [] as TraceEvent[] }),
  reject: async (pid: string) => engine.reject(pid),
  commit: async (pid: string, decisions: Record<string, string>) => ({ correlation_id: engine.commit(pid, decisions) }),
  loadScenario: async (raw: RawMockState) => { engine.loadScenario(raw); return { ok: true } },
}

function engineStream(id: string, onEvent: (e: TraceEvent) => void, onDone?: () => void): () => void {
  return engine.subscribe(id, onEvent, () => onDone?.())
}

// ------------------------------------------------------------------------ export
export const api = USE_BACKEND ? backendApi : engineApi
export const streamTraces = USE_BACKEND ? backendStream : engineStream
