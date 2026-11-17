import { RECOVERY } from './constants'

/**
 * Pure recovery helpers (unit-tested): stuck detection and a ring buffer of
 * recent safe positions. Physics validation (overlap/ground tests) is injected
 * by the controller so these stay deterministic.
 */

export interface StuckOptions {
  window: number
  minDisplacement: number
  clearDisplacement: number
  linger: number
}

/**
 * "Movement input held but the worker isn't going anywhere."
 * Flags stuck when the displacement stays below `minDisplacement` for `window`
 * seconds of continuous input. Clears once the worker actually moves
 * `clearDisplacement` away, or `linger` seconds after input is released.
 */
export class StuckDetector {
  stuck = false
  /** Time (detector clock) when the failed movement attempt began. */
  stuckSince = 0
  private t = 0
  private timer = 0
  private idle = 0
  private ax = 0
  private az = 0
  private sx = 0
  private sz = 0
  private hasAnchor = false
  private readonly o: StuckOptions

  constructor(opts: Partial<StuckOptions> = {}) {
    this.o = {
      window: opts.window ?? RECOVERY.stuckWindow,
      minDisplacement: opts.minDisplacement ?? RECOVERY.stuckMinDisplacement,
      clearDisplacement: opts.clearDisplacement ?? RECOVERY.stuckClearDisplacement,
      linger: opts.linger ?? RECOVERY.stuckHintLinger,
    }
  }

  /** Returns the current stuck flag. */
  update(dt: number, inputActive: boolean, x: number, z: number): boolean {
    this.t += dt
    if (!Number.isFinite(x) || !Number.isFinite(z)) return this.stuck
    if (!this.hasAnchor) this.anchor(x, z)
    if (!inputActive) {
      this.timer = 0
      this.anchor(x, z)
      if (this.stuck) {
        this.idle += dt
        if (this.idle >= this.o.linger) this.stuck = false
      }
      return this.stuck
    }
    this.idle = 0
    if (this.stuck) {
      if (Math.hypot(x - this.sx, z - this.sz) >= this.o.clearDisplacement) {
        this.stuck = false
        this.timer = 0
        this.anchor(x, z)
      }
      return this.stuck
    }
    if (Math.hypot(x - this.ax, z - this.az) > this.o.minDisplacement) {
      this.timer = 0
      this.anchor(x, z)
      return false
    }
    this.timer += dt
    if (this.timer >= this.o.window) {
      this.stuck = true
      this.stuckSince = this.t - this.timer
      this.sx = x
      this.sz = z
    }
    return this.stuck
  }

  /** Detector-local clock (seconds since construction). */
  get time(): number {
    return this.t
  }

  reset(x: number, z: number): void {
    this.stuck = false
    this.timer = 0
    this.idle = 0
    this.anchor(x, z)
  }

  private anchor(x: number, z: number): void {
    this.ax = x
    this.az = z
    this.hasAnchor = true
  }
}

export interface SafePos {
  x: number
  y: number
  z: number
  yaw: number
  /** Time recorded (caller's clock). */
  t: number
}

/** Ring buffer of recent validated positions, sampled at a fixed interval. */
export class SafePositionTracker {
  private buf: SafePos[] = []
  private acc = 0

  constructor(
    readonly capacity: number = RECOVERY.safeCapacity,
    readonly interval: number = RECOVERY.safeInterval,
  ) {
    this.acc = interval // sample on the first eligible update
  }

  /**
   * Advance by `dt`; every `interval` seconds calls `sample()` and stores the
   * result when non-null. `sample` performs the (expensive) validity checks.
   */
  update(dt: number, sample: () => SafePos | null): void {
    this.acc += dt
    if (this.acc < this.interval) return
    this.acc = 0
    const p = sample()
    if (p) this.push(p)
  }

  push(p: SafePos): void {
    if (![p.x, p.y, p.z, p.yaw].every(Number.isFinite)) return
    const last = this.buf[this.buf.length - 1]
    // Standing still: refresh the newest entry instead of flooding the buffer.
    if (last && Math.hypot(last.x - p.x, last.z - p.z) < 0.3 && Math.abs(last.y - p.y) < 0.3) {
      this.buf[this.buf.length - 1] = p
      return
    }
    this.buf.push(p)
    if (this.buf.length > this.capacity) this.buf.shift()
  }

  latest(): SafePos | null {
    return this.buf.length ? this.buf[this.buf.length - 1] : null
  }

  /**
   * Candidates newest-first: at least `minDist` from (x, z) and recorded no later
   * than `before` (e.g. before the worker got stuck).
   */
  candidates(x: number, z: number, minDist = 0, before = Infinity): SafePos[] {
    const out: SafePos[] = []
    for (let i = this.buf.length - 1; i >= 0; i--) {
      const p = this.buf[i]
      if (p.t > before) continue
      if (Math.hypot(p.x - x, p.z - z) < minDist) continue
      out.push(p)
    }
    return out
  }

  get size(): number {
    return this.buf.length
  }

  clear(): void {
    this.buf = []
    this.acc = this.interval
  }
}
