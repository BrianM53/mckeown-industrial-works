/**
 * NPC behaviour state machine (pure TypeScript, unit-tested).
 *
 * Priority:  gag (pose written by a gag timeline) > talk > reaction > routine.
 * Routine:   'stay' at a station → 'move' along the precomputed leg polyline to
 *            the next station ('mount'/'unmount' blend onto props) → 'stay' ...
 * Yielding:  a moving NPC pauses when the visitor (or the forklift) is within
 *            ~1.2 m ahead; after 2 s it sidesteps (if the spot is free), after 6 s
 *            it walks back to the station it came from; still walled in 8 s later,
 *            it snaps to its destination. It never pushes anyone.
 * After a gag the NPC walks a validated straight segment back to its station
 * ('return'); if anything is off (non-finite / far away) it snaps there.
 */
import { clamp, dampAngle, wrapAngle, yawFromDirection } from '@/core/math'
import type { Vec2 } from '@/core/types'
import type { WorkerAnim } from '@/world/WorkerModel'
import { legKey, type CompiledNpc } from './routes'
import type { ActorPose, StationDef } from './types'

export type BrainMode = 'stay' | 'move' | 'mount' | 'unmount' | 'gag' | 'return'
export type ReactKind = 'panic' | 'watch' | 'cheer' | 'dismay' | 'bumped'

export interface BrainEnv {
  player: { x: number; z: number; active: boolean }
  /** Forklift position (always present; `active` false when it is not a moving obstacle). */
  forklift: { x: number; z: number; active: boolean }
  /** The dialogue with this NPC is open. */
  talking: boolean
  /** Free-space check for sidesteps (layout + physics). */
  isFree: (x: number, z: number) => boolean
  rand: () => number
}

/** Tuning (exported for tests). */
export const BRAIN = {
  aheadDistance: 1.2,
  /** Too close in any direction while moving. */
  personalSpace: 0.8,
  forkliftAhead: 2.6,
  forkliftSpace: 1.9,
  sidestepAfter: 2,
  reverseAfter: 6,
  /** After backing off once, still walled in this long (e.g. a parked forklift + the visitor): snap home. */
  giveUpAfter: 8,
  sidestepDistance: 0.85,
  arriveTolerance: 0.08,
  cornerRadius: 0.3,
  turnLambda: 9,
  mountTime: 0.75,
  glanceDistance: 4.5,
  greetDistance: 7,
  greetCooldown: 30,
} as const

/** Yaw from one ground point toward another (allocation-free yawToward). */
const yawTo = (fx: number, fz: number, tx: number, tz: number): number => yawFromDirection(tx - fx, tz - fz)

const ANIM_FOR_ACTIVITY: Record<StationDef['activity'], WorkerAnim> = {
  idle: 'idle',
  work: 'work',
  sit: 'sit',
  lean: 'idle',
  nap: 'sleep',
  point: 'point',
  wave: 'wave',
}

interface Reaction {
  kind: ReactKind
  left: number
  /** Face this world point (watch). */
  face: Vec2 | null
  then: Reaction | null
}

export class NpcBrain {
  readonly c: CompiledNpc
  readonly id: string
  // ---- pose (read by the renderer every frame)
  x: number
  z: number
  y = 0
  yaw: number
  speed = 0
  anim: WorkerAnim = 'idle'
  lean = 0
  lookYaw: number | null = null
  carry = false
  hidden = false
  soot = 0
  slime = 0
  /** Holding a flashlight (night shift). */
  flashlight = false
  /** Physical capsule enabled (disabled during gags, re-enabled once the visitor is clear). */
  solid = true

  // ---- state
  mode: BrainMode = 'stay'
  stationId: string
  /** Index into def.routine of the current/last station. */
  routineIdx = 0
  stayLeft: number
  /** Stations/legs unavailable at runtime (physics validation). */
  readonly blockedStations = new Set<string>()
  readonly blockedLegs = new Set<string>()

  private path: Vec2[] = []
  private seg = 1
  private fromStation: string | null = null
  private toStation: string | null = null
  private blockedFor = 0
  private sidestepped = false
  private reversedOnce = false
  private mountT = 0
  private mountFrom: Vec2 = [0, 0]
  private mountTo: Vec2 = [0, 0]
  private mountY0 = 0
  private mountY1 = 0
  private mountYaw = 0
  private gesture: WorkerAnim | null = null
  private gestureLeft = 0
  private nextGesture: number
  private greetReadyAt = 0
  private wasNear = false
  private reaction: Reaction | null = null
  private time = 0
  private sweepBase = 0
  private talkT = 0
  private returnStation: string | null = null

  constructor(c: CompiledNpc, rand: () => number = Math.random, startStation?: string) {
    this.c = c
    this.id = c.def.id
    const idx = startStation ? Math.max(0, c.def.routine.indexOf(startStation)) : 0
    this.routineIdx = idx
    this.stationId = c.def.routine[idx]
    const st = this.station(this.stationId)
    this.x = st.pos[0]
    this.z = st.pos[1]
    this.y = st.y ?? 0
    this.yaw = st.yaw
    this.lean = st.lean ?? 0
    this.stayLeft = st.dur[0] + (st.dur[1] - st.dur[0]) * rand() * 0.8
    this.nextGesture = 4 + rand() * 8
    this.anim = ANIM_FOR_ACTIVITY[st.activity]
  }

  station(id: string): StationDef {
    const s = this.c.stations.get(id)
    if (!s) throw new Error(`[npc] ${this.id}: unknown station ${id}`)
    return s
  }

  get currentStation(): StationDef {
    return this.station(this.stationId)
  }

  /** Idle at a station (not walking, talking, reacting or performing a gag). */
  isSettledAt(stationId: string): boolean {
    return this.mode === 'stay' && this.stationId === stationId && this.reaction === null && !this.flashlight
  }

  get inGag(): boolean {
    return this.mode === 'gag'
  }

  get busyReacting(): boolean {
    return this.reaction !== null || this.flashlight
  }

  /** Can the visitor talk to this NPC right now? */
  canTalk(): boolean {
    return this.mode !== 'gag' && !this.hidden && (this.reaction === null || this.reaction.kind === 'watch')
  }

  // ------------------------------------------------------------------ external triggers

  /** Start a reaction (ignored during gags). `then` chains a follow-up. */
  react(kind: ReactKind, seconds: number, face: Vec2 | null = null, then: { kind: ReactKind; seconds: number } | null = null): void {
    if (this.mode === 'gag') return
    this.reaction = { kind, left: seconds, face, then: then ? { kind: then.kind, left: then.seconds, face, then: null } : null }
  }

  clearReaction(kind?: ReactKind): void {
    if (!this.reaction) return
    if (!kind || this.reaction.kind === kind) this.reaction = null
  }

  get reactionKind(): ReactKind | null {
    return this.reaction?.kind ?? null
  }

  setFlashlight(on: boolean): void {
    this.flashlight = on
    this.sweepBase = this.yaw
  }

  /** A gag takes control: the timeline writes the pose via `applyPose`. */
  beginGag(): void {
    this.mode = 'gag'
    this.reaction = null
    this.carry = false
    this.solid = false
    this.gesture = null
    this.lookYaw = null
  }

  applyPose(p: ActorPose): void {
    if (this.mode !== 'gag') return
    if (Number.isFinite(p.x) && Number.isFinite(p.z)) {
      this.x = p.x
      this.z = p.z
    }
    this.y = Number.isFinite(p.y) ? p.y : 0
    if (Number.isFinite(p.yaw)) this.yaw = p.yaw
    this.anim = p.anim
    this.speed = p.speed
    this.lean = p.lean
    this.soot = p.soot
    this.slime = p.slime
    this.hidden = p.hidden
    this.carry = p.carry
  }

  /**
   * The gag released this NPC: walk the (validated) straight segment back to
   * `stationId`, keeping any lingering tint fading out.
   */
  endGag(stationId: string, via: Vec2[] = []): void {
    const st = this.c.stations.get(stationId) ?? this.currentStation
    this.hidden = false
    this.y = 0
    this.lean = 0
    this.carry = false
    const far = !Number.isFinite(this.x) || !Number.isFinite(this.z) || Math.hypot(this.x - st.pos[0], this.z - st.pos[1]) > 25
    if (far) {
      this.snapTo(st.id)
      return
    }
    this.mode = 'return'
    this.returnStation = st.id
    this.path = [[this.x, this.z], ...via.map((p) => [p[0], p[1]] as Vec2), [st.pos[0], st.pos[1]]]
    this.seg = 1
    this.blockedFor = 0
    this.sidestepped = false
    this.reversedOnce = false
  }

  /** Wave at the visitor now (debug / screenshots; greeters also turn toward them). */
  greet(): void {
    if (this.mode !== 'stay') return
    this.gesture = 'wave'
    this.gestureLeft = 1.9
  }

  /** Teleport to a station (debug, recovery). */
  snapTo(stationId: string): void {
    const st = this.c.stations.get(stationId) ?? this.currentStation
    this.mode = 'stay'
    this.stationId = st.id
    const ri = this.c.def.routine.indexOf(st.id)
    if (ri >= 0) this.routineIdx = ri
    this.x = st.pos[0]
    this.z = st.pos[1]
    this.y = st.y ?? 0
    this.yaw = st.yaw
    this.lean = st.lean ?? 0
    this.hidden = false
    this.carry = false
    this.speed = 0
    this.stayLeft = st.dur[0]
    this.path = []
    this.solid = true
  }

  // ------------------------------------------------------------------ update

  update(dt: number, env: BrainEnv): void {
    if (!(dt > 0)) return
    dt = Math.min(dt, 0.1)
    this.time += dt
    if (this.mode === 'gag') return
    // tints fade on their own after a gag
    if (this.soot > 0) this.soot = Math.max(0, this.soot - dt * 0.22)
    if (this.slime > 0) this.slime = Math.max(0, this.slime - dt * 0.16)

    // Never freeze half-way onto a prop: finish mounting / dismounting first.
    if (this.mode === 'mount' || this.mode === 'unmount') {
      this.updateMount(dt)
      return
    }

    if (env.talking) {
      this.updateTalk(dt, env)
      return
    }
    this.talkT = 0

    if (this.reaction) {
      if (this.updateReaction(dt)) return
    }
    if (this.flashlight) {
      this.updateFlashlight(dt)
      return
    }

    if (this.mode === 'stay') this.updateStay(dt, env)
    else this.updateMove(dt, env)
  }

  /** Napping on a prop: sleeps through conversations, blackouts and launches alike. */
  get napping(): boolean {
    return this.mode === 'stay' && this.currentStation.activity === 'nap'
  }

  private onPropStation(): boolean {
    return this.mode === 'stay' && !!this.currentStation.onProp
  }

  private updateTalk(dt: number, env: BrainEnv): void {
    this.talkT += dt
    this.speed = 0
    const st = this.currentStation
    const seated = this.onPropStation() || this.mode === 'mount' || this.mode === 'unmount'
    const toPlayer = yawTo(this.x, this.z, env.player.x, env.player.z)
    if (seated) {
      // Nappers sleep-talk; sitters stay seated and look over.
      if (st.activity === 'nap') {
        this.anim = 'sleep'
        this.lookYaw = null
      } else {
        this.anim = 'sit'
        this.lookYaw = wrapAngle(toPlayer - this.yaw)
      }
      return
    }
    this.lean = this.lean * Math.exp(-6 * dt)
    this.yaw = dampAngle(this.yaw, toPlayer, 7, dt)
    this.lookYaw = 0
    this.carry = false
    this.anim = this.c.def.greeter && this.talkT < 1.4 ? 'wave' : 'idle'
  }

  /** Returns true when the reaction consumed the frame. */
  private updateReaction(dt: number): boolean {
    const r = this.reaction!
    r.left -= dt
    if (r.left <= 0) {
      this.reaction = r.then
      if (!this.reaction) return false
    }
    const cur = this.reaction!
    // Seated NPCs stay put; nappers sleep through it.
    const seated = this.onPropStation()
    if (this.napping) {
      this.anim = 'sleep'
      this.speed = 0
      return true
    }
    this.speed = Math.max(0, this.speed - dt * 6)
    switch (cur.kind) {
      case 'panic':
      case 'bumped':
        this.anim = seated ? 'sit' : 'panic'
        this.lookYaw = null
        break
      case 'cheer':
        this.anim = seated ? 'sit' : 'cheer'
        break
      case 'dismay':
        // slumped shoulders and a slow head shake ("…that was our rocket")
        this.anim = seated ? 'sit' : 'idle'
        this.lookYaw = Math.sin(this.time * 7.5 + this.c.def.seed) * 0.42
        break
      case 'watch':
        this.anim = seated ? 'sit' : this.carry ? 'carry' : 'idle'
        break
    }
    if (cur.face && !seated) {
      const y = yawTo(this.x, this.z, cur.face[0], cur.face[1])
      this.yaw = dampAngle(this.yaw, y, 4, dt)
      this.lookYaw = cur.kind === 'watch' ? 0 : this.lookYaw
    }
    if (!seated) {
      const slump = cur.kind === 'dismay' ? -0.13 : 0
      this.lean = slump + (this.lean - slump) * Math.exp(-6 * dt)
    }
    return true
  }

  private updateFlashlight(dt: number): void {
    const seated = this.onPropStation()
    this.speed = Math.max(0, this.speed - dt * 6)
    if (seated) {
      this.anim = this.napping ? 'sleep' : 'sit'
      return
    }
    this.lean = this.lean * Math.exp(-6 * dt)
    this.anim = 'point'
    this.lookYaw = null
    // Slow, nervous sweep around the original heading.
    const target = this.sweepBase + Math.sin(this.time * 0.7 + this.c.def.seed) * 0.55
    this.yaw = dampAngle(this.yaw, target, 3, dt)
  }

  // ------------------------------------------------------------------ stay

  private updateStay(dt: number, env: BrainEnv): void {
    const st = this.currentStation
    this.speed = Math.max(0, this.speed - dt * 6)
    this.carry = false
    this.lean += ((st.lean ?? 0) - this.lean) * (1 - Math.exp(-5 * dt))
    this.y += ((st.y ?? 0) - this.y) * (1 - Math.exp(-8 * dt))
    const dP = Math.hypot(env.player.x - this.x, env.player.z - this.z)
    const near = env.player.active && dP < BRAIN.glanceDistance

    // Greeter waves at visitors who come close (once per approach, rate limited).
    if (this.c.def.greeter) {
      const close = env.player.active && dP < BRAIN.greetDistance
      if (close && !this.wasNear && this.time >= this.greetReadyAt) {
        this.gesture = 'wave'
        this.gestureLeft = 1.9
        this.greetReadyAt = this.time + BRAIN.greetCooldown
      }
      this.wasNear = close
    }

    // Base facing: the station yaw, or toward the visitor while greeting/glancing.
    let faceYaw = st.yaw
    if (this.gesture === 'wave' && this.c.def.greeter) faceYaw = yawTo(this.x, this.z, env.player.x, env.player.z)
    if (!st.onProp) this.yaw = dampAngle(this.yaw, faceYaw, st.activity === 'lean' ? 6 : 4, dt)

    // Occasional gestures at idle stations.
    if (this.gesture) {
      this.gestureLeft -= dt
      if (this.gestureLeft <= 0) this.gesture = null
    } else if (this.time >= this.nextGesture) {
      this.nextGesture = this.time + 7 + env.rand() * 9
      if (st.activity === 'idle' && env.rand() < 0.55) {
        this.gesture = 'point'
        this.gestureLeft = 1.4
      } else if (st.activity === 'work' && env.rand() < 0.4) {
        // short break from work to look around
        this.gesture = 'idle'
        this.gestureLeft = 2.2
      }
    }
    this.anim = this.gesture ?? ANIM_FOR_ACTIVITY[st.activity]

    // Glances: at the visitor when near, else at the station's point of interest.
    if (st.activity === 'nap') this.lookYaw = null
    else if (near) this.lookYaw = wrapAngle(yawTo(this.x, this.z, env.player.x, env.player.z) - this.yaw)
    else if (st.lookAt) this.lookYaw = wrapAngle(yawTo(this.x, this.z, st.lookAt[0], st.lookAt[1]) - this.yaw)
    else this.lookYaw = null

    this.stayLeft -= dt
    if (this.stayLeft <= 0 && !this.gesture) this.startNextLeg(env)
  }

  /** Pick the next reachable station in the routine and set off. */
  private startNextLeg(env: BrainEnv): void {
    const r = this.c.def.routine
    for (let k = 1; k <= r.length; k++) {
      const idx = (this.routineIdx + k) % r.length
      const next = r[idx]
      if (next === this.stationId) continue
      if (this.blockedStations.has(next)) continue
      const key = legKey(this.stationId, next)
      if (this.blockedLegs.has(key)) continue
      const pts = this.c.paths.get(key)
      if (!pts) continue
      this.beginLeg(this.stationId, next, idx, pts)
      return
    }
    // Nowhere to go: stay a while longer.
    const st = this.currentStation
    this.stayLeft = st.dur[0] + (st.dur[1] - st.dur[0]) * env.rand()
  }

  private beginLeg(from: string, to: string, idx: number, pts: Vec2[]): void {
    this.fromStation = from
    this.toStation = to
    this.routineIdx = idx
    this.path = pts.map((p) => [p[0], p[1]] as Vec2)
    this.blockedFor = 0
    this.sidestepped = false
    this.reversedOnce = false
    this.carry = this.c.carry.has(legKey(from, to))
    const a = this.station(from)
    if (a.onProp && this.path.length >= 2) {
      // climb down first
      this.mode = 'unmount'
      this.mountT = 0
      this.mountFrom = [this.x, this.z]
      this.mountTo = [this.path[1][0], this.path[1][1]]
      this.mountY0 = this.y
      this.mountY1 = 0
      this.mountYaw = this.yaw
      this.seg = 2
      return
    }
    this.mode = 'move'
    this.seg = 1
  }

  // ------------------------------------------------------------------ move

  private blockedAhead(env: BrainEnv, dirX: number, dirZ: number): boolean {
    if (env.player.active) {
      const dx = env.player.x - this.x
      const dz = env.player.z - this.z
      const d = Math.hypot(dx, dz)
      if (d < BRAIN.personalSpace) return true
      if (d < BRAIN.aheadDistance && (dx * dirX + dz * dirZ) / d > 0.25) return true
    }
    if (env.forklift.active) {
      const dx = env.forklift.x - this.x
      const dz = env.forklift.z - this.z
      const d = Math.hypot(dx, dz)
      if (d < BRAIN.forkliftSpace) return true
      if (d < BRAIN.forkliftAhead && (dx * dirX + dz * dirZ) / d > 0.2) return true
    }
    return false
  }

  private updateMove(dt: number, env: BrainEnv): void {
    this.lookYaw = null
    this.lean = this.lean * Math.exp(-6 * dt)
    this.y = this.y * Math.exp(-10 * dt)
    if (this.seg >= this.path.length) {
      this.arrive(env)
      return
    }
    // Mount onto a prop station for the final segment.
    const dest = this.mode === 'move' && this.toStation ? this.station(this.toStation) : null
    if (dest?.onProp && this.seg === this.path.length - 1 && this.path.length >= 3) {
      const ap = this.path[this.seg - 1]
      if (Math.hypot(ap[0] - this.x, ap[1] - this.z) < 0.35) {
        this.mode = 'mount'
        this.mountT = 0
        this.mountFrom = [this.x, this.z]
        this.mountTo = [dest.pos[0], dest.pos[1]]
        this.mountY0 = 0
        this.mountY1 = dest.y ?? 0
        this.mountYaw = dest.yaw
        return
      }
    }

    const target = this.path[this.seg]
    let dx = target[0] - this.x
    let dz = target[1] - this.z
    let d = Math.hypot(dx, dz)
    const last = this.seg === this.path.length - 1
    if (d < (last ? BRAIN.arriveTolerance : BRAIN.cornerRadius)) {
      this.seg++
      if (this.seg >= this.path.length) {
        this.arrive(env)
        return
      }
      const t2 = this.path[this.seg]
      dx = t2[0] - this.x
      dz = t2[1] - this.z
      d = Math.hypot(dx, dz)
    }
    if (d < 1e-6) return
    const dirX = dx / d
    const dirZ = dz / d

    if (this.blockedAhead(env, dirX, dirZ)) {
      this.blockedFor += dt
      this.speed = Math.max(0, this.speed - dt * 8)
      this.anim = this.carry ? 'carry' : 'idle'
      if (env.player.active) this.lookYaw = wrapAngle(yawTo(this.x, this.z, env.player.x, env.player.z) - this.yaw)
      if (this.blockedFor > BRAIN.sidestepAfter && !this.sidestepped) this.trySidestep(env, dirX, dirZ)
      else if (this.blockedFor > BRAIN.reverseAfter && !this.reversedOnce) this.reverse()
      else if (this.reversedOnce && this.blockedFor > BRAIN.giveUpAfter) this.snapTo(this.destination ?? this.stationId)
      return
    }
    this.blockedFor = Math.max(0, this.blockedFor - dt * 2)

    const desired = yawFromDirection(dirX, dirZ)
    this.yaw = dampAngle(this.yaw, desired, BRAIN.turnLambda, dt)
    const align = Math.cos(wrapAngle(desired - this.yaw))
    const factor = clamp((align - 0.15) / 0.85, 0.15, 1)
    const vmax = this.c.def.speed * (this.carry ? 0.85 : 1)
    const v = Math.min(this.speed + dt * 4, vmax * factor)
    const step = Math.min(v * dt, d)
    this.x += dirX * step
    this.z += dirZ * step
    this.speed = step / dt
    this.anim = this.carry ? 'carry' : 'walk'
  }

  private trySidestep(env: BrainEnv, dirX: number, dirZ: number): void {
    this.sidestepped = true
    // perpendicular directions; prefer the side away from the visitor
    const lx = -dirZ
    const lz = dirX
    const px = env.player.x - this.x
    const pz = env.player.z - this.z
    const side = px * lx + pz * lz > 0 ? -1 : 1
    for (const s of [side, -side]) {
      const cx = this.x + lx * s * BRAIN.sidestepDistance + dirX * 0.15
      const cz = this.z + lz * s * BRAIN.sidestepDistance + dirZ * 0.15
      if (env.isFree(cx, cz)) {
        this.path.splice(this.seg, 0, [cx, cz])
        this.blockedFor = BRAIN.sidestepAfter * 0.5
        return
      }
    }
  }

  /** Give up on this leg (once): walk back to the station we came from. */
  private reverse(): void {
    this.reversedOnce = true
    this.blockedFor = 0
    // Returning from a gag has no previous station: just keep waiting politely.
    if (this.mode !== 'move' || !this.fromStation) return
    const back: Vec2[] = [[this.x, this.z]]
    for (let i = this.seg - 1; i >= 0; i--) back.push(this.path[i])
    this.path = back
    this.seg = 1
    const prev = this.fromStation
    this.toStation = prev
    this.fromStation = null
    this.carry = false
    this.sidestepped = true
    const ri = this.c.def.routine.indexOf(prev)
    if (ri >= 0) this.routineIdx = ri
  }

  private arrive(env: BrainEnv): void {
    const id = this.mode === 'return' ? this.returnStation : this.toStation
    const st = id ? this.c.stations.get(id) : undefined
    this.mode = 'stay'
    this.carry = false
    this.solid = true
    if (st) {
      this.stationId = st.id
      const ri = this.c.def.routine.indexOf(st.id)
      if (ri >= 0) this.routineIdx = ri
      this.stayLeft = st.dur[0] + (st.dur[1] - st.dur[0]) * env.rand()
    } else this.stayLeft = 3
    this.toStation = null
    this.fromStation = null
    this.returnStation = null
    this.path = []
  }

  private updateMount(dt: number): void {
    this.mountT += dt
    const T = BRAIN.mountTime
    const u = clamp(this.mountT / T, 0, 1)
    const e = u * u * (3 - 2 * u)
    this.speed = 0
    this.carry = false
    this.lookYaw = null
    this.anim = 'sit'
    if (this.mode === 'mount') {
      this.yaw = dampAngle(this.yaw, this.mountYaw, 10, dt)
      this.x = this.mountFrom[0] + (this.mountTo[0] - this.mountFrom[0]) * e
      this.z = this.mountFrom[1] + (this.mountTo[1] - this.mountFrom[1]) * e
      this.y = this.mountY0 + (this.mountY1 - this.mountY0) * e + Math.sin(u * Math.PI) * 0.12
      if (u >= 1) {
        const id = this.toStation
        this.mode = 'move'
        this.seg = this.path.length
        this.x = this.mountTo[0]
        this.z = this.mountTo[1]
        this.y = this.mountY1
        this.yaw = this.mountYaw
        this.arriveAt(id)
      }
    } else {
      this.x = this.mountFrom[0] + (this.mountTo[0] - this.mountFrom[0]) * e
      this.z = this.mountFrom[1] + (this.mountTo[1] - this.mountFrom[1]) * e
      this.y = this.mountY0 + (this.mountY1 - this.mountY0) * e + Math.sin(u * Math.PI) * 0.1
      if (u >= 1) {
        this.y = 0
        this.mode = 'move'
        this.carry = this.fromStation && this.toStation ? this.c.carry.has(legKey(this.fromStation, this.toStation)) : false
      }
    }
  }

  private arriveAt(id: string | null): void {
    const st = id ? this.c.stations.get(id) : undefined
    this.mode = 'stay'
    if (st) {
      this.stationId = st.id
      this.stayLeft = st.dur[0] + (st.dur[1] - st.dur[0]) * 0.5
    }
    this.toStation = null
    this.fromStation = null
    this.path = []
  }

  // ------------------------------------------------------------------ queries

  /** Debug-friendly state label. */
  stateLabel(): string {
    if (this.mode === 'gag') return 'gag'
    if (this.reaction) return `react:${this.reaction.kind}`
    if (this.flashlight) return 'flashlight'
    if (this.mode === 'stay') return `stay:${this.stationId}`
    if (this.mode === 'move') return `move:${this.toStation ?? '?'}${this.blockedFor > 0.2 ? ' (waiting)' : ''}`
    return this.mode
  }

  /** Remaining polyline (for tests / debug). */
  remainingPath(): Vec2[] {
    return this.path.slice(Math.max(0, this.seg - 1))
  }

  get destination(): string | null {
    return this.mode === 'return' ? this.returnStation : this.toStation
  }
}
