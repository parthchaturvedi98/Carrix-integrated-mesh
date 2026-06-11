// Medallion data-ingestion pipeline — runs entirely in-browser.
// Bronze → Silver → Gold produces a RawMockState the engine can consume directly.
//
// Accepted file types (by filename):
//   JSON  — single file containing a full RawMockState (or partial: any top-level keys present)
//   CSV   — named by system+table, e.g.:
//             tos_yard_blocks.csv, tos_storage_plan.csv
//             emodal_appointments.csv
//             ais_positions.csv, ais_manifests.csv
//             as400_fees.csv
//             ecs_equipment.csv, ecs_movement.csv

import { seedState, type RawMockState } from './scenario'

// ── shared types ──────────────────────────────────────────────────────────────

export interface BronzeFile {
  name: string
  type: 'json' | 'csv'
  table: string               // derived from filename
  rows: Record<string, string>[]
  rawSize: number             // bytes
}

export interface SilverIssue {
  file: string
  row: number
  field: string
  problem: string
  fix: string
}

export interface SilverFile {
  name: string
  table: string
  rows: Record<string, unknown>[]
  issues: SilverIssue[]
}

export interface GoldSummary {
  yard_blocks: number
  appointments: number
  vessels: number
  fees: number
  equipment: number
  storage_plan_sequences: number
}

export interface MedallionReport {
  bronze: { files: BronzeFile[]; total_rows: number }
  silver: { files: SilverFile[]; total_issues: number }
  gold: { state: RawMockState; summary: GoldSummary }
  errors: string[]
}

// ── Bronze: parse ─────────────────────────────────────────────────────────────

function tableKey(filename: string): string {
  return filename.toLowerCase().replace(/\.(csv|json)$/, '').replace(/[^a-z0-9_]/g, '_')
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map((line) => {
    const vals = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''))
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = vals[i] ?? '' })
    return row
  })
}

async function bronzeFile(file: File): Promise<BronzeFile> {
  const text = await file.text()
  const name = file.name
  const isJson = name.toLowerCase().endsWith('.json')
  const table = tableKey(name)
  let rows: Record<string, string>[] = []

  if (isJson) {
    try {
      const parsed = JSON.parse(text)
      // If it's an object (not array), treat the whole thing as a single-row payload
      rows = Array.isArray(parsed) ? parsed : [{ _json: text }]
    } catch {
      rows = [{ _json: text }]
    }
  } else {
    rows = parseCSV(text)
  }

  return { name, type: isJson ? 'json' : 'csv', table, rows, rawSize: text.length }
}

// ── Silver: validate & coerce ─────────────────────────────────────────────────

function num(val: string | undefined, fallback: number, file: string, row: number, field: string, issues: SilverIssue[]): number {
  if (val === undefined || val === '') {
    issues.push({ file, row, field, problem: 'missing value', fix: `filled with ${fallback}` })
    return fallback
  }
  const n = Number(val)
  if (isNaN(n)) {
    issues.push({ file, row, field, problem: `non-numeric "${val}"`, fix: `replaced with ${fallback}` })
    return fallback
  }
  return n
}

function str(val: string | undefined, fallback: string, file: string, row: number, field: string, issues: SilverIssue[]): string {
  if (val === undefined || val === '') {
    issues.push({ file, row, field, problem: 'missing value', fix: `filled with "${fallback}"` })
    return fallback
  }
  return val.trim()
}

function bool(val: string | undefined, fallback: boolean): boolean {
  if (val === undefined || val === '') return fallback
  return val.toLowerCase() === 'true' || val === '1'
}

function silverFile(bronze: BronzeFile): SilverFile {
  const issues: SilverIssue[] = []
  const f = bronze.name

  const rows = bronze.rows.map((raw, i) => {
    const r = i + 1
    const t = bronze.table

    if (t === 'tos_yard_blocks' || t === 'yard_blocks') {
      const capacity = num(raw.capacity, 120, f, r, 'capacity', issues)
      const occupied = num(raw.occupied, 0, f, r, 'occupied', issues)
      const clampedOccupied = Math.min(occupied, capacity)
      if (clampedOccupied !== occupied) issues.push({ file: f, row: r, field: 'occupied', problem: `occupied (${occupied}) > capacity (${capacity})`, fix: `clamped to ${clampedOccupied}` })
      return { block: str(raw.block, `BLK-${r}`, f, r, 'block', issues), terminal: str(raw.terminal, 'T18', f, r, 'terminal', issues), capacity, occupied: clampedOccupied }
    }

    if (t === 'tos_storage_plan' || t === 'storage_plan') {
      return {
        terminal: str(raw.terminal, 'T18', f, r, 'terminal', issues),
        window: str(raw.window, '12:00-16:00', f, r, 'window', issues),
        vessel_id: str(raw.vessel_id, 'V-UNKNOWN', f, r, 'vessel_id', issues),
        block: str(raw.block, `BLK-${r}`, f, r, 'block', issues),
        containers: num(raw.containers, 0, f, r, 'containers', issues),
      }
    }

    if (t === 'emodal_appointments' || t === 'appointments') {
      const demand = num(raw.demand, 0, f, r, 'demand', issues)
      const slots = num(raw.slots, 80, f, r, 'slots', issues)
      const booked = num(raw.booked, 0, f, r, 'booked', issues)
      return { window: str(raw.window, '12:00-16:00', f, r, 'window', issues), terminal: str(raw.terminal, 'T18', f, r, 'terminal', issues), slots, booked, demand }
    }

    if (t === 'ais_positions' || t === 'positions') {
      return {
        vessel_id: str(raw.vessel_id, `V-${r}`, f, r, 'vessel_id', issues),
        name: str(raw.name, str(raw.vessel_id, `Vessel ${r}`, f, r, 'name', issues), f, r, 'name', issues),
        status: str(raw.status, 'inbound', f, r, 'status', issues),
        destination_terminal: str(raw.destination_terminal, 'T18', f, r, 'destination_terminal', issues),
        eta: str(raw.eta, '2026-06-10T12:00:00Z', f, r, 'eta', issues),
      }
    }

    if (t === 'ais_manifests' || t === 'manifests') {
      return {
        vessel_id: str(raw.vessel_id, `V-${r}`, f, r, 'vessel_id', issues),
        terminal: str(raw.terminal, 'T18', f, r, 'terminal', issues),
        discharge_window: str(raw.discharge_window, '12:00-16:00', f, r, 'discharge_window', issues),
        discharge_count: num(raw.discharge_count, 0, f, r, 'discharge_count', issues),
        confirmed: bool(raw.confirmed, false),
      }
    }

    if (t === 'as400_fees' || t === 'fees' || t === 'fee_schedule') {
      return {
        code: str(raw.code, `FEE-${r}`, f, r, 'code', issues),
        unit: str(raw.unit, 'container', f, r, 'unit', issues),
        amount: num(raw.amount, 0, f, r, 'amount', issues),
        currency: str(raw.currency, 'USD', f, r, 'currency', issues),
      }
    }

    if (t === 'ecs_equipment' || t === 'equipment') {
      const util = num(raw.utilization_pct, 50, f, r, 'utilization_pct', issues)
      const derivedStatus = raw.status ? str(raw.status, 'busy', f, r, 'status', issues)
        : util > 100 ? 'overloaded' : util > 60 ? 'busy' : util < 40 ? 'idle' : 'normal'
      return { id: str(raw.id, `EQ-${r}`, f, r, 'id', issues), type: str(raw.type, 'Crane', f, r, 'type', issues), utilization_pct: util, status: derivedStatus }
    }

    if (t === 'ecs_movement' || t === 'movement') {
      return {
        total_moves: num(raw.total_moves, 0, f, r, 'total_moves', issues),
        unnecessary_shuffles: num(raw.unnecessary_shuffles, 0, f, r, 'unnecessary_shuffles', issues),
        avg_utilization_pct: num(raw.avg_utilization_pct, 50, f, r, 'avg_utilization_pct', issues),
        cycle_time_min: num(raw.cycle_time_min, 30, f, r, 'cycle_time_min', issues),
      }
    }

    // Unknown table — pass through as-is
    return raw as Record<string, unknown>
  })

  return { name: bronze.name, table: bronze.table, rows, issues }
}

// ── Gold: aggregate into RawMockState ─────────────────────────────────────────

function goldFromSilver(files: SilverFile[]): { state: RawMockState; summary: GoldSummary } {
  const base = seedState()
  const byTable = new Map<string, SilverFile>()
  for (const f of files) byTable.set(f.table, f)

  // TOS yard blocks
  const yb = byTable.get('tos_yard_blocks') ?? byTable.get('yard_blocks')
  if (yb?.rows.length) {
    base.tos.yard_blocks = yb.rows as RawMockState['tos']['yard_blocks']
  }

  // TOS storage plan (rows are sequence items — group by first row's terminal/window/vessel)
  const sp = byTable.get('tos_storage_plan') ?? byTable.get('storage_plan')
  if (sp?.rows.length) {
    const first = sp.rows[0] as { terminal: string; window: string; vessel_id: string; block: string; containers: number }
    base.tos.storage_plan = {
      terminal: first.terminal,
      window: first.window,
      vessel_id: first.vessel_id,
      sequence: sp.rows.map((r) => {
        const row = r as typeof first
        return { block: row.block, containers: row.containers }
      }),
    }
  }

  // eModal appointments
  const appt = byTable.get('emodal_appointments') ?? byTable.get('appointments')
  if (appt?.rows.length) {
    base.emodal.appointments = appt.rows as RawMockState['emodal']['appointments']
  }

  // AIS positions
  const pos = byTable.get('ais_positions') ?? byTable.get('positions')
  if (pos?.rows.length) {
    base.ais.positions = pos.rows as RawMockState['ais']['positions']
  }

  // AIS manifests
  const man = byTable.get('ais_manifests') ?? byTable.get('manifests')
  if (man?.rows.length) {
    base.ais.manifests = man.rows as RawMockState['ais']['manifests']
  }

  // AS/400 fees
  const fees = byTable.get('as400_fees') ?? byTable.get('fees') ?? byTable.get('fee_schedule')
  if (fees?.rows.length) {
    base.as400.fee_schedule = fees.rows as RawMockState['as400']['fee_schedule']
  }

  // ECS equipment
  const eq = byTable.get('ecs_equipment') ?? byTable.get('equipment')
  if (eq?.rows.length) {
    base.ecs.equipment = eq.rows as RawMockState['ecs']['equipment']
  }

  // ECS movement (single row)
  const mv = byTable.get('ecs_movement') ?? byTable.get('movement')
  if (mv?.rows.length) {
    base.ecs.movement = mv.rows[0] as RawMockState['ecs']['movement']
  }

  const summary: GoldSummary = {
    yard_blocks: base.tos.yard_blocks.length,
    appointments: base.emodal.appointments.length,
    vessels: base.ais.manifests.length,
    fees: base.as400.fee_schedule.length,
    equipment: base.ecs.equipment.length,
    storage_plan_sequences: base.tos.storage_plan?.sequence.length ?? 0,
  }

  return { state: base, summary }
}

// ── JSON full-state path ───────────────────────────────────────────────────────

function goldFromJSON(text: string): { state: RawMockState; summary: GoldSummary } | null {
  try {
    const parsed = JSON.parse(text) as Partial<RawMockState>
    const base = seedState()
    if (parsed.tos) base.tos = { ...base.tos, ...parsed.tos }
    if (parsed.emodal) base.emodal = { ...base.emodal, ...parsed.emodal }
    if (parsed.ais) base.ais = { ...base.ais, ...parsed.ais }
    if (parsed.as400) base.as400 = { ...base.as400, ...parsed.as400 }
    if (parsed.ecs) base.ecs = { ...base.ecs, ...parsed.ecs }
    const summary: GoldSummary = {
      yard_blocks: base.tos.yard_blocks.length,
      appointments: base.emodal.appointments.length,
      vessels: base.ais.manifests.length,
      fees: base.as400.fee_schedule.length,
      equipment: base.ecs.equipment.length,
      storage_plan_sequences: base.tos.storage_plan?.sequence.length ?? 0,
    }
    return { state: base, summary }
  } catch {
    return null
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runMedallion(files: File[]): Promise<MedallionReport> {
  const errors: string[] = []

  // Bronze
  const bronzeFiles: BronzeFile[] = []
  for (const file of files) {
    try {
      bronzeFiles.push(await bronzeFile(file))
    } catch (e) {
      errors.push(`Failed to parse ${file.name}: ${String(e)}`)
    }
  }
  const totalRows = bronzeFiles.reduce((s, f) => s + f.rows.length, 0)

  // Check if we have a single JSON file with the full state
  const jsonFiles = bronzeFiles.filter((f) => f.type === 'json')
  if (jsonFiles.length === 1 && bronzeFiles.length === 1) {
    const raw = await files[0].text()
    const gold = goldFromJSON(raw)
    if (gold) {
      return {
        bronze: { files: bronzeFiles, total_rows: totalRows },
        silver: { files: [], total_issues: 0 },
        gold,
        errors,
      }
    }
  }

  // Silver
  const silverFiles: SilverFile[] = bronzeFiles.map((b) => silverFile(b))
  const totalIssues = silverFiles.reduce((s, f) => s + f.issues.length, 0)

  // Gold
  const gold = goldFromSilver(silverFiles)

  return {
    bronze: { files: bronzeFiles, total_rows: totalRows },
    silver: { files: silverFiles, total_issues: totalIssues },
    gold,
    errors,
  }
}
