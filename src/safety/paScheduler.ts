/**
 * PA ANNOUNCER scheduler (pure logic, ticked by simClock). Every ~90–150 s it
 * asks the director for an 'ambient' slot (suppressed while a panel/dialogue is
 * open or ambient events are disabled) and reads an implausible corporate
 * notice: 'pa:announce' (audio chimes) + a 'pa' caption.
 *
 * It stays quiet while `blocked()` (launch sequence, Night Shift) and for a
 * while after anyone else's PA line, so it never talks over the launch
 * announcer.
 */
import type { GameEventName, GameEvents } from '@/core/events'
import { createRng, type Rng } from '@/core/rng'
import type { DirectorRequest } from '@/systems/director'
import { PA, PA_LINES } from './config'

type Emit = <K extends GameEventName>(name: K, payload: GameEvents[K]) => void

export interface PaDeps {
  now: () => number
  emit: Emit
  director: { request(req: DirectorRequest): boolean }
  rng?: Rng
  /** Extra "not now" condition (launch sequence, night shift...). */
  blocked?: () => boolean
  lines?: readonly string[]
}

export const PA_DIRECTOR_ID = 'pa'

export class PaScheduler {
  /** Sim time of the next attempt. */
  nextAt: number
  /** Everything announced (debug/tests), newest last, bounded. */
  readonly history: Array<{ t: number; text: string }> = []
  private readonly deps: PaDeps
  private readonly rng: Rng
  private readonly lines: readonly string[]
  private bag: number[] = []
  private last = -1
  private lastOtherPaAt = -Infinity
  private emitting = false

  constructor(deps: PaDeps) {
    this.deps = deps
    this.rng = deps.rng ?? createRng(0x5afe7)
    this.lines = deps.lines && deps.lines.length ? deps.lines : PA_LINES
    this.nextAt = this.now() + PA.firstMin + (PA.firstMax - PA.firstMin) * this.rng()
  }

  tick(): void {
    const now = this.now()
    if (now < this.nextAt) return
    let blocked = false
    try {
      blocked = !!this.deps.blocked?.()
    } catch {
      blocked = true
    }
    if (blocked || now - this.lastOtherPaAt < PA.quietAfterOtherPa) {
      this.nextAt = now + PA.retry
      return
    }
    let ok = false
    try {
      ok = this.deps.director.request({ id: PA_DIRECTOR_ID, kind: 'ambient', cooldown: PA.cooldown, duration: PA.duration })
    } catch {
      ok = false
    }
    if (!ok) {
      this.nextAt = now + PA.retry
      return
    }
    this.announce()
    this.nextAt = now + PA.minGap + (PA.maxGap - PA.minGap) * this.rng()
  }

  /** Read the next line now (debug: bypasses the director; pushes the schedule back). */
  announce(): string {
    const text = this.nextLine()
    this.emitting = true
    try {
      this.deps.emit('pa:announce', { text })
      this.deps.emit('caption', { text, kind: 'pa', duration: PA.captionSeconds })
    } finally {
      this.emitting = false
    }
    const now = this.now()
    this.history.push({ t: now, text })
    if (this.history.length > 50) this.history.shift()
    this.nextAt = Math.max(this.nextAt, now + PA.minGap)
    return text
  }

  /** Someone else used the PA (launch announcer, night shift): keep quiet for a bit. */
  notePa(): void {
    if (this.emitting) return
    this.lastOtherPaAt = this.now()
  }

  private now(): number {
    const t = this.deps.now()
    return Number.isFinite(t) ? t : 0
  }

  /** Shuffle-bag: every line once before any repeats, never the same line twice in a row. */
  private nextLine(): string {
    if (!this.bag.length) {
      this.bag = this.lines.map((_, i) => i)
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1))
        ;[this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]]
      }
      if (this.bag.length > 1 && this.bag[this.bag.length - 1] === this.last) {
        ;[this.bag[0], this.bag[this.bag.length - 1]] = [this.bag[this.bag.length - 1], this.bag[0]]
      }
    }
    const i = this.bag.pop() ?? 0
    this.last = i
    return this.lines[i]
  }
}
