export interface Action {
  tool: string
  args: Record<string, unknown>
  mutating: boolean
  description: string
  decision?: 'approved' | 'rejected'
  agent?: string
}

export type Decision = 'approve' | 'reject'

export interface AgentProposal {
  agent: 'Yard' | 'Gate' | 'Vessel' | 'Fees'
  findings: string
  rationale: string
  proposed_actions: Action[]
  evidence_ids: string[]
}

export interface ConflictDetail {
  terminal: string
  window: string
  discharge_total: number
  surge_threshold: number
  discharge_surge: boolean
  appointment_slots: number
  appointment_demand: number
  appointment_surge: boolean
  overflow_blocks: { block: string; assigned: number; remaining: number; overflow: number }[]
  yard_congested: boolean
}

export interface Conflict {
  detected: boolean
  summary: string
  detail: ConflictDetail
}

export interface Plan {
  conflict: Conflict
  agents: AgentProposal[]
  actions: (Action & { agent: string })[]
}

export interface Proposal {
  id: string
  correlation_id: string
  status: 'pending' | 'approved' | 'rejected'
  plan: Plan
}

export interface YardBlock {
  block: string
  terminal: string
  capacity: number
  occupied: number
}

export interface Snapshot {
  vessels: any[]
  yard_blocks: YardBlock[]
  appointments: { window: string; terminal: string; slots: number; booked: number; demand: number }[]
  fees: any[]
  storage_plan: { terminal: string; window: string; vessel_id: string; sequence: { block: string; containers: number }[] } | null
}

export interface RunView {
  correlation_id: string
  status: string
  llm_mode: string
  conflicts: Conflict[]
  initial_conflict: Conflict | null
  latest_conflict: Conflict | null
  proposal: Proposal | null
  snapshot: Snapshot
}

export interface TraceEvent {
  seq: number
  ts: number
  step: string
  level: 'info' | 'warning' | 'error'
  message: string
  data?:
    | (Record<string, unknown> & {
        agent?: string
        state?: string
        proposal?: AgentProposal
        detected?: boolean
        summary?: string
        detail?: ConflictDetail
      })
    | null
}

export interface Vessel {
  vessel_id: string
  name?: string
  terminal?: string
  eta?: string
  status?: string
  discharge_count?: number
  discharge_window?: string
  confirmed?: boolean
}

export interface Sources {
  tos: { yard_blocks: YardBlock[]; storage_plan: Snapshot['storage_plan'] }
  emodal: { appointments: Snapshot['appointments'] }
  ais: { positions: any[]; manifests: Vessel[] }
  as400: { fee_schedule: { code: string; unit: string; amount: number; currency: string }[] }
  scenario: { terminal: string; focus_window: string }
}

export interface Status {
  llm_mode: string
  orchestrator_model: string
  worker_model: string
  scenario: { terminal: string; focus_window: string }
}
