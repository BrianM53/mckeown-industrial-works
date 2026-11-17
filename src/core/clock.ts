/**
 * Simulation clock. Pure-logic systems (factory sim, launch FSM, gag scheduler,
 * OSHA FSM, night shift, director) subscribe with `simClock.onTick` instead of
 * using their own timers, so tests and debug tools can fast-forward time
 * deterministically.
 *
 * The world's SimDriver calls `simClock.step(frameDelta)` once per rendered
 * frame. Real frame deltas are clamped (tab switches do not cause huge jumps).
 */
export type TickFn = (dt: number, t: number) => void

export class SimClock {
  /** Simulated seconds since start. */
  t = 0
  timeScale = 1
  paused = false
  private subs = new Set<TickFn>()

  onTick(fn: TickFn): () => void {
    this.subs.add(fn)
    return () => {
      this.subs.delete(fn)
    }
  }

  /** Advance by a real frame delta (seconds). */
  step(realDt: number): void {
    if (this.paused) return
    const dt = Math.min(Math.max(realDt, 0), 0.1) * this.timeScale
    if (dt <= 0) return
    this.tick(dt)
  }

  /** Fast-forward `seconds` of sim time in fixed sub-steps (tests/debug). */
  advance(seconds: number, stepSize = 1 / 30): void {
    let remaining = seconds
    while (remaining > 1e-9) {
      const dt = Math.min(stepSize, remaining)
      this.tick(dt)
      remaining -= dt
    }
  }

  private tick(dt: number): void {
    this.t += dt
    for (const fn of [...this.subs]) {
      try {
        fn(dt, this.t)
      } catch (err) {
        console.error('[simClock] subscriber threw', err)
      }
    }
  }

  /** Number of subscribers (leak tests). */
  get subscriberCount(): number {
    return this.subs.size
  }
}

export const simClock = new SimClock()
