import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { Collider, KinematicCharacterController, RigidBody, World } from '@dimforge/rapier3d-compat'
import { interactionGroups } from '@react-three/rapier'
import { CG, GROUPS } from '@/core/collision'
import { clamp, dampAngle } from '@/core/math'
import type { PlayerMode } from '@/core/types'
import { PLAYABLE_BOUNDS, restrictedZoneAt } from '@/world/layout'
import { PLAYER, RECOVERY } from './constants'
import { FootstepCounter } from './gait'
import type { InputManager, MoveInput } from './input'
import { approachVelocity, targetVelocity, turnToward, verticalVelocity, type Planar } from './movement'
import { SafePositionTracker, StuckDetector, type SafePos } from './recovery'

/**
 * Fixed-step kinematic character controller (runs in Rapier's before-step
 * callback at 60 Hz). Owns the worker's physical state; the frame loop reads it
 * for visuals/camera and writes the shared runtime.
 */

/** Query groups: things the worker must not be placed inside. */
const OVERLAP_GROUPS = interactionGroups(CG.PLAYER, [CG.STATIC, CG.VEHICLE])
/** Query groups: walkable static ground. */
const GROUND_GROUPS = interactionGroups(CG.PLAYER, [CG.STATIC])
/**
 * Feet height of the parked capsule while the worker sits in a vehicle: far
 * below the ground slab, so even a stale contact can never touch anything.
 */
export const PARK_Y = -60

export interface ControllerEvents {
  footstep(x: number, y: number, z: number, run: boolean, surface: 'concrete' | 'metal'): void
  clockedIn(): void
}

type KnockState = { vx: number; vz: number; friction: number }

export class PlayerController {
  world: World | null = null
  rapier: typeof RAPIER | null = null
  body: RigidBody | null = null
  collider: Collider | null = null
  kcc: KinematicCharacterController | null = null
  private probeShape: RAPIER.Capsule | null = null

  /** Feet position after the latest physics step (body translation). */
  pos = new THREE.Vector3()
  /** Internal planar velocity (what the input asks for, after accel). */
  vel: Planar = { x: 0, z: 0 }
  vy = 0
  /** Smoothed measured velocity (actual displacement / dt). */
  measured = new THREE.Vector3()
  facing = 0
  grounded = true
  mode: PlayerMode = 'foot'
  visible = true
  running = false
  /** Movement input is being held (and allowed). */
  inputActive = false
  time = 0
  /** Frames for which visuals must snap to the body (after teleports). */
  snapVisual = 0
  /** Number of physics steps taken (debug). */
  steps = 0
  readonly locks = new Set<string>()
  readonly footsteps = new FootstepCounter()
  readonly stuck = new StuckDetector()
  readonly safe = new SafePositionTracker()
  knock: KnockState | null = null
  /** Temporary facing override (turn toward an interaction target). */
  private faceYaw: number | null = null
  private faceUntil = 0
  private clockInDist = 0
  private clockedIn = false
  /** True when a teleport happened while driving (vehicles module placed us). */
  teleportedWhileDriving = false
  /**
   * Seated in a vehicle: the capsule is disabled, in no collision group and
   * parked at PARK_Y (Rapier can keep contacts alive for a disabled collider
   * after its body moves). `pos` then holds the logical spot — where the worker
   * entered, or where a teleport while driving asked us to stand on exit.
   */
  parked = false
  /** Physics reported a non-finite position (frame loop respawns us). */
  corrupt = false

  private readonly input: MoveInput = { x: 0, y: 0, run: false }
  private readonly target: Planar = { x: 0, z: 0 }
  private readonly desired = { x: 0, y: 0, z: 0 }

  constructor(private readonly ev: ControllerEvents) {}

  // ------------------------------------------------------------------ physics lifecycle

  attach(world: World, rapier: typeof RAPIER): void {
    this.detach()
    this.world = world
    this.rapier = rapier
    const c = world.createCharacterController(PLAYER.skin)
    c.setUp({ x: 0, y: 1, z: 0 })
    c.setSlideEnabled(true)
    c.enableAutostep(PLAYER.autostepHeight, PLAYER.autostepMinWidth, false)
    c.enableSnapToGround(PLAYER.snapToGround)
    c.setMaxSlopeClimbAngle(PLAYER.maxClimbAngle)
    c.setMinSlopeSlideAngle(PLAYER.minSlideAngle)
    c.setApplyImpulsesToDynamicBodies(true)
    c.setCharacterMass(PLAYER.mass)
    this.kcc = c
    this.probeShape = new rapier.Capsule(PLAYER.halfHeight - 0.05, PLAYER.radius - 0.05)
  }

  detach(): void {
    if (this.kcc && this.world) {
      try {
        this.world.removeCharacterController(this.kcc)
      } catch {
        /* world already freed */
      }
    }
    this.kcc = null
    this.world = null
    this.rapier = null
    this.probeShape = null
  }

  get locked(): boolean {
    return this.locks.size > 0
  }

  setLocked(locked: boolean, reason: string): void {
    const r = reason || 'unspecified'
    if (locked) this.locks.add(r)
    else this.locks.delete(r)
  }

  /** Can the visitor steer right now? */
  get controllable(): boolean {
    return this.mode === 'foot' && !this.locked
  }

  faceToward(yaw: number, seconds: number): void {
    this.faceYaw = yaw
    this.faceUntil = this.time + seconds
  }

  // ------------------------------------------------------------------ fixed step

  fixedStep(dt: number, input: InputManager, cameraYaw: number): void {
    const body = this.body
    const col = this.collider
    const kcc = this.kcc
    if (!body || !col || !kcc || !this.world || !this.rapier) return
    this.time += dt
    this.steps++
    if (this.parked || this.mode === 'forklift') {
      // Seated: the capsule stays parked and non-colliding; the frame loop mirrors the seat.
      // `pos` keeps the logical spot (never the parked body's translation).
      if (this.parked) this.keepParked(body, col)
      this.vel.x = this.vel.z = 0
      this.vy = 0
      this.inputActive = false
      this.running = false
      this.measured.set(0, 0, 0)
      return
    }
    const t = body.translation()
    if (!Number.isFinite(t.x) || !Number.isFinite(t.y) || !Number.isFinite(t.z)) {
      this.corrupt = true
      return
    }
    this.pos.set(t.x, t.y, t.z)

    // ---- input
    const steer = this.controllable
    const mi = steer ? input.move(this.input) : ((this.input.x = 0), (this.input.y = 0), (this.input.run = false), this.input)
    const mag = Math.hypot(mi.x, mi.y)
    this.inputActive = steer && mag > 0.2

    // ---- planar velocity
    if (this.knock) {
      const k = this.knock
      if (this.grounded) {
        const sp = Math.hypot(k.vx, k.vz)
        const ns = Math.max(0, sp - k.friction * dt)
        const f = sp > 1e-6 ? ns / sp : 0
        k.vx *= f
        k.vz *= f
      }
      this.vel.x = k.vx
      this.vel.z = k.vz
    } else {
      targetVelocity(mi.x, mi.y, cameraYaw, mi.run, this.target)
      approachVelocity(this.vel, this.target, PLAYER.accel, PLAYER.decel, dt)
    }
    this.vy = verticalVelocity(this.vy, this.grounded, dt)

    // ---- collide & slide
    this.desired.x = this.vel.x * dt
    this.desired.y = this.vy * dt
    this.desired.z = this.vel.z * dt
    let mx = this.desired.x
    let my = this.desired.y
    let mz = this.desired.z
    try {
      kcc.computeColliderMovement(col, this.desired, this.rapier.QueryFilterFlags.EXCLUDE_SENSORS, GROUPS.player)
      const m = kcc.computedMovement()
      mx = m.x
      my = m.y
      mz = m.z
      this.grounded = kcc.computedGrounded()
    } catch {
      this.grounded = this.pos.y <= 0.05
    }
    if (!Number.isFinite(mx) || !Number.isFinite(my) || !Number.isFinite(mz)) {
      mx = my = mz = 0
    }
    if (this.grounded && this.vy < 0) this.vy = -1.5

    let nx = this.pos.x + mx
    let ny = this.pos.y + my
    let nz = this.pos.z + mz
    // ---- keep inside the playable rectangle
    const b = PLAYABLE_BOUNDS
    if (nx < b.minX || nx > b.maxX) {
      nx = clamp(nx, b.minX, b.maxX)
      this.vel.x = 0
      if (this.knock) this.knock.vx = 0
    }
    if (nz < b.minZ || nz > b.maxZ) {
      nz = clamp(nz, b.minZ, b.maxZ)
      this.vel.z = 0
      if (this.knock) this.knock.vz = 0
    }
    if (ny > 50) ny = 50
    body.setNextKinematicTranslation({ x: nx, y: ny, z: nz })

    // ---- measured velocity (smoothed) & facing
    const ax = (nx - this.pos.x) / dt
    const ay = (ny - this.pos.y) / dt
    const az = (nz - this.pos.z) / dt
    const k = 1 - Math.exp(-20 * dt)
    this.measured.x += (ax - this.measured.x) * k
    this.measured.y += (ay - this.measured.y) * k
    this.measured.z += (az - this.measured.z) * k
    const planar = Math.hypot(nx - this.pos.x, nz - this.pos.z)
    const speed = Math.hypot(this.measured.x, this.measured.z)
    this.running = mi.run && this.inputActive && speed > PLAYER.walkSpeed * 0.9

    if (this.faceYaw !== null && this.time < this.faceUntil) {
      this.facing = dampAngle(this.facing, this.faceYaw, 16, dt)
    } else {
      this.faceYaw = null
      if (!this.knock && this.inputActive) this.facing = turnToward(this.facing, this.target.x, this.target.z, dt)
    }

    // ---- footsteps
    if (this.grounded && planar > 1e-4 && !this.knock) {
      const n = this.footsteps.add(planar, speed)
      if (n > 0) this.ev.footstep(nx, ny - PLAYER.skin, nz, this.running, ny > 0.3 ? 'metal' : 'concrete')
    } else if (speed < 0.2) {
      this.footsteps.reset()
    }

    // ---- clocked in (first real, player-driven movement)
    if (!this.clockedIn && this.inputActive) {
      this.clockInDist += planar
      if (this.clockInDist >= PLAYER.clockInDistance) {
        this.clockedIn = true
        this.ev.clockedIn()
      }
    }

    // ---- stuck detection & safe positions
    this.stuck.update(dt, this.inputActive && !this.knock, nx, nz)
    this.safe.update(dt, () => this.sampleSafe(nx, ny, nz))

    this.pos.set(nx, ny, nz)
  }

  /** Validated safe position at (x, y, z), or null. */
  private sampleSafe(x: number, y: number, z: number): SafePos | null {
    if (!this.grounded || this.mode !== 'foot' || this.locked || this.knock || this.stuck.stuck) return null
    const b = PLAYABLE_BOUNDS
    if (x < b.minX + 0.2 || x > b.maxX - 0.2 || z < b.minZ + 0.2 || z > b.maxZ - 0.2) return null
    if (restrictedZoneAt(x, z)) return null
    if (!this.isFreeSpot(x, y, z)) return null
    return { x, y, z, yaw: this.facing, t: this.time }
  }

  /** No static/vehicle overlap for the capsule at feet (x, y, z) and static ground underneath. */
  isFreeSpot(x: number, y: number, z: number): boolean {
    const w = this.world
    const r = this.rapier
    const shape = this.probeShape
    if (!w || !r || !shape) return true
    try {
      const hit = w.intersectionWithShape(
        { x, y: y + PLAYER.centerY + 0.05, z },
        { x: 0, y: 0, z: 0, w: 1 },
        shape,
        r.QueryFilterFlags.EXCLUDE_SENSORS,
        OVERLAP_GROUPS,
        this.collider ?? undefined,
        this.body ?? undefined,
      )
      if (hit) return false
      const ray = new r.Ray({ x, y: y + 0.6, z }, { x: 0, y: -1, z: 0 })
      const g = w.castRay(ray, 1.4, true, r.QueryFilterFlags.EXCLUDE_SENSORS, GROUND_GROUPS, this.collider ?? undefined, this.body ?? undefined)
      return !!g
    } catch {
      return true
    }
  }

  /** Height of the walkable surface under (x, z) (topmost below ~2 m), default 0. */
  groundHeightAt(x: number, z: number): number {
    const w = this.world
    const r = this.rapier
    if (!w || !r) return 0
    try {
      const ray = new r.Ray({ x, y: 2.2, z }, { x: 0, y: -1, z: 0 })
      const hit = w.castRay(ray, 14, true, r.QueryFilterFlags.EXCLUDE_SENSORS, GROUND_GROUPS, this.collider ?? undefined, this.body ?? undefined)
      if (!hit) return 0
      const toi = hit.timeOfImpact
      if (!Number.isFinite(toi) || toi < 0.05) return 0
      const y = 2.2 - toi
      return y > 1.9 || y < -2 ? 0 : y
    } catch {
      return 0
    }
  }

  /** Find a free spot around (cx, cz) — used when leaving the forklift. */
  findFreeSpotNear(cx: number, cz: number, yaw: number): { x: number; z: number } | null {
    const sx = Math.cos(yaw)
    const sz = -Math.sin(yaw)
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    const offsets: Array<[number, number]> = [
      [-1.9, 0], // left side (driver's door)
      [1.9, 0],
      [0, -2.8], // behind
      [0, 2.8], // in front
      [-2.2, -1.6],
      [2.2, -1.6],
      [-2.2, 1.6],
      [2.2, 1.6],
      [-3.2, 0],
      [3.2, 0],
    ]
    for (const [s, f] of offsets) {
      const x = cx + sx * s + fx * f
      const z = cz + sz * s + fz * f
      const b = PLAYABLE_BOUNDS
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue
      if (restrictedZoneAt(x, z)) continue
      const y = this.groundHeightAt(x, z)
      if (this.isFreeSpot(x, y, z)) return { x, z }
    }
    return null
  }

  // ------------------------------------------------------------------ commands

  /** Instantly move the worker (feet) to (x, z) facing `yaw`. */
  teleportNow(x: number, z: number, yaw: number, y?: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return
    const b = PLAYABLE_BOUNDS
    const cx = clamp(x, b.minX, b.maxX)
    const cz = clamp(z, b.minZ, b.maxZ)
    const gy = y !== undefined && Number.isFinite(y) ? y : this.groundHeightAt(cx, cz)
    const p = { x: cx, y: gy + PLAYER.skin + 0.02, z: cz }
    const body = this.body
    // Seated: only the logical spot moves (we stand there on exit); the capsule stays parked.
    if (body && !this.parked) {
      try {
        body.setTranslation(p, true)
        body.setNextKinematicTranslation(p)
      } catch {
        /* body removed */
      }
    }
    this.pos.set(p.x, p.y, p.z)
    this.corrupt = false
    this.vel.x = this.vel.z = 0
    this.vy = 0
    this.knock = null
    this.measured.set(0, 0, 0)
    if (Number.isFinite(yaw)) this.facing = yaw
    this.faceYaw = null
    this.grounded = true
    this.footsteps.reset()
    this.stuck.reset(cx, cz)
    // History from before a teleport describes another place: start fresh.
    this.safe.clear()
    this.snapVisual = 3
    if (this.mode === 'forklift' || this.parked) this.teleportedWhileDriving = true
  }

  /**
   * Sit down in a vehicle: disable the capsule, drop it from every collision
   * group and park it far below the world. Idempotent.
   */
  park(): void {
    this.parked = true
    this.vel.x = this.vel.z = 0
    this.vy = 0
    this.knock = null
    this.measured.set(0, 0, 0)
    const body = this.body
    const col = this.collider
    if (body && col) this.keepParked(body, col)
  }

  /** Stand up at feet (x, z): place the capsule there, then make it collide again. */
  unpark(x: number, z: number, yaw: number): void {
    this.parked = false
    this.teleportNow(x, z, yaw)
    this.setColliderEnabled(true)
  }

  /** Re-assert the parked state (cheap; runs every step while seated — survives body re-creation). */
  private keepParked(body: RigidBody, col: Collider): void {
    try {
      if (col.isEnabled()) col.setEnabled(false)
      if (col.collisionGroups() !== 0) col.setCollisionGroups(0)
      const t = body.translation()
      if (!(t.y < PARK_Y + 1) || !Number.isFinite(t.x + t.z)) {
        const x = Number.isFinite(this.pos.x) ? this.pos.x : 0
        const z = Number.isFinite(this.pos.z) ? this.pos.z : 0
        const p = { x, y: PARK_Y, z }
        body.setTranslation(p, false)
        body.setNextKinematicTranslation(p)
      }
    } catch {
      /* body / collider being removed */
    }
  }

  /** Begin a cartoon knock-back away from `from` (tackle). */
  startKnock(fromX: number, fromZ: number, speed = 5.6, hop = 5.2): void {
    let dx = this.pos.x - fromX
    let dz = this.pos.z - fromZ
    let l = Math.hypot(dx, dz)
    if (!(l > 1e-3)) {
      dx = Math.sin(this.facing)
      dz = Math.cos(this.facing)
      l = 1
    }
    dx /= l
    dz /= l
    this.knock = { vx: dx * speed, vz: dz * speed, friction: 11 }
    this.vy = hop
    this.grounded = false
    // face the tackler (we fly backwards)
    this.facing = Math.atan2(dx, dz)
  }

  endKnock(): void {
    this.knock = null
    this.vel.x = this.vel.z = 0
  }

  /** Collider on (PLAYER groups) / off (disabled and in no group at all). */
  setColliderEnabled(on: boolean): void {
    try {
      const c = this.collider
      if (!c) return
      c.setCollisionGroups(on ? GROUPS.player : 0)
      c.setEnabled(on)
    } catch {
      /* ignore */
    }
  }

  get speed(): number {
    return Math.hypot(this.measured.x, this.measured.z)
  }

  get lastSafe(): SafePos | null {
    return this.safe.latest()
  }

  /** Choose where R should take us: a recent safe spot (validated now), else null. */
  recoveryTarget(): SafePos | null {
    const stuck = this.stuck.stuck
    const minD = stuck ? RECOVERY.recoverMinDistanceStuck : RECOVERY.recoverMinDistance
    const before = stuck ? this.time - (this.stuck.time - this.stuck.stuckSince) - 0.5 : Infinity
    const lists = [this.safe.candidates(this.pos.x, this.pos.z, minD, before), this.safe.candidates(this.pos.x, this.pos.z, 0.4)]
    for (const list of lists) {
      for (const c of list) {
        if (Math.hypot(c.x - this.pos.x, c.z - this.pos.z) > RECOVERY.recoverMaxDistance) continue
        if (restrictedZoneAt(c.x, c.z)) continue
        if (this.isFreeSpot(c.x, c.y, c.z)) return c
      }
    }
    return null
  }
}
