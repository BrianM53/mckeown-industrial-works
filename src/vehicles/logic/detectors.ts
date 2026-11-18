/**
 * Small timing state machines for the forklift (unit-tested):
 *  - OverturnDetector: body up·Y below a threshold for long enough → overturned;
 *    back above a (higher) threshold for a moment → righted (hysteresis).
 *  - StuckDetector: throttle held but barely moving for long enough → stuck.
 */
import { RECOVERY } from '../constants'

export type OverturnEvent = 'overturned' | 'righted' | null

export class OverturnDetector {
  overturned = false
  private lowFor = 0
  private highFor = 0

  constructor(
    private readonly cfg: { overturnUp: number; overturnAfter: number; rightedUp: number; rightedAfter: number } = RECOVERY,
  ) {}

  update(dt: number, upDot: number): OverturnEvent {
    if (!(dt > 0)) return null
    const up = Number.isFinite(upDot) ? upDot : -1
    if (!this.overturned) {
      this.lowFor = up < this.cfg.overturnUp ? this.lowFor + dt : 0
      if (this.lowFor >= this.cfg.overturnAfter) {
        this.overturned = true
        this.highFor = 0
        return 'overturned'
      }
      return null
    }
    this.highFor = up > this.cfg.rightedUp ? this.highFor + dt : 0
    if (this.highFor >= this.cfg.rightedAfter) {
      this.overturned = false
      this.lowFor = 0
      return 'righted'
    }
    return null
  }

  /** Seconds the body has been tipped past the threshold (before declaring overturned). */
  get tippedFor(): number {
    return this.lowFor
  }

  reset(): void {
    this.overturned = false
    this.lowFor = 0
    this.highFor = 0
  }
}

export type StuckEvent = 'stuck' | 'free' | null

export class StuckDetector {
  stuck = false
  private slowFor = 0
  private freeFor = 0
  private releasedFor = 0

  constructor(private readonly cfg: { stuckSpeed: number; stuckAfter: number } = RECOVERY) {}

  /**
   * @param throttleHeld the driver is pressing W or S (or the stick)
   * @param speed actual planar speed (m/s, unsigned)
   */
  update(dt: number, throttleHeld: boolean, speed: number): StuckEvent {
    if (!(dt > 0)) return null
    const sp = Number.isFinite(speed) ? Math.abs(speed) : 0
    if (!this.stuck) {
      this.slowFor = throttleHeld && sp < this.cfg.stuckSpeed ? this.slowFor + dt : 0
      if (this.slowFor >= this.cfg.stuckAfter) {
        this.stuck = true
        this.freeFor = 0
        this.releasedFor = 0
        return 'stuck'
      }
      return null
    }
    // clear once we move again, or the driver gave up pressing for a while
    this.freeFor = sp > this.cfg.stuckSpeed * 2.5 ? this.freeFor + dt : 0
    this.releasedFor = throttleHeld ? 0 : this.releasedFor + dt
    if (this.freeFor >= 0.3 || this.releasedFor >= 2.5) {
      this.stuck = false
      this.slowFor = 0
      return 'free'
    }
    return null
  }

  reset(): void {
    this.stuck = false
    this.slowFor = 0
    this.freeFor = 0
    this.releasedFor = 0
  }
}
