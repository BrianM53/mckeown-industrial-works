/**
 * NpcWorld — the NPC module's runtime: brains for the active roster, the gag
 * scheduler, reactions (night shift, launches, forklift bumps), ambient chatter
 * bubbles, dialogue rotation and debug hooks. Logic ticks from simClock; the
 * renderer reads the resulting poses every frame.
 */
import { AMBIENT_CHATTER, BUMP_LINES, DIALOGUE, LAUNCH_REACTIONS, PANIC_LINES, SLEEP_TALK } from '@/content/dialogue'
import { simClock } from '@/core/clock'
import { events } from '@/core/events'
import { createRng, hashString } from '@/core/rng'
import { params } from '@/core/params'
import { runtime } from '@/core/runtime'
import type { LaunchOutcome, SfxName, Vec2, Vec3 } from '@/core/types'
import { useGameStore } from '@/state/game'
import { useUIStore } from '@/state/ui'
import { director } from '@/systems/director'
import { factory } from '@/systems/factory'
import { PAD } from '@/world/layout'
import { NpcBrain, type BrainEnv } from './brain'
import { walkable } from './geo'
import { GAGS, type GagDef } from './gagDefs'
import type { GagFx, PuffKind } from './gagKit'
import { propFootprints } from './propsData'
import { ROSTER } from './roster'
import { compileNpc, walkSegments, type CompiledNpc } from './routes'
import { GagScheduler, type SchedulerHost } from './scheduler'
import type { NpcDef } from './types'
import { plausiblyVisible, type ViewState } from './visibility'

export const COMPILED: Map<string, CompiledNpc> = new Map(ROSTER.map((d) => [d.id, compileNpc(d)]))

const PROP_RECTS = propFootprints()
const WATCH_RADIUS = 45
export const BUBBLE_SLOTS = 3
const CHATTY_COUNT = 5

/** Rotates through an NPC's conversations: shuffled, never the same one twice in a row. */
export class DialogueRotation {
  private order = new Map<string, number[]>()
  private pos = new Map<string, number>()
  private last = new Map<string, number>()
  constructor(private readonly rand: () => number) {}

  next(id: string, count: number): number {
    if (count <= 1) return 0
    let order = this.order.get(id)
    let pos = this.pos.get(id) ?? 0
    if (!order || pos >= order.length) {
      order = [...Array(count).keys()]
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(this.rand() * (i + 1))
        ;[order[i], order[j]] = [order[j], order[i]]
      }
      const last = this.last.get(id)
      if (order[0] === last) [order[0], order[order.length - 1]] = [order[order.length - 1], order[0]]
      pos = 0
      this.order.set(id, order)
    }
    const idx = order[pos]
    this.pos.set(id, pos + 1)
    this.last.set(id, idx)
    return idx
  }
}

export interface Bubble {
  /** Render slot 0..BUBBLE_SLOTS-1 (stable for the bubble's lifetime). */
  slot: number
  npcId: string
  text: string
  /** Seconds left. */
  left: number
  total: number
  /** Monotonic id (renderers re-layout text when it changes). */
  serial: number
}

export interface PuffRequest {
  kind: PuffKind
  pos: Vec3
  count: number
  spread: number
}

/** View handles registered by each rendered NPC. */
export interface NpcView {
  group: import('three').Group | null
  lean: import('three').Group | null
  setSolid(solid: boolean): void
  solid: boolean
}

const ENV_SCRATCH = (): BrainEnv => ({
  player: { x: 0, z: 0, active: true },
  forklift: { x: 0, z: 0, active: false },
  talking: false,
  isFree: () => true,
  rand: Math.random,
})

export interface ValidationReport {
  ran: number
  blockedStations: string[]
  blockedLegs: string[]
  hidden: string[]
}

export class NpcWorld {
  readonly brains = new Map<string, NpcBrain>()
  /** NPCs removed because none of their stations is reachable at runtime. */
  readonly disabled = new Set<string>()
  validation: ValidationReport = { ran: 0, blockedStations: [], blockedLegs: [], hidden: [] }
  /** Called when the set of rendered NPCs changes (React re-render). */
  onRosterChange: (() => void) | null = null
  readonly views = new Map<string, NpcView>()
  readonly scheduler: GagScheduler
  readonly bubbles: Bubble[] = []
  readonly puffQueue: PuffRequest[] = []
  readonly rotation: DialogueRotation
  readonly talked = new Set<string>()
  /** Physics free-spot test (set by the physics guard once colliders exist). */
  physicsFree: (x: number, z: number) => boolean = () => true
  /** Free-running seconds. */
  clock = 0
  private rand: () => number
  private env = ENV_SCRATCH()
  private bubbleSerial = 0
  private chatterIn = 12
  private lastChatter = new Map<string, string>()
  private bumpReady = new Map<string, number>()
  private chattySent = false
  private watchedRocket = -1
  private nightShift = false
  private nightShiftSince = 0
  private view: ViewState = { px: 0, pz: 0, cx: 0, cz: 0, yaw: 0 }
  private readonly host: SchedulerHost

  constructor(seed: number = params.seed ?? 20261117) {
    this.rand = createRng(seed ^ hashString('npc'))
    this.rotation = new DialogueRotation(createRng(seed ^ hashString('dialogue')))
    this.env.rand = this.rand
    this.env.isFree = (x, z) => walkable(x, z, PROP_RECTS) && this.physicsFree(x, z)
    const fx: GagFx = {
      sfx: (name, pos, volume, rate) => this.sfx(name, pos, volume, rate),
      puff: (kind, pos, count, spread) => this.puff(kind, pos, count, spread ?? 0.4),
      say: (id, text, seconds) => this.say(id, text, seconds ?? 2.2),
      achievement: (id, pos, radius) => {
        const p = runtime.player.position
        if (!Number.isFinite(radius) || Math.hypot(p.x - pos[0], p.z - pos[2]) <= radius) events.emit('achievement', { id })
      },
    }
    const self = this
    this.host = {
      brain: (id) => self.brains.get(id),
      talking: (id) => useUIStore.getState().dialogue?.npcId === id,
      visible: (def) => self.gagVisible(def),
      quiet: () => self.quiet(),
      player: { x: 0, z: 0 },
      get clock() {
        return self.clock
      },
    }
    this.scheduler = new GagScheduler(GAGS, director, () => simClock.t, this.rand, fx, {
      started: (def) => this.onGagStarted(def),
      ended: (def) => events.emit('gag:end', { id: def.id }),
    })
  }

  // ------------------------------------------------------------------ roster

  /** Sync brains with the roster for the current quality tier. */
  setRoster(defs: NpcDef[]): void {
    const keep = new Set(defs.map((d) => d.id))
    for (const id of [...this.brains.keys()]) {
      if (!keep.has(id)) {
        if (this.scheduler.hasActor(id)) this.scheduler.abort(this.host)
        this.brains.delete(id)
      }
    }
    for (const d of defs) {
      if (this.brains.has(d.id) || this.disabled.has(d.id)) continue
      const c = COMPILED.get(d.id)
      if (!c) continue
      const start = d.routine[Math.floor(this.rand() * d.routine.length)]
      const b = new NpcBrain(c, this.rand, start)
      if (this.nightShift) b.setFlashlight(true)
      this.brains.set(d.id, b)
    }
  }

  // ------------------------------------------------------------------ tick (sim clock)

  tick(dt: number): void {
    if (!(dt > 0)) return
    this.clock += dt
    const p = runtime.player.position
    const f = runtime.forklift
    const env = this.env
    const footActive = runtime.player.mode === 'foot' || runtime.player.mode === 'travel'
    env.player.x = Number.isFinite(p.x) ? p.x : 0
    env.player.z = Number.isFinite(p.z) ? p.z : 0
    env.player.active = footActive
    env.forklift.x = f.position.x
    env.forklift.z = f.position.z
    // the forklift is an obstacle whether parked or driven (it never moves on its own)
    env.forklift.active = Number.isFinite(f.position.x) && Number.isFinite(f.position.z)
    const talkingId = useUIStore.getState().dialogue?.npcId ?? null
    for (const b of this.brains.values()) {
      env.talking = talkingId === b.id
      b.update(dt, env)
    }
    this.host.player.x = env.player.x
    this.host.player.z = env.player.z
    this.updateView()
    this.scheduler.tick(dt, this.host)
    this.tickBubbles(dt)
    this.tickChatter(dt)
    // Night shift safety net: never keep flashlights on if the event ended without notice.
    if (this.nightShift && !useGameStore.getState().nightShift && this.clock - this.nightShiftSince > 30) this.endNightShift()
  }

  private updateView(): void {
    const p = runtime.player.position
    const c = runtime.camera.position
    this.view.px = p.x
    this.view.pz = p.z
    this.view.cx = c.x
    this.view.cz = c.z
    this.view.yaw = runtime.camera.yaw
  }

  gagVisible(def: GagDef): boolean {
    return plausiblyVisible(def.anchor[0], def.anchor[2], this.view)
  }

  quiet(): boolean {
    if (this.nightShift || useGameStore.getState().nightShift) return true
    const phase = factory.state?.rocket?.phase
    return phase === 'countdown' || phase === 'ignition' || phase === 'flight'
  }

  // ------------------------------------------------------------------ gags

  private onGagStarted(def: GagDef): void {
    events.emit('gag:start', { id: def.id, position: [def.anchor[0], def.anchor[1], def.anchor[2]] })
    // Bystanders turn to watch.
    const actors = new Set(def.actors.map((a) => a.npc))
    const at: Vec2 = [def.anchor[0], def.anchor[2]]
    for (const b of this.brains.values()) {
      if (actors.has(b.id) || b.mode !== 'stay' || b.busyReacting || b.napping) continue
      if (Math.hypot(b.x - at[0], b.z - at[1]) > def.audience) continue
      b.react('watch', Math.min(def.duration, 7 + this.rand() * 2), at)
    }
  }

  triggerGag(id: string): boolean {
    return this.scheduler.trigger(id, this.host)
  }

  abortGags(): void {
    if (this.scheduler.running) this.scheduler.abort(this.host)
  }

  // ------------------------------------------------------------------ effects

  sfx(name: SfxName, pos: Vec3, volume = 1, rate = 1): void {
    events.emit('sfx', { name, position: pos, volume, rate })
  }

  puff(kind: PuffKind, pos: Vec3, count: number, spread: number): void {
    if (this.puffQueue.length > 32) this.puffQueue.shift()
    this.puffQueue.push({ kind, pos: [pos[0], pos[1], pos[2]], count, spread })
  }

  say(npcId: string, text: string, seconds = 2.4): void {
    if (!this.brains.has(npcId) || !text) return
    const existing = this.bubbles.find((b) => b.npcId === npcId)
    const serial = ++this.bubbleSerial
    if (existing) {
      existing.text = text
      existing.left = existing.total = seconds
      existing.serial = serial
      return
    }
    let slot = -1
    for (let k = 0; k < BUBBLE_SLOTS; k++) {
      if (!this.bubbles.some((b) => b.slot === k)) {
        slot = k
        break
      }
    }
    if (slot < 0) {
      // replace the one closest to expiring
      let oldest = 0
      for (let i = 1; i < this.bubbles.length; i++) if (this.bubbles[i].left < this.bubbles[oldest].left) oldest = i
      slot = this.bubbles[oldest].slot
      this.bubbles.splice(oldest, 1)
    }
    this.bubbles.push({ slot, npcId, text, left: seconds, total: seconds, serial })
  }

  private tickBubbles(dt: number): void {
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i]
      b.left -= dt
      if (b.left <= 0 || !this.brains.has(b.npcId)) this.bubbles.splice(i, 1)
    }
  }

  /** Director-paced ambient chatter: a short bubble over a worker the visitor can see. */
  private tickChatter(dt: number): void {
    this.chatterIn -= dt
    if (this.chatterIn > 0) return
    this.chatterIn = 13 + this.rand() * 11
    if (this.quiet()) return
    const cands: NpcBrain[] = []
    const talkingId = useUIStore.getState().dialogue?.npcId ?? null
    for (const b of this.brains.values()) {
      if (b.inGag || b.id === talkingId || b.busyReacting || b.hidden) continue
      if (this.bubbles.some((x) => x.npcId === b.id)) continue
      if (!plausiblyVisible(b.x, b.z, this.view, 16)) continue
      cands.push(b)
    }
    if (!cands.length) return
    const b = cands[Math.floor(this.rand() * cands.length) % cands.length]
    if (!director.request({ id: 'npc:chatter', kind: 'ambient', cooldown: 8, duration: 3.2 })) return
    const text = b.napping ? 'Zzz…' : this.pickLine(b.id, AMBIENT_CHATTER[b.id] ?? [])
    if (text) this.say(b.id, text, 3.2)
  }

  private pickLine(id: string, lines: readonly string[]): string {
    if (!lines.length) return ''
    let line = lines[Math.floor(this.rand() * lines.length) % lines.length]
    if (line === this.lastChatter.get(id) && lines.length > 1) line = lines[(lines.indexOf(line) + 1) % lines.length]
    this.lastChatter.set(id, line)
    return line
  }

  // ------------------------------------------------------------------ talk

  canTalk(id: string): boolean {
    const b = this.brains.get(id)
    return !!b && b.canTalk() && !this.scheduler.hasActor(id)
  }

  talk(id: string): void {
    const b = this.brains.get(id)
    const def = b?.c.def
    if (!b || !def || !this.canTalk(id)) return
    let lines: string[]
    if (b.napping) lines = SLEEP_TALK[this.rotation.next(`${id}:sleep`, SLEEP_TALK.length)]
    else {
      const entry = DIALOGUE.find((d) => d.npcId === id)
      const convs = entry?.conversations ?? [['…']]
      lines = convs[this.rotation.next(id, convs.length)]
    }
    // the bubble over their head would duplicate the dialogue card
    for (let i = this.bubbles.length - 1; i >= 0; i--) if (this.bubbles[i].npcId === id) this.bubbles.splice(i, 1)
    useUIStore.getState().openDialogue({ npcId: id, name: def.name, role: def.role, lines: [...lines] })
    this.talked.add(id)
    if (!this.chattySent && this.talked.size >= CHATTY_COUNT) {
      this.chattySent = true
      events.emit('achievement', { id: 'chatty' })
    }
  }

  // ------------------------------------------------------------------ reactions

  startNightShift(): void {
    this.nightShift = true
    this.nightShiftSince = this.clock
    // The blackout hides any running gag: end it now (actors snap home) so nobody is
    // left holding a flashlight half-way through a pratfall.
    this.abortGags()
    const p = runtime.player.position
    const near: NpcBrain[] = []
    for (const b of this.brains.values()) {
      b.setFlashlight(true)
      if (b.inGag) continue
      b.react('panic', 2.6 + this.rand() * 0.9)
      if (Math.hypot(b.x - p.x, b.z - p.z) < 22) near.push(b)
    }
    near.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))
    near.slice(0, 2).forEach((b, i) => this.say(b.id, PANIC_LINES[(i + Math.floor(this.rand() * PANIC_LINES.length)) % PANIC_LINES.length], 2.2))
  }

  endNightShift(): void {
    this.nightShift = false
    for (const b of this.brains.values()) {
      b.setFlashlight(false)
      b.clearReaction('panic')
    }
  }

  onCountdown(rocketId: number, secondsLeft: number): void {
    if (secondsLeft > 3 || this.watchedRocket === rocketId) return
    this.watchedRocket = rocketId
    for (const b of this.brains.values()) {
      if (b.inGag || b.napping || b.flashlight) continue
      if (Math.hypot(b.x - PAD.center[0], b.z - PAD.center[1]) > WATCH_RADIUS) continue
      b.react('watch', 24, PAD.center)
    }
  }

  onOutcome(outcome: LaunchOutcome): void {
    const watchers = [...this.brains.values()].filter((b) => b.reactionKind === 'watch')
    if (!watchers.length) return
    const p = runtime.player.position
    let cheerAt: Vec3 | null = null
    for (const b of watchers) {
      const j = this.rand()
      if (outcome === 'success' || outcome === 'wobble') {
        b.react('cheer', 2.4 + j * 1.2, PAD.center, { kind: 'watch', seconds: 1.5 })
        if (!cheerAt || Math.hypot(b.x - p.x, b.z - p.z) < Math.hypot(cheerAt[0] - p.x, cheerAt[2] - p.z)) cheerAt = [b.x, 1.6, b.z]
      } else if (outcome === 'breakup') b.react('panic', 1.2 + j * 0.6, PAD.center, { kind: 'dismay', seconds: 1.8 })
      else b.react('panic', 2.4 + j * 0.8, PAD.center, { kind: 'dismay', seconds: 1.2 })
    }
    if (cheerAt && Math.hypot(cheerAt[0] - p.x, cheerAt[2] - p.z) < 35) this.sfx('cheer', cheerAt, 0.6)
    const lines = LAUNCH_REACTIONS[outcome]
    watchers
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))
      .slice(0, 2)
      .forEach((b, i) => this.say(b.id, lines[(i + Math.floor(this.rand() * lines.length)) % lines.length], 2))
  }

  onRocketReset(): void {
    for (const b of this.brains.values()) b.clearReaction('watch')
  }

  onForkliftImpact(pos: Vec3): void {
    for (const b of this.brains.values()) {
      if (b.inGag || b.napping) continue
      if (Math.hypot(b.x - pos[0], b.z - pos[2]) > 2.8) continue
      if ((this.bumpReady.get(b.id) ?? 0) > this.clock) continue
      this.bumpReady.set(b.id, this.clock + 5)
      b.react('bumped', 1.3)
      this.say(b.id, BUMP_LINES[Math.floor(this.rand() * BUMP_LINES.length) % BUMP_LINES.length], 2)
    }
  }

  // ------------------------------------------------------------------ runtime validation

  /**
   * Check every station and route leg against the physics world (other modules'
   * machines, desks and racks). Blocked stations/legs are skipped by the brains;
   * an NPC with no usable station is hidden instead of clipping into geometry.
   */
  validate(free: (x: number, z: number) => boolean): ValidationReport {
    const report: ValidationReport = { ran: this.validation.ran + 1, blockedStations: [], blockedLegs: [], hidden: [] }
    let changed = false
    for (const b of [...this.brains.values()]) {
      const c = b.c
      b.blockedStations.clear()
      b.blockedLegs.clear()
      for (const st of c.def.stations) {
        if (st.onProp) continue
        if (!free(st.pos[0], st.pos[1])) {
          b.blockedStations.add(st.id)
          report.blockedStations.push(`${b.id}:${st.id}`)
        }
      }
      for (const key of c.paths.keys()) {
        const [from, to] = key.split('>')
        let ok = true
        for (const [a, z] of walkSegments(c, from, to)) {
          const len = Math.hypot(z[0] - a[0], z[1] - a[1])
          const n = Math.max(1, Math.ceil(len / 0.4))
          for (let i = 0; i <= n && ok; i++) ok = free(a[0] + ((z[0] - a[0]) * i) / n, a[1] + ((z[1] - a[1]) * i) / n)
          if (!ok) break
        }
        if (!ok) {
          b.blockedLegs.add(key)
          report.blockedLegs.push(`${b.id}:${key}`)
        }
      }
      const usable = c.def.stations.filter((st) => !b.blockedStations.has(st.id))
      if (!usable.length) {
        if (this.scheduler.hasActor(b.id)) this.scheduler.abort(this.host)
        this.brains.delete(b.id)
        this.disabled.add(b.id)
        report.hidden.push(b.id)
        changed = true
      } else if (b.mode === 'stay' && b.blockedStations.has(b.stationId)) {
        b.snapTo(usable[0].id)
      }
    }
    this.validation = report
    if (changed) this.onRosterChange?.()
    return report
  }

  // ------------------------------------------------------------------ lifecycle & debug

  /** Subscribe to the sim clock and game events. Returns the cleanup. */
  mount(): () => void {
    const offs = [
      simClock.onTick((dt) => this.tick(dt)),
      events.on('nightshift:start', () => this.startNightShift()),
      events.on('nightshift:end', () => this.endNightShift()),
      events.on('rocket:countdown', (p) => this.onCountdown(p.rocketId, p.secondsLeft)),
      events.on('rocket:ignition', (p) => this.onCountdown(p.rocketId, 0)),
      events.on('rocket:outcome', (p) => this.onOutcome(p.outcome)),
      events.on('rocket:reset', () => this.onRocketReset()),
      events.on('forklift:impact', (p) => this.onForkliftImpact(p.position)),
    ]
    if (useGameStore.getState().nightShift) this.startNightShift()
    return () => {
      for (const off of offs) off()
      this.abortGags()
      this.bubbles.length = 0
      this.puffQueue.length = 0
    }
  }

  debugList() {
    return [...this.brains.values()].map((b) => ({
      id: b.id,
      name: b.c.def.name,
      role: b.c.def.role,
      position: [round(b.x), round(b.y), round(b.z)],
      state: b.stateLabel(),
    }))
  }

  debugPositions(): Record<string, [number, number]> {
    const out: Record<string, [number, number]> = {}
    for (const b of this.brains.values()) out[b.id] = [round(b.x), round(b.z)]
    return out
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
