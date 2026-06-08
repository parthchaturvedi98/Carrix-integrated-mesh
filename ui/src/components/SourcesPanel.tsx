import type { Sources } from '../types'
import { Icon } from './icons'

/** Pre-run view: the four source systems as separate silos, each showing the fact it holds —
 *  and none of them connected. This is *why* you run the mesh. */
export function SourcesPanel({ sources }: { sources: Sources }) {
  const focus = sources.scenario.focus_window
  const term = sources.scenario.terminal

  const manifest = sources.ais.manifests.find(
    (m) => m.terminal === term && m.discharge_window === focus,
  )
  const appt = sources.emodal.appointments.find(
    (a) => a.terminal === term && a.window === focus,
  )
  const termBlocks = sources.tos.yard_blocks.filter((b) => b.terminal === term)
  const tightBlocks = termBlocks.filter((b) => b.occupied / b.capacity >= 0.85)

  const silos = [
    {
      key: 'ais', icon: 'vessel', name: 'Mock AIS', sub: 'vessel positions · manifests',
      lines: sources.ais.manifests.map((m) => `${m.vessel_id} → ${m.terminal}: ${m.discharge_count} containers (${m.discharge_window})`),
      flag: manifest ? `${manifest.discharge_count} containers inbound to ${term} this afternoon` : null,
    },
    {
      key: 'emodal', icon: 'gate', name: 'Mock eModal', sub: 'trucker appointment slots',
      lines: sources.emodal.appointments.filter((a) => a.terminal === term).map((a) => `${a.window}: ${a.demand} demand / ${a.slots} slots`),
      flag: appt && appt.demand > appt.slots ? `Appointment surge in ${focus}: ${appt.demand} vs ${appt.slots} slots` : null,
    },
    {
      key: 'tos', icon: 'yard', name: 'Mock TOS', sub: 'yard occupancy · storage plan',
      lines: termBlocks.map((b) => `${b.block}: ${b.occupied}/${b.capacity} (${Math.round((b.occupied / b.capacity) * 100)}%)`),
      flag: tightBlocks.length ? `${tightBlocks.length} ${term} block(s) already near-congested` : null,
    },
    {
      key: 'as400', icon: 'fees', name: 'Mock AS/400', sub: 'fee schedule · demurrage',
      lines: sources.as400.fee_schedule.map((f) => `${f.code}: ${f.currency} ${f.amount} / ${f.unit}`),
      flag: null,
    },
  ]

  if (sources.ecs) {
    const eq = sources.ecs.equipment
    const idle = eq.filter((e) => e.utilization_pct < 40).length
    silos.push({
      key: 'ecs', icon: 'movement', name: 'Mock ECS', sub: 'equipment · IoT telemetry',
      lines: eq.map((e) => `${e.id} (${e.type}): ${e.utilization_pct}% (${e.status})`),
      flag: idle > 0 || sources.ecs.movement.unnecessary_shuffles > 0
        ? `${idle} crane(s) idle, ${sources.ecs.movement.unnecessary_shuffles} unnecessary shuffles`
        : null,
    })
  }

  return (
    <section className="sources">
      <div className="sources-intro">
        <h2>Four systems · four silos</h2>
        <p>
          Each system below holds one piece of the picture, and <strong>none of them sees the
          others</strong>. Individually everything looks routine. Run the mesh to reconcile them
          into one world model and surface the cross-silo collision none can detect alone.
        </p>
      </div>
      <div className="silo-grid">
        {silos.map((s) => (
          <div key={s.key} className="silo">
            <div className="silo-head">
              <span className="agent-icon"><Icon name={s.icon} /></span>
              <div>
                <h3>{s.name}</h3>
                <span className="silo-sub">{s.sub}</span>
              </div>
            </div>
            <ul className="silo-lines">
              {s.lines.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
            {s.flag && <div className="silo-flag"><Icon name="warning" /> {s.flag}</div>}
          </div>
        ))}
      </div>
    </section>
  )
}
