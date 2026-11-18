/**
 * Row-Pergfect test rig model (pure, unit-tested). A crash-test dummy rows
 * badly; each stroke may carry one of the form errors the real Row-Pergfect
 * handle flags (projects.ts: pulling left or right, rushing the arms back,
 * pausing mid-stroke). The matching lamp lights the moment the error shows,
 * and the form gauge swings toward BAD; clean strokes swing it back to GOOD.
 */
import { createRng, type Rng } from '@/core/rng'

export type FormError = 'left' | 'right' | 'rush' | 'pause'
/** Lamp order on the panel (visitor's left → right). */
export const LAMP_ORDER: FormError[] = ['left', 'right', 'rush', 'pause']

export interface RowPose {
  /** 0 = catch (seat forward, knees up) … 1 = finish (legs straight). */
  seat: number
  /** -1 = leaning forward … +1 = leaning back. */
  body: number
  /** 0 = arms straight … 1 = handle pulled in to the ribs. */
  arms: number
  /** -1 … 1 lateral drift of handle and torso (rower's left = -1). */
  drift: number
  lamps: Record<FormError, number>
  /** Smoothed form score: 1 = GOOD, 0 = BAD. */
  score: number
  phase: 'drive' | 'pause' | 'recovery'
  /** Flywheel spin speed (rad/s), driven by the stroke. */
  flywheel: number
  stroke: number
  error: FormError | null
}

export const STROKE = { drive: 0.95, recovery: 1.55, rushRecovery: 0.85, pauseAt: 0.42, pauseFor: 0.95, lampDecay: 1.5 }

const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function pickError(rng: Rng): FormError | null {
  const r = rng()
  if (r < 0.28) return null
  if (r < 0.5) return 'rush'
  if (r < 0.66) return 'pause'
  if (r < 0.83) return 'left'
  return 'right'
}

export class RowingModel {
  private rng: Rng
  private phaseT = 0
  private pauseLeft = 0
  private detected = false
  readonly pose: RowPose

  constructor(seed = 62) {
    this.rng = createRng(seed)
    this.pose = {
      seat: 0,
      body: -1,
      arms: 0,
      drift: 0,
      lamps: { left: 0, right: 0, rush: 0, pause: 0 },
      score: 0.6,
      phase: 'drive',
      flywheel: 0,
      stroke: 0,
      error: null,
    }
    this.pose.error = pickError(this.rng)
  }

  /** Force the next stroke's error (debug / tests). */
  forceNext: FormError | null | undefined = undefined

  private light(e: FormError): void {
    this.pose.lamps[e] = 1
  }

  update(dt: number): RowPose {
    const p = this.pose
    const step = Math.min(Math.max(dt, 0), 0.1)
    // lamps fade
    for (const k of LAMP_ORDER) p.lamps[k] = Math.max(0, p.lamps[k] - step / STROKE.lampDecay)
    let target = p.score
    if (p.phase === 'pause') {
      this.pauseLeft -= step
      p.lamps.pause = 1
      p.flywheel *= Math.exp(-step * 1.5)
      if (this.pauseLeft <= 0) p.phase = 'drive'
      p.score += (0.08 - p.score) * (1 - Math.exp(-step * 3))
      return p
    }
    this.phaseT += step
    if (p.phase === 'drive') {
      const x = Math.min(1, this.phaseT / STROKE.drive)
      const rush = p.error === 'rush'
      p.seat = ss(0, 0.62, x)
      p.body = -1 + 2 * ss(0.32, 0.82, x)
      p.arms = rush ? ss(0.04, 0.42, x) : ss(0.6, 1, x)
      const side = p.error === 'left' ? -1 : p.error === 'right' ? 1 : 0
      p.drift = side * Math.sin(Math.PI * x) * 0.9
      p.flywheel = 6 + 22 * Math.sin(Math.PI * Math.min(1, x * 1.1))
      if (!this.detected) {
        if (rush && x > 0.16) this.detect('rush')
        else if ((p.error === 'left' || p.error === 'right') && x > 0.38) this.detect(p.error)
        else if (p.error === 'pause' && x >= STROKE.pauseAt) {
          this.detect('pause')
          p.phase = 'pause'
          this.pauseLeft = STROKE.pauseFor
          return p
        }
      }
      if (x >= 1) {
        p.phase = 'recovery'
        this.phaseT = 0
        if (!p.error) target = 0.95
      }
    } else {
      const dur = p.error === 'rush' ? STROKE.rushRecovery : STROKE.recovery
      const x = Math.min(1, this.phaseT / dur)
      p.arms = 1 - ss(0, 0.3, x)
      p.body = 1 - 2 * ss(0.12, 0.5, x)
      p.seat = 1 - ss(0.4, 1, x)
      p.drift *= Math.exp(-step * 6)
      p.flywheel = Math.max(4, p.flywheel * Math.exp(-step * 0.9))
      if (x >= 1) this.nextStroke()
    }
    if (this.detected && p.error) target = 0.06
    p.score += (target - p.score) * (1 - Math.exp(-step * 2.6))
    return p
  }

  private detect(e: FormError): void {
    this.detected = true
    this.light(e)
  }

  private nextStroke(): void {
    const p = this.pose
    p.stroke++
    p.phase = 'drive'
    this.phaseT = 0
    this.detected = false
    p.error = this.forceNext !== undefined ? this.forceNext : pickError(this.rng)
    this.forceNext = undefined
  }
}

/** Gauge needle angle (rad about the dial normal): GOOD = -1.05 (viewer's left), BAD = +1.05. */
export function needleAngle(score: number): number {
  const s = Math.min(1, Math.max(0, score))
  return 1.05 - 2.1 * s
}
