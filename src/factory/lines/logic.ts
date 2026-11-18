/**
 * Pure animation / gameplay logic for the production spine (no three.js, no
 * React) — unit-tested in logic.test.ts. Every machine pose is a function of
 * the factory sim's line state (phase, cycles, rate) so visuals stay in sync
 * with the simulation and the audio module (press thump at phase 0.5).
 */
import type { LineId } from '@/core/types'
import { COLLECTOR_CFG, ELEVATOR, BELT, ITEM_STAGES, MONORAIL, REJECT, type ItemKind } from './config'

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

/** 0..1 progress of x through [a, b]. */
export const seg = (x: number, a: number, b: number): number => clamp01((x - a) / (b - a))

export function smooth(x: number): number {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}

export function easeInOut(x: number): number {
  const t = clamp01(x)
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function easeOut(x: number): number {
  const t = clamp01(x)
  return 1 - (1 - t) * (1 - t)
}

export const frac = (x: number): number => x - Math.floor(x)

/** Deterministic hash → [0, 1) from up to three integers/floats (stable per item / per machine). */
export function hash01(a: number, b = 0, c = 0): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b)
  h = Math.imul(h ^ ((b | 0) + 0x7f4a7c15), 0xc2b2ae35)
  h = Math.imul(h ^ ((c | 0) + 0x165667b1), 0x27d4eb2f)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

/**
 * Continuous machine-cycle counter (cycles + phase) that never steps backwards
 * while the machine waits: the sim parks phase at 0 with `rate` 0 until the
 * finished part fits on the belt, so a waiting machine reads as "cycle done".
 */
export function lineU(line: { cycles: number; phase: number; rate: number }): number {
  const c = Number.isFinite(line.cycles) ? line.cycles : 0
  const p = Number.isFinite(line.phase) ? line.phase : 0
  return c + (line.rate > 0 ? p : 1)
}

/** Did a 0..1 cycle phase move across `mark` between two samples (handles the 1 → 0 wrap)? */
export function phaseCrossed(prev: number, cur: number, mark: number): boolean {
  if (!Number.isFinite(prev) || !Number.isFinite(cur)) return false
  if (cur >= prev) return prev < mark && cur >= mark
  return prev < mark || cur >= mark
}

// ---------------------------------------------------------------------------
// Machine motion curves (phase → pose)
// ---------------------------------------------------------------------------

/**
 * Stamping press ram travel: 0 = fully raised, 1 = dies closed. Accelerates
 * down and hits bottom EXACTLY at phase 0.5 (the audio module's thump), dwells,
 * then retracts.
 */
export function pressRam(phase: number): number {
  const p = frac(phase)
  if (p < 0.2) return 0
  if (p < 0.5) {
    const k = (p - 0.2) / 0.3
    return k * k * k
  }
  if (p < 0.6) return 1
  if (p < 0.88) return 1 - easeInOut((p - 0.6) / 0.28)
  return 0
}

/** Ore skip hoist over 4 machine cycles: lift (0..1 up the track) and tip (0..1). */
export function skipHoist(u: number): { lift: number; tip: number } {
  const f = frac(u / 4)
  const up = easeInOut(seg(f, 0.04, 0.36))
  const down = easeInOut(seg(f, 0.58, 0.9))
  const tip = smooth(seg(f, 0.38, 0.45)) * (1 - smooth(seg(f, 0.5, 0.56)))
  return { lift: up * (1 - down), tip }
}

/** Molten pour stream intensity (0..1) — pours while the next ingot is cast. */
export function pourFlow(phase: number): number {
  const p = frac(phase)
  return smooth(seg(p, 0.55, 0.64)) * (1 - smooth(seg(p, 0.9, 0.98)))
}

/** Pipe bender arm swing (0..1 of a 90° bend). Clamp closes at 0.3 (the audio clank). */
export function benderSwing(phase: number): number {
  const p = frac(phase)
  return easeInOut(seg(p, 0.32, 0.56)) * (1 - easeInOut(seg(p, 0.66, 0.92)))
}

/** Lathe tool feed (0..1 along the workpiece) and whether it is cutting. */
export function latheFeed(phase: number): { feed: number; cutting: boolean } {
  const p = frac(phase)
  if (p < 0.08) return { feed: 0, cutting: false }
  if (p < 0.72) return { feed: (p - 0.08) / 0.64, cutting: true }
  return { feed: 1 - easeInOut((p - 0.72) / 0.2), cutting: false }
}

/** Strapping head (0 = up, 1 = down on the bundle). */
export function strapperHead(phase: number): number {
  const p = frac(phase)
  return easeInOut(seg(p, 0.7, 0.8)) * (1 - easeInOut(seg(p, 0.86, 0.95)))
}

/** Bed-of-nails test head on the circuit line (0 = up, 1 = pressed on the board). */
export function testHead(phase: number): number {
  const p = frac(phase)
  return easeInOut(seg(p, 0.42, 0.52)) * (1 - easeInOut(seg(p, 0.68, 0.78)))
}

/** Plate-roller curl (0 = flat sheet, 1 = closed shell) — resets when the shell is ejected at the wrap. */
export function sheetCurl(phase: number): number {
  return easeInOut(seg(frac(phase), 0.06, 0.82))
}

/** Seam welder: progress along the seam (0..1), torch lift (0 = on the work) and whether the arc is lit. */
export function weldSeam(phase: number): { s: number; lift: number; arc: boolean } {
  const p = frac(phase)
  if (p < 0.1) return { s: 0, lift: 1 - easeInOut(p / 0.1), arc: false }
  if (p < 0.7) return { s: (p - 0.1) / 0.6, lift: 0, arc: true }
  if (p < 0.78) return { s: 1, lift: easeInOut((p - 0.7) / 0.08), arc: false }
  return { s: 1 - easeInOut((p - 0.78) / 0.22), lift: 1, arc: false }
}

/** Circumferential cap weld: angle progress (0..1) and arc on/off. */
export function weldCap(phase: number): { s: number; lift: number; arc: boolean } {
  const p = frac(phase)
  if (p < 0.25) return { s: 0, lift: 1 - easeInOut(seg(p, 0.12, 0.25)), arc: false }
  if (p < 0.8) return { s: (p - 0.25) / 0.55, lift: 0, arc: true }
  if (p < 0.88) return { s: 1, lift: easeInOut((p - 0.8) / 0.08), arc: false }
  return { s: 1 - easeInOut((p - 0.88) / 0.12), lift: 1, arc: false }
}

/** Pressure-test gauge reading 0..1 (0.8+ is the red zone). */
export function gaugePressure(phase: number): number {
  const p = frac(phase)
  const rise = easeOut(seg(p, 0.08, 0.5)) * 0.7
  const hold = p >= 0.5 && p < 0.78 ? 0.02 * Math.sin(p * 90) : 0
  const release = easeInOut(seg(p, 0.78, 0.94))
  return clamp01((rise + hold) * (1 - release))
}

/** Valve-robot tool target: forward (toward the belt) and right (toward the valve bin) offsets from the base, world height `u`. */
export interface ToolPose {
  f: number
  u: number
  r: number
  holding: boolean
}

const VR_BIN: readonly number[] = [0.02, 0.95, 1.5]
const VR_BIN_UP: readonly number[] = [0.12, 1.7, 1.3]
const VR_BELT_UP: readonly number[] = [1.3, 1.85, 0]
const VR_BELT: readonly number[] = [1.3, 1.24, 0]
const VR_PARK: readonly number[] = [0.7, 2.15, 0.45]

/**
 * Valve robot pick-and-place: reach into the valve bin, lift, swing over the
 * belt, place the wheel, retract to park. Holding while carrying a wheel.
 */
export function valveRobot(phase: number, out: ToolPose): ToolPose {
  const p = frac(phase)
  // (plain assignments: this runs every frame, no temporary arrays)
  let a = VR_PARK
  let b = VR_PARK
  let k = 0
  if (p < 0.12) {
    b = VR_BIN_UP
    k = easeInOut(p / 0.12)
  } else if (p < 0.2) {
    a = VR_BIN_UP
    b = VR_BIN
    k = easeInOut((p - 0.12) / 0.08)
  } else if (p < 0.28) {
    a = VR_BIN
    b = VR_BIN_UP
    k = easeInOut((p - 0.2) / 0.08)
  } else if (p < 0.48) {
    a = VR_BIN_UP
    b = VR_BELT_UP
    k = easeInOut((p - 0.28) / 0.2)
  } else if (p < 0.58) {
    a = VR_BELT_UP
    b = VR_BELT
    k = easeInOut((p - 0.48) / 0.1)
  } else if (p < 0.66) {
    a = VR_BELT
    b = VR_BELT_UP
    k = easeInOut((p - 0.58) / 0.08)
  } else if (p < 0.86) {
    a = VR_BELT_UP
    k = easeInOut((p - 0.66) / 0.2)
  }
  out.f = a[0] + (b[0] - a[0]) * k
  out.u = a[1] + (b[1] - a[1]) * k
  out.r = a[2] + (b[2] - a[2]) * k
  out.holding = p >= 0.2 && p < 0.58
  return out
}

/**
 * Two-link planar IK (elbow up). Target is `d` forward and `h` up from the
 * shoulder pivot. Writes [upper-arm angle from vertical, elbow bend] (radians,
 * positive = leaning forward) into `out`. Unreachable targets are clamped.
 */
export function ik2(d: number, h: number, l1: number, l2: number, out: [number, number]): [number, number] {
  const minR = Math.abs(l1 - l2) + 1e-3
  const maxR = l1 + l2 - 1e-3
  if (!Number.isFinite(d) || !Number.isFinite(h)) {
    // bad target (NaN upstream): stand the arm straight up rather than poisoning the skeleton
    d = 0
    h = maxR
  }
  const r = Math.hypot(d, h)
  const rc = Math.min(maxR, Math.max(minR, r))
  const alpha = Math.atan2(d, h)
  const cosB = (l1 * l1 + rc * rc - l2 * l2) / (2 * l1 * rc)
  const beta = Math.acos(Math.max(-1, Math.min(1, cosB)))
  const cosG = (l1 * l1 + l2 * l2 - rc * rc) / (2 * l1 * l2)
  const gamma = Math.acos(Math.max(-1, Math.min(1, cosG)))
  out[0] = alpha - beta
  out[1] = Math.PI - gamma
  return out
}

/**
 * Pick-and-place gantry target for the circuit booth. Four moves per machine
 * cycle alternating feeder (pick) and board (place); positions are seeded per
 * move so the head zips around without repeating. x/z in 0..1 of the travel
 * range, dip 0..1 (nozzle down).
 */
export function gantryTarget(u: number, out: { x: number; z: number; dip: number }): { x: number; z: number; dip: number } {
  const m = u * 4
  const k = Math.floor(m)
  const f = m - k
  const pos = (i: number, axis: number): number => {
    const pick = (i & 1) === 0
    if (axis === 0) return pick ? 0.04 + hash01(i, 7) * 0.12 : 0.35 + hash01(i, 11) * 0.6
    return pick ? 0.1 + hash01(i, 13) * 0.8 : 0.15 + hash01(i, 17) * 0.7
  }
  const mv = easeInOut(seg(f, 0, 0.38))
  out.x = pos(k - 1, 0) + (pos(k, 0) - pos(k - 1, 0)) * mv
  out.z = pos(k - 1, 1) + (pos(k, 1) - pos(k - 1, 1)) * mv
  out.dip = smooth(seg(f, 0.45, 0.58)) * (1 - smooth(seg(f, 0.72, 0.86)))
  return out
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/** Which item model a part shows at belt position p (made by machine cycle `cycle`). */
export function itemKindFor(line: LineId, p: number, cycle: number): ItemKind {
  switch (line) {
    case 'smelt': {
      const s = ITEM_STAGES.smelt
      if (p < s.sheetAt) return 'ingot'
      if (p < s.panelAt) return 'sheet'
      return hash01(cycle, 3) < 0.36 ? 'fin' : 'panel'
    }
    case 'pipe': {
      const s = ITEM_STAGES.pipe
      if (p < s.elbowAt) return 'pipeStraight'
      if (p < s.valveAt) return 'pipeElbow'
      if (p < s.bundleAt) return 'pipeValve'
      return 'pipeBundle'
    }
    case 'circuit':
      return p < ITEM_STAGES.circuit.populatedAt ? 'boardBlank' : 'boardPopulated'
    case 'tank':
      return p < ITEM_STAGES.tank.fuelAt ? 'tankShell' : 'tankFuel'
    case 'payload':
      return hash01(cycle, 5) < 0.62 ? 'podCapsule' : 'podCrate'
  }
}

/**
 * Counts parts the tower took from a line since the last call. Every machine
 * cycle pushes one item and every delivery removes one, so the running total
 * delivered is `cycles - items.length`. Resyncs (returns 0) after a reset.
 */
export class DeliveryCounter {
  private last = Number.NaN

  update(cycles: number, onBelt: number): number {
    const done = cycles - onBelt
    if (!Number.isFinite(done)) return 0
    if (!Number.isFinite(this.last) || done < this.last) {
      this.last = done
      return 0
    }
    const d = done - this.last
    this.last = done
    return d
  }

  /** Total delivered at the last update (cycle id of the newest delivered part). */
  get total(): number {
    return this.last
  }
}

/** Path a delivered part takes: up the elevator, along the head bridge, onto the collector and into the tower. */
export interface TransitPath {
  pts: Array<[number, number, number]>
  /** Cumulative length at each point. */
  cum: number[]
  /** Index of the first collector point (speeds before it follow the line; after it the collector). */
  collectorFrom: number
  length: number
}

export function transitPath(lineX: number, itemLift: number): TransitPath {
  const side = Math.sign(lineX) || 1
  const y0 = BELT.top + itemLift
  const yTop = ELEVATOR.headY0 + 0.25
  const yCol = COLLECTOR_CFG.y + itemLift
  const zIn = (ELEVATOR.zMin + ELEVATOR.zMax) / 2
  const pts: Array<[number, number, number]> = [
    [lineX, y0, 2.0],
    [lineX, y0, zIn],
    [lineX, yTop, zIn],
    [lineX, yTop, 0.3],
    [lineX, yCol, COLLECTOR_CFG.z],
    [side * COLLECTOR_CFG.innerX, yCol, COLLECTOR_CFG.z],
    [side * COLLECTOR_CFG.innerX, yCol, COLLECTOR_CFG.transferZEnd],
  ]
  const cum = [0]
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]))
  }
  return { pts, cum, collectorFrom: 4, length: cum[cum.length - 1] }
}

/** Point at distance s along a transit path → writes [x, y, z, heading(0 = along -z, 1 = along x)]. */
export function samplePath(path: TransitPath, s: number, out: [number, number, number, number]): [number, number, number, number] {
  const { pts, cum } = path
  let i = 1
  while (i < pts.length - 1 && cum[i] < s) i++
  const a = pts[i - 1]
  const b = pts[i]
  const len = cum[i] - cum[i - 1]
  const k = len > 1e-6 ? clamp01((s - cum[i - 1]) / len) : 1
  out[0] = a[0] + (b[0] - a[0]) * k
  out[1] = a[1] + (b[1] - a[1]) * k
  out[2] = a[2] + (b[2] - a[2]) * k
  out[3] = Math.abs(b[0] - a[0]) > Math.abs(b[2] - a[2]) ? 1 : 0
  return out
}

// ---------------------------------------------------------------------------
// QC arch: visitor detection + rejected payload pod trajectory
// ---------------------------------------------------------------------------

export interface QcStep {
  /** The visitor crossed the scanner plane inside the opening this step. */
  pass: boolean
  /** Play the scanner beep (rate limited). */
  beep: boolean
  /** Show the big toast (at most once per toastGap; commit with commitToast). */
  toast: boolean
}

/**
 * Detects the visitor walking through the QC arch: the feet position crossing
 * the arch plane z within |x| < halfW. Teleports / fast travel (large jumps)
 * never count. Toasts are rate limited (default once per 60 s).
 */
export class QcArchMonitor {
  private prevX = Number.NaN
  private prevZ = Number.NaN
  private lastBeep = -Infinity
  private lastToast = -Infinity
  private prevSeq = Number.NaN
  readonly result: QcStep = { pass: false, beep: false, toast: false }

  constructor(
    private readonly planeZ: number,
    private readonly halfW: number,
    private readonly opts: { beepGap?: number; toastGap?: number; maxStep?: number } = {},
  ) {}

  /**
   * `teleportSeq` (runtime.player.teleportSeq, bumped by the player module on every discontinuous
   * move: fast travel, respawn, debug teleport): a frame whose sequence changed is never a walk.
   * `maxStep` stays as a sanity bound for callers without a sequence (generous: low-fps frames).
   */
  step(x: number, z: number, onFoot: boolean, now: number, teleportSeq?: number): QcStep {
    const r = this.result
    r.pass = r.beep = r.toast = false
    const px = this.prevX
    const pz = this.prevZ
    this.prevX = x
    this.prevZ = z
    const seqChanged = teleportSeq !== undefined && teleportSeq !== this.prevSeq
    if (teleportSeq !== undefined) this.prevSeq = teleportSeq
    if (seqChanged) return r
    if (!onFoot || !Number.isFinite(px) || !Number.isFinite(pz) || !Number.isFinite(x) || !Number.isFinite(z)) return r
    const maxStep = this.opts.maxStep ?? 1.5
    if (Math.abs(z - pz) > maxStep || Math.abs(x - px) > maxStep) return r
    const a = pz - this.planeZ
    const b = z - this.planeZ
    if (a === 0 || (a > 0 && b > 0) || (a < 0 && b < 0)) return r
    const k = a / (a - b)
    const xc = px + (x - px) * k
    if (Math.abs(xc) >= this.halfW) return r
    r.pass = true
    if (now - this.lastBeep >= (this.opts.beepGap ?? 1.2)) {
      r.beep = true
      this.lastBeep = now
    }
    r.toast = now - this.lastToast >= (this.opts.toastGap ?? 60)
    return r
  }

  commitToast(now: number): void {
    this.lastToast = now
  }

  reset(): void {
    this.prevX = this.prevZ = Number.NaN
    this.prevSeq = Number.NaN
  }
}

export interface RejectPose {
  x: number
  y: number
  z: number
  rx: number
  rz: number
}

/** Seconds of the reject animation; the 'boing' plays on landing. */
export const REJECT_TIMES = { release: 0.42, slide: 1.05, land: 1.5, settle: 1.95 } as const

/** Rest position of the n-th pod in the reject bin (center of the pod body). */
const REJECT_SLOTS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [0, 0, 0, 0.08, -0.12],
  [-0.42, 0.02, 0.38, -0.2, 0.15],
  [0.32, 0.04, -0.38, 0.35, 0.05],
  [-0.12, 0.42, -0.02, 1.2, 0.3],
]
const restTmp: RejectPose = { x: 0, y: 0, z: 0, rx: 0, rz: 0 }

export function rejectSlot(n: number, out: RejectPose): RejectPose {
  const SLOTS = REJECT_SLOTS
  const s = SLOTS[((n % SLOTS.length) + SLOTS.length) % SLOTS.length]
  out.x = REJECT.rest[0] + s[0]
  out.y = REJECT.rest[1] + s[1]
  out.z = REJECT.rest[2] + s[2]
  out.rx = s[3]
  out.rz = s[4]
  return out
}

/**
 * Rejected pod trajectory: released under the scanner ring (`fromY` = pod
 * center on the rail), falls onto the chute, slides, flies into the bin and
 * bounces into its slot. Returns true once settled.
 */
export function rejectPose(t: number, fromY: number, fromZ: number, slot: number, out: RejectPose): boolean {
  const T = REJECT_TIMES
  const [ax, ay, az] = REJECT.chuteA
  const [bx, by, bz] = REJECT.chuteB
  const lift = 0.5 // pod center above the chute surface
  const x0 = MONORAIL.x
  if (t <= 0) {
    out.x = x0
    out.y = fromY
    out.z = fromZ
    out.rx = out.rz = 0
    return false
  }
  if (t < T.release) {
    const k = t / T.release
    out.x = x0 + (ax - x0) * k * k
    out.y = fromY + (ay + lift - fromY) * k * k
    out.z = fromZ + (az - fromZ) * k
    out.rx = 0
    out.rz = -0.6 * k
    return false
  }
  if (t < T.slide) {
    const k = Math.pow((t - T.release) / (T.slide - T.release), 1.5)
    out.x = ax + (bx - ax) * k
    out.y = ay + lift + (by - ay) * k
    out.z = az + (bz - az) * k
    out.rx = 0.4 * k
    out.rz = -0.6 - 2.2 * k
    return false
  }
  const rest = rejectSlot(slot, restTmp)
  if (t < T.land) {
    const k = (t - T.slide) / (T.land - T.slide)
    out.x = bx + (rest.x - bx) * k
    out.z = bz + (rest.z - bz) * k
    out.y = by + lift + (rest.y - by - lift) * k + 0.8 * Math.sin(Math.PI * k)
    out.rx = 0.4 + 2.6 * k
    out.rz = -2.8 - 2.4 * k
    return false
  }
  if (t < T.settle) {
    const k = (t - T.land) / (T.settle - T.land)
    out.x = rest.x
    out.z = rest.z
    out.y = rest.y + 0.32 * Math.abs(Math.sin(Math.PI * 2 * k)) * (1 - k)
    out.rx = rest.rx + (1 - k) * 0.5
    out.rz = rest.rz - (1 - k) * 0.4
    return false
  }
  out.x = rest.x
  out.y = rest.y
  out.z = rest.z
  out.rx = rest.rx
  out.rz = rest.rz
  return true
}
