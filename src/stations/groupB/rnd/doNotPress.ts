/**
 * DO NOT PRESS (spec §16 easter egg) state machine — pure, unit-tested.
 *
 *   idle ──press1──▶ rising (a SECOND, LARGER button rises from a floor hatch)
 *        ──▶ armed ──press2──▶ thanks (confetti + "THANK YOU FOR YOUR FEEDBACK")
 *   60 s after the last press: sinking ──▶ idle (everything resets)
 *
 * `update` returns animation channels (0..1) for the component; `press*`
 * return true when accepted (so the caller emits sounds / achievements once).
 */
export type DnpState = 'idle' | 'rising' | 'armed' | 'thanks' | 'sinking'

export const DNP_TIMING = { rise: 1.5, hatch: 0.35, sink: 1.3, press: 0.25, resetAfter: 60 }

export interface DnpChannels {
  /** Button 1 depression (pressed in = 1). */
  b1: number
  /** Hatch doors opening. */
  hatch: number
  /** Second pedestal rise (0 = hidden below the floor, 1 = up). */
  rise: number
  /** Button 2 depression. */
  b2: number
  /** Thank-you sign (0 = folded away, 1 = down and lit). */
  sign: number
}

export class DoNotPressMachine {
  state: DnpState = 'idle'
  /** Seconds in the current state. */
  t = 0
  /** Seconds since the most recent accepted press. */
  sinceLast = 0
  presses = 0
  private b2At = -1
  /** The thank-you sign came down this round (so it folds away on reset). */
  private thanked = false

  constructor(private resetAfter = DNP_TIMING.resetAfter) {}

  canPress1(): boolean {
    return this.state === 'idle'
  }

  canPress2(): boolean {
    return this.state === 'armed'
  }

  press1(): boolean {
    if (!this.canPress1()) return false
    this.enter('rising')
    this.sinceLast = 0
    this.presses++
    return true
  }

  press2(): boolean {
    if (!this.canPress2()) return false
    this.enter('thanks')
    this.sinceLast = 0
    this.b2At = 0
    this.thanked = true
    this.presses++
    return true
  }

  /** Debug: reset immediately. */
  reset(): void {
    this.enter('idle')
    this.sinceLast = 0
    this.b2At = -1
    this.thanked = false
  }

  private enter(s: DnpState): void {
    this.state = s
    this.t = 0
  }

  update(dt: number): DnpChannels {
    const step = Math.min(Math.max(dt, 0), 0.25)
    this.t += step
    this.sinceLast += step
    if (this.b2At >= 0) this.b2At += step
    const T = DNP_TIMING
    if (this.state === 'rising' && this.t >= T.rise) this.enter('armed')
    if ((this.state === 'rising' || this.state === 'armed' || this.state === 'thanks') && this.sinceLast >= this.resetAfter) this.enter('sinking')
    if (this.state === 'sinking' && this.t >= T.sink) {
      this.enter('idle')
      this.b2At = -1
      this.thanked = false
    }
    return this.channels()
  }

  private readonly ch: DnpChannels = { b1: 0, hatch: 0, rise: 0, b2: 0, sign: 0 }

  private set(b1: number, hatch: number, rise: number, b2: number, sign: number): DnpChannels {
    const c = this.ch
    c.b1 = b1
    c.hatch = hatch
    c.rise = rise
    c.b2 = b2
    c.sign = sign
    return c
  }

  /** Current animation channels (one reused object: copy it if you need to keep it). */
  channels(): DnpChannels {
    const T = DNP_TIMING
    const c01 = (x: number) => Math.min(1, Math.max(0, x))
    const pressCurve = (age: number) => (age < 0 ? 0 : age < T.press ? Math.sin((age / T.press) * Math.PI * 0.5) : Math.max(0.35, 1 - (age - T.press) * 2.5))
    switch (this.state) {
      case 'idle':
        return this.set(0, 0, 0, 0, 0)
      case 'rising': {
        const hatch = c01(this.t / T.hatch)
        const rise = c01((this.t - T.hatch * 0.6) / (T.rise - T.hatch * 0.6))
        return this.set(pressCurve(this.t), hatch, rise * rise * (3 - 2 * rise), 0, 0)
      }
      case 'armed':
        return this.set(0.35, 1, 1, 0, 0)
      case 'thanks':
        return this.set(0.35, 1, 1, pressCurve(this.b2At), c01((this.t - 0.25) / 0.6))
      case 'sinking': {
        const k = c01(this.t / T.sink)
        return this.set(0.35 * (1 - k), 1 - c01((k - 0.75) / 0.25), 1 - c01(k / 0.8), 0, this.thanked ? Math.max(0, 1 - k * 2.2) : 0)
      }
    }
  }
}
