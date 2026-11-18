import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  ConeCollider,
  CuboidCollider,
  CylinderCollider,
  InstancedRigidBodies,
  useAfterPhysicsStep,
  useBeforePhysicsStep,
  type InstancedRigidBodyProps,
  type RapierRigidBody,
} from '@react-three/rapier'
import * as THREE from 'three'
import { simClock } from '@/core/clock'
import { GROUPS } from '@/core/collision'
import { registerDebug } from '@/core/debug'
import { events } from '@/core/events'
import { runtime } from '@/core/runtime'
import { useGameStore } from '@/state/game'
import { useSettings } from '@/state/settings'
import { PROPS } from '../constants'
import type { PuffPool } from '../fx/Puffs'
import { capPlanar } from '../logic/drive'
import { propRule, type PropSnapshot } from '../logic/propRules'
import { PROP_KINDS, PROP_SPOTS, spotsOfKind, type PropKind, type PropSpot } from './propData'
import { propGeometry, propMaterial } from './propGeometry'

/**
 * ~40 light dynamic props (boxes, crates, cones, drums, pallets). One
 * InstancedRigidBodies + one instanced mesh per kind (6 draw calls). Sleeping
 * enabled, velocities capped, the visitor nudges what they walk into, bumps
 * make a (rate-limited) sound, and displaced props tidy themselves up once
 * nobody is watching.
 */

const KINDS: PropKind[] = ['box', 'boxSmall', 'crate', 'cone', 'barrel', 'pallet']
/**
 * Only the bigger silhouettes cast shadows (perf budget): low cardboard boxes and
 * flat pallets add a shadow draw call for a contact shadow nobody notices.
 */
const CASTS_SHADOW: Record<PropKind, boolean> = { box: false, boxSmall: false, pallet: false, crate: true, barrel: true, cone: true }
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const _q = new THREE.Quaternion()
const _up = new THREE.Vector3()
const _planar = { x: 0, z: 0 }
const _snap: PropSnapshot = { x: 0, y: 0, z: 0, up: 1, homeX: 0, homeY: 0, homeZ: 0, playerX: 0, playerZ: 0 }
/** Distance from the forklift origin that covers its whole footprint (fork tips are 2.18 m ahead). */
const FORKLIFT_CLEAR = 2.4

interface PropRec {
  spot: PropSpot
  kind: PropKind
  index: number
  radius: number
  home: { x: number; y: number; z: number; q: { x: number; y: number; z: number; w: number } }
  /** Cached pose (refreshed while awake). */
  x: number
  y: number
  z: number
  up: number
  /** Velocity before the physics step (bump detection). */
  pvx: number
  pvy: number
  pvz: number
  awake: boolean
  displacedFor: number
  nudgeCooldown: number
  bumpCooldown: number
}

class PropSystem {
  readonly recs: PropRec[] = []
  private readonly byKind = new Map<PropKind, PropRec[]>()
  private bodies = new Map<PropKind, RefObject<(RapierRigidBody | null)[] | null>>()
  private bumpGlobal = 0
  private tickAcc = 0
  puffs: PuffPool | null = null
  bumps = 0
  nudges = 0
  resets = 0

  constructor() {
    for (const kind of KINDS) {
      const list = spotsOfKind(kind).map((spot, index) => {
        _q.setFromAxisAngle(Y_AXIS, spot.yaw)
        const rec: PropRec = {
          spot,
          kind,
          index,
          radius: PROP_KINDS[kind].radius,
          home: { x: spot.x, y: spot.y, z: spot.z, q: { x: _q.x, y: _q.y, z: _q.z, w: _q.w } },
          x: spot.x,
          y: spot.y,
          z: spot.z,
          up: 1,
          pvx: 0,
          pvy: 0,
          pvz: 0,
          awake: true,
          displacedFor: 0,
          nudgeCooldown: 0,
          bumpCooldown: 0,
        }
        this.recs.push(rec)
        return rec
      })
      this.byKind.set(kind, list)
    }
  }

  bind(kind: PropKind, ref: RefObject<(RapierRigidBody | null)[] | null>): () => void {
    this.bodies.set(kind, ref)
    return () => {
      if (this.bodies.get(kind) === ref) this.bodies.delete(kind)
    }
  }

  private body(rec: PropRec): RapierRigidBody | null {
    const arr = this.bodies.get(rec.kind)?.current
    return arr?.[rec.index] ?? null
  }

  /** Cap velocities; remember pre-step velocity for bump detection. */
  beforeStep(): void {
    for (const rec of this.recs) {
      const b = this.body(rec)
      if (!b) continue
      try {
        if (b.isSleeping()) {
          rec.awake = false
          rec.pvx = rec.pvy = rec.pvz = 0
          continue
        }
        rec.awake = true
        const lv = b.linvel()
        const av = b.angvel()
        let changed = false
        const planar = _planar
        planar.x = lv.x
        planar.z = lv.z
        if (capPlanar(planar, PROPS.maxSpeed)) changed = true
        const vy = Math.min(lv.y, PROPS.maxSpeed)
        if (vy !== lv.y) changed = true
        if (changed) b.setLinvel({ x: planar.x, y: vy, z: planar.z }, true)
        const wl = Math.hypot(av.x, av.y, av.z)
        if (wl > PROPS.maxAngular) {
          const k = PROPS.maxAngular / wl
          b.setAngvel({ x: av.x * k, y: av.y * k, z: av.z * k }, true)
        }
        rec.pvx = planar.x
        rec.pvy = vy
        rec.pvz = planar.z
      } catch {
        /* body gone */
      }
    }
  }

  /** A sudden velocity change (hit by the forklift, a kick, a landing) → bump sound. */
  afterStep(dt: number): void {
    this.bumpGlobal = Math.max(0, this.bumpGlobal - dt)
    for (const rec of this.recs) {
      rec.bumpCooldown = Math.max(0, rec.bumpCooldown - dt)
      const b = this.body(rec)
      if (!b) continue
      try {
        if (b.isSleeping()) continue
        const lv = b.linvel()
        const dv = Math.hypot(lv.x - rec.pvx, lv.y - rec.pvy, lv.z - rec.pvz)
        if (dv < PROPS.bumpDeltaV || rec.bumpCooldown > 0 || this.bumpGlobal > 0) continue
        rec.bumpCooldown = PROPS.bumpCooldownPerProp
        this.bumpGlobal = PROPS.bumpCooldownGlobal
        this.bumps++
        const t = b.translation()
        const heavy = rec.kind === 'crate' || rec.kind === 'pallet' || rec.kind === 'barrel'
        events.emit('sfx', {
          name: 'crate-bump',
          position: [t.x, t.y + 0.3, t.z],
          volume: Math.min(1, 0.35 + dv * 0.12),
          rate: rec.kind === 'cone' ? 1.35 : heavy ? 0.8 : 1.05,
        })
      } catch {
        /* ignore */
      }
    }
  }

  /** Refresh cached poses of awake props; the visitor nudges what they walk into. */
  frame(dt: number): void {
    const p = runtime.player.position
    const v = runtime.player.velocity
    const onFoot = runtime.player.mode === 'foot'
    const speed = Math.hypot(v.x, v.z)
    for (const rec of this.recs) {
      rec.nudgeCooldown = Math.max(0, rec.nudgeCooldown - dt)
      const b = this.body(rec)
      if (!b) continue
      if (rec.awake) {
        try {
          const t = b.translation()
          const r = b.rotation()
          rec.x = t.x
          rec.y = t.y
          rec.z = t.z
          _up.set(0, 1, 0).applyQuaternion(_q.set(r.x, r.y, r.z, r.w))
          rec.up = _up.y
        } catch {
          continue
        }
      }
      if (!onFoot || speed < PROPS.nudgeMinSpeed || rec.nudgeCooldown > 0) continue
      const dx = rec.x - p.x
      const dz = rec.z - p.z
      const dist = Math.hypot(dx, dz)
      if (dist < 1e-3 || dist - rec.radius - 0.35 > PROPS.nudgeGap) continue
      if (rec.y > p.y + 1.2) continue // stacked high: out of reach
      const nx = dx / dist
      const nz = dz / dist
      const toward = (v.x * nx + v.z * nz) / speed
      if (toward < 0.45) continue
      try {
        const lv = b.linvel()
        const along = lv.x * nx + lv.z * nz
        const want = Math.min(3.2, Math.max(0.9, speed * 0.85))
        const dv = want - along
        if (dv <= 0.15) continue
        const m = b.mass()
        const lift = rec.kind === 'cone' ? 0.25 : 0.12
        b.applyImpulse({ x: nx * dv * m, y: lift * m, z: nz * dv * m }, true)
        rec.nudgeCooldown = PROPS.nudgeCooldown
        this.nudges++
      } catch {
        /* ignore */
      }
    }
  }

  /** Housekeeping at ~2 Hz on the sim clock. */
  tick(dt: number): void {
    this.tickAcc += dt
    if (this.tickAcc < 0.5) return
    const step = this.tickAcc
    this.tickAcc = 0
    const p = runtime.player.position
    const f = runtime.forklift.position
    const snap = _snap
    snap.playerX = p.x
    snap.playerZ = p.z
    for (const rec of this.recs) {
      snap.x = rec.x
      snap.y = rec.y
      snap.z = rec.z
      snap.up = rec.up
      snap.homeX = rec.home.x
      snap.homeY = rec.home.y
      snap.homeZ = rec.home.z
      const r = propRule(snap, rec.displacedFor, step)
      rec.displacedFor = r.displacedFor
      if (r.verdict === 'reset-now') this.reset(rec, true)
      else if (r.verdict === 'reset') {
        // never pop a prop back into the parked forklift: try again on a later tick
        if (Math.hypot(f.x - rec.home.x, f.z - rec.home.z) < rec.radius + FORKLIFT_CLEAR) rec.displacedFor = PROPS.resetAfter
        else this.reset(rec, false)
      }
    }
  }

  reset(rec: PropRec, visible: boolean): void {
    const b = this.body(rec)
    if (!b) return
    const h = rec.home
    try {
      b.setTranslation({ x: h.x, y: h.y + 0.002, z: h.z }, true)
      b.setRotation(h.q, true)
      b.setLinvel({ x: 0, y: 0, z: 0 }, true)
      b.setAngvel({ x: 0, y: 0, z: 0 }, true)
    } catch {
      return
    }
    rec.x = h.x
    rec.y = h.y
    rec.z = h.z
    rec.up = 1
    rec.displacedFor = 0
    rec.awake = true
    this.resets++
    if (visible && this.puffs) {
      const gentle = !!useSettings.getState().reducedMotion
      this.puffs.poof(h.x, h.y, h.z, { radius: 0.6, count: gentle ? 4 : 7, gentle })
    }
  }

  resetAll(): void {
    for (const rec of this.recs) this.reset(rec, false)
  }

  debug() {
    return {
      count: this.recs.length,
      awake: this.recs.filter((r) => r.awake).length,
      displaced: this.recs.filter((r) => r.displacedFor > 0).map((r) => r.spot.id),
      bumps: this.bumps,
      nudges: this.nudges,
      resets: this.resets,
    }
  }
}

function collidersFor(kind: PropKind): ReactNode[] {
  const def = PROP_KINDS[kind]
  return def.colliders.map((c, i) => {
    const common = { position: [0, c.y, 0] as [number, number, number], mass: c.mass, collisionGroups: GROUPS.prop, friction: def.friction, restitution: def.restitution }
    if (c.type === 'cuboid') return <CuboidCollider key={i} args={c.half} {...common} />
    if (c.type === 'cylinder') return <CylinderCollider key={i} args={[c.halfHeight, c.radius]} {...common} />
    return <ConeCollider key={i} args={[c.halfHeight, c.radius]} {...common} />
  })
}

function PropKindBodies({ kind, sys, shadows }: { kind: PropKind; sys: PropSystem; shadows: boolean }) {
  const def = PROP_KINDS[kind]
  const spots = useMemo(() => spotsOfKind(kind), [kind])
  const instances = useMemo<InstancedRigidBodyProps[]>(
    () => spots.map((s) => ({ key: s.id, position: [s.x, s.y + 0.002, s.z], rotation: [0, s.yaw, 0] })),
    [spots],
  )
  const colliderNodes = useMemo(() => collidersFor(kind), [kind])
  const ref = useRef<(RapierRigidBody | null)[]>(null)
  useEffect(() => sys.bind(kind, ref), [sys, kind])
  const geo = propGeometry(kind)
  const mat = propMaterial()
  if (spots.length === 0) return null
  return (
    <InstancedRigidBodies
      ref={ref}
      instances={instances}
      colliders={false}
      colliderNodes={colliderNodes}
      type="dynamic"
      canSleep
      ccd
      linearDamping={def.linearDamping}
      angularDamping={def.angularDamping}
    >
      <instancedMesh args={[geo, mat, spots.length]} count={spots.length} castShadow={shadows} receiveShadow frustumCulled={false} name={`vehicles:props:${kind}`} />
    </InstancedRigidBodies>
  )
}

export function BumpableProps({ puffs }: { puffs: PuffPool }) {
  const [sys] = useState(() => new PropSystem())
  const quality = useGameStore((s) => s.quality)

  useEffect(() => {
    sys.puffs = puffs
    const offs = [
      simClock.onTick((dt) => sys.tick(dt)),
      registerDebug('forklift', {
        props: () => sys.debug(),
        resetProps: () => sys.resetAll(),
        propSpots: () => PROP_SPOTS.map((s) => ({ id: s.id, kind: s.kind, x: s.x, z: s.z })),
      }),
    ]
    return () => {
      for (const off of offs) off()
    }
  }, [sys, puffs])

  useBeforePhysicsStep(() => {
    try {
      sys.beforeStep()
    } catch (err) {
      console.error('[vehicles] props step failed', err)
    }
  })
  useAfterPhysicsStep((w) => {
    try {
      sys.afterStep(w.timestep)
    } catch (err) {
      console.error('[vehicles] props after-step failed', err)
    }
  })
  useFrame((_, dt) => sys.frame(Math.min(Math.max(dt, 0), 0.1)))

  const shadows = quality !== 'low'
  return (
    <group name="vehicles-props">
      {KINDS.map((k) => (
        <PropKindBodies key={k} kind={k} sys={sys} shadows={shadows && CASTS_SHADOW[k]} />
      ))}
    </group>
  )
}
