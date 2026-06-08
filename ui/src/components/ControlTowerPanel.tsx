import type { RunView } from '../types'

// "One operating picture": the federated domains the control tower connects, an overall risk
// level, and the recommended actions by owner — the heart of the UC-10 story.
export function ControlTowerPanel({ view }: { view: RunView }) {
  const conflict = view.latest_conflict ?? view.initial_conflict
  const detected = Boolean(conflict?.detected)
  const resolved = view.status === 'resolved'
  const risk = resolved ? 'low' : detected ? 'high' : 'medium'

  // domains the tower is reconciling; the first four are live in this demo
  const domains = [
    { name: 'Yard', live: true },
    { name: 'Gate', live: true },
    { name: 'Vessel', live: true },
    { name: 'Equipment', live: true },
    { name: 'Rail', live: false },
    { name: 'Safety', live: false },
    { name: 'Support', live: false },
    { name: 'Maintenance', live: false },
  ]

  const actions = view.proposal?.plan.actions ?? []
  const owners = view.proposal?.plan.agents
    ?.filter((a) => a.proposed_actions.length > 0)
    .map((a) => ({ owner: a.agent, decision: actions.find((x) => x.agent === a.agent)?.decision })) ?? []

  return (
    <section className="panel tower">
      <div className="panel-head">
        <h2>Control tower · operating picture</h2>
        <span className={`pill risk-${risk}`}>Risk: {risk}</span>
      </div>
      <div className="tower-domains">
        {domains.map((d) => (
          <span key={d.name} className={`domain ${d.live ? 'on' : 'off'}`}>
            <i className="domain-dot" />{d.name}
          </span>
        ))}
      </div>
      {owners.length > 0 && (
        <div className="tower-owners">
          <div className="tower-sub">Recommended actions by owner</div>
          {owners.map((o) => (
            <div key={o.owner} className="owner-row">
              <span className="owner-name">{o.owner}</span>
              <span className={`owner-status s-${o.decision ?? 'pending'}`}>
                {o.decision === 'approved' ? 'executed' : o.decision === 'rejected' ? 'rejected' : 'recommended'}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
