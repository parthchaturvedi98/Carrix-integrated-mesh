import type { Sources } from '../types'
import { Icon } from './icons'

const SILO_SHELLS = [
  { key: 'ais',    icon: 'vessel',   name: 'AIS',    sub: 'vessel positions · manifests' },
  { key: 'emodal', icon: 'gate',     name: 'eModal', sub: 'trucker appointment slots' },
  { key: 'tos',    icon: 'yard',     name: 'TOS',    sub: 'yard occupancy · storage plan' },
  { key: 'as400',  icon: 'fees',     name: 'AS/400', sub: 'fee schedule · demurrage' },
  { key: 'ecs',    icon: 'movement', name: 'ECS',    sub: 'equipment · IoT telemetry' },
]

/** Pre-run view: the five source systems as separate silos.
 *  When `populated` is false the tiles show their headers only — data is
 *  revealed after the Data Quality Agent approves the uploaded files. */
export function SourcesPanel({ sources, populated = true }: { sources: Sources; populated?: boolean }) {
  const focus = sources.scenario.focus_window
  const term  = sources.scenario.terminal

  const manifest   = sources.ais.manifests.find((m) => m.terminal === term && m.discharge_window === focus)
  const appt       = sources.emodal.appointments.find((a) => a.terminal === term && a.window === focus)
  const termBlocks = sources.tos.yard_blocks.filter((b) => b.terminal === term)
  const tightBlocks = termBlocks.filter((b) => b.occupied / b.capacity >= 0.85)

  type SiloData = { lines: string[]; flag: string | null }
  const data: Record<string, SiloData> = {
    ais: {
      lines: sources.ais.manifests.map(
        (m) => `${m.vessel_id} → ${m.terminal}: ${m.discharge_count} containers (${m.discharge_window})`,
      ),
      flag: manifest ? `${manifest.discharge_count} containers inbound to ${term} this window` : null,
    },
    emodal: {
      lines: sources.emodal.appointments
        .filter((a) => a.terminal === term)
        .map((a) => `${a.window}: ${a.demand} demand / ${a.slots} slots`),
      flag: appt && appt.demand > appt.slots
        ? `Appointment surge in ${focus}: ${appt.demand} vs ${appt.slots} slots`
        : null,
    },
    tos: {
      lines: termBlocks.map(
        (b) => `${b.block}: ${b.occupied}/${b.capacity} (${Math.round((b.occupied / b.capacity) * 100)}%)`,
      ),
      flag: tightBlocks.length ? `${tightBlocks.length} ${term} block(s) near-congested` : null,
    },
    as400: {
      lines: sources.as400.fee_schedule.map(
        (f) => `${f.code}: ${f.currency} ${f.amount} / ${f.unit}`,
      ),
      flag: null,
    },
    ecs: sources.ecs
      ? {
          lines: sources.ecs.equipment.map(
            (e) => `${e.id} (${e.type}): ${e.utilization_pct}% (${e.status})`,
          ),
          flag:
            sources.ecs.equipment.filter((e) => e.utilization_pct < 40).length > 0 ||
            sources.ecs.movement.unnecessary_shuffles > 0
              ? `${sources.ecs.equipment.filter((e) => e.utilization_pct < 40).length} crane(s) idle, ${sources.ecs.movement.unnecessary_shuffles} unnecessary shuffles`
              : null,
        }
      : { lines: [], flag: null },
  }

  return (
    <section className="sources">
      <div className="sources-intro">
        <h2>Five source systems · five silos</h2>
        <p>
          Each system below holds one piece of the picture, and{' '}
          <strong>none of them sees the others</strong>. Individually everything looks routine.
          {populated
            ? ' Run the reconciliation loop to correlate them into one world model and surface the cross-silo collision none can detect alone.'
            : ' Upload a scenario file to populate the silos, then run the reconciliation loop.'}
        </p>
      </div>

      <div className="silo-grid">
        {SILO_SHELLS.map((shell) => {
          const d = data[shell.key]
          return (
            <div key={shell.key} className={`silo ${!populated ? 'silo-empty' : ''}`}>
              <div className="silo-head">
                <span className="agent-icon"><Icon name={shell.icon} /></span>
                <div>
                  <h3>{shell.name}</h3>
                  <span className="silo-sub">{shell.sub}</span>
                </div>
              </div>

              {populated ? (
                <>
                  <ul className="silo-lines">
                    {d.lines.map((l, i) => <li key={i}>{l}</li>)}
                  </ul>
                  {d.flag && (
                    <div className="silo-flag"><Icon name="warning" /> {d.flag}</div>
                  )}
                </>
              ) : (
                <div className="silo-awaiting">
                  Awaiting data file upload
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
