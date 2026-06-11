import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { api, streamTraces } from './api'
import { AgentStrip } from './components/AgentStrip'
import { ConflictPanel } from './components/ConflictPanel'
import { ControlTowerPanel } from './components/ControlTowerPanel'
import { ForecastPanel } from './components/ForecastPanel'
import { MedallionUploader } from './components/MedallionUploader'
import { OrchestratorBar } from './components/OrchestratorBar'
import { OutcomesPanel } from './components/OutcomesPanel'
import { Icon } from './components/icons'
import { ProposalCard } from './components/ProposalCard'
import { SourcesPanel } from './components/SourcesPanel'
import { TracePanel } from './components/TracePanel'
import { YardView } from './components/YardView'
import type { MedallionReport } from './engine/medallion'
import type { AgentProposal, Conflict, Decision, RunView, Sources, Status, TraceEvent } from './types'

const TwinScene = lazy(() => import('./components/TwinScene'))

type Phase = 'idle' | 'running' | 'awaiting' | 'applying' | 'done'
type Tab = 'dashboard' | 'twin'
const AGENT_ORDER = ['Yard', 'Gate', 'Vessel', 'Movement', 'Fees']

export default function App() {
  const [status, setStatus] = useState<Status | null>(null)
  const [sources, setSources] = useState<Sources | null>(null)
  const [view, setView] = useState<RunView | null>(null)
  const [traces, setTraces] = useState<TraceEvent[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [tab, setTab] = useState<Tab>('dashboard')
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [error, setError] = useState<string | null>(null)
  const [sourcesReady, setSourcesReady] = useState(false) // false until DQ agent approves a file upload
  const unsub = useRef<(() => void) | null>(null)

  const loadSources = useCallback(() => {
    api.sources().then(setSources).catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    api.status().then(setStatus).catch((e) => setError(String(e)))
    loadSources()
    return () => unsub.current?.()
  }, [loadSources])

  const follow = useCallback((cid: string, onDone: () => void) => {
    unsub.current?.()
    unsub.current = streamTraces(
      cid,
      (e) => {
        // dedupe by seq against existing traces (re-subscribing replays buffered events)
        setTraces((prev) => (prev.some((t) => t.seq === e.seq) ? prev : [...prev, e].sort((a, b) => a.seq - b.seq)))
      },
      onDone,
    )
  }, [])

  const onRun = async () => {
    setError(null)
    setTraces([])
    setView(null)
    setDecisions({})
    setPhase('running')
    try {
      const { correlation_id } = await api.run()
      follow(correlation_id, async () => {
        const v = await api.getRun(correlation_id)
        setView(v)
        setPhase(v.status === 'awaiting_approval' ? 'awaiting' : 'done')
      })
    } catch (e) {
      setError(String(e))
      setPhase('idle')
    }
  }

  const onCommit = async () => {
    if (!view?.proposal) return
    setError(null)
    setPhase('applying')
    try {
      const { correlation_id } = await api.commit(view.proposal.id, decisions)
      follow(correlation_id, async () => {
        const v = await api.getRun(correlation_id)
        setView(v)
        setPhase('done')
      })
    } catch (e) {
      setError(String(e))
      setPhase('awaiting')
    }
  }

  const onReset = async () => {
    try {
      await api.reset()
      unsub.current?.()
      setView(null)
      setTraces([])
      setDecisions({})
      setPhase('idle')
      setSourcesReady(true)
      loadSources()
    } catch (e) {
      setError(String(e))
    }
  }

  // Called when files are first dropped — hides the tiles while the DQ agent runs
  const onMedallionStarted = () => setSourcesReady(false)

  // Called when user clicks "Load data into silos" after reviewing the DQ report
  const onMedallionLoaded = async (report: MedallionReport) => {
    const extApi = api as typeof api & { loadScenario?: (raw: unknown) => Promise<unknown> }
    if (extApi.loadScenario) await extApi.loadScenario(report.gold.state)
    loadSources()
    setSourcesReady(true)
  }

  // Derive conflict + proposals from the live trace stream so they appear the moment each
  // agent finishes — before the whole run assembles. The fetched view (when present) is
  // authoritative (carries persisted decisions/outcomes).
  const liveConflict = useMemo<Conflict | null>(() => {
    for (let i = traces.length - 1; i >= 0; i--) {
      const t = traces[i]
      if (t.step === 'reason' && t.data?.detail) {
        return { detected: !!t.data.detected, summary: t.data.summary ?? '', detail: t.data.detail }
      }
    }
    return null
  }, [traces])

  const liveProposals = useMemo<Record<string, AgentProposal>>(() => {
    const m: Record<string, AgentProposal> = {}
    for (const t of traces) {
      const p = t.data?.proposal
      if (p?.agent) m[p.agent] = p
    }
    return m
  }, [traces])

  const busy = phase === 'running' || phase === 'applying'
  const conflict = view?.latest_conflict ?? liveConflict ?? view?.initial_conflict ?? null
  const proposalsFromView = view?.proposal?.plan.agents
  const proposals: AgentProposal[] =
    proposalsFromView ?? (AGENT_ORDER.map((a) => liveProposals[a]).filter(Boolean) as AgentProposal[])
  const actions = view?.proposal?.plan.actions ?? []
  const mutatingAgents = proposalsFromView
    ? actions.map((a) => a.agent as string)
    : proposals.filter((p) => p.proposed_actions.some((a) => a.mutating)).map((p) => p.agent)
  const outcomeByAgent: Record<string, 'approved' | 'rejected'> = {}
  for (const a of actions) if (a.decision && a.agent) outcomeByAgent[a.agent] = a.decision

  // Agents with confidence > 80 are auto-approved; ≤ 80 require human review
  const autoApprovedSet = useMemo<Set<string>>(() => new Set(
    proposals
      .filter((p) => p.proposed_actions.some((a) => a.mutating) && (p.confidence ?? 0) > 80)
      .map((p) => p.agent as string)
  ), [proposals])
  const hitlAgents = mutatingAgents.filter((a) => !autoApprovedSet.has(a as string))

  // Pre-populate decisions for auto-approved agents when entering awaiting
  useEffect(() => {
    if (phase === 'awaiting' && autoApprovedSet.size > 0) {
      setDecisions((prev) => {
        const next = { ...prev }
        autoApprovedSet.forEach((a: string) => { if (!next[a]) next[a] = 'approve' })
        return next
      })
    }
  }, [phase, autoApprovedSet])

  const lastStep = traces.length ? traces[traces.length - 1] : null
  const decidedCount = hitlAgents.filter((a) => decisions[a]).length
  const approvedCount = mutatingAgents.filter((a) => decisions[a] === 'approve').length
  const allDecided = hitlAgents.length === 0 || (hitlAgents.length > 0 && decidedCount === hitlAgents.length)
  const rejectedAgents = Object.entries(outcomeByAgent).filter(([, d]) => d === 'rejected').map(([a]) => a)

  const setDecision = (agent: string, d: Decision) => setDecisions((p) => ({ ...p, [agent]: d }))
  const setAll = (d: Decision) => setDecisions(Object.fromEntries(hitlAgents.map((a) => [a, d])))

  // data for the 3D twin: the live snapshot once a run exists, else the seeded yard from sources
  const twinSnapshot = view?.snapshot
    ?? (sources ? { yard_blocks: sources.tos.yard_blocks, storage_plan: sources.tos.storage_plan } : null)
  // "before" plan for the post-resolution replay = the initial over-capacity assignments
  const twinFromPlan = phase === 'done' && view?.initial_conflict
    ? Object.fromEntries(view.initial_conflict.detail.overflow_blocks.map((o) => [o.block, o.assigned]))
    : undefined

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo"><Icon name="mesh" /></div>
          <div>
            <h1>Carrix · Terminal Control Tower</h1>
            <p className="tag">Yard digital twin · one operating picture across yard, gate, vessel &amp; equipment</p>
          </div>
        </div>
        <div className="topbar-right">
          {status && (
            <>
              <span className={`pill ${status.llm_mode === 'real' ? 'pill-ok' : 'pill-muted'}`}>
                LLM: {status.llm_mode}
              </span>
              <span className="scenario">{status.scenario.terminal} · {status.scenario.focus_window}</span>
            </>
          )}
          <button className="btn ghost" onClick={onReset} disabled={busy}>
            <Icon name="reset" /> Reset scenario
          </button>
        </div>
      </header>

      <div className="toolbar">
        <button className="btn primary" onClick={onRun} disabled={busy || phase === 'awaiting'}>
          {phase !== 'running' && <Icon name="play" />}
          {phase === 'running' ? 'Reconciling…' : phase === 'done' ? 'Run again' : 'Run reconciliation loop'}
        </button>
        {phase !== 'idle' && (
          <span className={`run-status status-${phase}`}>
            {busy && <span className="spinner" />}
            {lastStep ? <span className="cur-step">{lastStep.message}</span> : <span>starting…</span>}
            {view && <span className="cid"> · cid {view.correlation_id}</span>}
          </span>
        )}
        {error && <span className="error">{error}</span>}
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'dashboard' ? 'active' : ''}`} onClick={() => setTab('dashboard')}>Command centre</button>
        <button className={`tab ${tab === 'twin' ? 'active' : ''}`} onClick={() => setTab('twin')}>3D twin</button>
      </div>

      {tab === 'twin' && (
        twinSnapshot
          ? <Suspense fallback={<div className="twin-loading">Loading 3D twin…</div>}><TwinScene snapshot={twinSnapshot} fromPlan={twinFromPlan} /></Suspense>
          : <div className="twin-loading">Run the loop or reset to load the yard.</div>
      )}

      {tab === 'dashboard' && phase === 'idle' && (
        <div className="idle-layout">
          <div className="idle-col-main">
            <MedallionUploader
              onStarted={onMedallionStarted}
              onLoaded={onMedallionLoaded}
            />
            {sources && <SourcesPanel sources={sources} populated={sourcesReady} />}
          </div>
        </div>
      )}

      {tab === 'dashboard' && phase !== 'idle' && (
        <main className="grid">
          <div className="col-main">
            <OrchestratorBar phase={phase} traces={traces} />
            {conflict && <ConflictPanel conflict={conflict} />}

            {proposals.length > 0 && (
              <>
                <div className="section-bar">
                  <h2 className="section-title">
                    Agent proposals
                    {phase === 'running' && <span className="live-count"> · {proposals.length} in…</span>}
                    {phase === 'awaiting' && hitlAgents.length > 0 && (
                      <span className="live-count"> · {hitlAgents.length} need{hitlAgents.length === 1 ? 's' : ''} your review</span>
                    )}
                  </h2>
                  {phase === 'awaiting' && hitlAgents.length > 0 && (
                    <div className="bulk">
                      <button className="btn-sm reject" onClick={() => setAll('reject')}>Reject all</button>
                      <button className="btn-sm approve" onClick={() => setAll('approve')}>Approve all</button>
                    </div>
                  )}
                </div>
                {phase === 'awaiting' && autoApprovedSet.size > 0 && (
                  <div className="banner banner-auto">
                    <Icon name="check" />
                    <strong>Auto-approved ({autoApprovedSet.size}):</strong>{' '}
                    {[...autoApprovedSet].map((a) => {
                      const conf = proposals.find((p) => p.agent === a)?.confidence
                      return `${a}${conf != null ? ` (${conf}%)` : ''}`
                    }).join(', ')} — confidence above 80%, write-backs queued.
                  </div>
                )}
                <div className="cards">
                  {proposals.map((p) => (
                    <ProposalCard
                      key={p.agent}
                      p={p}
                      decision={decisions[p.agent]}
                      onDecide={phase === 'awaiting' && !autoApprovedSet.has(p.agent) ? setDecision : undefined}
                      outcome={phase === 'applying' || phase === 'done' ? outcomeByAgent[p.agent] : undefined}
                      autoApproved={phase === 'awaiting' && autoApprovedSet.has(p.agent)}
                    />
                  ))}
                </div>
              </>
            )}

            {phase === 'awaiting' && view?.proposal && (
              <ForecastPanel view={view} decisions={decisions} mutatingAgents={mutatingAgents} />
            )}
            {phase === 'awaiting' && view?.proposal && (
              <div className="approval-bar">
                <div className="approval-text">
                  <strong>Human-in-the-loop — review the twin forecast, then decide on low-confidence write-backs.</strong>
                  <span>
                    {hitlAgents.length > 0
                      ? `${decidedCount}/${hitlAgents.length} reviewed · ${autoApprovedSet.size} auto-approved. `
                      : `All ${autoApprovedSet.size} write-backs auto-approved (confidence > 80%). `}
                    Nothing changes until you commit.
                  </span>
                </div>
                <div className="approval-actions">
                  <button className="btn approve" onClick={onCommit} disabled={!allDecided}>
                    Commit {approvedCount} write-back{approvedCount === 1 ? '' : 's'}
                  </button>
                </div>
              </div>
            )}
            {phase === 'applying' && (
              <div className="banner banner-info"><span className="spinner" /> Writing back approved decisions and re-observing…</div>
            )}
            {phase === 'done' && view && (view.status === 'resolved' || view.status === 'applied') && (
              <OutcomesPanel view={view} />
            )}
            {phase === 'done' && view?.status === 'resolved' && (
              <div className="banner banner-ok">
                <Icon name="check" /> Approved write-backs applied and re-observed — the collision is resolved.
              </div>
            )}
            {phase === 'done' && view?.status === 'applied' && (
              <div className="banner banner-warn">
                <Icon name="warning" /> Partially applied — approved write-backs are in, but the collision is not fully resolved
                {rejectedAgents.length > 0 && <> because you rejected: <strong>{rejectedAgents.join(', ')}</strong></>}.
              </div>
            )}
            {phase === 'done' && view?.status === 'rejected' && (
              <div className="banner banner-warn">
                <Icon name="warning" /> All decisions rejected — no write-back performed. Source systems unchanged.
              </div>
            )}
          </div>

          <div className="col-side">
            {view && <ControlTowerPanel view={view} />}
            <AgentStrip traces={traces} />
            {view && <YardView snapshot={view.snapshot} />}
            <TracePanel traces={traces} />
          </div>
        </main>
      )}
    </div>
  )
}
