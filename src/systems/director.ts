import { simClock } from '@/core/clock'

/**
 * Event director — humor pacing & mutual exclusion for ambient gags and
 * disruptive events (spec §8 "Humor pacing").
 *
 *  - 'ambient'    : small optional gags (NPC naps, soot puff). Per-id cooldown +
 *                   a short global gap so jokes don't pile up. Suppressed while the
 *                   visitor reads a panel or when ambient events are disabled.
 *  - 'disruptive' : involuntary events that grab attention (PA blare, forklift
 *                   standoff near the player). At most ONE active at a time, long
 *                   global cooldown, suppressed while reading.
 *  - 'player'     : triggered by the visitor's own action (OSHA tackle after
 *                   entering a restricted zone, Night Shift button). Never
 *                   suppressed by reading/settings, but still exclusive with other
 *                   active disruptive/player events.
 *
 * Usage:
 *   if (director.request({ id: 'gag:nap', kind: 'ambient', cooldown: 60, duration: 8 })) { ...start...; later director.end('gag:nap') }
 * `duration` is a safety net: the lock auto-expires even if `end` is never called.
 */
export type DirectorKind = 'ambient' | 'disruptive' | 'player'

export interface DirectorRequest {
  id: string
  kind: DirectorKind
  /** Seconds before this same id may run again (measured from start). */
  cooldown: number
  /** Expected duration in seconds; lock auto-releases after this. */
  duration: number
  /** Debug/test override: ignore cooldowns and suppression (still records). */
  force?: boolean
}

interface ActiveEntry {
  id: string
  kind: DirectorKind
  until: number
}

export interface DirectorConfig {
  /** Min seconds between two ambient gags anywhere. */
  ambientGap: number
  /** Min seconds between two involuntary disruptive events. */
  disruptiveGap: number
  /** Max simultaneously running ambient gags. */
  maxAmbient: number
}

export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
  ambientGap: 6,
  disruptiveGap: 75,
  maxAmbient: 2,
}

export class Director {
  config: DirectorConfig
  private lastStart = new Map<string, number>()
  private active = new Map<string, ActiveEntry>()
  private lastAmbientAt = -Infinity
  private lastDisruptiveAt = -Infinity
  private suppressors: Array<() => boolean> = []
  private enabledFn: () => boolean = () => true
  private now: () => number

  constructor(now: () => number = () => simClock.t, config: DirectorConfig = DEFAULT_DIRECTOR_CONFIG) {
    this.now = now
    this.config = { ...config }
  }

  /** Register a predicate that, when true, suppresses involuntary events (e.g. a panel is open). */
  addSuppressor(fn: () => boolean): () => void {
    this.suppressors.push(fn)
    return () => {
      this.suppressors = this.suppressors.filter((f) => f !== fn)
    }
  }

  /** Global on/off for involuntary events (settings.ambientEvents, ?noevents=1). */
  setEnabledPredicate(fn: () => boolean): void {
    this.enabledFn = fn
  }

  private prune(t: number): void {
    for (const [id, e] of this.active) if (e.until <= t) this.active.delete(id)
  }

  isActive(id: string): boolean {
    this.prune(this.now())
    return this.active.has(id)
  }

  activeIds(): string[] {
    this.prune(this.now())
    return [...this.active.keys()]
  }

  /** Is an exclusive (disruptive or player-triggered) event running? */
  exclusiveActive(): string | null {
    this.prune(this.now())
    for (const e of this.active.values()) if (e.kind !== 'ambient') return e.id
    return null
  }

  cooldownRemaining(id: string, cooldown: number): number {
    const last = this.lastStart.get(id)
    if (last === undefined) return 0
    return Math.max(0, last + cooldown - this.now())
  }

  canStart(req: DirectorRequest): boolean {
    const t = this.now()
    this.prune(t)
    if (this.active.has(req.id)) return false
    if (req.force) return true
    if (this.cooldownRemaining(req.id, req.cooldown) > 0) return false
    const suppressed = this.suppressors.some((s) => safe(s))
    if (req.kind === 'ambient') {
      if (!this.enabledFn() || suppressed) return false
      if (t - this.lastAmbientAt < this.config.ambientGap) return false
      const ambientCount = [...this.active.values()].filter((e) => e.kind === 'ambient').length
      if (ambientCount >= this.config.maxAmbient) return false
      return true
    }
    if (req.kind === 'disruptive') {
      if (!this.enabledFn() || suppressed) return false
      if (t - this.lastDisruptiveAt < this.config.disruptiveGap) return false
      return this.exclusiveActive() === null
    }
    // 'player'
    return this.exclusiveActive() === null
  }

  request(req: DirectorRequest): boolean {
    if (!this.canStart(req)) return false
    const t = this.now()
    this.lastStart.set(req.id, t)
    this.active.set(req.id, { id: req.id, kind: req.kind, until: t + Math.max(0.1, req.duration) })
    if (req.kind === 'ambient') this.lastAmbientAt = t
    else if (req.kind === 'disruptive') this.lastDisruptiveAt = t
    return true
  }

  end(id: string): void {
    this.active.delete(id)
  }

  /** Test helper. */
  reset(): void {
    this.lastStart.clear()
    this.active.clear()
    this.lastAmbientAt = -Infinity
    this.lastDisruptiveAt = -Infinity
  }
}

function safe(fn: () => boolean): boolean {
  try {
    return fn()
  } catch {
    return false
  }
}

/** The app-wide director instance. */
export const director = new Director()
