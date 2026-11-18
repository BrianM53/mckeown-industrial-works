/**
 * Résumé-O-Matic 3000 print sequence (pure, unit-tested). The machine's 3D
 * component samples `poseAt(variant, t)` every frame and fires `cuesBetween`
 * for sounds / the achievement. The résumé PANEL opens immediately on
 * interaction — this sequence only plays in the world behind it.
 *
 *  normal: whir → sheet feeds onto the tray → giant stamp winds up and slams
 *          "APPROVED FOR EMPLOYMENT" → arm lifts → motors spin down. The
 *          stamped sheet stays in the output tray.
 *  shred:  (every 3rd print, director permitting) the first copy is sucked up
 *          the pneumatic tube into the shredder, THEN the real copy prints and
 *          gets stamped.
 */
export type PrintVariant = 'normal' | 'shred'

/** Every Nth print sends the first copy to the shredder. */
export const SHRED_EVERY = 3

/** `printNumber` is the 1-based count of prints this session. */
export function isShredPrint(printNumber: number): boolean {
  return Number.isInteger(printNumber) && printNumber > 0 && printNumber % SHRED_EVERY === 0
}

interface Span {
  a: number
  b: number
}

export interface Timeline {
  variant: PrintVariant
  motorUp: Span
  motorDown: Span
  decoyFeed: Span | null
  suck: Span | null
  tube: Span | null
  shred: Span | null
  keeperFeed: Span
  windup: Span
  slam: Span
  hold: Span
  lift: Span
  /** Impact moment (stamp sound, mark appears, achievement). */
  impact: number
  duration: number
}

const NORMAL_STAMP_START = 1.95
/** Extra time the shred gag inserts before the real copy is stamped. */
export const SHRED_DELAY = 3.9

export function timeline(variant: PrintVariant): Timeline {
  const d = variant === 'shred' ? SHRED_DELAY : 0
  const s = NORMAL_STAMP_START + d
  const windup = { a: s, b: s + 0.45 }
  const slam = { a: windup.b, b: windup.b + 0.18 }
  const hold = { a: slam.b, b: slam.b + 0.32 }
  const lift = { a: hold.b, b: hold.b + 0.8 }
  const motorDown = { a: lift.b - 0.1, b: lift.b + 0.5 }
  return {
    variant,
    motorUp: { a: 0, b: 0.35 },
    motorDown,
    decoyFeed: variant === 'shred' ? { a: 0.45, b: 1.85 } : null,
    suck: variant === 'shred' ? { a: 2.05, b: 2.6 } : null,
    tube: variant === 'shred' ? { a: 2.6, b: 3.45 } : null,
    shred: variant === 'shred' ? { a: 3.45, b: 4.45 } : null,
    keeperFeed: { a: 0.45 + d, b: 1.85 + d },
    windup,
    slam,
    hold,
    lift,
    impact: slam.b,
    duration: motorDown.b + 0.1,
  }
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const prog = (s: Span | null, t: number) => (s ? clamp01((t - s.a) / Math.max(1e-6, s.b - s.a)) : 0)
const easeOut = (x: number) => 1 - (1 - x) * (1 - x)
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2)
const easeInCubic = (x: number) => x * x * x

export interface PrintPose {
  /** Motor intensity 0..1 (rollers, paper roll, pistons, gauges, beacons). */
  motor: number
  /** Feed progress of the copy that gets stamped and kept (0 = in the slot, 1 = on the tray). */
  keeperFeed: number
  /** Feed progress of the decoy copy (shred variant only). */
  decoyFeed: number
  /** Decoy lifting off the tray into the suction hood (0..1). */
  suck: number
  /** Paper ball along the pneumatic tube (0..1), or -1 when not in the tube. */
  tube: number
  /** Shredder activity envelope (0..1). */
  shred: number
  /** Stamp arm: 0 = rest, negative = wind-up (raised further), 1 = impact. */
  arm: number
  /** Post-impact squash/bounce 0..1. */
  squash: number
  /** The keeper copy shows the APPROVED mark. */
  stamped: boolean
  /** Warning beacons spinning. */
  beacons: boolean
  /** Sequence finished. */
  done: boolean
}

export const WINDUP_ARM = -0.11

const TIMELINES: Record<PrintVariant, Timeline> = { normal: timeline('normal'), shred: timeline('shred') }

export function blankPose(): PrintPose {
  return { motor: 0, keeperFeed: 0, decoyFeed: 0, suck: 0, tube: -1, shred: 0, arm: 0, squash: 0, stamped: false, beacons: false, done: false }
}

/** Machine pose at sequence time t. Writes into `out` when given (no per-frame allocation). */
export function poseAt(variant: PrintVariant, t: number, out: PrintPose = blankPose()): PrintPose {
  const tl = TIMELINES[variant]
  const up = easeOut(prog(tl.motorUp, t))
  const down = prog(tl.motorDown, t)
  const motor = t < 0 ? 0 : Math.max(0, Math.min(up, 1 - down))

  let arm = 0
  if (t >= tl.windup.a && t < tl.windup.b) arm = WINDUP_ARM * easeOut(prog(tl.windup, t))
  else if (t >= tl.slam.a && t < tl.slam.b) arm = WINDUP_ARM + (1 - WINDUP_ARM) * easeInCubic(prog(tl.slam, t))
  else if (t >= tl.hold.a && t < tl.hold.b) arm = 1
  else if (t >= tl.lift.a && t < tl.lift.b) arm = 1 - easeInOut(prog(tl.lift, t))

  let squash = 0
  if (t >= tl.impact && t < tl.hold.b + 0.15) {
    const k = (t - tl.impact) / (tl.hold.b + 0.15 - tl.impact)
    squash = Math.exp(-k * 4) * Math.abs(Math.cos(k * 9))
  }

  const tubeP = tl.tube && t >= tl.tube.a && t < tl.tube.b ? easeInOut(prog(tl.tube, t)) : -1
  let shred = 0
  if (tl.shred && t >= tl.shred.a && t < tl.shred.b) {
    const k = prog(tl.shred, t)
    shred = Math.min(1, k * 8) * Math.min(1, (1 - k) * 5)
  }

  out.motor = motor
  out.keeperFeed = easeOut(prog(tl.keeperFeed, t))
  out.decoyFeed = tl.decoyFeed ? easeOut(prog(tl.decoyFeed, t)) : 0
  out.suck = tl.suck ? easeInOut(prog(tl.suck, t)) : 0
  out.tube = tubeP
  out.shred = shred
  out.arm = arm
  out.squash = squash
  out.stamped = t >= tl.impact
  out.beacons = t >= 0 && t < tl.motorDown.b
  out.done = t >= tl.duration
  return out
}

export type CueKind = 'whir' | 'whoosh' | 'shred' | 'stamp' | 'done'

export interface Cue {
  t: number
  kind: CueKind
}

/** One-shot cues (sounds, achievement) in time order. */
export function cues(variant: PrintVariant): Cue[] {
  const tl = timeline(variant)
  const out: Cue[] = []
  // printer-whir is ~0.55 s long: re-trigger it while paper feeds
  const whirFrom = (a: number) => {
    for (let k = 0; k < 3; k++) out.push({ t: a + k * 0.6, kind: 'whir' })
  }
  whirFrom(0.05)
  if (tl.suck) out.push({ t: tl.suck.a + 0.05, kind: 'whoosh' })
  if (tl.shred) out.push({ t: tl.shred.a, kind: 'shred' })
  if (variant === 'shred') whirFrom(tl.keeperFeed.a - 0.05)
  out.push({ t: tl.impact, kind: 'stamp' })
  out.push({ t: tl.duration, kind: 'done' })
  return out.sort((a, b) => a.t - b.t)
}

const cueCache: Record<PrintVariant, Cue[]> = { normal: cues('normal'), shred: cues('shred') }

/** Cues with t0 < cue.t <= t1 (call once per frame with the previous and current time). */
export function cuesBetween(variant: PrintVariant, t0: number, t1: number, out: Cue[] = []): Cue[] {
  out.length = 0
  if (!(t1 > t0)) return out
  for (const c of cueCache[variant]) if (c.t > t0 && c.t <= t1) out.push(c)
  return out
}
