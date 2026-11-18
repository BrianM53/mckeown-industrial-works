/**
 * Gag toolkit (pure): keyframe tracks for actor choreography, the shared prop
 * state written by gag timelines (read by the prop renderers), effect cues, and
 * the robot-arm kinematics. No three.js / React here.
 */
import { clamp, wrapAngle, yawFromDirection } from '@/core/math'
import type { SfxName, Vec2, Vec3 } from '@/core/types'
import type { WorkerAnim } from '@/world/WorkerModel'
import { JACK_A, JACK_B, NAP_CONVEYOR, ROBOT_ARM } from './propsData'
import type { ActorPose } from './types'

// ---------------------------------------------------------------------------
// Easing helpers
// ---------------------------------------------------------------------------

/** Normalized progress of t through [t0, t1] (clamped). */
export function span(t: number, t0: number, t1: number): number {
  return t1 <= t0 ? (t >= t1 ? 1 : 0) : clamp((t - t0) / (t1 - t0), 0, 1)
}
export function ease(u: number): number {
  return u * u * (3 - 2 * u)
}
export function easeOut(u: number): number {
  return 1 - (1 - u) * (1 - u)
}
export function easeIn(u: number): number {
  return u * u
}
export function mix(a: number, b: number, u: number): number {
  return a + (b - a) * u
}
export function mixAngle(a: number, b: number, u: number): number {
  return a + wrapAngle(b - a) * u
}
/** True exactly once when `at` lies in (t - dt, t]. */
export function crossed(t: number, dt: number, at: number): boolean {
  return t >= at && t - dt < at
}

// ---------------------------------------------------------------------------
// Keyframe tracks
// ---------------------------------------------------------------------------

export interface Key {
  t: number
  /** Ground position at this key (linear in between = constant walking speed). */
  p?: Vec2
  y?: number
  /** Explicit facing at this key (interpolated along the shortest arc). */
  yaw?: number
  a?: WorkerAnim
  lean?: number
  soot?: number
  slime?: number
  carry?: boolean
  hide?: boolean
  /** Facing mode from this key on: 'move' faces the travel direction, 'hold' follows yaw keys. */
  face?: 'move' | 'hold'
  /** Gait speed override (m/s) from this key on (e.g. shuffling backwards); null = derived. */
  gait?: number | null
}

type NumField = 'y' | 'lean' | 'soot' | 'slime'
const LOCOMOTION = new Set<WorkerAnim>(['walk', 'run', 'carry'])

/** Samples actor poses from a list of keys. Allocation-free after construction. */
export class Track {
  readonly keys: Key[]
  private readonly pKeys: Key[]
  private readonly yawKeys: Key[]
  private readonly num: Record<NumField, Key[]>

  constructor(keys: Key[]) {
    this.keys = [...keys].sort((a, b) => a.t - b.t)
    this.pKeys = this.keys.filter((k) => k.p)
    this.yawKeys = this.keys.filter((k) => k.yaw !== undefined)
    this.num = {
      y: this.keys.filter((k) => k.y !== undefined),
      lean: this.keys.filter((k) => k.lean !== undefined),
      soot: this.keys.filter((k) => k.soot !== undefined),
      slime: this.keys.filter((k) => k.slime !== undefined),
    }
    if (!this.pKeys.length) throw new Error('[npc] track needs at least one position key')
  }

  get start(): Vec2 {
    return this.pKeys[0].p!
  }
  get end(): Vec2 {
    return this.pKeys[this.pKeys.length - 1].p!
  }
  get duration(): number {
    return this.keys[this.keys.length - 1].t
  }

  private discrete<K extends 'a' | 'carry' | 'hide' | 'face' | 'gait'>(t: number, field: K, fallback: Key[K]): Key[K] {
    let v = fallback
    for (const k of this.keys) {
      if (k.t > t) break
      if (k[field] !== undefined) v = k[field]
    }
    return v
  }

  private numeric(t: number, list: Key[], field: NumField, fallback: number): number {
    if (!list.length) return fallback
    if (t <= list[0].t) return list[0][field] as number
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i]
      const b = list[i + 1]
      if (t < b.t) return mix(a[field] as number, b[field] as number, ease(span(t, a.t, b.t)))
    }
    return list[list.length - 1][field] as number
  }

  /** Write the pose at time t into `out` (yaw is the TARGET facing). */
  sample(t: number, out: ActorPose): ActorPose {
    // position + derived speed / travel direction
    const P = this.pKeys
    let moving = false
    let dirX = 0
    let dirZ = 0
    let segSpeed = 0
    if (t <= P[0].t) {
      out.x = P[0].p![0]
      out.z = P[0].p![1]
    } else if (t >= P[P.length - 1].t) {
      out.x = P[P.length - 1].p![0]
      out.z = P[P.length - 1].p![1]
    } else {
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i]
        const b = P[i + 1]
        if (t < b.t) {
          const u = span(t, a.t, b.t)
          const dx = b.p![0] - a.p![0]
          const dz = b.p![1] - a.p![1]
          out.x = a.p![0] + dx * u
          out.z = a.p![1] + dz * u
          const d = Math.hypot(dx, dz)
          if (d > 0.05) {
            moving = true
            dirX = dx / d
            dirZ = dz / d
            segSpeed = d / Math.max(1e-3, b.t - a.t)
          }
          break
        }
      }
    }
    const anim = this.discrete(t, 'a', 'idle') as WorkerAnim
    out.anim = anim
    const gait = this.discrete(t, 'gait', null)
    out.speed = moving ? (typeof gait === 'number' ? gait : segSpeed) : 0
    const face = this.discrete(t, 'face', undefined) ?? (LOCOMOTION.has(anim) ? 'move' : 'hold')
    if (moving && face === 'move') out.yaw = yawFromDirection(dirX, dirZ)
    else if (this.yawKeys.length) {
      const Y = this.yawKeys
      if (t <= Y[0].t) out.yaw = Y[0].yaw!
      else if (t >= Y[Y.length - 1].t) out.yaw = Y[Y.length - 1].yaw!
      else
        for (let i = 0; i < Y.length - 1; i++) {
          if (t < Y[i + 1].t) {
            out.yaw = mixAngle(Y[i].yaw!, Y[i + 1].yaw!, ease(span(t, Y[i].t, Y[i + 1].t)))
            break
          }
        }
    }
    out.y = this.numeric(t, this.num.y, 'y', 0)
    out.lean = this.numeric(t, this.num.lean, 'lean', 0)
    out.soot = this.numeric(t, this.num.soot, 'soot', 0)
    out.slime = this.numeric(t, this.num.slime, 'slime', 0)
    out.carry = !!this.discrete(t, 'carry', false)
    out.hidden = !!this.discrete(t, 'hide', false)
    return out
  }
}

// ---------------------------------------------------------------------------
// Prop state (written by gag timelines, read by prop renderers)
// ---------------------------------------------------------------------------

export interface XForm {
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
}

export interface ArmAngles {
  turret: number
  shoulder: number
  elbow: number
  /** 0 = open, 1 = closed. */
  grip: number
}

export interface PropStates {
  /** Nap conveyor roller speed 0..1. */
  conveyorRun: number
  napCrate: XForm
  jackA: { x: number; z: number; yaw: number; moving: boolean }
  jackB: { x: number; z: number; yaw: number; moving: boolean }
  /** Kick machine: 0..1 sputter (jerky, smoky), 0..1 boost (spins fast, decays by itself). */
  kickSputter: number
  kickBoost: number
  /** Seconds since the last kick impact (drives a short shake), large when idle. */
  kickImpact: number
  /** Vat bubbling 0..1 (rest ≈ 0.25), splash impulse 0..1 (decays). */
  vatAgitation: number
  vatSplash: number
  /** Printer ribbon length (m) and lamp: 0 idle/green, 1 busy (amber blink), 2 jammed (red). */
  printerLength: number
  printerLamp: 0 | 1 | 2
  printerFeeding: number
  /** Robot arm: when override is false the renderer runs the idle loop and writes `armNow`. */
  armOverride: boolean
  arm: ArmAngles
  /** Current arm angles as rendered (written by the arm renderer while idle). */
  armNow: ArmAngles
  /** Phase clock of the arm's idle loop (advanced by the scheduler tick; shared by renderer + gag). */
  armClock: number
  /** Foam pile squash impulse 0..1 (decays). */
  foamSquash: number
}

export const CRATE_SIZE = { w: 0.74, h: 0.56, d: 0.8 }
/** The nap crate's resting spot (crate CENTER): on the conveyor's south (upstream) end. */
export const CRATE_REST: XForm = {
  x: NAP_CONVEYOR.pos[0],
  y: NAP_CONVEYOR.height + CRATE_SIZE.h / 2,
  z: NAP_CONVEYOR.pos[1] + NAP_CONVEYOR.length / 2 - CRATE_SIZE.d / 2 - 0.08,
  rx: 0,
  ry: 0,
  rz: 0,
}

export const ARM_IDLE_TURRET = -1.56

export function createPropStates(): PropStates {
  return {
    conveyorRun: 0,
    napCrate: { ...CRATE_REST },
    jackA: { x: JACK_A.pos[0], z: JACK_A.pos[1], yaw: JACK_A.yaw, moving: false },
    jackB: { x: JACK_B.pos[0], z: JACK_B.pos[1], yaw: JACK_B.yaw, moving: false },
    kickSputter: 0,
    kickBoost: 0,
    kickImpact: 99,
    vatAgitation: 0.25,
    vatSplash: 0,
    printerLength: 0,
    printerLamp: 0,
    printerFeeding: 0,
    armOverride: false,
    arm: { turret: ARM_IDLE_TURRET, shoulder: 0.4, elbow: 1.2, grip: 0.4 },
    armNow: { turret: ARM_IDLE_TURRET, shoulder: 0.4, elbow: 1.2, grip: 0.4 },
    armClock: 0,
    foamSquash: 0,
  }
}

/** Natural decay of impulse-style prop values (called every tick). */
export function decayProps(p: PropStates, dt: number): void {
  p.armClock += dt
  p.kickBoost = Math.max(0, p.kickBoost - dt / 4.5)
  p.kickImpact += dt
  p.vatSplash = Math.max(0, p.vatSplash - dt * 1.6)
  p.foamSquash = Math.max(0, p.foamSquash - dt * 1.2)
}

// ---------------------------------------------------------------------------
// Effects interface (implemented by the NPC world; no-op in tests)
// ---------------------------------------------------------------------------

export type PuffKind = 'soot' | 'dust' | 'slime' | 'foam' | 'smoke' | 'spark' | 'paper'

export interface GagFx {
  sfx(name: SfxName, pos: Vec3, volume?: number, rate?: number): void
  puff(kind: PuffKind, pos: Vec3, count: number, spread?: number): void
  say(npcId: string, text: string, seconds?: number): void
  /** Unlock an achievement if the visitor is within `radius` m of `pos` (Infinity = always). */
  achievement(id: string, pos: Vec3, radius: number): void
}

export const NO_FX: GagFx = {
  sfx: () => {},
  puff: () => {},
  say: () => {},
  achievement: () => {},
}

// ---------------------------------------------------------------------------
// Robot arm kinematics (pedestal at ROBOT_ARM.pos)
// ---------------------------------------------------------------------------

export const ARM = { pedestal: 0.95, shoulderY: 1.3, l1: 1.15, l2: 1.0, l3: 0.35 }

/** Gripper tip in world space for the given joint angles. */
export function armTip(a: ArmAngles, out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }) {
  const fx = -Math.sin(a.turret)
  const fz = -Math.cos(a.turret)
  const s2 = a.shoulder + a.elbow
  const L2 = ARM.l2 + ARM.l3
  const h = ARM.l1 * Math.sin(a.shoulder) + L2 * Math.sin(s2)
  const v = ARM.l1 * Math.cos(a.shoulder) + L2 * Math.cos(s2)
  out.x = ROBOT_ARM.pos[0] + fx * h
  out.z = ROBOT_ARM.pos[1] + fz * h
  out.y = ARM.shoulderY + v
  return out
}

/** Two-link IK in the arm plane: reach `h` m horizontally and `v` m above the shoulder (elbow up). */
export function armIK(h: number, v: number): { shoulder: number; elbow: number } {
  const L1 = ARM.l1
  const L2 = ARM.l2 + ARM.l3
  const d = clamp(Math.hypot(h, v), Math.abs(L1 - L2) + 0.02, L1 + L2 - 0.02)
  const inner = Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1))
  const gamma = Math.atan2(h, v)
  const alpha = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1))
  return { shoulder: gamma - alpha, elbow: Math.PI - inner }
}

/** Idle "inspection" loop of the arm (renderer and gags share it so hand-offs are seamless). */
export function armIdle(t: number, out: ArmAngles): ArmAngles {
  out.turret = ARM_IDLE_TURRET + Math.sin(t * 0.31) * 0.65
  out.shoulder = 0.42 + Math.sin(t * 0.47 + 0.6) * 0.16
  out.elbow = 1.25 + Math.sin(t * 0.41 + 1.7) * 0.22
  out.grip = 0.5 + Math.sin(t * 0.9) * 0.45
  return out
}

export function mixArm(a: ArmAngles, b: ArmAngles, u: number, out: ArmAngles): ArmAngles {
  out.turret = mixAngle(a.turret, b.turret, u)
  out.shoulder = mix(a.shoulder, b.shoulder, u)
  out.elbow = mix(a.elbow, b.elbow, u)
  out.grip = mix(a.grip, b.grip, u)
  return out
}
