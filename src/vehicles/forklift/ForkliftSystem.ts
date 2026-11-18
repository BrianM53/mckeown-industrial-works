import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import { interactionGroups, type RapierRigidBody } from '@react-three/rapier'
import { audio, type LoopHandle } from '@/audio/api'
import { CG } from '@/core/collision'
import { events } from '@/core/events'
import { clamp, wrapAngle } from '@/core/math'
import { createRng, hashString } from '@/core/rng'
import { runtime } from '@/core/runtime'
import { getService, type ForkliftService } from '@/core/services'
import type { Vec3 } from '@/core/types'
import { useSettings } from '@/state/settings'
import { isOverlayBlocking, useUIStore } from '@/state/ui'
import { director } from '@/systems/director'
import { CHECKPOINTS, PLAYABLE_BOUNDS, restrictedZoneAt } from '@/world/layout'
import { DRIVE, FORKLIFT, HOME, IMPACT, RECOVERY } from '../constants'
import type { PuffPool } from '../fx/Puffs'
import { OverturnDetector, StuckDetector } from '../logic/detectors'
import { capPlanar, engineRate, lateralGripFor, stepForwardSpeed, stepSteer, yawRateFor } from '../logic/drive'
import { chooseExitSpot, exitCandidates } from '../logic/exitSpot'
import type { Pose2 } from '../logic/geometry2d'
import { RouteGuard, type GuardAction } from '../logic/routeGuard'
import { SafePositionTracker, isSafePose } from '../logic/safePosition'
import { DriveInput, type DriveIntent } from './input'

/**
 * The forklift's brain. Pure-ish state machine driven from three places:
 *  - `step(dt)`       Rapier before-step (60 Hz): arcade controller, detectors
 *  - `afterStep()`    Rapier after-step: crash detection
 *  - `frame(dt)`      render loop: runtime.forklift, hints, audio, FX timers
 *  - `tick(dt)`       simClock: route guard (auto-return / auto-upright)
 * Visual animation lives in Forklift.tsx and reads this object.
 */

type World = RAPIER.World

/** Scene-query filters (membership, filter). */
const Q_GROUND = interactionGroups(CG.VEHICLE, [CG.STATIC, CG.PROP])
const Q_FLOOR = interactionGroups(CG.VEHICLE, [CG.STATIC])
const Q_WORKER = interactionGroups(CG.PLAYER, [CG.STATIC, CG.VEHICLE, CG.NPC, CG.PROP])
const Q_WORKER_NO_PROPS = interactionGroups(CG.PLAYER, [CG.STATIC, CG.VEHICLE, CG.NPC])
const Q_PARK = interactionGroups(CG.VEHICLE, [CG.STATIC, CG.PLAYER, CG.NPC])
const Q_WEDGED = interactionGroups(CG.VEHICLE, [CG.STATIC])

const HINT = {
  overturn: { desktop: 'Forklift on its side — press R to recover', touch: 'Forklift on its side — tap Recover' },
  stuck: { desktop: 'Forklift stuck? Press R to recover', touch: 'Forklift stuck? Tap Recover' },
}

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 }
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const _q = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _v = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _up = new THREE.Vector3()
const _pf = new THREE.Vector3()
const _exhaust = new THREE.Color()
const EXHAUST_IDLE = new THREE.Color('#8E8C86')
const EXHAUST_LOAD = new THREE.Color('#3E3D3A')

let sessionToastShown = false
let sessionAchievement = false

function isCoarsePointer(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

function finite3(v: { x: number; y: number; z: number }): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
}

export type RecoverReason = 'manual' | 'auto' | 'bounds' | 'debug'

export class ForkliftSystem {
  // ---- physics hookup
  body: RapierRigidBody | null = null
  world: World | null = null
  rapier: typeof RAPIER | null = null
  /** The RigidBody's object (rapier-interpolated transform). */
  group: THREE.Object3D | null = null
  puffs: PuffPool | null = null

  // ---- state
  occupied = false
  readonly input = new DriveInput()
  private readonly intent: DriveIntent = { throttle: 0, steer: 0, held: false }
  /** Smoothed steering (+1 = right). */
  steer = 0
  throttle = 0
  /** Signed forward speed at the front axle (m/s). */
  speed = 0
  yawRate = 0
  upDot = 1
  grounded = true
  /** Physics heading (latest step). */
  yaw: number = HOME.yaw
  /** Interpolated heading (render). */
  visualYaw: number = HOME.yaw
  readonly pos = new THREE.Vector3(HOME.x, 0, HOME.z)
  readonly quat = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, HOME.yaw)

  readonly overturn = new OverturnDetector()
  readonly stuck = new StuckDetector()
  readonly safe = new SafePositionTracker()
  readonly guard = new RouteGuard()

  // ---- crashes
  private readonly vSet = { x: 0, y: 0, z: 0 }
  private vSetValid = false
  private impactCooldown = 0
  /** Seconds the anti-roll/yaw assistance is suspended (after a crash kick / flip). */
  kickHold = 0
  /** For visuals: time since the last impact and its strength. */
  lastImpact = { t: 99, strength: 0 }
  private readonly rng = createRng(hashString('forklift-07'))

  // ---- bookkeeping
  private recoverCooldown = 0
  private hint: string | null = null
  private engine: LoopHandle | null = null
  private beepTimer = 0
  private hornCooldown = 0
  /** Seconds since the last horn (visual squash). */
  hornAge = 99
  private exhaustTimer = 0
  private captionCooldown = 0
  private syncX = 0
  private syncZ = 0
  private syncTimer = 0
  private mismatchFor = 0
  private orphanFor = 0
  private refusals = 0
  private time = 0
  private mounted = true

  // shapes / rays (created lazily per rapier instance)
  private ray: RAPIER.Ray | null = null
  private capsule: RAPIER.Capsule | null = null
  private parkBox: RAPIER.Cuboid | null = null
  private shapesFor: typeof RAPIER | null = null

  constructor() {
    this.input.isActive = () => this.occupied
    this.input.onHorn = () => this.horn()
  }

  // ======================================================================== lifecycle

  attach(world: World, rapier: typeof RAPIER): void {
    this.world = world
    this.rapier = rapier
    if (this.shapesFor !== rapier) {
      this.ray = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
      this.capsule = new rapier.Capsule(0.5, 0.33)
      const halfLen = (FORKLIFT.rearZ - FORKLIFT.frontZ) / 2
      this.parkBox = new rapier.Cuboid(FORKLIFT.halfWidth, 1.0, halfLen)
      this.shapesFor = rapier
    }
  }

  mount(): void {
    this.mounted = true
  }

  /** Unmount: never leave the visitor locked in a vehicle that no longer exists. */
  dispose(): void {
    if (this.occupied) this.exit()
    this.mounted = false
    this.stopEngine()
    this.setHint(null)
    this.input.clear()
    this.body = null
    this.group = null
  }

  // ======================================================================== services

  service(): ForkliftService {
    return {
      enter: () => {
        this.enter()
      },
      exit: () => {
        this.exit()
      },
      recover: () => {
        this.recover('manual')
      },
      isOccupied: () => this.occupied,
    }
  }

  /** Overturned (or badly tipped) right now. */
  get needsUpright(): boolean {
    return this.overturn.overturned || this.upDot < 0.5
  }

  // ======================================================================== enter / exit

  enter(): boolean {
    if (this.occupied || !this.body || !this.mounted) return false
    if (runtime.player.mode !== 'foot') return false
    if (this.needsUpright) {
      // walking up to a forklift on its side: E sets it back on its wheels first
      this.recover('manual')
      return false
    }
    const player = getService('player')
    const camera = getService('camera')
    this.occupied = true
    runtime.forklift.occupied = true
    this.input.suppressHeld()
    this.steer = 0
    this.stuck.reset()
    this.syncX = runtime.player.position.x
    this.syncZ = runtime.player.position.z
    this.syncTimer = 0.25
    this.mismatchFor = 0
    try {
      player?.setLocked(true, 'forklift')
      player?.setVisible(false)
      camera?.follow('forklift')
    } catch (err) {
      console.error('[vehicles] entering the forklift failed', err)
    }
    events.emit('forklift:enter', {})
    events.emit('sfx', { name: 'forklift-start', position: this.positionVec(0.8) })
    this.startEngine()
    if (!sessionAchievement) {
      sessionAchievement = true
      events.emit('achievement', { id: 'forklift-driver' })
    }
    if (!sessionToastShown) {
      sessionToastShown = true
      events.emit('toast', {
        text: isCoarsePointer()
          ? 'Forklift: left stick drives & steers · Horn button · Interact to climb out · Recover if you flip it'
          : 'Forklift: W/S throttle · A/D steer · H horn · E exit · R if you flip it (you will)',
        kind: 'info',
        duration: 7,
      })
    }
    return true
  }

  /**
   * Leave the forklift. When the player module is still in forklift mode we
   * pick a free spot (driver side first) and place the worker there; when it
   * already left (tackle / fast travel called us) we only tidy up.
   */
  exit(): boolean {
    if (!this.occupied) return false
    const stillSeated = runtime.player.mode === 'forklift'
    this.occupied = false
    runtime.forklift.occupied = false
    const player = getService('player')
    const camera = getService('camera')
    if (stillSeated && player) {
      try {
        const spot = this.findExitSpot()
        const facing = Number.isFinite(runtime.camera.yaw) ? runtime.camera.yaw : this.yaw
        if (spot) player.teleport(spot.x, spot.z, facing)
        else {
          const cp = this.nearestCheckpoint()
          player.teleport(cp.position[0], cp.position[1], cp.yaw)
        }
      } catch (err) {
        console.error('[vehicles] placing the worker failed', err)
      }
    }
    try {
      player?.setVisible(true)
      player?.setLocked(false, 'forklift')
      camera?.follow('player')
    } catch (err) {
      console.error('[vehicles] leaving the forklift failed', err)
    }
    events.emit('forklift:exit', {})
    this.stopEngine()
    this.setHint(null)
    this.stuck.reset()
    this.input.clear()
    return true
  }

  /** Where the worker steps out: driver side, other side, back, front, then rings. */
  findExitSpot(): { x: number; z: number } | null {
    const pose = { x: this.pos.x, z: this.pos.z, yaw: this.yaw }
    const cands = exitCandidates(pose)
    const b = PLAYABLE_BOUNDS
    const accept = (x: number, z: number) => x > b.minX + 0.5 && x < b.maxX - 0.5 && z > b.minZ + 0.5 && z < b.maxZ - 0.5 && !restrictedZoneAt(x, z)
    return chooseExitSpot(cands, (x, z) => this.workerSpotFree(x, z, true), accept) ?? chooseExitSpot(cands, (x, z) => this.workerSpotFree(x, z, false), accept)
  }

  private nearestCheckpoint() {
    let best = CHECKPOINTS[0]
    let bestD = Infinity
    for (const c of CHECKPOINTS) {
      const d = Math.hypot(c.position[0] - this.pos.x, c.position[1] - this.pos.z)
      if (d < bestD && this.workerSpotFree(c.position[0], c.position[1], false)) {
        bestD = d
        best = c
      }
    }
    return best
  }

  // ======================================================================== recovery

  /** R / recover button / auto: set the forklift upright at the last safe spot. */
  recover(reason: RecoverReason = 'manual'): boolean {
    if (!this.body || !this.mounted) return false
    if (reason === 'manual' && this.recoverCooldown > 0) return false
    this.recoverCooldown = RECOVERY.recoverCooldown
    const fromX = this.pos.x
    const fromY = this.pos.y
    const fromZ = this.pos.z
    const target = this.recoveryPose(reason === 'bounds')
    this.placeAt(target.x, target.z, target.yaw)
    const gentle = !!useSettings.getState().reducedMotion
    if (Number.isFinite(fromX) && Number.isFinite(fromZ) && Math.hypot(fromX - target.x, fromZ - target.z) > 1.5)
      this.puffs?.poof(fromX, Math.max(0, fromY), fromZ, { radius: 1.6, count: gentle ? 6 : 12, gentle })
    this.puffs?.poof(target.x, 0, target.z, { radius: 1.4, count: gentle ? 6 : 12, gentle })
    events.emit('sfx', { name: 'boing', position: [target.x, 0.8, target.z] })
    const position: Vec3 = [target.x, 0, target.z]
    events.emit('forklift:recovered', { position })
    if (reason !== 'auto') events.emit('toast', { text: 'Forklift recovered', kind: 'success', duration: 2 })
    else if (this.playerNear(target.x, target.z, 25)) events.emit('toast', { text: 'Someone set the forklift back on its wheels.', kind: 'info', duration: 3 })
    this.setHint(null)
    return true
  }

  /** Newest safe sample that is still free, else the home spot. */
  private recoveryPose(forceHome = false): Pose2 {
    if (!forceHome) {
      for (const s of this.safe.candidates()) {
        if (isSafePose(s) && this.parkFree(s)) return { x: s.x, z: s.z, yaw: s.yaw }
      }
    }
    return { x: HOME.x, z: HOME.z, yaw: HOME.yaw }
  }

  /** Back to the Maintenance Bay (route guard / debug). False if the bay spot is occupied. */
  returnHome(opts: { force?: boolean; quiet?: boolean } = {}): boolean {
    if (!this.body || this.occupied) return false
    const home = { x: HOME.x, z: HOME.z, yaw: HOME.yaw }
    if (!opts.force && !this.parkFree(home)) return false
    const fromX = this.pos.x
    const fromY = this.pos.y
    const fromZ = this.pos.z
    this.placeAt(home.x, home.z, home.yaw)
    this.safe.clear()
    const gentle = !!useSettings.getState().reducedMotion
    if (Number.isFinite(fromX) && Number.isFinite(fromZ)) this.puffs?.poof(fromX, Math.max(0, fromY), fromZ, { radius: 1.6, count: gentle ? 6 : 14, gentle })
    this.puffs?.poof(home.x, 0, home.z, { radius: 1.6, count: gentle ? 6 : 14, gentle })
    events.emit('sfx', { name: 'tube-whoosh', position: [home.x, 1, home.z] })
    if (!opts.quiet) events.emit('toast', { text: 'The forklift has been returned to the Maintenance Bay.', kind: 'info', duration: 4 })
    return true
  }

  /** Teleport the body (upright, at rest) and reset all motion state. */
  placeAt(x: number, z: number, yaw: number): void {
    const body = this.body
    if (!body || !Number.isFinite(x) || !Number.isFinite(z)) return
    const y = this.floorHeight(x, z) + 0.03
    const yw = Number.isFinite(yaw) ? yaw : HOME.yaw
    _q.setFromAxisAngle(Y_AXIS, yw)
    try {
      body.setTranslation({ x, y, z }, true)
      body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true)
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    } catch {
      return
    }
    this.pos.set(x, y, z)
    this.quat.copy(_q)
    this.yaw = yw
    this.visualYaw = yw
    this.speed = 0
    this.steer = 0
    this.yawRate = 0
    this.upDot = 1
    this.grounded = true
    this.kickHold = 0
    this.vSetValid = false
    this.overturn.reset()
    this.stuck.reset()
    // snap the interpolated visual so there is no one-frame smear across the map
    if (this.group) {
      this.group.position.set(x, y, z)
      this.group.quaternion.copy(_q)
    }
  }

  /** Debug: roll it onto its side. */
  flip(): void {
    const body = this.body
    if (!body) return
    _q.setFromAxisAngle(Y_AXIS, this.yaw)
    _q2.setFromAxisAngle(_v.set(0, 0, -1), 1.8)
    _q.multiply(_q2)
    try {
      body.setTranslation({ x: this.pos.x, y: Math.max(0, this.pos.y) + 0.95, z: this.pos.z }, true)
      body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true)
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    } catch {
      /* ignore */
    }
    this.kickHold = 2
    this.vSetValid = false
  }

  // ======================================================================== horn

  horn(): void {
    if (!this.occupied || this.hornCooldown > 0) return
    this.hornCooldown = 0.35
    this.hornAge = 0
    events.emit('forklift:horn', { position: this.positionVec(1.2) })
    if (this.captionCooldown <= 0) {
      this.captionCooldown = 5
      events.emit('caption', { text: 'Forklift horn: HONK', kind: 'sound', duration: 1.6 })
    }
  }

  // ======================================================================== physics step

  step(dt: number): void {
    const body = this.body
    const world = this.world
    if (!body || !world || !this.rapier || !(dt > 0)) return
    this.time += dt
    this.impactCooldown = Math.max(0, this.impactCooldown - dt)
    this.kickHold = Math.max(0, this.kickHold - dt)
    this.recoverCooldown = Math.max(0, this.recoverCooldown - dt)

    let t: { x: number; y: number; z: number }
    let r: { x: number; y: number; z: number; w: number }
    try {
      t = body.translation()
      r = body.rotation()
    } catch {
      return
    }
    // ---- NaN / fell out of the world / escaped the playable area → recover
    if (!finite3(t) || !Number.isFinite(r.w)) {
      this.placeAt(HOME.x, HOME.z, HOME.yaw)
      return
    }
    const b = PLAYABLE_BOUNDS
    const slack = RECOVERY.boundsSlack
    if (t.y < RECOVERY.killY || t.x < b.minX - slack || t.x > b.maxX + slack || t.z < b.minZ - slack || t.z > b.maxZ + slack) {
      this.recover('bounds')
      return
    }

    this.pos.set(t.x, t.y, t.z)
    this.quat.set(r.x, r.y, r.z, r.w)
    _fwd.set(0, 0, -1).applyQuaternion(this.quat)
    _up.set(0, 1, 0).applyQuaternion(this.quat)
    this.upDot = _up.y
    if (Math.hypot(_fwd.x, _fwd.z) > 0.15) this.yaw = Math.atan2(-_fwd.x, -_fwd.z)
    const fx = -Math.sin(this.yaw)
    const fz = -Math.cos(this.yaw)
    const rx = Math.cos(this.yaw)
    const rz = -Math.sin(this.yaw)

    this.grounded = this.upDot > 0.5 && (this.groundUnder(0, FORKLIFT.frontAxleZ) || this.groundUnder(0, FORKLIFT.rearAxleZ))

    const lv = body.linvel()
    const av = body.angvel()
    const com = body.worldCom()
    let vx = lv.x
    let vy = lv.y
    let vz = lv.z
    let wx = av.x
    let wy = av.y
    let wz = av.z
    // velocity of the front axle (rear-steer pivot) on the ground plane
    _pf.set(0, 0.3, FORKLIFT.frontAxleZ).applyQuaternion(this.quat).add(this.pos)
    const ex = _pf.x - com.x
    const ez = _pf.z - com.z
    const vfx = vx + wy * ez
    const vfz = vz - wy * ex
    const v = vfx * fx + vfz * fz
    const slip = vfx * rx + vfz * rz

    const testing = this.input.testActive
    this.input.read(this.intent, this.occupied)
    this.throttle = this.intent.throttle
    const control = this.grounded && this.upDot > 0.6
    let changed = false
    if (control) {
      const parked = !this.occupied && !testing
      this.steer = stepSteer(this.steer, this.intent.steer, dt)
      const v2 = stepForwardSpeed(v, this.intent.throttle, dt, parked)
      const wTarget = yawRateFor(v2, this.steer)
      const active = this.occupied || testing || Math.abs(v) > 0.03 || Math.abs(slip) > 0.03 || Math.abs(wy) > 0.03
      if (active) {
        const grip = lateralGripFor(v2, this.steer)
        const wy2 = this.kickHold > 0 ? wy : wy + (wTarget - wy) * DRIVE.yawGrip
        const slip2 = slip * (1 - grip)
        const nfx = fx * v2 + rx * slip2
        const nfz = fz * v2 + rz * slip2
        vx = nfx - wy2 * ez
        vz = nfz + wy2 * ex
        wy = wy2
        if (this.upDot > DRIVE.antiRollMinUp && this.kickHold <= 0) {
          wx *= 1 - DRIVE.antiRoll
          wz *= 1 - DRIVE.antiRoll
        }
        changed = true
      }
      this.speed = v2
    } else {
      this.steer = stepSteer(this.steer, this.occupied ? this.intent.steer : 0, dt)
      this.speed = v
    }
    this.yawRate = wy

    // ---- caps: stable, no tunneling, no orbit
    const planar = { x: vx, z: vz }
    if (capPlanar(planar, DRIVE.maxSpeed)) {
      vx = planar.x
      vz = planar.z
      changed = true
    }
    if (vy > DRIVE.maxRiseSpeed) {
      vy = DRIVE.maxRiseSpeed
      changed = true
    }
    const wl = Math.hypot(wx, wy, wz)
    if (wl > DRIVE.maxAngular) {
      const k = DRIVE.maxAngular / wl
      wx *= k
      wy *= k
      wz *= k
      changed = true
    }
    if (changed) {
      body.setLinvel({ x: vx, y: vy, z: vz }, true)
      body.setAngvel({ x: wx, y: wy, z: wz }, true)
    }
    this.vSet.x = vx
    this.vSet.y = vy
    this.vSet.z = vz
    this.vSetValid = true

    // ---- detectors
    const ov = this.overturn.update(dt, this.upDot)
    if (ov === 'overturned') {
      events.emit('forklift:overturned', { position: this.positionVec(0.5) })
      if (this.occupied) events.emit('achievement', { id: 'forklift-flipped' })
    }
    if (this.occupied && control) this.stuck.update(dt, this.intent.held, Math.hypot(vx, vz))
    else if (!this.occupied) this.stuck.reset()

    this.safe.update(dt, () => {
      if (this.upDot < 0.94 || !this.grounded || Math.abs(wy) > 1.6 || this.overturn.overturned) return null
      const pose = { x: this.pos.x, z: this.pos.z, yaw: this.yaw }
      return this.wedged(pose) ? null : pose
    })
  }

  /** After the world stepped: an unexplained velocity jump is a crash. */
  afterStep(): void {
    const body = this.body
    if (!body || !this.vSetValid) return
    this.vSetValid = false
    let lv: { x: number; y: number; z: number }
    try {
      lv = body.linvel()
    } catch {
      return
    }
    if (!finite3(lv)) return
    const dx = lv.x - this.vSet.x
    const dz = lv.z - this.vSet.z
    const h = Math.hypot(dx, dz)
    const landing = this.vSet.y < -2.5 ? Math.max(0, lv.y - this.vSet.y - 0.4) : 0
    const dv = Math.max(h, landing * 0.7)
    if (dv < IMPACT.minDeltaV || this.impactCooldown > 0) return
    this.impactCooldown = IMPACT.cooldown
    const strength = clamp(dv / IMPACT.fullDeltaV, 0.12, 1)
    this.lastImpact.t = 0
    this.lastImpact.strength = strength
    events.emit('forklift:impact', { position: this.positionVec(0.6), strength })
    if (this.occupied) events.emit('shake', { intensity: 0.1 + 0.32 * strength, duration: 0.18 + 0.22 * strength })
    // a puff of dust where we hit
    if (this.puffs && h > 0.5) {
      const ox = this.pos.x - (dx / h) * 1.4
      const oz = this.pos.z - (dz / h) * 1.4
      const n = strength > 0.5 ? 5 : 3
      for (let i = 0; i < n; i++)
        this.puffs.emit(ox + (this.rng() - 0.5) * 0.8, 0.25 + this.rng() * 0.4, oz + (this.rng() - 0.5) * 0.8, {
          vx: (this.rng() - 0.5) * 1.6,
          vy: 0.8 + this.rng() * 0.6,
          vz: (this.rng() - 0.5) * 1.6,
          life: 0.7,
          size0: 0.12,
          size1: 0.28 + strength * 0.2,
          color: '#C9BFAE',
          drag: 2.2,
        })
    }
    if (this.occupied && h >= landing && strength >= IMPACT.kickMin && this.grounded) this.crashKick(dx, dz, h, strength)
  }

  /** Comedic stoppie / tip: tilt the top toward where we were going. */
  private crashKick(dx: number, dz: number, h: number, strength: number): void {
    const body = this.body
    if (!body || h < 1e-4) return
    const s = clamp((strength - IMPACT.kickMin) / (1 - IMPACT.kickMin), 0, 1)
    if (s <= 0) return
    const lx = -dx / h
    const lz = -dz / h
    const fx = -Math.sin(this.yaw)
    const fz = -Math.cos(this.yaw)
    const rx = Math.cos(this.yaw)
    const rz = -Math.sin(this.yaw)
    const lf = lx * fx + lz * fz
    const ll = lx * rx + lz * rz
    const jitter = 0.8 + 0.4 * this.rng()
    const mp = IMPACT.kickPitch * s * Math.abs(lf) * jitter
    const mr = IMPACT.kickRoll * s * Math.abs(ll) * jitter
    const sp = lf >= 0 ? 1 : -1
    const sr = ll >= 0 ? 1 : -1
    // axis = Y × d tips the top toward d: Y × (x, 0, z) = (z, 0, -x)
    const ax = sp * fz * mp + sr * rz * mr
    const az = -sp * fx * mp - sr * rx * mr
    try {
      const av = body.angvel()
      body.setAngvel({ x: av.x + ax, y: av.y, z: av.z + az }, true)
    } catch {
      return
    }
    this.kickHold = 0.9
  }

  // ======================================================================== frame

  frame(dtRaw: number): void {
    const dt = clamp(Number.isFinite(dtRaw) ? dtRaw : 0, 0, 0.1)
    this.hornCooldown = Math.max(0, this.hornCooldown - dt)
    this.captionCooldown = Math.max(0, this.captionCooldown - dt)
    this.hornAge += dt
    this.lastImpact.t += dt
    const g = this.group
    const f = runtime.forklift
    if (g && finite3(g.position)) {
      f.position.copy(g.position)
      _fwd.set(0, 0, -1).applyQuaternion(g.quaternion)
      if (Math.hypot(_fwd.x, _fwd.z) > 0.15) this.visualYaw = Math.atan2(-_fwd.x, -_fwd.z)
    }
    f.yaw = this.visualYaw
    f.speed = Number.isFinite(this.speed) ? this.speed : 0
    f.occupied = this.occupied
    f.upright = !this.overturn.overturned

    this.watchPlayerMode(dt)
    if (this.occupied) {
      this.syncParkedWorker(dt)
      this.updateEngine(dt)
    }
    this.updateHint()
  }

  /** Keep our idea of "occupied" and the player module's mode in agreement (softlock guard). */
  private watchPlayerMode(dt: number): void {
    const mode = runtime.player.mode
    if (this.occupied && mode !== 'forklift') {
      this.mismatchFor += dt
      if (this.mismatchFor > 0.25) {
        this.mismatchFor = 0
        this.exit()
      }
    } else this.mismatchFor = 0
    if (!this.occupied && mode === 'forklift') {
      this.orphanFor += dt
      if (this.orphanFor > 0.6) {
        this.orphanFor = 0
        try {
          getService('player')?.setVisible(true)
          getService('player')?.setLocked(false, 'forklift')
          getService('camera')?.follow('player')
        } catch {
          /* ignore */
        }
      }
    } else this.orphanFor = 0
  }

  /**
   * The worker's (hidden, non-colliding) body stays where they climbed in. Keep
   * it near the forklift so the player module treats our exit placement as a
   * short hop (smooth camera instead of a hard cut).
   */
  private syncParkedWorker(dt: number): void {
    if (runtime.player.mode !== 'forklift') return
    this.syncTimer -= dt
    if (this.syncTimer > 0) return
    this.syncTimer = 0.25
    const p = runtime.forklift.position
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return
    if (Math.hypot(p.x - this.syncX, p.z - this.syncZ) < 5) return
    this.syncX = p.x
    this.syncZ = p.z
    try {
      getService('player')?.teleport(p.x, p.z, this.visualYaw)
    } catch {
      /* ignore */
    }
  }

  private startEngine(): void {
    if (this.engine) return
    try {
      this.engine = audio.loop('forklift-engine', { position: this.positionVec(0.9), volume: 0.85, rate: 1 })
    } catch {
      this.engine = null
    }
  }

  private stopEngine(): void {
    const e = this.engine
    this.engine = null
    if (e) {
      try {
        e.stop()
      } catch {
        /* ignore */
      }
    }
  }

  private updateEngine(dt: number): void {
    const p = runtime.forklift.position
    const e = this.engine
    if (e) {
      e.setRate(engineRate(this.speed, this.throttle))
      e.setPosition(p.x, p.y + 0.9, p.z)
    }
    // reverse beeper
    if (this.speed < -0.25) {
      this.beepTimer -= dt
      if (this.beepTimer <= 0) {
        this.beepTimer = 0.85
        events.emit('sfx', { name: 'forklift-beep', position: [p.x, p.y + 1.2, p.z] })
      }
    } else this.beepTimer = 0
  }

  /** Exhaust: call from the render loop with the pipe tip in world space. */
  exhaust(dt: number, x: number, y: number, z: number, lowQuality: boolean): void {
    if (!this.occupied || !this.puffs) return
    this.exhaustTimer -= dt
    if (this.exhaustTimer > 0) return
    const load = clamp(Math.abs(this.speed) / DRIVE.maxForward + Math.abs(this.throttle) * 0.5, 0, 1)
    this.exhaustTimer = (0.5 - 0.32 * load) * (lowQuality ? 1.8 : 1)
    // idle: light grey wisps; flat out: darker, bigger diesel clouds
    _exhaust.copy(EXHAUST_IDLE).lerp(EXHAUST_LOAD, load)
    this.puffs.emit(x, y, z, {
      vx: (this.rng() - 0.5) * 0.3,
      vy: 0.9 + load * 0.6,
      vz: (this.rng() - 0.5) * 0.3,
      life: 1.1 + this.rng() * 0.4,
      size0: 0.06,
      size1: 0.2 + load * 0.12,
      color: _exhaust,
      lift: 0.5,
      drag: 1.4,
    })
  }

  private updateHint(): void {
    let want: string | null = null
    if (this.occupied) {
      const touch = isCoarsePointer()
      if (this.overturn.overturned) want = touch ? HINT.overturn.touch : HINT.overturn.desktop
      else if (this.stuck.stuck) want = touch ? HINT.stuck.touch : HINT.stuck.desktop
    }
    this.setHint(want)
  }

  /** Only ever clear a hint we set (the player module owns the on-foot one). */
  private setHint(text: string | null): void {
    if (text === this.hint) return
    const ui = useUIStore.getState()
    if (text) ui.setRecoveryHint(text)
    else if (this.hint && ui.recoveryHint === this.hint) ui.setRecoveryHint(null)
    this.hint = text
  }

  // ======================================================================== route guard (simClock)

  tick(dt: number): void {
    if (!this.body || !this.mounted) return
    const action: GuardAction = this.guard.update(dt, {
      x: this.pos.x,
      z: this.pos.z,
      yaw: this.yaw,
      occupied: this.occupied,
      upright: !this.overturn.overturned && this.upDot > 0.5,
    })
    if (!action) return
    const id = action === 'return' ? 'vehicles:forklift-return' : 'vehicles:forklift-upright'
    let ok = director.request({ id, kind: 'ambient', cooldown: 4, duration: 1.5 })
    if (!ok) {
      // Never block a route forever: after ~a minute of refusals (ambient events
      // off, busy director) do it anyway — but never over an open panel.
      this.refusals++
      if (this.refusals >= 20 && !isOverlayBlocking()) ok = director.request({ id, kind: 'ambient', cooldown: 4, duration: 1.5, force: true })
    }
    if (!ok) {
      this.guard.deferred()
      return
    }
    this.refusals = 0
    const done = action === 'return' ? this.returnHome() : this.recover('auto')
    director.end(id)
    if (done) this.guard.done()
    else this.guard.deferred()
  }

  // ======================================================================== world queries

  private positionVec(dy = 0): Vec3 {
    const p = runtime.forklift.position
    return [p.x, p.y + dy, p.z]
  }

  private playerNear(x: number, z: number, d: number): boolean {
    const p = runtime.player.position
    return Math.hypot(p.x - x, p.z - z) < d
  }

  /** Ray down under a local (x, z) point of the vehicle: is there ground within reach? */
  private groundUnder(localX: number, localZ: number): boolean {
    const w = this.world
    const ray = this.ray
    const body = this.body
    if (!w || !ray || !body || !this.rapier) return true
    _v.set(localX, 0.45, localZ).applyQuaternion(this.quat).add(this.pos)
    ray.origin.x = _v.x
    ray.origin.y = _v.y
    ray.origin.z = _v.z
    ray.dir.x = 0
    ray.dir.y = -1
    ray.dir.z = 0
    try {
      return !!w.castRay(ray, 0.8, true, this.rapier.QueryFilterFlags.EXCLUDE_SENSORS, Q_GROUND, undefined, body)
    } catch {
      return true
    }
  }

  /** Height of the floor (static) under (x, z), searching from 3 m down. */
  floorHeight(x: number, z: number): number {
    const w = this.world
    const ray = this.ray
    if (!w || !ray || !this.rapier) return 0
    ray.origin.x = x
    ray.origin.y = 3
    ray.origin.z = z
    ray.dir.x = 0
    ray.dir.y = -1
    ray.dir.z = 0
    try {
      const hit = w.castRay(ray, 8, true, this.rapier.QueryFilterFlags.EXCLUDE_SENSORS, Q_FLOOR, undefined, this.body ?? undefined)
      if (!hit || !Number.isFinite(hit.timeOfImpact)) return 0
      const y = 3 - hit.timeOfImpact
      return y < -1 || y > 2.5 ? 0 : y
    } catch {
      return 0
    }
  }

  /** Can a worker stand at (x, z)? Static/vehicle/NPC (and optionally prop) overlap + floor below. */
  workerSpotFree(x: number, z: number, withProps: boolean): boolean {
    const w = this.world
    const shape = this.capsule
    if (!w || !shape || !this.rapier) return true
    const gy = this.floorHeight(x, z)
    if (gy > 0.6) return false
    try {
      const hit = w.intersectionWithShape(
        { x, y: gy + 0.9 + 0.04, z },
        IDENTITY,
        shape,
        this.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
        withProps ? Q_WORKER : Q_WORKER_NO_PROPS,
      )
      return !hit
    } catch {
      return true
    }
  }

  private boxAt(pose: Pose2): { center: { x: number; y: number; z: number }; rot: { x: number; y: number; z: number; w: number } } {
    // the footprint centre sits this far AHEAD of the origin (forks are long, the tail is short)
    const ahead = -(FORKLIFT.frontZ + FORKLIFT.rearZ) / 2
    _q.setFromAxisAngle(Y_AXIS, pose.yaw)
    const cx = pose.x - Math.sin(pose.yaw) * ahead
    const cz = pose.z - Math.cos(pose.yaw) * ahead
    return { center: { x: cx, y: 1.28, z: cz }, rot: { x: _q.x, y: _q.y, z: _q.z, w: _q.w } }
  }

  /** Is the forklift footprint at `pose` free of walls, machines, the worker and NPCs? */
  parkFree(pose: Pose2): boolean {
    const w = this.world
    const shape = this.parkBox
    if (!w || !shape || !this.rapier) return true
    const { center, rot } = this.boxAt(pose)
    try {
      return !w.intersectionWithShape(center, rot, shape, this.rapier.QueryFilterFlags.EXCLUDE_SENSORS, Q_PARK, undefined, this.body ?? undefined)
    } catch {
      return true
    }
  }

  /** Overlapping static geometry right now (never record such a spot as safe). */
  private wedged(pose: Pose2): boolean {
    const w = this.world
    const shape = this.parkBox
    if (!w || !shape || !this.rapier) return false
    const { center, rot } = this.boxAt(pose)
    try {
      return !!w.intersectionWithShape(center, rot, shape, this.rapier.QueryFilterFlags.EXCLUDE_SENSORS, Q_WEDGED, undefined, this.body ?? undefined)
    } catch {
      return false
    }
  }

  // ======================================================================== debug

  debugApi() {
    const round = (n: number) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : n)
    return {
      enter: () => this.enter(),
      exit: () => this.exit(),
      flip: () => this.flip(),
      recover: () => this.recover('debug'),
      returnHome: () => this.returnHome({ force: true }),
      horn: () => this.horn(),
      /** Programmatic driving input for tests: throttle/steer in -1..1 for `ms`. */
      drive: (throttle: number, steer: number, ms = 1000) => this.input.setTest(throttle, steer, ms),
      /** Place the forklift (upright, at rest). */
      teleport: (x: number, z: number, yaw?: number) => this.placeAt(x, z, yaw ?? this.yaw),
      getState: () => {
        const ls = this.safe.latest()
        const p = runtime.forklift.position
        return {
          position: [round(p.x), round(p.y), round(p.z)],
          yaw: round(wrapAngle(runtime.forklift.yaw)),
          speed: round(this.speed),
          upright: !this.overturn.overturned,
          upDot: round(this.upDot),
          occupied: this.occupied,
          grounded: this.grounded,
          stuck: this.stuck.stuck,
          steer: round(this.steer),
          sleeping: (() => {
            try {
              return this.body?.isSleeping() ?? null
            } catch {
              return null
            }
          })(),
          lastSafe: ls ? [round(ls.x), round(ls.z)] : null,
          guard: { blockingFor: round(this.guard.blockingFor), idleFor: round(this.guard.idleFor) },
          lastImpact: { ago: round(this.lastImpact.t), strength: round(this.lastImpact.strength) },
          hint: this.hint,
        }
      },
    }
  }
}
