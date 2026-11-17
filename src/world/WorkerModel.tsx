import { useMemo, useRef } from 'react'
import type { ThreeElements } from '@react-three/fiber'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { colorMat } from './materials'
import { PALETTE } from './palette'

/**
 * Shared procedural worker character (player, NPCs, rocket crew, OSHA inspector).
 * ~1.85 m tall, feet at local y=0, faces -Z (set group rotation.y = yaw).
 * Animation is procedural: joint angles damp toward per-state targets every
 * frame, so state changes blend smoothly. Pass getters for `anim`/`speed` to
 * change them per frame without React re-renders.
 *
 * Owner: player module (may improve visuals/animations; must keep the props API).
 */
export type WorkerAnim =
  | 'idle'
  | 'walk'
  | 'run'
  | 'work'
  | 'wave'
  | 'panic'
  | 'tumble'
  | 'sit'
  | 'sleep'
  | 'carry'
  | 'cheer'
  | 'point'
  | 'kick'
  | 'tackle'

export type WorkerAccessory = 'none' | 'clipboard' | 'wrench' | 'headset' | 'whistle' | 'mug' | 'tablet'

export interface WorkerLook {
  helmet: string
  vest: string
  shirt: string
  pants: string
  skin: string
  boots: string
  accessory: WorkerAccessory
  /** Optional reflective stripe color on the vest. */
  stripe: string
}

export const DEFAULT_LOOK: WorkerLook = {
  helmet: PALETTE.hazard,
  vest: PALETTE.safety,
  shirt: '#4b5b66',
  pants: '#2f3b44',
  skin: '#c99a76',
  boots: '#3a2a1f',
  accessory: 'none',
  stripe: '#d8dcd6',
}

type GroupProps = ThreeElements['group']

export interface WorkerModelProps extends Omit<GroupProps, 'children'> {
  look?: Partial<WorkerLook>
  anim?: WorkerAnim | (() => WorkerAnim)
  /** Ground speed in m/s (drives walk/run cadence). */
  speed?: number | (() => number)
  /** Per-instance variation seed. */
  seed?: number
  castShadow?: boolean
}

// Shared geometries (created once).
const G = {
  boot: new THREE.BoxGeometry(0.17, 0.13, 0.3),
  leg: new THREE.CapsuleGeometry(0.09, 0.46, 4, 8),
  hips: new THREE.BoxGeometry(0.38, 0.2, 0.24),
  torso: new THREE.BoxGeometry(0.44, 0.5, 0.27),
  vest: new THREE.BoxGeometry(0.47, 0.42, 0.3),
  stripe: new THREE.BoxGeometry(0.48, 0.045, 0.305),
  arm: new THREE.CapsuleGeometry(0.075, 0.36, 4, 8),
  hand: new THREE.SphereGeometry(0.075, 10, 8),
  neck: new THREE.CylinderGeometry(0.06, 0.07, 0.08, 8),
  head: new THREE.SphereGeometry(0.145, 14, 12),
  helmet: new THREE.SphereGeometry(0.18, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  brim: new THREE.CylinderGeometry(0.215, 0.215, 0.025, 18),
  clipboard: new THREE.BoxGeometry(0.2, 0.28, 0.02),
  wrench: new THREE.BoxGeometry(0.05, 0.32, 0.03),
  mug: new THREE.CylinderGeometry(0.05, 0.045, 0.1, 10),
  headset: new THREE.TorusGeometry(0.16, 0.02, 6, 16, Math.PI),
  whistle: new THREE.BoxGeometry(0.06, 0.03, 0.05),
}

interface Joints {
  root: THREE.Group
  body: THREE.Group
  hipL: THREE.Group
  hipR: THREE.Group
  shoulderL: THREE.Group
  shoulderR: THREE.Group
  head: THREE.Group
}

const TARGET = {
  hipL: 0,
  hipR: 0,
  shL: 0,
  shR: 0,
  shLz: 0,
  shRz: 0,
  bodyPitch: 0,
  bodyY: 0,
  bodyRoll: 0,
  headYaw: 0,
  rootPitch: 0,
}

function resolve<T>(v: T | (() => T) | undefined, fallback: T): T {
  if (v === undefined) return fallback
  return typeof v === 'function' ? (v as () => T)() : v
}

export function WorkerModel({ look: lookPatch, anim = 'idle', speed = 0, seed = 0, castShadow = true, ...groupProps }: WorkerModelProps) {
  const look = useMemo(() => ({ ...DEFAULT_LOOK, ...lookPatch }), [lookPatch])
  const m = useMemo(
    () => ({
      helmet: colorMat(look.helmet, 0.45, 0.15),
      vest: colorMat(look.vest, 0.7, 0.05),
      stripe: colorMat(look.stripe, 0.3, 0.6),
      shirt: colorMat(look.shirt, 0.85, 0.05),
      pants: colorMat(look.pants, 0.9, 0.05),
      skin: colorMat(look.skin, 0.8, 0),
      boots: colorMat(look.boots, 0.9, 0.05),
      prop: colorMat('#8d7a5b', 0.8, 0.1),
      metal: colorMat('#9aa3a5', 0.4, 0.8),
    }),
    [look],
  )

  const j = useRef<Partial<Joints>>({})
  const state = useRef({ phase: seed * 1.37, t: seed * 3.1, cur: { ...TARGET }, tumble: 0 })

  useFrame((_, rawDt) => {
    const J = j.current as Joints
    if (!J.root) return
    const dt = Math.min(rawDt, 0.05)
    const s = state.current
    s.t += dt
    const a = resolve(anim, 'idle')
    const v = Math.max(0, resolve(speed, 0))
    const tgt = { ...TARGET }
    let cadence = 0
    switch (a) {
      case 'walk':
      case 'run': {
        const run = a === 'run'
        cadence = run ? 2.6 + v * 0.18 : 1.4 + v * 0.35
        s.phase += dt * cadence * Math.PI * 2 * 0.5
        const amp = run ? 0.95 : 0.6
        const sw = Math.sin(s.phase)
        tgt.hipL = sw * amp
        tgt.hipR = -sw * amp
        tgt.shL = -sw * amp * 0.8
        tgt.shR = sw * amp * 0.8
        tgt.bodyPitch = run ? 0.16 : 0.04
        tgt.bodyY = Math.abs(Math.cos(s.phase)) * (run ? 0.07 : 0.035)
        break
      }
      case 'work': {
        s.phase += dt * 7
        tgt.shR = -1.6 + Math.sin(s.phase) * 0.55
        tgt.shL = -0.6
        tgt.bodyPitch = 0.12
        break
      }
      case 'wave': {
        tgt.shRz = 2.5
        tgt.shR = Math.sin(s.t * 9) * 0.35
        break
      }
      case 'point': {
        tgt.shR = -1.5
        break
      }
      case 'panic': {
        s.phase += dt * 16
        tgt.shLz = -2.4 + Math.sin(s.phase) * 0.5
        tgt.shRz = 2.4 + Math.cos(s.phase) * 0.5
        tgt.hipL = Math.sin(s.phase) * 0.7
        tgt.hipR = -Math.sin(s.phase) * 0.7
        tgt.bodyY = Math.abs(Math.sin(s.phase)) * 0.08
        tgt.headYaw = Math.sin(s.t * 6) * 0.6
        break
      }
      case 'cheer': {
        s.phase += dt * 8
        tgt.shLz = -2.6 + Math.sin(s.phase) * 0.3
        tgt.shRz = 2.6 - Math.sin(s.phase) * 0.3
        tgt.bodyY = Math.max(0, Math.sin(s.phase)) * 0.12
        break
      }
      case 'carry': {
        s.phase += dt * cadence
        tgt.shL = -1.2
        tgt.shR = -1.2
        if (v > 0.2) {
          s.phase += dt * (1.4 + v * 0.35) * Math.PI
          tgt.hipL = Math.sin(s.phase) * 0.5
          tgt.hipR = -Math.sin(s.phase) * 0.5
        }
        break
      }
      case 'kick': {
        s.phase += dt * 10
        tgt.hipR = -1.1 * Math.max(0, Math.sin(s.phase))
        tgt.shL = 0.6
        tgt.shR = -0.4
        break
      }
      case 'tackle': {
        tgt.bodyPitch = 1.1
        tgt.shL = -2.6
        tgt.shR = -2.6
        tgt.hipL = 0.6
        tgt.hipR = -0.3
        break
      }
      case 'sit': {
        tgt.hipL = -1.45
        tgt.hipR = -1.45
        tgt.bodyY = -0.45
        tgt.shL = -0.3
        tgt.shR = -0.3
        break
      }
      case 'sleep': {
        tgt.rootPitch = -Math.PI / 2
        tgt.bodyY = 0.16
        tgt.shL = 0.1
        tgt.shR = 0.1
        break
      }
      case 'tumble':
        break
      case 'idle':
      default: {
        const fidget = Math.sin(s.t * 0.7 + seed) > 0.92
        tgt.bodyY = Math.sin(s.t * 1.8) * 0.008
        tgt.headYaw = fidget ? Math.sin(s.t * 2.3) * 0.5 : Math.sin(s.t * 0.4 + seed) * 0.12
        tgt.shL = Math.sin(s.t * 1.8) * 0.03
        tgt.shR = -Math.sin(s.t * 1.8) * 0.03
        break
      }
    }

    const k = 1 - Math.exp(-14 * dt)
    const c = s.cur
    for (const key of Object.keys(tgt) as (keyof typeof TARGET)[]) c[key] += (tgt[key] - c[key]) * k

    J.hipL.rotation.x = c.hipL
    J.hipR.rotation.x = c.hipR
    J.shoulderL.rotation.x = c.shL
    J.shoulderR.rotation.x = c.shR
    J.shoulderL.rotation.z = c.shLz
    J.shoulderR.rotation.z = c.shRz
    J.body.rotation.x = -c.bodyPitch
    J.body.position.y = c.bodyY
    J.head.rotation.y = c.headYaw

    if (a === 'tumble') {
      s.tumble += dt * 9
      J.root.rotation.x = s.tumble
      J.root.position.y = 0.55 + Math.abs(Math.sin(s.tumble * 0.5)) * 0.3
    } else {
      s.tumble = 0
      J.root.rotation.x = c.rootPitch
      J.root.position.y = 0
    }
  })

  const set = (key: keyof Joints) => (o: THREE.Group | null) => {
    if (o) (j.current as Record<string, THREE.Group>)[key] = o
  }
  const sh = castShadow

  return (
    <group {...groupProps}>
      <group ref={set('root')}>
        {/* legs pivot at hips */}
        <group ref={set('hipL')} position={[-0.11, 0.9, 0]}>
          <mesh geometry={G.leg} material={m.pants} position={[0, -0.36, 0]} castShadow={sh} />
          <mesh geometry={G.boot} material={m.boots} position={[0, -0.84, -0.04]} castShadow={sh} />
        </group>
        <group ref={set('hipR')} position={[0.11, 0.9, 0]}>
          <mesh geometry={G.leg} material={m.pants} position={[0, -0.36, 0]} castShadow={sh} />
          <mesh geometry={G.boot} material={m.boots} position={[0, -0.84, -0.04]} castShadow={sh} />
        </group>
        <group ref={set('body')}>
          <mesh geometry={G.hips} material={m.pants} position={[0, 0.95, 0]} castShadow={sh} />
          <mesh geometry={G.torso} material={m.shirt} position={[0, 1.27, 0]} castShadow={sh} />
          <mesh geometry={G.vest} material={m.vest} position={[0, 1.25, 0]} castShadow={sh} />
          <mesh geometry={G.stripe} material={m.stripe} position={[0, 1.18, 0]} />
          <mesh geometry={G.stripe} material={m.stripe} position={[0, 1.33, 0]} />
          {/* arms pivot at shoulders */}
          <group ref={set('shoulderL')} position={[-0.29, 1.47, 0]}>
            <mesh geometry={G.arm} material={m.shirt} position={[0, -0.24, 0]} castShadow={sh} />
            <mesh geometry={G.hand} material={m.skin} position={[0, -0.5, 0]} />
            {look.accessory === 'clipboard' && <mesh geometry={G.clipboard} material={m.prop} position={[0, -0.52, -0.1]} rotation={[0.4, 0, 0]} />}
            {look.accessory === 'tablet' && <mesh geometry={G.clipboard} material={m.metal} position={[0, -0.52, -0.1]} rotation={[0.4, 0, 0]} />}
          </group>
          <group ref={set('shoulderR')} position={[0.29, 1.47, 0]}>
            <mesh geometry={G.arm} material={m.shirt} position={[0, -0.24, 0]} castShadow={sh} />
            <mesh geometry={G.hand} material={m.skin} position={[0, -0.5, 0]} />
            {look.accessory === 'wrench' && <mesh geometry={G.wrench} material={m.metal} position={[0, -0.6, -0.04]} />}
            {look.accessory === 'mug' && <mesh geometry={G.mug} material={m.helmet} position={[0, -0.55, -0.06]} />}
          </group>
          <mesh geometry={G.neck} material={m.skin} position={[0, 1.58, 0]} />
          <group ref={set('head')} position={[0, 1.7, 0]}>
            <mesh geometry={G.head} material={m.skin} castShadow={sh} />
            <mesh geometry={G.helmet} material={m.helmet} position={[0, 0.03, 0]} castShadow={sh} />
            <mesh geometry={G.brim} material={m.helmet} position={[0, 0.035, -0.02]} />
            {look.accessory === 'headset' && <mesh geometry={G.headset} material={m.metal} position={[0, 0.02, 0]} rotation={[0, Math.PI / 2, 0]} />}
            {look.accessory === 'whistle' && <mesh geometry={G.whistle} material={m.metal} position={[0, -0.2, -0.16]} />}
          </group>
        </group>
      </group>
    </group>
  )
}

export default WorkerModel
