import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { World } from '@dimforge/rapier3d-compat'
import { events } from '@/core/events'
import { listInteractables, selectTarget, type Interactable } from '@/core/interaction'
import { clamp, damp, dampAngle, wrapAngle, yawToward } from '@/core/math'
import { params } from '@/core/params'
import { runtime } from '@/core/runtime'
import { getService, type CameraService, type PlayerService } from '@/core/services'
import type { PlayerMode, RespawnReason, Vec3 } from '@/core/types'
import { useGameStore } from '@/state/game'
import { useSettings } from '@/state/settings'
import { isOverlayBlocking, useUIStore } from '@/state/ui'
import type { WorkerAnim } from '@/world/WorkerModel'
import { CHECKPOINTS, PRINCIPAL_ZONES, SPAWN, ZONES, getCheckpoint, zoneAt, type CheckpointDef, type ZoneId } from '@/world/layout'
import { FADE, INTERACTION, PLAYER, RECOVERY } from './constants'
import { CameraRig, type FollowTarget } from './cameraRig'
import { nearFade } from './cameraMath'
import { PlayerController } from './controller'
import { clearFade, currentFade, fadeTo, wait, type Cancel } from './fade'
import { InputManager, type LookInput } from './input'
import type { ActionControl } from './inputMap'
import { OccluderFader } from './occluders'

/** Where the visitor starts: ?spawn=<zoneId> (dev/test) or visitor intake. */
export function initialSpawn(): { x: number; z: number; yaw: number } {
  const id = params.spawn
  if (id && Object.prototype.hasOwnProperty.call(ZONES, id)) {
    const zone = ZONES[id as ZoneId]
    return { x: zone.entrance[0], z: zone.entrance[1], yaw: zone.entranceYaw }
  }
  return { x: SPAWN.position[0], z: SPAWN.position[1], yaw: SPAWN.yaw }
}

/** Building interior containing (x, z) from the layout (fallback when the environment doesn't say). */
export function interiorAt(x: number, z: number): ZoneId | null {
  for (const zone of Object.values(ZONES)) {
    const b = zone.building
    if (!b) continue
    const r = b.interior
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return zone.id
  }
  return null
}

export function nearestCheckpoint(x: number, z: number, accept: (c: CheckpointDef) => boolean = () => true): CheckpointDef {
  let best: CheckpointDef | null = null
  let bestD = Infinity
  for (const c of CHECKPOINTS) {
    const d = Math.hypot(c.position[0] - x, c.position[1] - z)
    if (d < bestD && accept(c)) {
      bestD = d
      best = c
    }
  }
  return best ?? getCheckpoint('intake')
}

/** Lock reasons that mean "seated in the forklift". */
const VEHICLE_LOCK = /forklift|vehicle|driv/i

const STUCK_HINT_DESKTOP = 'Stuck? Press R to recover'
const STUCK_HINT_TOUCH = 'Stuck? Tap Recover to get unstuck'

function isCoarsePointer(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

const _v = new THREE.Vector3()
const _ndc = new THREE.Vector3()

export class PlayerSystem {
  readonly ctrl: PlayerController
  readonly rig = new CameraRig()
  readonly input: InputManager
  readonly occluders = new OccluderFader()
  /** Visual (interpolated, smoothed) feet position of the worker. */
  readonly visual = new THREE.Vector3()
  visualFacing = 0
  visualSpeed = 0
  /** Worker opacity (fades when the camera boom is very short). */
  workerOpacity = 1
  /** Current interaction target (refreshed at 15 Hz). */
  target: Interactable | null = null
  /** Anim override while tackled. */
  tackleAnim: WorkerAnim | null = null
  /** Debug/test anim override. */
  private forcedAnim: { anim: WorkerAnim; until: number } | null = null
  gestureUntil = 0
  /** Visual groups (set by PlayerVisual). */
  rootGroup: THREE.Group | null = null
  leanGroup: THREE.Group | null = null
  /** Physics anchor inside the RigidBody (rapier-interpolated position). */
  anchor: THREE.Object3D | null = null
  /** Scene seen by the last frame (debug stats only). */
  private scene: THREE.Object3D | null = null

  private clock = 0
  private interactTimer = 0
  private zoneTimer = 0
  private visited = new Set<ZoneId>()
  private allStationsSent = false
  private stuckShown = false
  private seqCancel: Cancel | null = null
  private seqId = 0
  private tacklePromise: Promise<void> | null = null
  private visY = 0
  private leanX = 0
  private leanZ = 0
  private prevFacing = 0
  private prevSpeed = 0
  private readonly look: LookInput = { dx: 0, dy: 0, zoom: 0, keyYaw: 0, keyPitch: 0, keyZoom: 0 }
  private respawnGuard = 0
  private mounted = true

  constructor(spawn: { x: number; z: number; yaw: number }) {
    this.ctrl = new PlayerController({
      footstep: (x, y, z, run, surface) => events.emit('player:footstep', { position: [x, y, z], run, surface }),
      clockedIn: () => events.emit('achievement', { id: 'clocked-in' }),
    })
    this.input = new InputManager((a) => this.onAction(a))
    this.ctrl.facing = spawn.yaw
    this.ctrl.pos.set(spawn.x, 0, spawn.z)
    this.visual.set(spawn.x, 0, spawn.z)
    this.visualFacing = spawn.yaw
    this.prevFacing = spawn.yaw
    this.rig.snapBehind(spawn.yaw)
    this.writeRuntime(spawn.x, 0, spawn.z, spawn.yaw, 0)
    runtime.player.teleportSeq++
  }

  // ------------------------------------------------------------------ physics hookup

  attachPhysics(world: World, rapier: typeof RAPIER): void {
    this.ctrl.attach(world, rapier)
  }

  detachPhysics(): void {
    this.ctrl.detach()
  }

  fixedStep(dt: number): void {
    this.ctrl.fixedStep(dt, this.input, this.rig.yaw)
  }

  // ------------------------------------------------------------------ modes

  setMode(m: PlayerMode): void {
    this.ctrl.mode = m
    runtime.player.mode = m
    useGameStore.getState().setMode(m)
  }

  /** Enter forklift mode (idempotent): parked, non-colliding, chase camera. */
  enterVehicle(): void {
    if (this.ctrl.mode === 'forklift') return
    if (this.ctrl.mode === 'tackled') return
    this.cancelSequence()
    this.setMode('forklift')
    this.ctrl.teleportedWhileDriving = false
    // Disabled + no collision groups + parked below the world: the hidden capsule can never
    // touch the forklift (or anything else) while we drive.
    this.ctrl.park()
    this.ctrl.stuck.reset(this.ctrl.pos.x, this.ctrl.pos.z)
    this.rig.setFollow('forklift')
    this.updateStuckHint(true)
    this.interactTimer = 1
    // The published position jumps to the seat now.
    const f = runtime.forklift
    if (Number.isFinite(f.position.x + f.position.y + f.position.z)) this.visual.copy(f.position)
    if (Number.isFinite(f.yaw)) this.visualFacing = f.yaw
    this.noteJump()
  }

  /** Leave forklift mode (idempotent): place the worker beside the vehicle. */
  exitVehicle(): void {
    if (this.ctrl.mode !== 'forklift') return
    const fp = runtime.forklift.position
    const fyaw = Number.isFinite(runtime.forklift.yaw) ? runtime.forklift.yaw : this.ctrl.facing
    const c = this.ctrl
    let spot: { x: number; z: number } | null = null
    if (c.teleportedWhileDriving && c.isFreeSpot(c.pos.x, c.pos.y, c.pos.z)) spot = { x: c.pos.x, z: c.pos.z }
    if (!spot && Number.isFinite(fp.x) && Number.isFinite(fp.z)) spot = c.findFreeSpotNear(fp.x, fp.z, fyaw)
    if (!spot) {
      const cp = nearestCheckpoint(fp.x, fp.z)
      spot = { x: cp.position[0], z: cp.position[1] }
    }
    // Measured from the seat (the published position), not from the hidden capsule.
    const seat = runtime.player.position
    const far = Math.hypot(spot.x - seat.x, spot.z - seat.z) > 10
    c.unpark(spot.x, spot.z, fyaw)
    c.teleportedWhileDriving = false
    // A vehicle lock must never outlive the vehicle (softlock guard).
    for (const r of [...c.locks]) if (VEHICLE_LOCK.test(r)) c.locks.delete(r)
    this.setMode('foot')
    this.rig.setFollow('player')
    if (far) this.rig.snapBehind(c.facing)
    this.interactTimer = 1
    // The published position jumps from the seat to where the worker stands.
    this.syncVisualToBody()
    this.noteJump()
  }

  /** Visual state = the controller's (just placed) body, no smoothing. */
  private syncVisualToBody(): void {
    const c = this.ctrl
    this.visual.set(c.pos.x, c.pos.y - PLAYER.skin, c.pos.z)
    this.visY = c.pos.y
    this.visualFacing = c.facing
    this.prevFacing = c.facing
    this.visualSpeed = 0
  }

  /**
   * A discontinuous move of the published position (teleport, respawn, recover,
   * fast travel, tackle respawn, forklift enter/exit): publish the new position
   * right away and bump runtime.player.teleportSeq, so readers always see the
   * new sequence number together with the new position.
   */
  private noteJump(): void {
    this.writeRuntime(this.visual.x, this.visual.y, this.visual.z, this.visualFacing, 0)
    runtime.player.teleportSeq++
  }

  // ------------------------------------------------------------------ sequences

  private beginSequence(): Cancel {
    this.cancelSequence()
    const c: Cancel = { cancelled: false }
    this.seqCancel = c
    return c
  }

  private cancelSequence(): void {
    if (this.seqCancel) this.seqCancel.cancelled = true
    this.seqCancel = null
  }

  get busy(): boolean {
    return this.seqCancel !== null || this.tacklePromise !== null
  }

  /**
   * Instant move. Snaps the camera behind the new facing when asked (or when the jump is far).
   * While driving only the logical exit spot moves: the worker stays seated, the published
   * position stays the seat and the chase camera keeps following the forklift.
   */
  moveNow(x: number, z: number, yaw: number, snapCamera: boolean): void {
    if (this.ctrl.mode === 'forklift') {
      this.ctrl.teleportNow(x, z, yaw)
      this.input.clear()
      this.interactTimer = 1
      return
    }
    const far = Math.hypot(x - this.visual.x, z - this.visual.z) > 10
    this.ctrl.teleportNow(x, z, yaw)
    this.syncVisualToBody()
    if (snapCamera || far) this.rig.snapBehind(this.ctrl.facing)
    this.input.clear()
    this.target = null
    this.interactTimer = 1
    this.noteJump()
  }

  /** PlayerService.teleport */
  teleport(x: number, z: number, yaw?: number, opts?: { fade?: boolean; onMoved?: () => void; toast?: string }): void {
    const facing = yaw !== undefined && Number.isFinite(yaw) ? yaw : this.ctrl.facing
    if (!Number.isFinite(x) || !Number.isFinite(z)) return
    if (this.tacklePromise) return // a tackle owns the player until it completes
    if (!opts?.fade) {
      this.cancelSequence()
      if (this.ctrl.mode === 'forklift') this.ctrl.teleportedWhileDriving = true
      this.moveNow(x, z, facing, false)
      opts?.onMoved?.()
      return
    }
    const cancel = this.beginSequence()
    const lockId = `travel#${++this.seqId}`
    if (this.ctrl.mode === 'forklift') {
      this.exitVehicle()
      try {
        getService('forklift')?.exit()
      } catch {
        /* ignore */
      }
    }
    const prev = this.ctrl.mode === 'travel' ? 'foot' : this.ctrl.mode
    this.ctrl.setLocked(true, lockId)
    this.setMode('travel')
    const run = async () => {
      try {
        await fadeTo(1, FADE.outMs, cancel)
        if (cancel.cancelled || !this.mounted) return
        this.moveNow(x, z, facing, true)
        opts.onMoved?.()
        if (opts.toast) events.emit('toast', { text: opts.toast, kind: 'success', duration: 1800 })
        await wait(FADE.holdMs, cancel)
        await fadeTo(0, FADE.inMs, cancel)
      } finally {
        this.ctrl.setLocked(false, lockId)
        if (this.ctrl.mode === 'travel' && !this.tacklePromise) this.setMode(prev === 'forklift' ? 'foot' : prev)
        if (this.seqCancel === cancel) this.seqCancel = null
        // Never leave the screen dark unless another fade sequence now owns it.
        if (this.seqCancel === null && !this.tacklePromise && currentFade() > 0) clearFade()
      }
    }
    void run()
  }

  /** PlayerService.respawn */
  respawn(checkpointId: string, reason: RespawnReason): void {
    const cp = getCheckpoint(checkpointId)
    const emit = () => events.emit('player:respawned', { reason, checkpointId: cp.id })
    if (reason === 'debug') {
      this.cancelSequence()
      this.moveNow(cp.position[0], cp.position[1], cp.yaw, true)
      emit()
      return
    }
    this.teleport(cp.position[0], cp.position[1], cp.yaw, { fade: true, onMoved: emit })
  }

  /** PlayerService.tackle — cartoon knock-back, fade, respawn at intake. < 3.5 s total. */
  tackle(from: Vec3): Promise<void> {
    if (this.tacklePromise) return this.tacklePromise
    const fx = Array.isArray(from) && Number.isFinite(from[0]) ? from[0] : this.ctrl.pos.x
    const fz = Array.isArray(from) && Number.isFinite(from[2]) ? from[2] : this.ctrl.pos.z + 1
    const cancel = this.beginSequence()
    if (this.ctrl.mode === 'forklift') {
      this.exitVehicle()
      try {
        getService('forklift')?.exit()
      } catch {
        /* ignore */
      }
    }
    this.ctrl.setLocked(true, 'tackle')
    this.setMode('tackled')
    this.tackleAnim = 'tumble'
    this.target = null
    useUIStore.getState().setPrompt(null)
    this.input.clear()
    this.ctrl.startKnock(fx, fz)
    events.emit('shake', { intensity: 0.55, duration: 0.45 })
    const run = async () => {
      try {
        await wait(900, cancel)
        this.tackleAnim = 'sleep'
        this.ctrl.endKnock()
        await wait(450, cancel)
        await fadeTo(1, 300, cancel)
        const cp = getCheckpoint('intake')
        if (this.mounted) {
          this.tackleAnim = null
          this.moveNow(cp.position[0], cp.position[1], cp.yaw, true)
          events.emit('player:respawned', { reason: 'tackle', checkpointId: cp.id })
        }
        await wait(200, cancel)
        await fadeTo(0, 350, cancel)
      } finally {
        this.tackleAnim = null
        this.ctrl.endKnock()
        this.ctrl.setLocked(false, 'tackle')
        if (this.ctrl.mode === 'tackled') this.setMode('foot')
        if (this.seqCancel === cancel) this.seqCancel = null
        if (currentFade() > 0) clearFade()
        this.tacklePromise = null
      }
    }
    this.tacklePromise = run()
    return this.tacklePromise
  }

  /** R / recover button. */
  recover(): void {
    if (isOverlayBlocking()) return
    if (this.ctrl.mode === 'forklift') {
      try {
        getService('forklift')?.recover()
      } catch (err) {
        console.error('[player] forklift recover failed', err)
      }
      return
    }
    if (this.ctrl.mode !== 'foot' || this.ctrl.locked || this.busy) return
    const stuck = this.ctrl.stuck.stuck
    const spot = this.ctrl.recoveryTarget()
    useUIStore.getState().setRecoveryHint(null)
    this.stuckShown = false
    if (spot) {
      this.teleport(spot.x, spot.z, spot.yaw, { fade: true, toast: 'Recovered' })
      return
    }
    const cp = nearestCheckpoint(this.ctrl.pos.x, this.ctrl.pos.z, (c) => {
      const y = this.ctrl.groundHeightAt(c.position[0], c.position[1])
      return this.ctrl.isFreeSpot(c.position[0], y, c.position[1])
    })
    const emit = () => events.emit('player:respawned', { reason: stuck ? 'stuck' : 'manual', checkpointId: cp.id })
    this.teleport(cp.position[0], cp.position[1], cp.yaw, { fade: true, toast: 'Recovered', onMoved: emit })
  }

  // ------------------------------------------------------------------ actions & interaction

  onAction(a: ActionControl): void {
    if (a === 'interact') this.interact()
    else if (a === 'recover') this.recover()
    else if (a === 'recenter') this.recenter()
  }

  recenter(): void {
    if (isOverlayBlocking()) return
    this.rig.recenter()
  }

  private interactionBlocked(): boolean {
    const m = this.ctrl.mode
    if (isOverlayBlocking()) return true
    if (m === 'tackled' || m === 'travel') return true
    if (m === 'foot' && this.ctrl.locked) return true
    return false
  }

  private interactPos(): { x: number; z: number; facing: number } {
    if (this.ctrl.mode === 'forklift') {
      const f = runtime.forklift
      return { x: f.position.x, z: f.position.z, facing: f.yaw }
    }
    return { x: this.ctrl.pos.x, z: this.ctrl.pos.z, facing: this.ctrl.facing }
  }

  refreshTarget(): void {
    let t: Interactable | null = null
    if (!this.interactionBlocked()) {
      const p = this.interactPos()
      try {
        t = selectTarget({ x: p.x, z: p.z }, p.facing, this.ctrl.mode, listInteractables())
      } catch (err) {
        console.error('[player] interaction selection failed', err)
        t = null
      }
    }
    this.target = t
    let prompt: { id: string; verb: string; label: string } | null = null
    if (t) {
      try {
        prompt = { id: t.id, verb: t.verb || 'Inspect', label: t.label || '' }
      } catch {
        prompt = null
      }
    }
    useUIStore.getState().setPrompt(prompt)
  }

  interact(): void {
    if (this.interactionBlocked()) return
    this.refreshTarget()
    const t = this.target
    if (!t) return
    try {
      t.onInteract()
    } catch (err) {
      console.error(`[player] interactable "${t.id}" threw`, err)
    }
    events.emit('player:interact', { id: t.id })
    if (this.ctrl.mode === 'foot') {
      this.gestureUntil = this.clock + INTERACTION.gestureTime
      try {
        const p = t.getPosition()
        if (Number.isFinite(p.x) && Number.isFinite(p.z) && Math.hypot(p.x - this.ctrl.pos.x, p.z - this.ctrl.pos.z) > 0.3)
          this.ctrl.faceToward(yawToward({ x: this.ctrl.pos.x, z: this.ctrl.pos.z }, p), 0.4)
      } catch {
        /* ignore */
      }
    }
    this.interactTimer = 1
  }

  /** Current worker animation (getter for WorkerModel). */
  anim = (): WorkerAnim => {
    if (this.forcedAnim) {
      if (this.clock < this.forcedAnim.until) return this.forcedAnim.anim
      this.forcedAnim = null
    }
    if (this.tackleAnim) return this.tackleAnim
    if (this.clock < this.gestureUntil) return 'point'
    const s = this.visualSpeed
    if (s > 5.4) return 'run'
    if (s > 0.35) return 'walk'
    return 'idle'
  }

  speed = (): number => this.visualSpeed

  /** Glance at the current interaction target (head yaw relative to the body). */
  lookYaw = (): number | null => {
    const t = this.target
    if (!t || this.ctrl.mode !== 'foot' || this.tackleAnim) return null
    try {
      const p = t.getPosition()
      const dx = p.x - this.visual.x
      const dz = p.z - this.visual.z
      if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx, dz) < 0.4) return null
      return wrapAngle(yawToward({ x: 0, z: 0 }, { x: dx, z: dz }) - this.visualFacing)
    } catch {
      return null
    }
  }

  opacity = (): number => this.workerOpacity

  // ------------------------------------------------------------------ per-frame

  frame(dtRaw: number, camera: THREE.Camera, scene?: THREE.Object3D): void {
    const dt = clamp(Number.isFinite(dtRaw) ? dtRaw : 0, 0, 0.1)
    this.clock += dt
    const c = this.ctrl
    const driving = c.mode === 'forklift'

    // ---- 1. visual position (rapier-interpolated) + smoothing
    if (!driving) {
      let rx = c.pos.x
      let ry = c.pos.y
      let rz = c.pos.z
      if (c.snapVisual > 0 || !this.anchor) {
        if (c.snapVisual > 0) c.snapVisual--
        const body = c.body
        if (body) {
          try {
            const t = body.translation()
            rx = t.x
            ry = t.y
            rz = t.z
          } catch {
            /* ignore */
          }
        }
        this.visY = ry
      } else {
        this.anchor.getWorldPosition(_v)
        rx = _v.x
        ry = _v.y
        rz = _v.z
      }
      if (Number.isFinite(rx) && Number.isFinite(ry) && Number.isFinite(rz)) {
        const dy = ry - this.visY
        if (Math.abs(dy) > 0.6 || c.knock) this.visY = ry
        else this.visY = damp(this.visY, ry, dy > 0 ? 18 : 28, dt)
        this.visual.set(rx, this.visY - PLAYER.skin, rz)
      }
      this.visualFacing = dampAngle(this.visualFacing, c.facing, 40, dt)
      this.visualSpeed = c.knock ? 0 : damp(this.visualSpeed, c.speed, 14, dt)
    } else {
      const f = runtime.forklift
      if (Number.isFinite(f.position.x) && Number.isFinite(f.position.z)) this.visual.copy(f.position)
      this.visualFacing = Number.isFinite(f.yaw) ? f.yaw : this.visualFacing
      this.visualSpeed = Math.abs(f.speed) || 0
    }

    // ---- 2. shared runtime (one writer: player)
    this.writeRuntime(this.visual.x, this.visual.y, this.visual.z, this.visualFacing, this.visualSpeed)

    // ---- 3. worker transform + lean
    this.updateWorkerTransform(dt)

    // ---- 4. camera
    const st = useSettings.getState()
    this.input.consumeLook(this.look)
    const interior = runtime.world.interior ?? (driving ? null : interiorAt(this.visual.x, this.visual.z))
    const cam = camera as THREE.PerspectiveCamera
    if (cam.isPerspectiveCamera) {
      this.rig.update(dt, {
        camera: cam,
        world: c.world,
        rapier: c.rapier,
        focus: this.visual,
        facing: driving ? runtime.forklift.yaw : c.facing,
        speed: driving ? runtime.forklift.speed : this.visualSpeed,
        running: !driving && c.running,
        interior,
        reducedMotion: !!st.reducedMotion,
        sensitivity: st.cameraSensitivity,
        invertY: !!st.invertY,
        look: this.look,
        lastLookInputAt: this.input.lastLookInputAt,
      })
      runtime.camera.yaw = this.rig.yaw
      runtime.camera.pitch = this.rig.pitch
      runtime.camera.distance = this.rig.arm.length
      runtime.camera.position.copy(this.rig.position)
    }
    this.workerOpacity = driving ? 1 : nearFade(this.rig.arm.length)
    if (scene) {
      this.scene = scene
      _v.set(this.visual.x, this.visual.y + (driving ? 1.6 : 1.7), this.visual.z)
      this.occluders.update(dt, scene, this.rig.position, _v, { skipContaining: driving })
    }

    // ---- 5. interaction (15 Hz)
    this.interactTimer += dt
    if (this.interactTimer >= 1 / INTERACTION.rate) {
      this.interactTimer = 0
      this.refreshTarget()
    }

    // ---- 6. zones & achievements (4 Hz)
    this.zoneTimer += dt
    if (this.zoneTimer >= 0.25) {
      this.zoneTimer = 0
      this.trackZone()
    }

    // ---- 7. recovery hint + out-of-world safety net
    this.updateStuckHint(false)
    this.checkOutOfWorld(dt)

    // ---- 8. pointer lock hygiene
    if (this.input.locked && (!st.pointerLock || isOverlayBlocking())) this.input.releasePointerLock()
  }

  private updateWorkerTransform(dt: number): void {
    const g = this.rootGroup
    if (!g) return
    const c = this.ctrl
    const show = c.visible && c.mode !== 'forklift'
    g.visible = show
    if (!show) return
    g.position.copy(this.visual)
    g.rotation.y = this.visualFacing
    // lean into turns & acceleration (subtle; none while tumbling)
    const turnRate = wrapAngle(this.visualFacing - this.prevFacing) / Math.max(dt, 1e-3)
    this.prevFacing = this.visualFacing
    const accel = (this.visualSpeed - this.prevSpeed) / Math.max(dt, 1e-3)
    this.prevSpeed = this.visualSpeed
    const calm = c.knock || this.tackleAnim
    const bank = calm ? 0 : clamp(turnRate * this.visualSpeed * 0.011, -0.16, 0.16)
    const pitch = calm ? 0 : clamp(-accel * 0.006, -0.09, 0.09)
    this.leanZ = damp(this.leanZ, bank, 10, dt)
    this.leanX = damp(this.leanX, pitch, 8, dt)
    const lg = this.leanGroup
    if (lg) {
      lg.rotation.x = this.leanX
      lg.rotation.z = this.leanZ
    }
  }

  private writeRuntime(x: number, y: number, z: number, facing: number, speed: number): void {
    const p = runtime.player
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) p.position.set(x, y, z)
    if (this.ctrl) {
      const m = this.ctrl.mode === 'forklift' ? null : this.ctrl.measured
      if (m && Number.isFinite(m.x + m.y + m.z)) p.velocity.copy(m)
      else if (this.ctrl.mode === 'forklift') {
        const f = runtime.forklift
        p.velocity.set(-Math.sin(f.yaw) * f.speed, 0, -Math.cos(f.yaw) * f.speed)
      }
      p.grounded = this.ctrl.mode === 'forklift' ? true : this.ctrl.grounded
      p.mode = this.ctrl.mode
    }
    if (Number.isFinite(facing)) p.facing = facing
    p.speed = Number.isFinite(speed) ? speed : 0
  }

  private trackZone(): void {
    const z = zoneAt(this.visual.x, this.visual.z)
    useGameStore.getState().setCurrentZone(z)
    if (z && (PRINCIPAL_ZONES as string[]).includes(z) && !this.visited.has(z)) {
      this.visited.add(z)
      if (!this.allStationsSent && PRINCIPAL_ZONES.every((id) => this.visited.has(id))) {
        this.allStationsSent = true
        events.emit('achievement', { id: 'all-stations' })
      }
    }
  }

  private updateStuckHint(forceClear: boolean): void {
    const stuck = !forceClear && this.ctrl.mode === 'foot' && this.ctrl.stuck.stuck && !this.busy
    if (stuck === this.stuckShown) return
    this.stuckShown = stuck
    useUIStore.getState().setRecoveryHint(stuck ? (isCoarsePointer() ? STUCK_HINT_TOUCH : STUCK_HINT_DESKTOP) : null)
    if (stuck) events.emit('player:stuck', {})
  }

  private checkOutOfWorld(dt: number): void {
    this.respawnGuard = Math.max(0, this.respawnGuard - dt)
    if (this.respawnGuard > 0 || this.busy || this.ctrl.mode !== 'foot') return
    const p = this.ctrl.pos
    const bad = this.ctrl.corrupt || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z) || p.y < RECOVERY.killY
    if (!bad) return
    this.respawnGuard = 2
    const cp = Number.isFinite(p.x) && Number.isFinite(p.z) ? nearestCheckpoint(p.x, p.z) : getCheckpoint('intake')
    this.respawn(cp.id, 'bounds')
  }

  // ------------------------------------------------------------------ services & debug

  playerService(): PlayerService {
    return {
      teleport: (x, z, yaw, opts) => this.teleport(x, z, yaw, { fade: !!opts?.fade }),
      respawn: (id, reason) => this.respawn(id, reason),
      tackle: (from) => this.tackle(from),
      setLocked: (locked, reason) => {
        this.ctrl.setLocked(!!locked, reason)
        if (VEHICLE_LOCK.test(reason || '')) {
          if (locked) this.enterVehicle()
          else this.exitVehicle()
        }
        if (locked) this.input.clear()
      },
      setVisible: (v) => {
        this.ctrl.visible = !!v
      },
    }
  }

  cameraService(): CameraService {
    return {
      recenter: () => this.rig.recenter(),
      follow: (target: FollowTarget) => {
        if (target === 'forklift') this.enterVehicle()
        else this.exitVehicle()
        this.rig.setFollow(target)
      },
      set: (opts) => this.rig.set(opts ?? {}),
    }
  }

  debugPlayer() {
    return {
      getState: () => {
        const p = runtime.player.position
        const ls = this.ctrl.lastSafe
        return {
          position: [round(p.x), round(p.y), round(p.z)],
          facing: round(runtime.player.facing),
          speed: round(runtime.player.speed),
          mode: this.ctrl.mode,
          grounded: this.ctrl.grounded,
          lastSafe: ls ? [round(ls.x), round(ls.z)] : null,
          locked: [...this.ctrl.locks],
          visible: this.ctrl.visible,
          stuck: this.ctrl.stuck.stuck,
          target: this.target?.id ?? null,
          steps: this.ctrl.steps,
          teleportSeq: runtime.player.teleportSeq,
          parked: this.ctrl.parked,
        }
      },
      /** Shared WorkerModel stats for perf checks: visible workers, how many use the distant LOD, shadow casters. */
      workers: () => {
        const sc = this.scene
        if (!sc) return null
        let visible = 0
        let lod = 0
        let shadowCasters = 0
        let triangles = 0
        sc.traverseVisible((o) => {
          const m = o as THREE.SkinnedMesh
          if (!m.isSkinnedMesh || m.name !== 'worker') return
          const g = m.geometry
          const t = (g.index ? g.index.count : g.getAttribute('position').count) / 3
          visible++
          if (t < 1500) lod++
          triangles += t
          if (m.castShadow) {
            shadowCasters++
            triangles += t
          }
        })
        return { visible, lod, shadowCasters, triangles }
      },
      teleport: (x: number, z: number, yaw?: number) => {
        if (this.tacklePromise) return false
        this.cancelSequence()
        this.moveNow(x, z, yaw ?? this.ctrl.facing, true)
        return true
      },
      respawn: (id: string) => this.respawn(id, 'debug'),
      tackle: (x?: number, z?: number) => this.tackle([x ?? this.ctrl.pos.x, 0, z ?? this.ctrl.pos.z - 2]),
      recover: () => this.recover(),
      interact: () => this.interact(),
      setInputForTest: (v: { x?: number; y?: number; run?: boolean; ms?: number } | null) => this.input.setTestInput(v),
      /** Set/clear the directory route target (same as the ui directory's "Show route"). */
      routeTo: (zoneId: string | null) => useUIStore.getState().setRouteTarget(zoneId),
      /** Play a worker animation for `ms` (visual checks of the shared WorkerModel). */
      forceAnim: (anim: WorkerAnim | null, ms = 3000) => {
        this.forcedAnim = anim ? { anim, until: this.clock + ms / 1000 } : null
      },
    }
  }

  debugCamera(getCamera: () => THREE.Camera) {
    return {
      getState: () => {
        const cam = getCamera() as THREE.PerspectiveCamera
        const head = this.headNdc(cam)
        const feet = this.feetNdc(cam)
        const inside = (v: THREE.Vector3) => Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z >= -1 && v.z <= 1
        return {
          type: cam.type,
          isPerspective: !!cam.isPerspectiveCamera,
          fov: round(cam.fov ?? 0),
          position: [round(cam.position.x), round(cam.position.y), round(cam.position.z)],
          yaw: round(this.rig.yaw),
          pitch: round(this.rig.pitch),
          distance: round(this.rig.arm.length),
          targetDistance: round(this.rig.targetDistance),
          allowed: round(this.rig.allowed),
          follow: this.rig.follow,
          // on foot: the worker; driving: the followed forklift
          workerOnScreen: inside(head.v) || inside(feet.v),
          workerScreenY: round(head.v.y),
          workerFeetScreenY: round(feet.v.y),
          workerScreenX: round(head.v.x),
          interior: runtime.world.interior ?? interiorAt(this.visual.x, this.visual.z),
          workerOpacity: round(this.workerOpacity),
        }
      },
      /** What the camera sees at screen point (NDC x, y; default the centre): nearest hits with their named ancestors. */
      pick: (x = 0, y = 0, n = 4) => {
        const sc = this.scene
        if (!sc) return null
        const ray = new THREE.Raycaster()
        ray.setFromCamera(new THREE.Vector2(x, y), getCamera())
        return ray
          .intersectObject(sc, true)
          .filter((h) => {
            for (let o: THREE.Object3D | null = h.object; o; o = o.parent) if (!o.visible) return false
            return true
          })
          .slice(0, n)
          .map((h) => {
            const names: string[] = []
            for (let o: THREE.Object3D | null = h.object; o && names.length < 6; o = o.parent) if (o.name) names.push(o.name)
            return { d: round(h.distance), point: [round(h.point.x), round(h.point.y), round(h.point.z)], path: names.join(' < ') }
          })
      },
      set: (opts: { yaw?: number; pitch?: number; distance?: number; immediate?: boolean }) => this.rig.set(opts ?? {}),
      recenter: () => this.rig.recenter(),
      follow: (t: FollowTarget) => this.cameraService().follow(t),
    }
  }

  private headNdc(cam: THREE.Camera) {
    cam.updateMatrixWorld()
    const v = _ndc.set(this.visual.x, this.visual.y + 1.75, this.visual.z).project(cam).clone()
    return { v }
  }

  private feetNdc(cam: THREE.Camera) {
    const v = _ndc.set(this.visual.x, this.visual.y + 0.05, this.visual.z).project(cam).clone()
    return { v }
  }

  /** (Re)mount — StrictMode runs effects twice in development. */
  mount(): void {
    this.mounted = true
  }

  /** Unmount cleanup: never leave the screen black, the pointer locked or the player locked. */
  dispose(): void {
    this.mounted = false
    this.occluders.restoreAll()
    this.cancelSequence()
    if (currentFade() > 0) clearFade()
    this.input.releasePointerLock()
    const ui = useUIStore.getState()
    ui.setPrompt(null)
    ui.setRecoveryHint(null)
    this.ctrl.locks.clear()
  }
}

function round(n: number, d = 3): number {
  if (!Number.isFinite(n)) return n
  const k = 10 ** d
  return Math.round(n * k) / k
}

