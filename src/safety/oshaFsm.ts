/**
 * OSHA-style tackle FSM (pure logic, ticked by simClock; tests drive it with a
 * fake clock, a fake player service and their own Director).
 *
 *   patrol ──(visitor on foot enters a restricted zone)──┐
 *     │  tackle cooldown running / no player service /   │
 *     │  director busy ──► 'warning' (whistle, "Out. Now.", toast) ──► back
 *     └─ director.request('osha') ok ──► 'alert'
 *          whistle + caption; the inspector pops out of the nearest safety hatch
 *          (or sprints from where he patrols) and is guaranteed to make contact
 *          ≤ OSHA.contactDeadline (1.2 s) after the whistle
 *          ├─ visitor leaves the zone first ──► 'aborted' (points, "I saw that.") ──► patrol
 *          └─ contact ──► 'tackling': getService('player').tackle(from) — the player
 *             module tumbles/fades/respawns the worker at Visitor Intake (< 3.5 s);
 *             'osha:tackle'; when the worker is back: toast + achievement
 *               ──► 'cooldown' (20 s; re-entry = warning only) ──► patrol
 *
 * Never loops: the respawn point is far from every zone, the tackle cooldown and
 * the director's per-id cooldown both apply, and the director keeps the event
 * exclusive with the Night Shift (a busy director just defers to warnings).
 */
import type { GameEventName, GameEvents } from '@/core/events'
import { clamp, dampAngle, yawFromDirection, yawToward } from '@/core/math'
import type { PlayerService } from '@/core/services'
import type { PlayerMode, Vec2, Vec3 } from '@/core/types'
import type { DirectorRequest } from '@/systems/director'
import { RESTRICTED_ZONES, type RestrictedZoneDef } from '@/world/layout'
import { HATCHES, HEAD_SHAKE, OSHA, OSHA_TEXT, type HatchDef } from './config'
import { createActor, InspectorBrain, type InspectorActor } from './patrol'
import { zoneAtPoint, zoneSignedDistance } from './zones'

export type OshaState = 'patrol' | 'warning' | 'alert' | 'tackling' | 'aborted' | 'cooldown'

export type Emit = <K extends GameEventName>(name: K, payload: GameEvents[K]) => void

export interface DirectorLike {
  request(req: DirectorRequest): boolean
  end(id: string): void
  cooldownRemaining(id: string, cooldown: number): number
}

export interface PlayerSnapshot {
  x: number
  z: number
  mode: PlayerMode
}

export interface OshaDeps {
  /** Sim time (s) — the same clock the director uses. */
  now: () => number
  emit: Emit
  director: DirectorLike
  player: () => PlayerSnapshot | null
  playerService: () => Pick<PlayerService, 'tackle'> | undefined
  /** Forklift position while driving (falls back to the player position). */
  forklift?: () => { x: number; z: number } | null
  /** Camera ground position + look yaw (to pick an on-screen hatch). */
  camera?: () => { x: number; z: number; yaw: number } | null
  /** A panel/dialogue is open (never chase a reading visitor). */
  overlayOpen?: () => boolean
  /** Night shift running (alternative warning line). */
  dark?: () => boolean
  zones?: readonly RestrictedZoneDef[]
  hatches?: readonly HatchDef[]
}

export const OSHA_DIRECTOR_ID = 'osha'

interface HatchAnim {
  openedAt: number
  closeAt: number
  closed: boolean
}

export interface OshaSnapshot {
  state: OshaState
  zoneId: string | null
  cooldownRemaining: number
  inspector: [number, number]
  anim: string
  brain: string
  stats: OshaFsm['stats']
}

const LID_OPEN_TIME = 0.14
const LID_CLOSE_TIME = 0.22

export class OshaFsm {
  state: OshaState = 'patrol'
  /** Zone of the current / most recent event. */
  zoneId: string | null = null
  readonly actor: InspectorActor
  readonly brain: InspectorBrain
  readonly hatches: readonly HatchDef[]
  /** Counters (debug + tests). */
  readonly stats = { warnings: 0, alerts: 0, tackles: 0, aborts: 0, forkliftWarnings: 0 }

  private readonly deps: OshaDeps
  private readonly zones: readonly RestrictedZoneDef[]
  private zone: RestrictedZoneDef | null = null
  private stateAt = 0
  private resumeState: 'patrol' | 'cooldown' = 'patrol'
  private lastTackleAt = -Infinity
  private lastWarningAt = -Infinity
  private lastForkliftWarnAt = -Infinity
  private warningCount = 0
  private forceNext = false
  /** Debug: next chase starts from a hatch even if he patrols nearby. */
  private hatchNext = false
  private alertAt = 0
  private origin: Vec2 = [0, 0]
  private contactAt = 0
  private slide: Vec2 = [0, 0]
  private citeFace: Vec2 = [0, 0]
  private tackleToken = 0
  private tackleDone = false
  /** Post-tackle choreography (dive → get up → citation) still running. */
  private citing = false
  private readonly hatchAnim: Array<HatchAnim | null>
  private disposed = false

  constructor(deps: OshaDeps) {
    this.deps = deps
    this.zones = deps.zones ?? RESTRICTED_ZONES
    this.hatches = deps.hatches ?? HATCHES
    this.hatchAnim = this.hatches.map(() => null)
    this.actor = createActor(0, 0)
    this.brain = new InspectorBrain(this.actor, {
      player: () => {
        const p = this.readPlayer()
        return p && p.mode === 'foot' ? p : null
      },
    })
    this.stateAt = this.now()
  }

  // ------------------------------------------------------------------ public API

  tick(dt: number): void {
    if (this.disposed || !(dt > 0) || !Number.isFinite(dt)) return
    dt = Math.min(dt, 0.25)
    const now = this.now()
    const p = this.readPlayer()
    switch (this.state) {
      case 'patrol':
      case 'cooldown':
        this.routine(dt, now)
        if (this.state === 'cooldown' && this.tackleCooldownRemaining(now) <= 0) this.setState('patrol', now)
        if (p) this.detect(p, now)
        break
      case 'warning':
        this.routine(dt, now)
        if (now - this.stateAt >= OSHA.warningHold) this.setState(this.resumeState, now)
        break
      case 'alert':
        this.tickAlert(dt, p, now)
        break
      case 'tackling':
        this.tickTackling(dt, now)
        break
      case 'aborted':
        this.tickAborted(dt, p, now)
        break
    }
    this.tickHatches(now)
    const a = this.actor
    if (a.burst) {
      a.burstT += dt
      if (a.burstT > 1.3) {
        a.burst = null
        a.burstT = 0
      }
    }
    this.sanitize()
  }

  /** NPC mishap nearby: the inspector may wander over with his clipboard. */
  onGag(id: string, position: Vec3 | null | undefined): boolean {
    if (this.disposed || !position) return false
    if (this.state !== 'patrol' && this.state !== 'cooldown') return false
    return this.brain.investigate(id, position[0], position[2])
  }

  /** Seconds until a new entry can lead to a tackle (own cooldown and the director's). */
  cooldownRemaining(now = this.now()): number {
    let d = 0
    try {
      d = this.deps.director.cooldownRemaining(OSHA_DIRECTOR_ID, OSHA.tackleCooldown)
    } catch {
      d = 0
    }
    if (this.forceNext) d = 0
    return Math.max(this.tackleCooldownRemaining(now), Number.isFinite(d) ? d : 0)
  }

  /** Lid opening 0 (closed) .. 1 (fully open) for hatch `i`. */
  hatchOpen(i: number, now = this.now()): number {
    const h = this.hatchAnim[i]
    if (!h || now < h.openedAt) return 0
    if (now < h.closeAt) return clamp((now - h.openedAt) / LID_OPEN_TIME, 0, 1)
    return clamp(1 - (now - h.closeAt) / LID_CLOSE_TIME, 0, 1)
  }

  /** Debug/test: forget cooldowns so the next entry is tackled again; inspector back to patrol. */
  reset(): void {
    const now = this.now()
    if (this.state === 'alert' || this.state === 'tackling') this.safeDirectorEnd()
    this.tackleToken++
    this.lastTackleAt = -Infinity
    this.lastWarningAt = -Infinity
    this.lastForkliftWarnAt = -Infinity
    this.forceNext = true
    this.citing = false
    const a = this.actor
    a.rise = 1
    a.burst = null
    a.dust = false
    a.look = null
    this.setState('patrol', now)
    this.brain.resumeVia([])
  }

  /** Debug/screenshots: the next chase always pops out of a hatch. */
  preferHatchNext(): void {
    this.hatchNext = true
  }

  /** Re-arm after dispose() (StrictMode remount / HMR). */
  revive(): void {
    this.disposed = false
  }

  /** Stop for good (unmount). Releases the director lock and ignores late promises. */
  dispose(): void {
    if (this.disposed) return
    if (this.state === 'alert' || this.state === 'tackling') this.safeDirectorEnd()
    this.tackleToken++
    this.disposed = true
  }

  snapshot(): OshaSnapshot {
    const a = this.actor
    const r = (v: number) => Math.round(v * 100) / 100
    return {
      state: this.state,
      zoneId: this.zoneId,
      cooldownRemaining: r(this.cooldownRemaining()),
      inspector: [r(a.x), r(a.z)],
      anim: a.anim,
      brain: this.brain.mode,
      stats: { ...this.stats },
    }
  }

  // ------------------------------------------------------------------ detection

  private now(): number {
    const t = this.deps.now()
    return Number.isFinite(t) ? t : 0
  }

  private readPlayer(): PlayerSnapshot | null {
    let p: PlayerSnapshot | null = null
    try {
      p = this.deps.player()
    } catch {
      return null
    }
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return null
    return p
  }

  private setState(s: OshaState, now: number): void {
    this.state = s
    this.stateAt = now
  }

  private tackleCooldownRemaining(now: number): number {
    return Math.max(0, this.lastTackleAt + OSHA.tackleCooldown - now)
  }

  private overlayOpen(): boolean {
    try {
      return !!this.deps.overlayOpen?.()
    } catch {
      return false
    }
  }

  private service(): Pick<PlayerService, 'tackle'> | undefined {
    try {
      return this.deps.playerService()
    } catch {
      return undefined
    }
  }

  private detect(p: PlayerSnapshot, now: number): void {
    if (this.overlayOpen()) return
    if (p.mode === 'forklift') {
      this.detectForklift(p, now)
      return
    }
    if (p.mode !== 'foot') return
    const zone = zoneAtPoint(p.x, p.z, this.zones)
    if (!zone) return
    this.zoneId = zone.id
    const svc = this.service()
    if (!svc || typeof svc.tackle !== 'function' || this.tackleCooldownRemaining(now) > 0) {
      this.warn(zone, p, now)
      return
    }
    if (this.requestDirector()) this.startAlert(zone, p, now)
    else this.warn(zone, p, now)
  }

  private requestDirector(): boolean {
    const force = this.forceNext
    try {
      const ok = this.deps.director.request({
        id: OSHA_DIRECTOR_ID,
        kind: 'player',
        cooldown: OSHA.tackleCooldown,
        duration: OSHA.directorDuration,
        force,
      })
      if (ok) this.forceNext = false
      return ok
    } catch {
      return false
    }
  }

  private safeDirectorEnd(): void {
    try {
      this.deps.director.end(OSHA_DIRECTOR_ID)
    } catch {
      /* ignore */
    }
  }

  private detectForklift(p: PlayerSnapshot, now: number): void {
    let f: { x: number; z: number } | null = null
    try {
      f = this.deps.forklift?.() ?? null
    } catch {
      f = null
    }
    const x = f && Number.isFinite(f.x) ? f.x : p.x
    const z = f && Number.isFinite(f.z) ? f.z : p.z
    const zone = zoneAtPoint(x, z, this.zones)
    if (!zone) return
    if (now - this.lastForkliftWarnAt < OSHA.forkliftWarningInterval) return
    this.lastForkliftWarnAt = now
    this.stats.forkliftWarnings++
    this.deps.emit('toast', { text: OSHA_TEXT.forkliftToast(zone.id), kind: 'warning', duration: 5 })
  }

  private whistlePosition(p: PlayerSnapshot): Vec3 {
    const a = this.actor
    const dx = a.x - p.x
    const dz = a.z - p.z
    const d = Math.hypot(dx, dz)
    if (d <= 25 || d < 1e-3) return [a.x, 1.7, a.z]
    return [p.x + (dx / d) * 7, 1.7, p.z + (dz / d) * 7]
  }

  private warn(zone: RestrictedZoneDef, p: PlayerSnapshot, now: number): void {
    if (now - this.lastWarningAt < OSHA.warningInterval) return
    this.lastWarningAt = now
    this.stats.warnings++
    const a = this.actor
    let dark = false
    try {
      dark = !!this.deps.dark?.()
    } catch {
      dark = false
    }
    const text = dark ? OSHA_TEXT.darkWarning : OSHA_TEXT.warnings[this.warningCount++ % OSHA_TEXT.warnings.length]
    const { emit } = this.deps
    emit('osha:warning', { zoneId: zone.id })
    // 'osha:warning' has no mapped sound; the whistle is ours to play.
    emit('sfx', { name: 'whistle', position: this.whistlePosition(p), volume: 0.75 })
    emit('caption', { text, kind: 'sound', duration: 3.2 })
    emit('toast', { text: OSHA_TEXT.warningToast(zone.label), kind: 'warning', duration: 4.5 })
    const d = Math.hypot(a.x - p.x, a.z - p.z)
    if (d <= OSHA.warningVisualRadius && a.rise >= 1) {
      a.burst = 'tweet'
      a.burstT = 0
      this.brain.hold(OSHA.warningHold, () => this.readPlayer(), 'point', true)
    }
    this.resumeState = this.state === 'cooldown' ? 'cooldown' : 'patrol'
    this.setState('warning', now)
  }

  // ------------------------------------------------------------------ chase

  /** Index of the best hatch for a chase toward `p` (on-screen, nearby, serving this zone), or -1. */
  chooseHatch(zone: RestrictedZoneDef, p: { x: number; z: number }): number {
    let cam: { x: number; z: number; yaw: number } | null = null
    try {
      cam = this.deps.camera?.() ?? null
    } catch {
      cam = null
    }
    if (cam && !(Number.isFinite(cam.x) && Number.isFinite(cam.z) && Number.isFinite(cam.yaw))) cam = null
    let best = -1
    let bestScore = Infinity
    this.hatches.forEach((h, i) => {
      const hx = h.position[0]
      const hz = h.position[1]
      const d = Math.hypot(hx - p.x, hz - p.z)
      if (d < 1.4) return // never pop out right under the visitor
      let score = d
      if (h.zone !== zone.id) score += 3
      if (d > OSHA.hatchSearchRadius) score += (d - OSHA.hatchSearchRadius) * 3
      if (cam) {
        const fx = -Math.sin(cam.yaw)
        const fz = -Math.cos(cam.yaw)
        const vx = hx - cam.x
        const vz = hz - cam.z
        const vd = Math.hypot(vx, vz)
        const cos = vd > 1e-3 ? (vx * fx + vz * fz) / vd : 1
        if (cos < 0.77) score += 4 // off screen: the comedy needs an audience
      }
      if (score < bestScore) {
        bestScore = score
        best = i
      }
    })
    return best
  }

  private openHatch(i: number, now: number): void {
    this.hatchAnim[i] = { openedAt: now, closeAt: now + OSHA.emergeTime + OSHA.hatchHoldOpen, closed: false }
    const [x, z] = this.hatches[i].position
    this.deps.emit('sfx', { name: 'machine-clank', position: [x, 0.1, z], volume: 0.7, rate: 1.25 })
  }

  private tickHatches(now: number): void {
    for (let i = 0; i < this.hatchAnim.length; i++) {
      const h = this.hatchAnim[i]
      if (!h || h.closed || now < h.closeAt + LID_CLOSE_TIME) continue
      h.closed = true
      const [x, z] = this.hatches[i].position
      this.deps.emit('sfx', { name: 'machine-clank', position: [x, 0.1, z], volume: 0.55, rate: 0.9 })
    }
  }

  private startAlert(zone: RestrictedZoneDef, p: PlayerSnapshot, now: number): void {
    this.stats.alerts++
    this.zone = zone
    this.zoneId = zone.id
    this.alertAt = now
    this.brain.pause()
    const a = this.actor
    const d = Math.hypot(a.x - p.x, a.z - p.z)
    const direct = a.rise >= 1 && d <= OSHA.directChaseRadius && !this.hatchNext
    this.hatchNext = false
    if (direct) {
      this.origin = [a.x, a.z]
    } else {
      const h = this.chooseHatch(zone, p)
      if (h >= 0) {
        const [hx, hz] = this.hatches[h].position
        a.x = hx
        a.z = hz
        a.rise = 0
        this.openHatch(h, now)
      } else {
        // No hatches configured: step out of nowhere 6 m away (he's that kind of inspector).
        const ux = d > 1e-3 ? (a.x - p.x) / d : 0
        const uz = d > 1e-3 ? (a.z - p.z) / d : 1
        a.x = p.x + ux * 6
        a.z = p.z + uz * 6
      }
      this.origin = [a.x, a.z]
    }
    a.yaw = yawToward(a, p)
    a.anim = 'run'
    a.speed = OSHA.sprintSpeed
    a.look = null
    a.collidable = false
    a.burst = 'tweet'
    a.burstT = 0
    this.deps.emit('osha:whistle', { position: [a.x, 1.7, a.z], zoneId: zone.id })
    this.deps.emit('caption', { text: OSHA_TEXT.alertCaption, kind: 'sound', duration: 3 })
    this.setState('alert', now)
  }

  private tickAlert(dt: number, p: PlayerSnapshot | null, now: number): void {
    const a = this.actor
    const zone = this.zone
    if (!p || !zone) return this.abort(now, false)
    if (this.overlayOpen()) return this.abort(now, false)
    const svc = this.service()
    if (!svc || typeof svc.tackle !== 'function') return this.abort(now, false)
    if (p.mode !== 'foot') return this.abort(now, p.mode === 'travel')
    if (zoneSignedDistance(zone, p.x, p.z) > OSHA.abortMargin) return this.abort(now, true)

    const T = now - this.alertAt
    a.collidable = false
    if (a.rise < 1) {
      a.rise = Math.min(1, a.rise + dt / OSHA.emergeTime)
      a.yaw = yawToward(a, p)
      a.anim = 'run'
      a.speed = 5
      if (a.rise < 1 && T < OSHA.contactDeadline) return
    }
    const dx = p.x - a.x
    const dz = p.z - a.z
    const dist = Math.hypot(dx, dz)
    const remain = Math.max(0.05, OSHA.contactDeadline - T)
    const need = Math.max(0, dist - OSHA.contactDistance)
    const speed = clamp(Math.max(OSHA.sprintSpeed, need / remain), 0, OSHA.maxSprintSpeed)
    const step = Math.min(need, speed * dt)
    if (dist > 1e-4) {
      a.x += (dx / dist) * step
      a.z += (dz / dist) * step
      a.yaw = yawFromDirection(dx, dz)
    }
    a.speed = speed
    a.anim = dist - step < OSHA.diveDistance ? 'tackle' : 'run'
    a.dust = true
    if (need - step <= 1e-3 || T >= OSHA.contactDeadline - 1e-6) this.contact(p, now)
  }

  private contact(p: PlayerSnapshot, now: number): void {
    const a = this.actor
    let dx = p.x - a.x
    let dz = p.z - a.z
    let dist = Math.hypot(dx, dz)
    if (dist < 1e-4) {
      dx = -Math.sin(a.yaw)
      dz = -Math.cos(a.yaw)
      dist = 1
    }
    const ux = dx / dist
    const uz = dz / dist
    if (dist > OSHA.contactDistance + 0.05) {
      // deadline reached: the last lunge covers the gap
      a.x = p.x - ux * OSHA.contactDistance
      a.z = p.z - uz * OSHA.contactDistance
    }
    a.rise = 1
    a.yaw = yawFromDirection(ux, uz)
    a.anim = 'tackle'
    a.speed = 0
    a.dust = false
    a.burst = 'whump'
    a.burstT = 0
    this.slide = [ux, uz]
    this.citeFace = [p.x + ux * 1.5, p.z + uz * 1.5]
    this.contactAt = now
    this.lastTackleAt = now
    this.stats.tackles++
    this.tackleDone = false
    this.citing = true
    const token = ++this.tackleToken
    const settle = () => {
      if (token === this.tackleToken) this.tackleDone = true
    }
    const from: Vec3 = [a.x, 0, a.z]
    try {
      const res = this.service()?.tackle(from)
      if (res && typeof (res as Promise<void>).then === 'function') (res as Promise<void>).then(settle, settle)
      else settle()
    } catch (err) {
      console.error('[safety] player.tackle failed', err)
      settle()
    }
    this.deps.emit('osha:tackle', { zoneId: this.zoneId ?? '' })
    this.setState('tackling', now)
  }

  private tickTackling(dt: number, now: number): void {
    this.postTackle(dt, now)
    const T = now - this.contactAt
    if (!this.tackleDone && T >= OSHA.tackleFailsafe) this.tackleDone = true
    if (!this.tackleDone) return
    // The worker is back at Visitor Intake: log it, then the cooldown starts
    // (the inspector keeps writing the citation for a moment before walking back).
    this.safeDirectorEnd()
    this.deps.emit('toast', { text: OSHA_TEXT.tackleToast, kind: 'info', duration: 5 })
    this.deps.emit('achievement', { id: 'tackled' })
    this.setState(this.tackleCooldownRemaining(now) > 0 ? 'cooldown' : 'patrol', now)
    if (!this.citing) this.brain.resumeVia([this.origin])
  }

  /** Normal routine: the post-tackle citation if one is running, else the patrol brain. */
  private routine(dt: number, now: number): void {
    if (this.citing) {
      this.postTackle(dt, now)
      if (!this.citing) this.brain.resumeVia([this.origin])
      return
    }
    this.brain.tick(dt)
  }

  /** Dive, slide, lie there, get up, write the citation. Clears `citing` when done. */
  private postTackle(dt: number, now: number): void {
    const a = this.actor
    const T = now - this.contactAt
    a.dust = false
    a.speed = 0
    a.collidable = false
    a.look = null
    if (T < OSHA.slideTime) {
      const v = OSHA.slideSpeed * (1 - T / OSHA.slideTime)
      a.x += this.slide[0] * v * dt
      a.z += this.slide[1] * v * dt
      a.anim = 'tackle'
    } else if (T < OSHA.lieUntil) {
      a.anim = 'tackle'
    } else if (T < OSHA.standUntil) {
      a.anim = 'idle'
    } else if (T < OSHA.citeUntil) {
      a.anim = 'work'
      a.yaw = dampAngle(a.yaw, yawToward(a, { x: this.citeFace[0], z: this.citeFace[1] }), 6, dt)
    } else {
      a.anim = 'idle'
      this.citing = false
    }
  }

  private abort(now: number, loud: boolean): void {
    this.stats.aborts++
    this.safeDirectorEnd()
    if (loud) this.deps.emit('caption', { text: OSHA_TEXT.abortCaption, kind: 'sound', duration: 2.8 })
    this.actor.dust = false
    this.setState('aborted', now)
  }

  private tickAborted(dt: number, p: PlayerSnapshot | null, now: number): void {
    const a = this.actor
    const T = now - this.stateAt
    if (a.rise < 1) a.rise = Math.min(1, a.rise + dt / OSHA.emergeTime)
    if (p) a.yaw = dampAngle(a.yaw, yawToward(a, p), 8, dt)
    a.anim = T < 0.25 ? 'idle' : 'point'
    a.speed = 0
    a.collidable = false
    a.look = T > 0.25 ? Math.sin(T * Math.PI * 2 * HEAD_SHAKE.frequency) * HEAD_SHAKE.amplitude : null
    if (T >= OSHA.abortHold && a.rise >= 1) {
      a.look = null
      this.setState('patrol', now)
      this.brain.resumeVia([this.origin])
    }
  }

  private sanitize(): void {
    const a = this.actor
    if (Number.isFinite(a.x) && Number.isFinite(a.z) && Number.isFinite(a.yaw) && Number.isFinite(a.rise)) return
    // Never render NaN: back to the start of the patrol.
    this.brain.placeAtRouteStart()
    a.rise = 1
    if (this.state === 'alert' || this.state === 'aborted') {
      this.safeDirectorEnd()
      this.setState('patrol', this.now())
    }
  }
}
