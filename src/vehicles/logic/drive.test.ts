import { describe, expect, it } from 'vitest'
import { DRIVE } from '../constants'
import { approach, capPlanar, engineRate, lateralGripFor, rearWheelAngle, stepForwardSpeed, stepSteer, yawRateFor } from './drive'

const DT = 1 / 60

function run(v: number, throttle: number, seconds: number, parked = false): number {
  for (let t = 0; t < seconds - 1e-9; t += DT) v = stepForwardSpeed(v, throttle, DT, parked)
  return v
}

describe('forklift drive model', () => {
  it('approach never overshoots', () => {
    expect(approach(0, 1, 0.3)).toBeCloseTo(0.3)
    expect(approach(0.9, 1, 0.3)).toBe(1)
    expect(approach(1, -1, 0.5)).toBeCloseTo(0.5)
    expect(approach(Number.NaN, 2, 0.1)).toBe(2)
  })

  it('accelerates forward at a heavy but responsive rate and caps at max speed', () => {
    const after1s = run(0, 1, 1)
    expect(after1s).toBeGreaterThan(3.2)
    expect(after1s).toBeLessThan(DRIVE.accel + 0.01)
    expect(run(0, 1, 6)).toBeCloseTo(DRIVE.maxForward, 5)
    expect(run(0, 1, 20)).toBeLessThanOrEqual(DRIVE.maxForward + 1e-9)
  })

  it('reverses slower than it drives forward', () => {
    expect(run(0, -1, 6)).toBeCloseTo(-DRIVE.maxReverse, 5)
    expect(Math.abs(run(0, -1, 0.5))).toBeLessThan(run(0, 1, 0.5))
  })

  it('S while rolling forward brakes hard before reversing', () => {
    const v = run(DRIVE.maxForward, -1, 0.5)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(DRIVE.maxForward - DRIVE.brake * 0.5 + 0.2)
    const later = run(DRIVE.maxForward, -1, 2.5)
    expect(later).toBeLessThan(0)
  })

  it('W while reversing brakes first', () => {
    const v = run(-DRIVE.maxReverse, 1, 0.2)
    expect(v).toBeLessThan(0)
    expect(v).toBeGreaterThan(-DRIVE.maxReverse)
  })

  it('coasts to a stop without input; parking brake is stronger', () => {
    const coasting = run(5, 0, 1)
    const parked = run(5, 0, 1, true)
    expect(coasting).toBeGreaterThan(parked)
    expect(run(5, 0, 5)).toBe(0)
    expect(parked).toBe(0)
  })

  it('partial throttle (touch stick) drives slower', () => {
    expect(run(0, 0.5, 8)).toBeCloseTo(DRIVE.maxForward * 0.5, 5)
  })

  it('ignores garbage input', () => {
    expect(stepForwardSpeed(Number.NaN, 1, DT)).toBe(0)
    expect(stepForwardSpeed(2, Number.NaN, DT)).toBeLessThan(2)
    expect(stepForwardSpeed(2, 1, 0)).toBe(2)
  })

  it('yaw rate is proportional to speed, capped, zero when stopped', () => {
    expect(yawRateFor(0, 1)).toBe(0)
    const slow = Math.abs(yawRateFor(1, 1))
    const mid = Math.abs(yawRateFor(2, 1))
    expect(mid).toBeCloseTo(slow * 2, 6)
    expect(Math.abs(yawRateFor(DRIVE.maxForward, 1))).toBeCloseTo(DRIVE.maxYawRate, 6)
  })

  it('D turns right going forward (yaw decreases) and the sign flips in reverse', () => {
    expect(yawRateFor(3, 1)).toBeLessThan(0)
    expect(yawRateFor(3, -1)).toBeGreaterThan(0)
    expect(yawRateFor(-2, 1)).toBeGreaterThan(0)
  })

  it('steering chases the input and self-centers faster', () => {
    let s = 0
    for (let i = 0; i < 6; i++) s = stepSteer(s, 1, DT)
    expect(s).toBeGreaterThan(0.3)
    expect(s).toBeLessThan(1)
    let back = 1
    for (let i = 0; i < 6; i++) back = stepSteer(back, 0, DT)
    expect(1 - back).toBeGreaterThan(s)
  })

  it('side grip loosens a little at speed with full lock', () => {
    expect(lateralGripFor(0.5, 0)).toBeCloseTo(DRIVE.lateralGrip, 5)
    expect(lateralGripFor(DRIVE.maxForward, 1)).toBeCloseTo(DRIVE.lateralGripFast, 5)
    expect(lateralGripFor(DRIVE.maxForward, 1)).toBeLessThan(lateralGripFor(2, 0.3))
  })

  it('engine pitch is 1 at idle and ~2.5 flat out', () => {
    expect(engineRate(0, 0)).toBe(1)
    expect(engineRate(DRIVE.maxForward, 1)).toBeCloseTo(2.5, 5)
    expect(engineRate(Number.NaN, Number.NaN)).toBe(1)
  })

  it('rear wheels point opposite the turn (rear steer)', () => {
    expect(rearWheelAngle(1)).toBeGreaterThan(0)
    expect(rearWheelAngle(-1)).toBeLessThan(0)
    expect(rearWheelAngle(0)).toBe(0)
  })

  it('capPlanar clamps horizontal speed', () => {
    const v = { x: 6, z: 8 }
    expect(capPlanar(v, 5)).toBe(true)
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(5)
    expect(capPlanar(v, 9)).toBe(false)
  })
})
