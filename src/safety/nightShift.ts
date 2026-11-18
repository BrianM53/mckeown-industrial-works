/**
 * NIGHT SHIFT blackout FSM (pure logic, ticked by simClock).
 *
 *   idle ──start()──► powerDown (2 s: lights stutter and fade 1 → 0.12; reduced
 *   motion: one gentle 3 s fade) ──► blackout (12 s: red emergency beacons, PA
 *   "Remain calm…") ──► restore (2 s: lights stutter back; reduced: gentle 3 s
 *   fade) ──► cooldown (45 s, button lamp blinks) ──► idle
 *
 * Sole writer of runtime.lighting (passed in as `lighting`). HARD GUARANTEES:
 *  - every path back to idle/cooldown writes level 1 / emergency 0;
 *  - `watchdog()` (called from a real-time interval and every frame) restores
 *    normal light if anything is off while not active, or if an event has run
 *    longer than NIGHT.watchdogMaxActive real seconds (paused/stalled clock);
 *  - `dispose()` (component unmount, even mid-blackout) restores lighting.
 */
import type { GameEventName, GameEvents } from '@/core/events'
import { clamp, lerp, smoothstep } from '@/core/math'
import type { DirectorRequest } from '@/systems/director'
import { NIGHT } from './config'

export type NightPhase = 'idle' | 'powerDown' | 'blackout' | 'restore' | 'cooldown'

type Emit = <K extends GameEventName>(name: K, payload: GameEvents[K]) => void

export interface NightShiftDeps {
  /** Sim time (s). */
  now: () => number
  emit: Emit
  director: { request(req: DirectorRequest): boolean; end(id: string): void }
  /** runtime.lighting (this FSM is its only writer). */
  lighting: { level: number; emergency: number }
  setNightShift: (on: boolean) => void
  reducedMotion: () => boolean
  /** Wall-clock seconds for the watchdog (defaults to performance.now). */
  realNow?: () => number
  /** Phase change notification (debug/tests). */
  onPhase?: (phase: NightPhase) => void
}

export const NIGHT_DIRECTOR_ID = 'nightshift'

const defaultRealNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000

/** Lights stutter while dying: multiplier on the smooth fade (≤ 2 dips per second). */
function stutterDown(t: number): number {
  if (t >= 0.18 && t < 0.3) return 0.45
  if (t >= 0.64 && t < 0.74) return 0.62
  if (t >= 1.22 && t < 1.3) return 0.8
  return 1
}

/** Lights coming back: two hesitant blinks, then a smooth rise (≤ 2 flashes per second). */
function stutterUp(t: number, len: number): number {
  const lo = NIGHT.level
  if (t < 0.2) return lo
  if (t < 0.32) return 0.7
  if (t < 0.62) return 0.2
  if (t < 0.74) return 0.86
  if (t < 1.0) return 0.42
  return lerp(0.42, 1, smoothstep(1.0, Math.max(1.01, len), t))
}

export class NightShiftFsm {
  phase: NightPhase = 'idle'
  private readonly deps: NightShiftDeps
  private phaseAt = 0
  private phaseLen = 0
  private gentle = false
  private startedReal = 0
  private paDone = false
  private restorePaDone = true
  private endEmitted = true
  private disposed = false
  /** Number of completed or started events (debug/tests). */
  runs = 0

  constructor(deps: NightShiftDeps) {
    this.deps = deps
  }

  /** The button may be pressed (idle; the director decides at press time). */
  canStart(): boolean {
    return !this.disposed && this.phase === 'idle'
  }

  isActive(): boolean {
    return this.phase === 'powerDown' || this.phase === 'blackout' || this.phase === 'restore'
  }

  /** Seconds until the button works again (0 when idle). Includes the running event. */
  cooldownRemaining(now = this.now()): number {
    const T = now - this.phaseAt
    switch (this.phase) {
      case 'idle':
        return 0
      case 'cooldown':
        return Math.max(0, NIGHT.cooldown - T)
      case 'powerDown':
        return Math.max(0, this.phaseLen - T) + NIGHT.blackout + this.fadeLen() + NIGHT.cooldown
      case 'blackout':
        return Math.max(0, this.phaseLen - T) + this.fadeLen() + NIGHT.cooldown
      case 'restore':
        return Math.max(0, this.phaseLen - T) + NIGHT.cooldown
    }
  }

  /** Begin the blackout. Returns false when not idle or the director refuses. */
  start(opts: { force?: boolean } = {}): boolean {
    if (!this.canStart()) return false
    let ok = false
    try {
      ok = this.deps.director.request({
        id: NIGHT_DIRECTOR_ID,
        kind: 'player',
        cooldown: NIGHT.cooldown,
        duration: NIGHT.directorDuration,
        force: !!opts.force,
      })
    } catch {
      ok = false
    }
    if (!ok) return false
    this.runs++
    this.gentle = this.safeReduced()
    this.startedReal = this.realNow()
    this.paDone = false
    this.restorePaDone = false
    this.endEmitted = false
    this.enter('powerDown', this.now())
    this.safeSetNightShift(true)
    const { emit } = this.deps
    emit('nightshift:start', {})
    emit('caption', { text: NIGHT.startCaption, kind: 'warning', duration: 4 })
    emit('achievement', { id: 'night-shift' })
    this.apply(this.now())
    return true
  }

  tick(): void {
    if (this.disposed) return
    const now = this.now()
    if (this.phase === 'idle') {
      this.ensureNormal()
      return
    }
    // Natural transitions carry the overshoot so long frames never drift the schedule.
    for (let guard = 0; guard < 6; guard++) {
      const T = now - this.phaseAt
      if (this.phase === 'blackout' && !this.paDone && T >= NIGHT.paAt) {
        this.paDone = true
        this.deps.emit('pa:announce', { text: NIGHT.paText })
        this.deps.emit('caption', { text: NIGHT.paText, kind: 'pa', duration: 5 })
      }
      if (this.phase === 'cooldown' && !this.restorePaDone && T >= NIGHT.restorePaDelay) {
        this.restorePaDone = true
        this.deps.emit('pa:announce', { text: NIGHT.restorePa })
        this.deps.emit('caption', { text: NIGHT.restorePa, kind: 'pa', duration: 4.5 })
      }
      if (T < this.phaseLen) break
      const next = this.phaseAt + this.phaseLen
      if (this.phase === 'powerDown') this.enter('blackout', next)
      else if (this.phase === 'blackout') {
        this.enter('restore', next)
        this.emitEnd()
        this.safeSetNightShift(false)
      } else if (this.phase === 'restore') this.finishRestore(next)
      else if (this.phase === 'cooldown') {
        this.enter('idle', next)
        break
      }
    }
    this.apply(now)
  }

  /**
   * Safety net. Returns true when it had to intervene. Call from a wall-clock
   * interval (keeps working when the sim clock is paused) and every frame.
   */
  watchdog(): boolean {
    if (this.disposed) return this.ensureNormal()
    const L = this.deps.lighting
    if (!Number.isFinite(L.level) || !Number.isFinite(L.emergency)) {
      if (this.isActive()) this.forceRestore()
      else this.ensureNormal()
      return true
    }
    if (!this.isActive()) return this.ensureNormal()
    if (this.realNow() - this.startedReal > NIGHT.watchdogMaxActive) {
      this.forceRestore()
      return true
    }
    return false
  }

  /** Debug: end the blackout now (lights back on, normal cooldown). */
  forceRestore(): void {
    if (this.isActive()) {
      this.emitEnd()
      this.safeSetNightShift(false)
      this.releaseDirector()
      this.restorePaDone = true
      this.enter('cooldown', this.now())
    }
    this.ensureNormal()
  }

  /** Debug: skip the remaining cooldown so the button works again right away. */
  skipCooldown(): void {
    if (this.phase === 'cooldown') {
      this.restorePaDone = true
      this.enter('idle', this.now())
      this.ensureNormal()
    }
  }

  /** Unmount: lights back to normal immediately, even mid-blackout. Idempotent. */
  dispose(): void {
    if (this.isActive()) {
      this.emitEnd()
      this.safeSetNightShift(false)
      this.releaseDirector()
    }
    this.phase = 'idle'
    this.phaseLen = 0
    this.disposed = true
    this.ensureNormal()
  }

  /** Re-arm after dispose (StrictMode remount). Always starts idle with normal light. */
  revive(): void {
    this.disposed = false
    this.phase = 'idle'
    this.ensureNormal()
  }

  // ------------------------------------------------------------------ internals

  private now(): number {
    const t = this.deps.now()
    return Number.isFinite(t) ? t : 0
  }

  private realNow(): number {
    try {
      return (this.deps.realNow ?? defaultRealNow)()
    } catch {
      return defaultRealNow()
    }
  }

  private safeReduced(): boolean {
    try {
      return !!this.deps.reducedMotion()
    } catch {
      return false
    }
  }

  private safeSetNightShift(v: boolean): void {
    try {
      this.deps.setNightShift(v)
    } catch {
      /* ignore */
    }
  }

  private releaseDirector(): void {
    try {
      this.deps.director.end(NIGHT_DIRECTOR_ID)
    } catch {
      /* ignore */
    }
  }

  private emitEnd(): void {
    if (this.endEmitted) return
    this.endEmitted = true
    this.deps.emit('nightshift:end', {})
  }

  private fadeLen(): number {
    return this.gentle ? NIGHT.gentleFade : NIGHT.restore
  }

  private enter(phase: NightPhase, at: number): void {
    this.phase = phase
    this.phaseAt = at
    switch (phase) {
      case 'powerDown':
        this.phaseLen = this.gentle ? NIGHT.gentleFade : NIGHT.powerDown
        break
      case 'blackout':
        this.phaseLen = NIGHT.blackout
        break
      case 'restore':
        this.phaseLen = this.fadeLen()
        break
      case 'cooldown':
        this.phaseLen = NIGHT.cooldown
        break
      default:
        this.phaseLen = 0
    }
    try {
      this.deps.onPhase?.(phase)
    } catch {
      /* ignore */
    }
  }

  private finishRestore(at: number): void {
    this.deps.lighting.level = 1
    this.deps.lighting.emergency = 0
    this.releaseDirector()
    this.enter('cooldown', at)
  }

  /** Normal lighting outside an event. Returns true when it changed something. */
  private ensureNormal(): boolean {
    const L = this.deps.lighting
    if (L.level === 1 && L.emergency === 0) return false
    L.level = 1
    L.emergency = 0
    return true
  }

  private apply(now: number): void {
    const L = this.deps.lighting
    const T = Math.max(0, now - this.phaseAt)
    const len = Math.max(0.01, this.phaseLen)
    let level = 1
    let emergency = 0
    switch (this.phase) {
      case 'powerDown': {
        const u = clamp(T / len, 0, 1)
        level = lerp(1, NIGHT.level, smoothstep(0, 1, u))
        if (!this.gentle) level *= stutterDown(T)
        emergency = this.gentle ? smoothstep(0.6, 1, u) * 0.4 : smoothstep(0.7, 1, u) * 0.5
        break
      }
      case 'blackout': {
        level = NIGHT.level
        const ramp = this.gentle ? 1.5 : NIGHT.emergencyRamp
        emergency = lerp(this.gentle ? 0.4 : 0.5, 1, smoothstep(0, ramp, T))
        break
      }
      case 'restore': {
        const u = clamp(T / len, 0, 1)
        level = this.gentle ? lerp(NIGHT.level, 1, smoothstep(0, 1, u)) : stutterUp(T, len)
        emergency = 1 - smoothstep(0, this.gentle ? 1 : 0.4, u)
        break
      }
      default:
        level = 1
        emergency = 0
    }
    L.level = Number.isFinite(level) ? clamp(level, 0, 1) : 1
    L.emergency = Number.isFinite(emergency) ? clamp(emergency, 0, 1) : 0
  }
}
