/**
 * Shared gait model: the worker's leg cycle (src/world/WorkerModel.tsx) and the
 * player's footstep events use the same stride so steps line up with feet.
 */

/** Length of one full gait cycle (two footsteps) in meters at ground speed `v` (m/s). */
export function strideLength(v: number): number {
  return 1.0 + 0.24 * Math.max(0, v)
}

/** Gait cycles per second at speed `v`. */
export function gaitFrequency(v: number): number {
  const s = Math.max(0, v)
  return s / strideLength(s)
}

/**
 * Accumulates travelled distance and reports how many footsteps occurred:
 * one footstep every half stride. The first step lands after `firstStepFraction`
 * of a half stride so starting to walk is audible immediately.
 */
export class FootstepCounter {
  private acc = 0
  private started = false
  constructor(private readonly firstStepFraction = 0.35) {}

  /** Add `dist` meters travelled at `speed`; returns the number of footsteps that landed (≤ 4). */
  add(dist: number, speed: number): number {
    if (!(dist > 0) || !Number.isFinite(dist)) return 0
    const half = strideLength(speed) / 2
    if (!this.started) {
      this.started = true
      this.acc = half * (1 - this.firstStepFraction)
    }
    this.acc += dist
    let n = 0
    while (this.acc >= half && n < 4) {
      this.acc -= half
      n++
    }
    if (this.acc >= half) this.acc = 0
    return n
  }

  /** Call when the walker stops so the next start gets a prompt first step. */
  reset(): void {
    this.acc = 0
    this.started = false
  }
}
