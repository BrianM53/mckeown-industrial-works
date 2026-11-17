import { describe, expect, it } from 'vitest'
import { forwardFromYaw, wrapAngle } from '@/core/math'
import { PLAYER } from './constants'
import { FootstepCounter, gaitFrequency, strideLength } from './gait'
import { approachVelocity, simulateFlat, targetVelocity, turnToward, verticalVelocity } from './movement'

const DT = 1 / 60

describe('camera-relative movement integration', () => {
  it('W with camera yaw 0 walks north (-Z)', () => {
    const r = simulateFlat(60, DT, { x: 0, y: 1 }, 0)
    expect(r.z).toBeLessThan(-3)
    expect(Math.abs(r.x)).toBeLessThan(1e-6)
  })
  it('W with camera yaw π/2 moves west (-X)', () => {
    const r = simulateFlat(60, DT, { x: 0, y: 1 }, Math.PI / 2)
    expect(r.x).toBeLessThan(-3)
    expect(Math.abs(r.z)).toBeLessThan(1e-6)
    // body turned to face west
    expect(Math.abs(wrapAngle(r.facing - Math.PI / 2))).toBeLessThan(0.01)
  })
  it('D strafes right of the camera, S walks toward the camera', () => {
    const right = simulateFlat(60, DT, { x: 1, y: 0 }, 0)
    expect(right.x).toBeGreaterThan(3)
    const back = simulateFlat(60, DT, { x: 0, y: -1 }, 0)
    expect(back.z).toBeGreaterThan(3)
    // camera facing east (yaw -π/2): A (left) heads north
    const left = simulateFlat(60, DT, { x: -1, y: 0 }, -Math.PI / 2)
    expect(left.z).toBeLessThan(-3)
  })
  it('works in all four cardinal directions and diagonals at walk speed (normalized)', () => {
    for (const [x, y] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const r = simulateFlat(120, DT, { x, y }, 0.3)
      expect(Math.hypot(r.vx, r.vz)).toBeCloseTo(PLAYER.walkSpeed, 6)
      const f = forwardFromYaw(0.3)
      const expected = { x: f.x * y + Math.cos(0.3) * x, z: f.z * y - Math.sin(0.3) * x }
      const el = Math.hypot(expected.x, expected.z)
      expect((r.vx * expected.x + r.vz * expected.z) / (Math.hypot(r.vx, r.vz) * el)).toBeCloseTo(1, 6)
    }
  })
  it('runs faster with shift', () => {
    const r = simulateFlat(120, DT, { x: 0, y: 1, run: true }, 0)
    expect(Math.hypot(r.vx, r.vz)).toBeCloseTo(PLAYER.runSpeed, 6)
  })
  it('analog stick magnitude scales speed', () => {
    const t = targetVelocity(0, 0.5, 0, false)
    expect(Math.hypot(t.x, t.z)).toBeCloseTo(PLAYER.walkSpeed / 2, 6)
  })
})

describe('acceleration feel', () => {
  it('reaches walk speed in well under 0.25 s and stops within 0.2 s', () => {
    const v = { x: 0, z: 0 }
    const tgt = targetVelocity(0, 1, 0, false)
    let t = 0
    while (Math.hypot(v.x, v.z) < PLAYER.walkSpeed - 1e-6 && t < 1) {
      approachVelocity(v, tgt, PLAYER.accel, PLAYER.decel, DT)
      t += DT
    }
    expect(t).toBeLessThan(0.25)
    let s = 0
    const zero = { x: 0, z: 0 }
    while (Math.hypot(v.x, v.z) > 1e-6 && s < 1) {
      approachVelocity(v, zero, PLAYER.accel, PLAYER.decel, DT)
      s += DT
    }
    expect(s).toBeLessThan(0.2)
  })
  it('turns the body smoothly toward the move direction', () => {
    let facing = 0
    facing = turnToward(facing, 1, 0, DT) // east = -π/2
    expect(facing).toBeLessThan(0)
    expect(facing).toBeGreaterThan(-Math.PI / 2)
    for (let i = 0; i < 60; i++) facing = turnToward(facing, 1, 0, DT)
    expect(facing).toBeCloseTo(-Math.PI / 2, 2)
    expect(turnToward(1.234, 0, 0, DT)).toBe(1.234)
  })
  it('vertical: sticks to the ground, falls with gravity, capped', () => {
    expect(verticalVelocity(0, true, DT)).toBeLessThan(0)
    expect(verticalVelocity(3, true, DT)).toBeLessThan(3) // jump/knock still decays
    let vy = 0
    for (let i = 0; i < 600; i++) vy = verticalVelocity(vy, false, DT)
    expect(vy).toBe(-PLAYER.maxFallSpeed)
  })
})

describe('gait & footsteps', () => {
  it('stride grows with speed and the cadence stays plausible', () => {
    expect(strideLength(7.2)).toBeGreaterThan(strideLength(4.2))
    expect(gaitFrequency(1.4)).toBeGreaterThan(0.8)
    expect(gaitFrequency(7.2)).toBeLessThan(3)
    expect(gaitFrequency(0)).toBe(0)
  })
  it('emits one footstep per half stride, first step promptly', () => {
    const c = new FootstepCounter()
    const v = PLAYER.walkSpeed
    let steps = 0
    let firstAt = -1
    for (let i = 0; i < 120; i++) {
      const n = c.add(v * DT, v)
      if (n && firstAt < 0) firstAt = i * DT
      steps += n
    }
    const expected = (v * 2) / (strideLength(v) / 2)
    expect(Math.abs(steps - expected)).toBeLessThanOrEqual(1)
    expect(firstAt).toBeLessThan(0.15)
    expect(c.add(Number.NaN, 1)).toBe(0)
  })
})
