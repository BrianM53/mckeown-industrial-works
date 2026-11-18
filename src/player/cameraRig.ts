import * as THREE from 'three'
import type { World } from '@dimforge/rapier3d-compat'
import type RAPIER from '@dimforge/rapier3d-compat'
import { CAMERA_RAY_GROUPS } from '@/core/collision'
import { clamp, damp, dampAngle, wrapAngle } from '@/core/math'
import { ZONES, type ZoneId } from '@/world/layout'
import { CAMERA, FORKLIFT_CAMERA } from './constants'
import {
  applyZoom,
  ceilingLimit,
  clampPitch,
  decayTrauma,
  fovForAspect,
  nearestAngle,
  orbitOffset,
  portraitLookLift,
  shakeNoise,
  springArmStep,
  type ArmState,
} from './cameraMath'
import type { LookInput } from './input'

/**
 * Third-person orbit camera with a collision-aware spring arm.
 *
 *  - Orbits a pivot ~1.6 m above the worker's feet and looks slightly above the
 *    head, so the worker sits lower-center and the view looks out into the
 *    factory at human height. Never an overview: distance 2.2–9 m, pitch
 *    −20°…65°.
 *  - The boom is a sphere cast (STATIC + CAMERA groups only) from the pivot:
 *    pulls in instantly, eases back out slowly.
 *  - Indoors: shorter boom and the camera stays under the eave.
 *  - Forklift: higher/wider chase cam that trails the vehicle heading but
 *    stays orbitable.
 */
export type FollowTarget = 'player' | 'forklift'

interface Profile {
  distance: number
  pitch: number
}

export interface CameraFrameContext {
  camera: THREE.PerspectiveCamera
  world: World | null
  rapier: typeof RAPIER | null
  /** Feet position of what we follow (worker or forklift). */
  focus: THREE.Vector3
  /** Facing yaw of the followed thing (worker body / vehicle). */
  facing: number
  /** Forward speed of the followed thing (m/s, signed for the vehicle). */
  speed: number
  running: boolean
  /** Building interior zone, or null outdoors. */
  interior: string | null
  reducedMotion: boolean
  sensitivity: number
  invertY: boolean
  look: LookInput
  /** ms timestamp of the last manual orbit input. */
  lastLookInputAt: number
}

const _desired = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _cam = new THREE.Vector3()
const _look = new THREE.Vector3()
const _off = { x: 0, y: 0, z: 0 }
const _ndc = new THREE.Vector3()
const IDENTITY_ROT = { x: 0, y: 0, z: 0, w: 1 }

export class CameraRig {
  /** Smoothed orbit state (what the camera shows). */
  yaw = 0
  pitch: number = CAMERA.defaultPitch
  /** Orbit targets (input applies here; smoothed toward). */
  yawTarget = 0
  pitchTarget: number = CAMERA.defaultPitch
  /** Zoom target and smoothed zoom (log-damped). */
  zoomTarget: number = CAMERA.defaultDistance
  zoom: number = CAMERA.defaultDistance
  arm: ArmState = { length: CAMERA.defaultDistance, free: true }
  /** Collision-free allowed boom from the last probe. */
  allowed: number = CAMERA.defaultDistance
  pivot = new THREE.Vector3()
  /** Camera position before shake (written to runtime). */
  position = new THREE.Vector3()
  lookTarget = new THREE.Vector3()
  follow: FollowTarget = 'player'
  private profiles: Record<FollowTarget, Profile> = {
    player: { distance: CAMERA.defaultDistance, pitch: CAMERA.defaultPitch },
    forklift: { distance: FORKLIFT_CAMERA.defaultDistance, pitch: FORKLIFT_CAMERA.defaultPitch },
  }
  private recentering = false
  private snapNext = true
  private trauma = 0
  private traumaDuration = 0.4
  private shakeT = 0
  private fov: number = CAMERA.fov
  private ball: RAPIER.Ball | null = null
  private ballRapier: typeof RAPIER | null = null
  /** Smoothed interior/eave boom cap. */
  private cap: number = CAMERA.maxDistance
  private pivotHeight: number = CAMERA.pivotHeight
  private lookHeight: number = CAMERA.lookHeight

  /** Put the camera behind `facing` instantly (spawn / teleport / respawn). */
  snapBehind(facing: number, opts: { keepPitch?: boolean } = {}): void {
    this.yaw = this.yawTarget = wrapAngle(facing)
    if (!opts.keepPitch) this.pitch = this.pitchTarget = this.profile().pitch
    this.recentering = false
    this.snapNext = true
  }

  /** Smoothly swing behind the current target's facing (C key / recenter button). */
  recenter(): void {
    this.recentering = true
  }

  setFollow(target: FollowTarget): void {
    if (target === this.follow) return
    // remember the current framing for this target, restore the other one's
    this.profiles[this.follow] = { distance: this.zoomTarget, pitch: this.pitchTarget }
    this.follow = target
    const p = this.profiles[target]
    this.zoomTarget = p.distance
    this.pitchTarget = p.pitch
    this.recentering = target === 'forklift'
  }

  /** Directly set orbit parameters (values clamped). */
  set(opts: { yaw?: number; pitch?: number; distance?: number; immediate?: boolean }): void {
    const [minD, maxD] = this.distanceRange()
    if (opts.yaw !== undefined && Number.isFinite(opts.yaw)) this.yawTarget = nearestAngle(this.yaw, opts.yaw)
    if (opts.pitch !== undefined && Number.isFinite(opts.pitch)) this.pitchTarget = clampPitch(opts.pitch)
    if (opts.distance !== undefined && Number.isFinite(opts.distance)) this.zoomTarget = clamp(opts.distance, minD, maxD)
    this.recentering = false
    if (opts.immediate) {
      this.yaw = this.yawTarget
      this.pitch = this.pitchTarget
      this.zoom = this.zoomTarget
      this.arm.length = this.zoomTarget
      this.arm.free = true
      this.snapNext = true
    }
  }

  /** Camera shake request (ignored entirely under reduced motion). */
  addShake(intensity: number, duration: number, reducedMotion: boolean): void {
    if (reducedMotion) return
    const i = clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1)
    if (i <= 0) return
    this.trauma = Math.min(1, Math.max(this.trauma, i))
    this.traumaDuration = clamp(Number.isFinite(duration) ? duration : 0.4, 0.1, 2.5)
  }

  get targetDistance(): number {
    return this.zoomTarget
  }

  private profile(): Profile {
    return this.follow === 'forklift'
      ? { distance: FORKLIFT_CAMERA.defaultDistance, pitch: FORKLIFT_CAMERA.defaultPitch }
      : { distance: CAMERA.defaultDistance, pitch: CAMERA.defaultPitch }
  }

  private distanceRange(): [number, number] {
    return this.follow === 'forklift' ? [FORKLIFT_CAMERA.minDistance, FORKLIFT_CAMERA.maxDistance] : [CAMERA.minDistance, CAMERA.maxDistance]
  }

  update(dt: number, ctx: CameraFrameContext): void {
    const cam = ctx.camera
    const L = ctx.look
    const fork = this.follow === 'forklift'
    const [minD, maxD] = this.distanceRange()

    // ---- 1. input → targets
    const sens = clamp(Number.isFinite(ctx.sensitivity) ? ctx.sensitivity : 1, 0.25, 3)
    const userOrbit = L.dx !== 0 || L.dy !== 0 || L.keyYaw !== 0 || L.keyPitch !== 0
    if (userOrbit) this.recentering = false
    this.yawTarget -= L.dx * CAMERA.dragYawPerPx * sens
    this.pitchTarget += L.dy * CAMERA.dragPitchPerPx * sens * (ctx.invertY ? -1 : 1)
    this.yawTarget += L.keyYaw * CAMERA.keyYawRate * dt
    this.pitchTarget += L.keyPitch * CAMERA.keyPitchRate * dt
    const zoomDelta = L.zoom + L.keyZoom * CAMERA.keyZoomRate * dt
    if (zoomDelta !== 0) this.zoomTarget = applyZoom(this.zoomTarget, zoomDelta, minD, maxD)
    this.zoomTarget = clamp(this.zoomTarget, minD, maxD)

    // ---- 2. assisted framing: recenter (C) and forklift auto-trail
    if (this.recentering) {
      const behind = nearestAngle(this.yawTarget, ctx.facing)
      this.yawTarget = damp(this.yawTarget, behind, CAMERA.recenterLambda, dt)
      this.pitchTarget = damp(this.pitchTarget, this.profile().pitch, CAMERA.recenterLambda * 0.6, dt)
      if (Math.abs(behind - this.yawTarget) < 0.004 && Math.abs(this.pitchTarget - this.profile().pitch) < 0.01) this.recentering = false
    } else if (fork) {
      const sinceLook = (performance.now() - ctx.lastLookInputAt) / 1000
      const sp = Math.abs(ctx.speed)
      if (sinceLook > FORKLIFT_CAMERA.trailDelay && sp > 0.6) {
        const k = FORKLIFT_CAMERA.trailLambda * Math.min(1, sp / 4)
        this.yawTarget = dampAngle(this.yawTarget, ctx.facing, k, dt)
        this.pitchTarget = damp(this.pitchTarget, FORKLIFT_CAMERA.defaultPitch, 0.8, dt)
      }
    }
    this.pitchTarget = clampPitch(this.pitchTarget)

    // ---- 3. smoothing (frame-rate independent)
    if (this.snapNext) {
      this.yaw = this.yawTarget
      this.pitch = this.pitchTarget
      this.zoom = this.zoomTarget
    } else {
      this.yaw = dampAngle(this.yaw, this.yawTarget, CAMERA.orbitLambda, dt)
      this.pitch = damp(this.pitch, this.pitchTarget, CAMERA.orbitLambda, dt)
      this.zoom = Math.exp(damp(Math.log(this.zoom), Math.log(this.zoomTarget), CAMERA.zoomLambda, dt))
    }
    // keep angles bounded
    const wrapped = wrapAngle(this.yaw)
    this.yawTarget += wrapped - this.yaw
    this.yaw = wrapped

    // ---- 4. pivot follows the focus (subtle lag; heights blend between profiles)
    const aspect = cam.aspect
    const ph = fork ? FORKLIFT_CAMERA.pivotHeight : CAMERA.pivotHeight
    const lh = (fork ? FORKLIFT_CAMERA.lookHeight : CAMERA.lookHeight) + portraitLookLift(aspect)
    if (this.snapNext) {
      this.pivotHeight = ph
      this.lookHeight = lh
    } else {
      this.pivotHeight = damp(this.pivotHeight, ph, 4, dt)
      this.lookHeight = damp(this.lookHeight, lh, 4, dt)
    }
    const fx = ctx.focus.x
    const fy = ctx.focus.y + this.pivotHeight
    const fz = ctx.focus.z
    if (this.snapNext || !Number.isFinite(this.pivot.x + this.pivot.y + this.pivot.z) || this.pivot.distanceToSquared(_cam.set(fx, fy, fz)) > 400) {
      this.pivot.set(fx, fy, fz)
    } else {
      this.pivot.x = damp(this.pivot.x, fx, CAMERA.pivotLambdaXZ, dt)
      this.pivot.z = damp(this.pivot.z, fz, CAMERA.pivotLambdaXZ, dt)
      this.pivot.y = damp(this.pivot.y, fy, CAMERA.pivotLambdaY, dt)
    }

    // ---- 5. desired boom length (zoom, interior cap, eave cap)
    // Caps glide (crossing a doorway must not pop the camera); collisions below still snap.
    const zoneId = ctx.interior && Object.prototype.hasOwnProperty.call(ZONES, ctx.interior) ? (ctx.interior as ZoneId) : null
    const building = zoneId ? ZONES[zoneId].building : undefined
    let capTarget = maxD
    if (zoneId) capTarget = Math.min(capTarget, fork ? FORKLIFT_CAMERA.interiorMaxDistance : CAMERA.interiorMaxDistance)
    if (building) capTarget = Math.min(capTarget, ceilingLimit(this.pivot.y, this.pitch, building.height - CAMERA.eaveMargin))
    capTarget = Math.max(CAMERA.minArm, capTarget)
    this.cap = this.snapNext || !Number.isFinite(this.cap) ? capTarget : damp(this.cap, capTarget, CAMERA.capLambda, dt)
    const desired = Math.max(CAMERA.minArm, Math.min(this.zoom, this.cap))

    // ---- 6. spring arm probe
    orbitOffset(this.yaw, this.pitch, 1, _off)
    _dir.set(_off.x, _off.y, _off.z).normalize()
    this.allowed = this.probe(ctx, desired)
    if (this.snapNext) {
      this.arm.length = Math.min(desired, this.allowed)
      this.arm.free = this.allowed >= desired - 1e-3
    } else {
      springArmStep(this.arm, desired, this.allowed, dt)
    }
    const len = Math.max(CAMERA.minArm, Math.min(this.arm.length, this.allowed))

    // ---- 7. place camera
    _cam.copy(this.pivot).addScaledVector(_dir, len)
    if (_cam.y < CAMERA.minCameraY) _cam.y = CAMERA.minCameraY
    _look.set(this.pivot.x, this.pivot.y - this.pivotHeight + this.lookHeight, this.pivot.z)
    if (CAMERA.shoulder !== 0 && !fork) {
      const rx = Math.cos(this.yaw) * CAMERA.shoulder
      const rz = -Math.sin(this.yaw) * CAMERA.shoulder
      _cam.x += rx
      _cam.z += rz
      _look.x += rx
      _look.z += rz
    }
    this.position.copy(_cam)
    this.lookTarget.copy(_look)

    // ---- 8. shake (never under reduced motion)
    let roll = 0
    if (this.trauma > 0) {
      if (ctx.reducedMotion) this.trauma = 0
      else {
        this.shakeT += dt
        const a = this.trauma * this.trauma
        _cam.x += shakeNoise(this.shakeT, 1) * CAMERA.shakeMaxOffset * a
        _cam.y += shakeNoise(this.shakeT, 2) * CAMERA.shakeMaxOffset * a * 0.7
        _cam.z += shakeNoise(this.shakeT, 3) * CAMERA.shakeMaxOffset * a
        roll = shakeNoise(this.shakeT, 4) * CAMERA.shakeMaxRoll * a
        this.trauma = decayTrauma(this.trauma, dt, this.traumaDuration)
      }
    }

    cam.position.copy(_cam)
    cam.up.set(0, 1, 0)
    cam.lookAt(_look)
    if (roll !== 0) cam.rotateZ(roll)

    // ---- 9. FOV (subtle speed boost; constant under reduced motion)
    // portrait phones: widen the vertical FOV so the horizontal view stays usable
    let fovTarget: number = fovForAspect(aspect)
    if (!ctx.reducedMotion) {
      if (fork) fovTarget += FORKLIFT_CAMERA.fovBoost * Math.min(1, Math.abs(ctx.speed) / 5)
      else if (ctx.running) fovTarget += CAMERA.runFovBoost
    }
    this.fov = this.snapNext ? fovTarget : damp(this.fov, fovTarget, 3, dt)
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov
      cam.updateProjectionMatrix()
    }
    this.snapNext = false
  }

  /** Sphere-cast from the pivot along the boom; returns the collision-free length. */
  private probe(ctx: CameraFrameContext, desired: number): number {
    const { world, rapier } = ctx
    if (!world || !rapier) return desired
    try {
      if (!this.ball || this.ballRapier !== rapier) {
        this.ball = new rapier.Ball(CAMERA.probeRadius)
        this.ballRapier = rapier
      }
      const hit = world.castShape(
        { x: this.pivot.x, y: this.pivot.y, z: this.pivot.z },
        IDENTITY_ROT,
        { x: _dir.x, y: _dir.y, z: _dir.z },
        this.ball,
        0,
        desired,
        false,
        rapier.QueryFilterFlags.EXCLUDE_SENSORS,
        CAMERA_RAY_GROUPS,
      )
      if (!hit) return desired
      const toi = hit.time_of_impact
      if (!Number.isFinite(toi)) return desired
      return clamp(toi - 0.04, CAMERA.minArm, desired)
    } catch {
      return desired
    }
  }

  /** Project a world point to NDC with the given camera (for debug / tests). */
  static toNdc(camera: THREE.Camera, x: number, y: number, z: number): THREE.Vector3 {
    camera.updateMatrixWorld()
    return _ndc.set(x, y, z).project(camera)
  }

  /** Expose the desired (pre-collision) camera position for debugging. */
  desiredPosition(out: THREE.Vector3 = _desired): THREE.Vector3 {
    orbitOffset(this.yaw, this.pitch, this.zoom, _off)
    return out.set(this.pivot.x + _off.x, this.pivot.y + _off.y, this.pivot.z + _off.z)
  }
}
