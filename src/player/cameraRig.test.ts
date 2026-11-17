import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CAMERA, FORKLIFT_CAMERA } from './constants'
import { CameraRig, type CameraFrameContext } from './cameraRig'
import type { LookInput } from './input'

const DT = 1 / 60
const noLook = (): LookInput => ({ dx: 0, dy: 0, zoom: 0, keyYaw: 0, keyPitch: 0, keyZoom: 0 })

function ctx(over: Partial<CameraFrameContext> = {}): CameraFrameContext {
  return {
    camera: new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500),
    world: null,
    rapier: null,
    focus: new THREE.Vector3(0, 0, 32),
    facing: 0,
    speed: 0,
    running: false,
    interior: null,
    reducedMotion: false,
    sensitivity: 1,
    invertY: false,
    look: noLook(),
    lastLookInputAt: -Infinity,
    ...over,
  }
}

function run(rig: CameraRig, c: CameraFrameContext, frames: number, look?: () => LookInput) {
  for (let i = 0; i < frames; i++) {
    c.look = look ? look() : noLook()
    rig.update(DT, c)
  }
}

describe('camera rig (third-person, perspective)', () => {
  it('spawns behind the worker at human height, looking north up the aisle', () => {
    const rig = new CameraRig()
    rig.snapBehind(0)
    const c = ctx()
    run(rig, c, 2)
    const cam = c.camera
    expect(cam.position.z).toBeGreaterThan(36) // south of the worker at z=32
    expect(cam.position.y).toBeGreaterThan(2)
    expect(cam.position.y).toBeLessThan(3.2)
    const dir = cam.getWorldDirection(new THREE.Vector3())
    expect(dir.z).toBeLessThan(-0.95) // looking north
    // worker sits lower-center: head slightly below center, feet in the lower half
    const head = new THREE.Vector3(0, 1.75, 32).project(cam)
    const feet = new THREE.Vector3(0, 0.05, 32).project(cam)
    expect(Math.abs(head.x)).toBeLessThan(0.05)
    expect(head.y).toBeLessThan(0.05)
    expect(head.y).toBeGreaterThan(-0.3)
    expect(feet.y).toBeGreaterThan(-0.9)
    expect(feet.y).toBeLessThan(-0.4)
  })

  it('a 600 px drag orbits roughly 180° (camera ends up on the other side)', () => {
    const rig = new CameraRig()
    rig.snapBehind(0)
    const c = ctx()
    run(rig, c, 1)
    let first = true
    run(rig, c, 60, () => {
      const l = noLook()
      if (first) l.dx = 600
      first = false
      return l
    })
    expect(Math.abs(Math.abs(rig.yaw) - Math.PI)).toBeLessThan(0.15)
    expect(c.camera.position.z).toBeLessThan(28) // now north of the worker
  })

  it('orbit is unrestricted in yaw and clamped in pitch; zoom stays within 2.2–9 m', () => {
    const rig = new CameraRig()
    rig.snapBehind(0)
    const c = ctx()
    run(rig, c, 240, () => ({ ...noLook(), keyYaw: 1, keyPitch: 1, keyZoom: 1 }))
    expect(rig.pitch).toBeCloseTo(CAMERA.maxPitch, 3)
    expect(rig.zoomTarget).toBe(CAMERA.maxDistance)
    run(rig, c, 400, () => ({ ...noLook(), dy: -50, zoom: -0.3 }))
    expect(rig.pitch).toBeCloseTo(CAMERA.minPitch, 3)
    expect(rig.zoomTarget).toBe(CAMERA.minDistance)
    expect(Number.isFinite(rig.yaw)).toBe(true)
    expect(Math.abs(rig.yaw)).toBeLessThanOrEqual(Math.PI + 1e-9)
  })

  it('camera never dips below the minimum height', () => {
    const rig = new CameraRig()
    rig.snapBehind(0)
    rig.set({ pitch: -1, distance: 9, immediate: true })
    const c = ctx()
    run(rig, c, 5)
    expect(c.camera.position.y).toBeGreaterThanOrEqual(CAMERA.minCameraY - 1e-9)
  })

  it('invertY flips vertical drag; sensitivity scales it', () => {
    const a = new CameraRig()
    const b = new CameraRig()
    a.snapBehind(0)
    b.snapBehind(0)
    const ca = ctx()
    const cb = ctx({ invertY: true, sensitivity: 2 })
    run(a, ca, 1, () => ({ ...noLook(), dy: 40 }))
    run(b, cb, 1, () => ({ ...noLook(), dy: 40 }))
    expect(a.pitchTarget).toBeGreaterThan(CAMERA.defaultPitch)
    expect(b.pitchTarget).toBeLessThan(CAMERA.defaultPitch)
    expect(CAMERA.defaultPitch - b.pitchTarget).toBeCloseTo(2 * (a.pitchTarget - CAMERA.defaultPitch), 6)
  })

  it('recenter (C) smoothly swings behind the worker facing', () => {
    const rig = new CameraRig()
    rig.snapBehind(0)
    rig.set({ yaw: 2.5, immediate: true })
    const c = ctx({ facing: -0.4 })
    run(rig, c, 1)
    rig.recenter()
    run(rig, c, 3)
    expect(Math.abs(rig.yaw - -0.4)).toBeGreaterThan(0.3) // not a snap
    run(rig, c, 150)
    expect(Math.abs(rig.yaw - -0.4)).toBeLessThan(0.02)
  })

  it('indoors: boom capped at 4.2 m and kept under the eave', () => {
    const rig = new CameraRig()
    rig.snapBehind(0)
    rig.set({ distance: 9, pitch: 1.1, immediate: true })
    const c = ctx({ focus: new THREE.Vector3(12, 0, 29), interior: 'personnel' })
    run(rig, c, 30)
    expect(rig.arm.length).toBeLessThanOrEqual(CAMERA.interiorMaxDistance + 1e-6)
    expect(c.camera.position.y).toBeLessThanOrEqual(6 - CAMERA.eaveMargin + 1e-6)
    // user's zoom preference survives going indoors
    expect(rig.zoomTarget).toBe(9)
  })

  it('walking through a doorway glides to the interior framing (no pop)', () => {
    const rig = new CameraRig()
    rig.snapBehind(0)
    const c = ctx({ focus: new THREE.Vector3(4.5, 0, 29) })
    run(rig, c, 5)
    expect(rig.arm.length).toBeCloseTo(CAMERA.defaultDistance, 3)
    c.interior = 'personnel'
    run(rig, c, 1)
    expect(rig.arm.length).toBeGreaterThan(CAMERA.defaultDistance - 0.15)
    run(rig, c, 90)
    expect(rig.arm.length).toBeLessThan(CAMERA.interiorMaxDistance + 0.05)
    c.interior = null
    run(rig, c, 240)
    expect(rig.arm.length).toBeCloseTo(CAMERA.defaultDistance, 2)
  })

  it('shake moves the camera, but never under reduced motion', () => {
    const base = new CameraRig()
    base.snapBehind(0)
    const cb = ctx()
    run(base, cb, 3)
    const ref = cb.camera.position.clone()

    const shaken = new CameraRig()
    shaken.snapBehind(0)
    const cs = ctx()
    run(shaken, cs, 1)
    shaken.addShake(1, 1, false)
    run(shaken, cs, 2)
    expect(cs.camera.position.distanceTo(ref)).toBeGreaterThan(0.005)

    const calm = new CameraRig()
    calm.snapBehind(0)
    const cc = ctx({ reducedMotion: true })
    run(calm, cc, 1)
    calm.addShake(1, 1, true)
    run(calm, cc, 2)
    expect(cc.camera.position.distanceTo(ref)).toBeLessThan(1e-9)
  })

  it('forklift chase cam: higher, wider, trails the vehicle heading, restores on exit', () => {
    const rig = new CameraRig()
    rig.snapBehind(0)
    rig.set({ distance: 3.5, immediate: true })
    const c = ctx({ focus: new THREE.Vector3(-11, 0, 29), facing: -Math.PI / 2, speed: 4 })
    rig.setFollow('forklift')
    run(rig, c, 240)
    expect(rig.arm.length).toBeCloseTo(FORKLIFT_CAMERA.defaultDistance, 1)
    expect(rig.pitch).toBeCloseTo(FORKLIFT_CAMERA.defaultPitch, 2)
    expect(Math.abs(rig.yaw - -Math.PI / 2)).toBeLessThan(0.05) // behind the vehicle
    rig.setFollow('player')
    run(rig, c, 240)
    expect(rig.zoomTarget).toBeCloseTo(3.5, 6) // on-foot framing restored
  })

  it('set() clamps values and ignores NaN', () => {
    const rig = new CameraRig()
    rig.set({ yaw: Number.NaN, pitch: 5, distance: 100, immediate: true })
    expect(rig.pitch).toBeCloseTo(CAMERA.maxPitch, 9)
    expect(rig.zoomTarget).toBe(CAMERA.maxDistance)
    expect(Number.isFinite(rig.yaw)).toBe(true)
  })
})
