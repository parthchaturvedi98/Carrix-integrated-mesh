import { Canvas, useFrame } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import type { Mesh } from 'three'
import type { Snapshot, YardBlock } from '../types'

const MAX_H = 3 // visual height (world units) representing full block capacity

// One yard block: occupied (slate) + planned-that-fits (blue) + over-capacity overflow (red,
// rising above the capacity marker). Heights ease toward the active assignment, so when the
// assignment switches from the "before" plan to the resolved plan the towers visibly rebalance.
function Block({ b, assigned, x, z }: { b: YardBlock; assigned: number; x: number; z: number }) {
  const cap = b.capacity
  const free = cap - b.occupied
  const h = (a: number) => ({
    occ: (b.occupied / cap) * MAX_H,
    plan: (Math.min(a, free) / cap) * MAX_H,
    over: (Math.max(0, a - free) / cap) * MAX_H,
  })
  const t = h(assigned)
  const cur = useRef({ occ: 0.001, plan: 0.001, over: 0.001 })
  const occRef = useRef<Mesh>(null)
  const planRef = useRef<Mesh>(null)
  const overRef = useRef<Mesh>(null)
  const w = 1.3

  useFrame(() => {
    const c = cur.current
    c.occ += (t.occ - c.occ) * 0.1
    c.plan += (t.plan - c.plan) * 0.1
    c.over += (t.over - c.over) * 0.1
    if (occRef.current) { occRef.current.scale.y = Math.max(c.occ, 0.001); occRef.current.position.y = c.occ / 2 }
    if (planRef.current) { planRef.current.scale.y = Math.max(c.plan, 0.001); planRef.current.position.y = c.occ + c.plan / 2 }
    if (overRef.current) { overRef.current.scale.y = Math.max(c.over, 0.001); overRef.current.position.y = c.occ + c.plan + c.over / 2 }
  })

  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <boxGeometry args={[w + 0.3, 0.1, w + 0.3]} />
        <meshStandardMaterial color="#cbd5e1" />
      </mesh>
      <mesh ref={occRef}><boxGeometry args={[w, 1, w]} /><meshStandardMaterial color="#64748b" /></mesh>
      <mesh ref={planRef}><boxGeometry args={[w, 1, w]} /><meshStandardMaterial color="#2563eb" /></mesh>
      <mesh ref={overRef}><boxGeometry args={[w, 1, w]} /><meshStandardMaterial color="#dc2626" /></mesh>
      <mesh position={[0, MAX_H, 0]}><boxGeometry args={[w + 0.22, 0.03, w + 0.22]} /><meshStandardMaterial color="#94a3b8" /></mesh>
      <Html position={[0, MAX_H + 0.7, 0]} center distanceFactor={14}>
        <div className="twin-label">{b.block}<br />{b.occupied}/{b.capacity}{assigned ? ` +${assigned}` : ''}</div>
      </Html>
    </group>
  )
}

function Crane({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[-1.6, 2, 0]}><boxGeometry args={[0.15, 4, 0.15]} /><meshStandardMaterial color="#f59e0b" /></mesh>
      <mesh position={[1.6, 2, 0]}><boxGeometry args={[0.15, 4, 0.15]} /><meshStandardMaterial color="#f59e0b" /></mesh>
      <mesh position={[0, 4, 0]}><boxGeometry args={[3.5, 0.18, 0.18]} /><meshStandardMaterial color="#f59e0b" /></mesh>
    </group>
  )
}

function Yard({ blocks, assignedFor }: { blocks: YardBlock[]; assignedFor: (block: string) => number }) {
  const terminals = Array.from(new Set(blocks.map((b) => b.terminal)))
  const placed: { b: YardBlock; x: number; z: number }[] = []
  terminals.forEach((t, ti) => {
    const row = blocks.filter((b) => b.terminal === t)
    const z = ti * 3.2 - (terminals.length - 1) * 1.6
    row.forEach((b, i) => placed.push({ b, x: i * 2.2 - (row.length - 1) * 1.1, z }))
  })
  const minZ = Math.min(...placed.map((p) => p.z))

  return (
    <>
      <color attach="background" args={['#eef2f7']} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[6, 12, 6]} intensity={1.1} castShadow />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.12, 0]} receiveShadow>
        <planeGeometry args={[40, 30]} />
        <meshStandardMaterial color="#dbe2ec" />
      </mesh>
      {placed.map((p) => (
        <Block key={p.b.block} b={p.b} assigned={assignedFor(p.b.block)} x={p.x} z={p.z} />
      ))}
      <Crane x={0} z={minZ} />
      <group position={[0, 0, minZ - 3]}>
        <mesh position={[0, 0.6, 0]}><boxGeometry args={[9, 1.2, 2]} /><meshStandardMaterial color="#1f2a44" /></mesh>
        <mesh position={[3, 1.6, 0]}><boxGeometry args={[1.6, 0.8, 1.6]} /><meshStandardMaterial color="#33415e" /></mesh>
        <Html position={[0, 2.2, 0]} center distanceFactor={16}><div className="twin-label vessel">MV Meridian · 400 TEU</div></Html>
      </group>
    </>
  )
}

export default function TwinScene({
  snapshot, fromPlan,
}: {
  snapshot: { yard_blocks: YardBlock[]; storage_plan: Snapshot['storage_plan'] }
  fromPlan?: Record<string, number>
}) {
  const toPlan = new Map<string, number>()
  for (const item of snapshot.storage_plan?.sequence ?? []) {
    toPlan.set(item.block, (toPlan.get(item.block) ?? 0) + item.containers)
  }

  // before -> after replay: when a "before" plan is supplied (post-resolution), hold the
  // congested state briefly, then morph to the resolved plan. A Replay button re-triggers it.
  const hasTransition = !!fromPlan && Object.keys(fromPlan).length > 0
  const [morphed, setMorphed] = useState(!hasTransition)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (!hasTransition) { setMorphed(true); return }
    setMorphed(false)
    const id = setTimeout(() => setMorphed(true), 1600)
    return () => clearTimeout(id)
  }, [hasTransition, nonce])

  const assignedFor = (block: string) =>
    morphed ? (toPlan.get(block) ?? 0) : (fromPlan?.[block] ?? 0)

  return (
    <div className="twin-wrap">
      <Canvas shadows camera={{ position: [7, 8, 11], fov: 45 }} dpr={[1, 2]}>
        <Yard blocks={snapshot.yard_blocks} assignedFor={assignedFor} />
        <OrbitControls enableDamping target={[0, 1.4, 0]} maxPolarAngle={Math.PI / 2.1} minDistance={6} maxDistance={26} />
      </Canvas>

      {hasTransition && (
        <div className="twin-caption">
          <span className={`twin-phase ${morphed ? '' : 'on'}`}>Before: congested</span>
          <span className="twin-phase-sep">to</span>
          <span className={`twin-phase ${morphed ? 'on' : ''}`}>After: rebalanced</span>
          <button className="btn-sm" onClick={() => setNonce((n) => n + 1)}>Replay</button>
        </div>
      )}

      <div className="twin-legend">
        <span><i className="sw sw-occ" /> occupied</span>
        <span><i className="sw sw-plan" /> planned discharge</span>
        <span><i className="sw sw-over" /> over capacity</span>
        <span className="twin-hint">drag to orbit · scroll to zoom</span>
      </div>
    </div>
  )
}
