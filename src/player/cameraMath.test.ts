import { describe, expect, it } from 'vitest'
import { CAMERA } from './constants'
import {
  applyZoom,
  ceilingLimit,
  clampDistance,
  clampPitch,
  decayTrauma,
  fovForAspect,
  horizontalFov,
  nearFade,
  nearestAngle,
  orbitOffset,
  portraitLookLift,
  springArmStep,
  wheelToZoom,
  type ArmState,
} from './cameraMath'

const DT = 1 / 60
const DEG = Math.PI / 180

describe('orbit clamps & zoom', () => {
  it('pitch is clamped to -20°..65°', () => {
    expect(clampPitch(-1)).toBeCloseTo(-20 * DEG, 9)
    expect(clampPitch(2)).toBeCloseTo(65 * DEG, 9)
    expect(clampPitch(0.2)).toBe(0.2)
    expect(clampPitch(Number.NaN)).toBe(CAMERA.defaultPitch)
  })
  it('distance is clamped to 2.2..9 m (never a bird’s-eye overview)', () => {
    expect(clampDistance(1)).toBe(2.2)
    expect(clampDistance(50)).toBe(9)
    expect(clampDistance(Number.NaN)).toBe(CAMERA.defaultDistance)
    let d: number = CAMERA.defaultDistance
    for (let i = 0; i < 100; i++) d = applyZoom(d, wheelToZoom(120, 0))
    expect(d).toBe(9)
    for (let i = 0; i < 100; i++) d = applyZoom(d, wheelToZoom(-120, 0))
    expect(d).toBe(2.2)
  })
  it('wheel zoom is multiplicative, sign-correct and normalized across delta modes', () => {
    expect(applyZoom(5, wheelToZoom(100, 0))).toBeGreaterThan(5)
    expect(applyZoom(5, wheelToZoom(-100, 0))).toBeLessThan(5)
    expect(wheelToZoom(3, 1)).toBeCloseTo(wheelToZoom(48, 0), 9) // lines → px
    expect(Math.abs(wheelToZoom(100000, 0))).toBeLessThanOrEqual(0.6)
  })
  it('default framing is a human-scale third-person view', () => {
    // camera height at default pitch/distance: shoulder height-ish, not overhead
    const o = orbitOffset(0, CAMERA.defaultPitch, CAMERA.defaultDistance)
    const camY = CAMERA.pivotHeight + o.y
    expect(camY).toBeGreaterThan(2)
    expect(camY).toBeLessThan(3.2)
    // yaw 0 looks north → camera sits south (+Z) of the pivot
    expect(o.z).toBeGreaterThan(5)
    expect(Math.abs(o.x)).toBeLessThan(1e-9)
    // max zoom + max pitch stays well below an overview height
    const top = orbitOffset(0, CAMERA.maxPitch, CAMERA.maxDistance)
    expect(CAMERA.pivotHeight + top.y).toBeLessThan(10.5)
  })
  it('orbit offset: yaw π/2 (looking west) puts the camera east of the pivot', () => {
    const o = orbitOffset(Math.PI / 2, 0, 5)
    expect(o.x).toBeCloseTo(5, 9)
    expect(o.z).toBeCloseTo(0, 9)
  })
  it('nearestAngle picks the short way round', () => {
    expect(nearestAngle(3, -3)).toBeCloseTo(3 + (2 * Math.PI - 6), 9)
    expect(nearestAngle(0.1, 0.3)).toBeCloseTo(0.3, 9)
  })
})

describe('spring arm', () => {
  it('pulls in immediately when blocked (no clipping)', () => {
    const s: ArmState = { length: 5.5, free: true }
    expect(springArmStep(s, 5.5, 1.4, DT)).toBe(1.4)
    expect(s.free).toBe(false)
  })
  it('eases back out slowly once the obstruction clears (no popping)', () => {
    const s: ArmState = { length: 1.4, free: false }
    const first = springArmStep(s, 5.5, 5.5, DT)
    expect(first).toBeGreaterThan(1.4)
    expect(first - 1.4).toBeLessThan(0.3) // far from a pop
    let t = DT
    while (s.length < 5.5 - 1e-6 && t < 5) {
      springArmStep(s, 5.5, 5.5, DT)
      t += DT
    }
    expect(t).toBeGreaterThan(0.5)
    expect(t).toBeLessThan(2.5)
    expect(s.free).toBe(true)
  })
  it('re-blocks instantly while easing out', () => {
    const s: ArmState = { length: 2, free: false }
    springArmStep(s, 5.5, 5.5, DT)
    expect(springArmStep(s, 5.5, 1.0, DT)).toBe(1.0)
  })
  it('unobstructed zoom follows the desired distance 1:1 (no double smoothing)', () => {
    const s: ArmState = { length: 5.5, free: true }
    expect(springArmStep(s, 6.0, 9, DT)).toBe(6.0)
    expect(springArmStep(s, 4.0, 9, DT)).toBe(4.0)
  })
  it('frame-rate independent: 30 fps and 120 fps converge alike', () => {
    const run = (dt: number) => {
      const s: ArmState = { length: 1, free: false }
      for (let t = 0; t < 0.5; t += dt) springArmStep(s, 5, 5, dt)
      return s.length
    }
    expect(Math.abs(run(1 / 30) - run(1 / 120))).toBeLessThan(0.12)
  })
})

describe('interior & comfort helpers', () => {
  it('ceilingLimit keeps the camera under an eave', () => {
    const lim = ceilingLimit(1.6, 30 * DEG, 5.6)
    expect(1.6 + Math.sin(30 * DEG) * lim).toBeCloseTo(5.6, 9)
    expect(ceilingLimit(1.6, -0.1, 5.6)).toBe(Infinity)
    expect(ceilingLimit(6, 0.5, 5)).toBe(0)
  })
  it('shake trauma decays to zero over its duration', () => {
    let tr = 1
    for (let t = 0; t < 0.5; t += DT) tr = decayTrauma(tr, DT, 0.5)
    expect(tr).toBeLessThan(0.05)
    expect(decayTrauma(0, DT, 0.5)).toBe(0)
  })
  it('worker fades only when the camera is inside/near the head', () => {
    expect(nearFade(5)).toBe(1)
    expect(nearFade(0.3)).toBe(0)
    const mid = nearFade(0.9)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
  })
})

describe('portrait framing', () => {
  it('landscape keeps the base FOV', () => {
    expect(fovForAspect(16 / 9)).toBe(CAMERA.fov)
    expect(fovForAspect(1.2)).toBe(CAMERA.fov)
    expect(fovForAspect(Number.NaN)).toBe(CAMERA.fov)
    expect(fovForAspect(0)).toBe(CAMERA.fov)
  })
  it('portrait phones widen the vertical FOV (capped) so the view across is no longer ~28°', () => {
    const pixel7 = 412 / 839
    expect(horizontalFov(CAMERA.fov, pixel7)).toBeLessThan(30) // the reported problem
    const fov = fovForAspect(pixel7)
    expect(fov).toBeGreaterThan(CAMERA.fov)
    expect(fov).toBeLessThanOrEqual(CAMERA.maxPortraitFov)
    expect(horizontalFov(fov, pixel7)).toBeGreaterThan(40)
    // a portrait tablet reaches the full minimum horizontal FOV without hitting the cap
    const tablet = 0.75
    expect(horizontalFov(fovForAspect(tablet), tablet)).toBeCloseTo(CAMERA.minHorizontalFov, 3)
    expect(fovForAspect(tablet)).toBeLessThan(CAMERA.maxPortraitFov)
  })
  it('portrait aims a little higher (worker lower in the frame); never on landscape', () => {
    expect(portraitLookLift(16 / 9)).toBe(0)
    expect(portraitLookLift(1)).toBe(0)
    expect(portraitLookLift(0.75)).toBeCloseTo(CAMERA.portraitLookLift / 2)
    expect(portraitLookLift(0.45)).toBe(CAMERA.portraitLookLift)
  })
})
