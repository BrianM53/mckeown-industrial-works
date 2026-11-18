/**
 * Ambient gag scheduler (pure; unit-tested with a fake clock).
 *
 * Every ~1.5 s it looks for a gag whose actors are settled at the right
 * station, which the visitor can plausibly see (≤ 35 m, in view, line of
 * sight), while nothing exclusive is happening — then asks the director
 * (`kind: 'ambient'`, per-gag cooldown). The director enforces per-id cooldowns,
 * the global ambient gap, "not while reading a panel" and the ambient-events
 * setting; the scheduler adds its own pacing (one NPC gag at a time, a breather
 * after each) and never runs a gag during exclusive events.
 */
import { dampAngle } from '@/core/math'
import type { DirectorRequest } from '@/systems/director'
import type { NpcBrain } from './brain'
import type { GagContext, GagDef } from './gagDefs'
import { initialPose } from './gagDefs'
import { createPropStates, decayProps, type GagFx, type PropStates } from './gagKit'
import type { ActorPose } from './types'

export interface DirectorLike {
  request(req: DirectorRequest): boolean
  end(id: string): void
  exclusiveActive(): string | null
}

export interface SchedulerHost {
  brain(id: string): NpcBrain | undefined
  /** The dialogue with this NPC is open. */
  talking(id: string): boolean
  /** The visitor can plausibly see this gag right now. */
  visible(def: GagDef): boolean
  /** Global quiet time (night shift, launch countdown/flight). */
  quiet(): boolean
  player: { x: number; z: number }
  /** Free-running clock (s), for idle animation phases. */
  clock: number
}

export interface SchedulerHooks {
  started?(def: GagDef): void
  ended?(def: GagDef, aborted: boolean): void
}

export const SCHEDULER = {
  /** Seconds between eligibility checks. */
  checkEvery: 1.5,
  /** Delay before the first gag after mount. */
  firstDelay: 9,
  /** Breather after a gag ends [min, max]. */
  restAfter: [14, 26] as [number, number],
  /** Extra director lock beyond the timeline (the walk back). */
  lockPadding: 3,
}

interface Running {
  def: GagDef
  t: number
  poses: Record<string, ActorPose>
  yaw: Record<string, number>
}

export class GagScheduler {
  readonly props: PropStates
  readonly history: { id: string; at: number }[] = []
  private run: Running | null = null
  private wait: number = SCHEDULER.firstDelay
  private checkT = 0
  private ctx: GagContext

  constructor(
    readonly defs: GagDef[],
    private readonly director: DirectorLike,
    private readonly now: () => number,
    private readonly rand: () => number,
    fx: GagFx,
    private readonly hooks: SchedulerHooks = {},
    props?: PropStates,
  ) {
    this.props = props ?? createPropStates()
    this.ctx = { fx, props: this.props, poses: {}, player: { x: 0, z: 0 }, clock: 0 }
  }

  get running(): string | null {
    return this.run?.def.id ?? null
  }

  get runningDef(): GagDef | null {
    return this.run?.def ?? null
  }

  get elapsed(): number {
    return this.run?.t ?? 0
  }

  /** Is this NPC currently performing in a gag? */
  hasActor(npcId: string): boolean {
    return !!this.run && this.run.def.actors.some((a) => a.npc === npcId)
  }

  /** Are all of a gag's actors present, settled at their stations and free? */
  actorsReady(def: GagDef, host: SchedulerHost): boolean {
    for (const a of def.actors) {
      const b = host.brain(a.npc)
      if (!b || host.talking(a.npc) || !b.isSettledAt(a.station) || b.blockedStations.has(a.station)) return false
    }
    return true
  }

  tick(dt: number, host: SchedulerHost): void {
    if (!(dt > 0)) return
    this.ctx.player.x = host.player.x
    this.ctx.player.z = host.player.z
    this.ctx.clock = host.clock
    decayProps(this.props, dt)
    if (this.run) {
      this.advance(dt, host)
      return
    }
    this.wait -= dt
    this.checkT -= dt
    if (this.wait > 0 || this.checkT > 0) return
    this.checkT = SCHEDULER.checkEvery
    this.tryStart(host)
  }

  private tryStart(host: SchedulerHost): boolean {
    if (host.quiet() || this.director.exclusiveActive() !== null) return false
    const order = [...this.defs]
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    for (const def of order) {
      if (!this.actorsReady(def, host) || this.playerInTheWay(def, host) || !host.visible(def)) continue
      if (!this.director.request({ id: def.id, kind: 'ambient', cooldown: def.cooldown, duration: def.duration + SCHEDULER.lockPadding })) continue
      this.begin(def, host)
      return true
    }
    return false
  }

  /** The visitor stands where the choreography will sweep through. */
  playerInTheWay(def: GagDef, host: SchedulerHost): boolean {
    if (!def.keepClear) return false
    const { x, z } = host.player
    for (const [cx, cz, r] of def.keepClear) if (Math.hypot(x - cx, z - cz) < r) return true
    return false
  }

  /** Debug/test: start a gag now (forced past cooldowns/suppression; actors are snapped to their stations). */
  trigger(id: string, host: SchedulerHost): boolean {
    const def = this.defs.find((d) => d.id === id || d.id === `gag:${id}`)
    if (!def) return false
    if (this.run) this.abort(host)
    for (const a of def.actors) {
      const b = host.brain(a.npc)
      if (!b) return false
      if (!b.isSettledAt(a.station)) {
        b.clearReaction()
        b.setFlashlight(false)
        b.snapTo(a.station)
      }
    }
    if (!this.director.request({ id: def.id, kind: 'ambient', cooldown: def.cooldown, duration: def.duration + SCHEDULER.lockPadding, force: true })) return false
    this.begin(def, host)
    return true
  }

  private begin(def: GagDef, host: SchedulerHost): void {
    const poses: Record<string, ActorPose> = {}
    const yaw: Record<string, number> = {}
    for (const a of def.actors) {
      const b = host.brain(a.npc)!
      b.beginGag()
      poses[a.npc] = initialPose(b.x, b.z, b.y, b.yaw)
      yaw[a.npc] = b.yaw
    }
    this.ctx.poses = poses
    this.run = { def, t: 0, poses, yaw }
    this.history.push({ id: def.id, at: this.now() })
    if (this.history.length > 64) this.history.shift()
    def.start(this.ctx)
    this.hooks.started?.(def)
  }

  private advance(dt: number, host: SchedulerHost): void {
    const r = this.run!
    // An actor vanished (quality change, unmount): abort cleanly.
    for (const a of r.def.actors) {
      if (!host.brain(a.npc)) {
        this.abort(host)
        return
      }
    }
    r.t += dt
    const t = Math.min(r.t, r.def.duration)
    r.def.update(t, dt, this.ctx)
    for (const a of r.def.actors) {
      const pose = r.poses[a.npc]
      // smooth facing changes (timelines give targets)
      r.yaw[a.npc] = dampAngle(r.yaw[a.npc], pose.yaw, 12, dt)
      const target = pose.yaw
      pose.yaw = r.yaw[a.npc]
      host.brain(a.npc)!.applyPose(pose)
      pose.yaw = target
    }
    if (r.t >= r.def.duration) this.finish(host, false)
  }

  private finish(host: SchedulerHost, aborted: boolean): void {
    const r = this.run
    if (!r) return
    this.run = null
    r.def.finish(this.ctx, aborted)
    for (const a of r.def.actors) {
      const b = host.brain(a.npc)
      if (!b) continue
      if (aborted) b.snapTo(a.returnTo)
      else b.endGag(a.returnTo, a.returnVia)
    }
    this.director.end(r.def.id)
    this.wait = SCHEDULER.restAfter[0] + (SCHEDULER.restAfter[1] - SCHEDULER.restAfter[0]) * this.rand()
    this.checkT = 0
    this.hooks.ended?.(r.def, aborted)
  }

  /** Stop the running gag immediately, restoring props and actors. */
  abort(host: SchedulerHost): void {
    this.finish(host, true)
  }
}
