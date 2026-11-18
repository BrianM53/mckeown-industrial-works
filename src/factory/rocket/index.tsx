/**
 * ROCKET module root — the world centerpiece: assembly tower with crane and
 * umbilicals, a procedural (intentionally terrible) rocket built stage by
 * stage, the crawler transporter + track, the launch pad, launch effects and
 * outcomes, the launch crew (incl. the occasional stowaway), the
 * "TIME SINCE LAST UNSCHEDULED DISASSEMBLY" sign, the observation-deck bench
 * and binoculars, and the tower's status kiosk.
 *
 * Driven entirely by factory.state.rocket / counters (read every frame by
 * RocketRuntime). The sim emits every rocket:* event and caption; this module
 * only emits visual-side events: sfx for visual-only beats, one camera 'shake'
 * at ignition, the witness achievements and the "Clear the track!" caption.
 *
 * Debug: __MIW__.rocket.stats()
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { CuboidCollider, CylinderCollider, RigidBody, type RapierCollider, type RapierRigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { GROUPS } from '@/core/collision'
import { registerDebug } from '@/core/debug'
import { events, useGameEvent } from '@/core/events'
import { useInteractable } from '@/core/interaction'
import { clamp, yawToward } from '@/core/math'
import { runtime } from '@/core/runtime'
import { getService } from '@/core/services'
import { useGameStore } from '@/state/game'
import { useSettings } from '@/state/settings'
import { isOverlayBlocking } from '@/state/ui'
import { director } from '@/systems/director'
import { factory } from '@/systems/factory'
import { WorkerModel } from '@/world/WorkerModel'
import { binocularsText, kioskText } from './choreo'
import {
  BENCH,
  BINOCULARS,
  COLUMN_OFF,
  CUSHION,
  DECK_TOP,
  DECK_Y,
  IGNITION_CAPTION,
  IGNITION_SHAKE,
  KIOSK,
  PAD_BEACONS,
  PAD_MAST,
  PAD_SLAB_R,
  PAD_TOP,
  PAD_WATER_TOWER,
  PAD_X,
  PAD_Z,
  SIGN_BOARD,
  SIGN_POS,
  SIGN_YAW,
  STAIR,
  TOWER_CX,
  TOWER_CZ,
  TOWER_H,
  TRANSPORTER,
  WITNESS_RANGE,
} from './config'
import { CREW_LOOKS } from './crew'
import { RocketRuntime } from './runtime'
import { TRACK_PATH } from './track'

export default function FactoryRocket() {
  const [rt] = useState(() => new RocketRuntime())
  const quality = useGameStore((s) => s.quality)
  const reduced = useSettings((s) => s.reducedMotion)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)

  useLayoutEffect(() => {
    rt.mount(useGameStore.getState().quality)
    return () => rt.unmount()
  }, [rt])
  useEffect(() => rt.setQuality(quality), [rt, quality])
  useEffect(() => {
    rt.reduced = reduced
  }, [rt, reduced])

  useFrame((state, dt) => rt.update(state.camera, dt), -10)

  // Compile every shader variant the module will ever use right away, so the
  // first launch / explosion never stalls on a program compile.
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        gl.compile(rt.root, camera, scene)
      } catch {
        /* best effort */
      }
    }, 400)
    return () => window.clearTimeout(id)
  }, [gl, camera, scene, rt])

  useEffect(() => registerDebug('rocket', { stats: () => rt.stats() }), [rt])

  return (
    <>
      <primitive object={rt.root} dispose={null} />
      <Crew rt={rt} />
      <StaticColliders />
      <TransporterProxy rt={rt} />
      <Interactables />
      <LaunchEvents />
    </>
  )
}

// ---------------------------------------------------------------------------
// Crew (three shared WorkerModels; transforms written by the runtime)
// ---------------------------------------------------------------------------

function Crew({ rt }: { rt: RocketRuntime }) {
  return (
    <>
      {CREW_LOOKS.map((look, i) => (
        <group
          key={i}
          ref={(g) => {
            rt.crewGroups[i] = g
          }}
        >
          <WorkerModel look={look} seed={11 + i * 7} anim={() => rt.crewAnim[i]} speed={() => rt.crewSpeed[i]} lookYaw={() => rt.crewLook[i]} />
        </group>
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// Physics: tower legs, stair foot, kiosk, sign legs, bench, pad structures.
// ---------------------------------------------------------------------------

type Box = { p: [number, number, number]; h: [number, number, number]; yaw?: number }
type Cyl = { p: [number, number, number]; r: number; hh: number }

function rotateXZ(x: number, z: number, yaw: number): [number, number] {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [x * c + z * s, -x * s + z * c]
}

const BOXES: Box[] = (() => {
  const o = COLUMN_OFF
  const out: Box[] = []
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push({ p: [TOWER_CX + sx * o, TOWER_H / 2, TOWER_CZ + sz * o], h: [0.72, TOWER_H / 2, 0.72] })
  // stair: the foot is chained off — a solid block under the flights
  out.push({ p: [(STAIR.x0 + STAIR.x1) / 2, 1.1, (STAIR.z0 + STAIR.z1) / 2], h: [(STAIR.x1 - STAIR.x0) / 2, 1.1, (STAIR.z1 - STAIR.z0) / 2] })
  out.push({ p: [KIOSK[0], 0.7, KIOSK[1]], h: [0.32, 0.7, 0.26] })
  // counter-sign legs (sign-local x = ±(w/2 - 0.8), z = 0.32)
  for (const sx of [-1, 1]) {
    const [dx, dz] = rotateXZ(sx * (SIGN_BOARD.w / 2 - 0.8), 0.32, SIGN_YAW)
    out.push({ p: [SIGN_POS[0] + dx, 1.6, SIGN_POS[1] + dz], h: [0.45, 1.6, 0.45], yaw: SIGN_YAW })
  }
  out.push({ p: [BENCH.x, DECK_TOP + 0.42, BENCH.z], h: [BENCH.w / 2, 0.42, 0.3], yaw: BENCH.yaw })
  out.push({ p: [PAD_MAST[0], 7, PAD_MAST[1]], h: [0.75, 7, 0.75] })
  // buffer stops (tower end inside the tower, pad end north of the mount)
  out.push({ p: [TOWER_CX - 3.6, 0.45, TOWER_CZ], h: [0.35, 0.45, 1.95] })
  out.push({ p: [PAD_X, 0.45, PAD_Z - 3.3], h: [1.95, 0.45, 0.35] })
  // cushion inflator
  out.push({ p: [CUSHION[0] + 0.5, 0.35, CUSHION[1] + 1.7], h: [0.52, 0.35, 0.37] })
  return out
})()

const CYLS: Cyl[] = (() => {
  const out: Cyl[] = []
  const [wx, wz] = PAD_WATER_TOWER
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push({ p: [wx + sx * 0.92, 3.3, wz + sz * 0.92], r: 0.2, hh: 3.3 })
  for (const [bx, bz] of PAD_BEACONS) out.push({ p: [bx, 1.2, bz], r: 0.18, hh: 1.2 })
  // the pad slab is a low step (walkable)
  out.push({ p: [PAD_X, PAD_TOP / 2, PAD_Z], r: PAD_SLAB_R, hh: PAD_TOP / 2 })
  return out
})()

function StaticColliders() {
  return (
    <RigidBody type="fixed" colliders={false} name="rocket-static">
      {BOXES.map((b, i) => (
        <CuboidCollider key={`b${i}`} args={b.h} position={b.p} rotation={[0, b.yaw ?? 0, 0]} collisionGroups={GROUPS.static} />
      ))}
      {CYLS.map((c, i) => (
        <CylinderCollider key={`c${i}`} args={[c.hh, c.r]} position={c.p} collisionGroups={GROUPS.static} />
      ))}
    </RigidBody>
  )
}

// ---------------------------------------------------------------------------
// Transporter proxy: a solid body only while the crawler stands still and the
// visitor is not standing in its footprint (so it can never trap anyone).
// ---------------------------------------------------------------------------

const _inv = new THREE.Matrix4()
const _pp = new THREE.Vector3()
const _pos = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _scl = new THREE.Vector3()

function TransporterProxy({ rt }: { rt: RocketRuntime }) {
  const body = useRef<RapierRigidBody>(null)
  const deck = useRef<RapierCollider>(null)
  const stack = useRef<RapierCollider>(null)
  const state = useRef({ deck: false, stack: false, synced: false })

  useFrame(() => {
    const b = body.current
    const d = deck.current
    const s = stack.current
    if (!b || !d || !s) return
    _inv.copy(rt.transporterMatrix).invert()
    _pp.copy(runtime.player.position).applyMatrix4(_inv)
    const inside = Math.abs(_pp.x) < TRANSPORTER.width / 2 + 0.5 && Math.abs(_pp.z) < TRANSPORTER.length / 2 + 0.5
    const r = factory.state.rocket
    const wantDeck = rt.parked && !inside
    const wantStack = wantDeck && rt.rocketOnDeck && (r.phase !== 'assembling' || r.stagesComplete >= 1)
    // (re)place the body whenever a collider is about to be (re)enabled — and
    // once at start, since the colliders are created enabled at the body's spawn pose
    if (!state.current.synced || (wantDeck && !state.current.deck) || (wantStack && !state.current.stack)) {
      rt.transporterMatrix.decompose(_pos, _quat, _scl)
      if (!Number.isFinite(_pos.x + _pos.z + _quat.w)) return
      try {
        b.setTranslation({ x: _pos.x, y: 0, z: _pos.z }, true)
        b.setRotation({ x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w }, true)
        state.current.synced = true
      } catch {
        return
      }
    }
    if (wantDeck !== state.current.deck) {
      try {
        d.setEnabled(wantDeck)
        state.current.deck = wantDeck
      } catch {
        /* collider gone (unmount) */
      }
    }
    if (wantStack !== state.current.stack) {
      try {
        s.setEnabled(wantStack)
        state.current.stack = wantStack
      } catch {
        /* ignore */
      }
    }
  })

  // the colliders are created enabled: mark them so, the frame loop then
  // disables / re-places them as needed (also after a StrictMode remount)
  useEffect(() => {
    state.current = { deck: true, stack: true, synced: false }
  }, [])

  return (
    <RigidBody ref={body} type="fixed" colliders={false} name="rocket-transporter-proxy" position={[TOWER_CX, 0, TOWER_CZ]}>
      <CuboidCollider ref={deck} args={[TRANSPORTER.width / 2, DECK_Y / 2, TRANSPORTER.length / 2]} position={[0, DECK_Y / 2, 0]} collisionGroups={GROUPS.static} />
      <CylinderCollider ref={stack} args={[5.5, 1.25]} position={[0, DECK_Y + 5.5, 0]} collisionGroups={GROUPS.static} />
    </RigidBody>
  )
}

// ---------------------------------------------------------------------------
// Interactables: coin-op binoculars on the observation deck, tower kiosk
// ---------------------------------------------------------------------------

function Interactables() {
  useInteractable({
    id: 'rocket:binoculars',
    label: 'Coin-Op Binoculars',
    verb: 'Look through',
    radius: 1.9,
    priority: 0.5,
    getPosition: () => ({ x: BINOCULARS[0], y: DECK_TOP, z: BINOCULARS[1] }),
    // only from the deck itself, not from the ground underneath
    enabled: () => runtime.player.position.y > DECK_TOP * 0.55,
    onInteract: () => {
      const r = factory.state.rocket
      events.emit('toast', { text: binocularsText(r, factory.state.params), kind: 'info', duration: 6 })
      events.emit('sfx', { name: 'scanner-beep', position: [BINOCULARS[0], DECK_TOP + 1.2, BINOCULARS[1]], volume: 0.6 })
      const p = runtime.player.position
      getService('camera')?.set({ yaw: yawToward({ x: p.x, z: p.z }, { x: PAD_X, z: PAD_Z }), pitch: 0.22 })
    },
  })
  useInteractable({
    id: 'rocket:kiosk',
    label: 'Assembly Status Kiosk',
    verb: 'Check',
    radius: 2.1,
    getPosition: () => ({ x: KIOSK[0], y: 0, z: KIOSK[1] + 0.5 }),
    onInteract: () => {
      events.emit('toast', { text: kioskText(factory.state.rocket, factory.state.params), kind: 'info', duration: 6 })
      events.emit('sfx', { name: 'scanner-beep', position: [KIOSK[0], 1.2, KIOSK[1]], volume: 0.5 })
    },
  })
  return null
}

// ---------------------------------------------------------------------------
// Visual-side launch events
// ---------------------------------------------------------------------------

function canWitness(): boolean {
  const p = runtime.player.position
  if (!Number.isFinite(p.x)) return false
  const d = Math.hypot(p.x - PAD_X, p.z - PAD_Z)
  return d <= WITNESS_RANGE && runtime.world.interior === null
}

function LaunchEvents() {
  useGameEvent('rocket:ignition', () => {
    // one rumble per launch, weaker with distance; never while the visitor is reading
    if (isOverlayBlocking()) return
    const p = runtime.player.position
    const d = Math.hypot(p.x - PAD_X, p.z - PAD_Z)
    if (!Number.isFinite(d)) return
    const k = clamp(1.25 - d / 80, 0.25, 1)
    // the camera ignores shake under reduced motion; the caption is the alternate cue
    events.emit('shake', { intensity: IGNITION_SHAKE.intensity * k, duration: IGNITION_SHAKE.duration })
    if (d <= WITNESS_RANGE * 1.5) events.emit('caption', { text: IGNITION_CAPTION, kind: 'sound', duration: 3 })
  })
  useGameEvent('rocket:countdown', (p) => {
    // Pacing hint only: the launch occupies an AMBIENT slot so fewer gags pile
    // on top of it. Never 'disruptive' — an exclusive lock would refuse the
    // visitor's own actions (Night Shift button, OSHA tackles) for 32 s.
    if (p.secondsLeft >= 10) director.request({ id: 'rocket:launch', kind: 'ambient', cooldown: 60, duration: 32 })
  })
  useGameEvent('rocket:reset', () => director.end('rocket:launch'))
  useGameEvent('rocket:liftoff', () => {
    if (canWitness()) events.emit('achievement', { id: 'launch-witness' })
  })
  useGameEvent('rocket:outcome', (p) => {
    if ((p.outcome === 'breakup' || p.outcome === 'explosion') && canWitness()) events.emit('achievement', { id: 'disassembly-witness' })
  })
  useGameEvent('rocket:stage', () => {
    events.emit('sfx', { name: 'machine-clank', position: [TOWER_CX, DECK_Y + 5, TOWER_CZ], volume: 0.7 })
  })
  return null
}
