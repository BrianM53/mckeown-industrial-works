import { describe, expect, it } from 'vitest'
import { EAST, NORTH, PLAYABLE_BOUNDS } from '@/world/layout'
import { HOME } from '../constants'
import { SafePositionTracker, footprintInBounds, footprintInRestricted, isSafePose } from './safePosition'

describe('safe-position rules', () => {
  it('home is safe', () => {
    expect(isSafePose({ x: HOME.x, z: HOME.z, yaw: HOME.yaw })).toBe(true)
  })

  it('rejects poses in restricted zones (pad circle, transformer, wet paint)', () => {
    expect(footprintInRestricted({ x: 16, z: -34, yaw: 0 })).toBe(true)
    // parked beside the blast circle, with the forks poking in
    expect(footprintInRestricted({ x: 16, z: -24.5, yaw: NORTH })).toBe(true)
    expect(footprintInRestricted({ x: 17.5, z: -4.5, yaw: 0 })).toBe(true)
    expect(footprintInRestricted({ x: -17.5, z: -4.5, yaw: EAST })).toBe(true)
    expect(footprintInRestricted({ x: 0, z: 25, yaw: NORTH })).toBe(false)
    expect(isSafePose({ x: 16, z: -34, yaw: 0 })).toBe(false)
  })

  it('rejects poses poking outside the playable rectangle', () => {
    expect(footprintInBounds({ x: PLAYABLE_BOUNDS.maxX - 0.5, z: 0, yaw: 0 })).toBe(false)
    expect(footprintInBounds({ x: 0, z: PLAYABLE_BOUNDS.maxZ - 1, yaw: 0 })).toBe(false)
    expect(footprintInBounds({ x: 0, z: 0, yaw: 0 })).toBe(true)
  })

  it('rejects non-finite poses', () => {
    expect(isSafePose({ x: Number.NaN, z: 0, yaw: 0 })).toBe(false)
    expect(isSafePose({ x: 0, z: 0, yaw: Number.POSITIVE_INFINITY })).toBe(false)
  })
})

describe('safe-position tracker', () => {
  it('samples about once per second and keeps the newest first', () => {
    const t = new SafePositionTracker(1, 5)
    let calls = 0
    let x = 0
    for (let i = 0; i < 60 * 4; i++) {
      t.update(1 / 60, () => {
        calls++
        x += 2
        return { x, z: 25, yaw: 0 }
      })
    }
    expect(calls).toBeGreaterThanOrEqual(3)
    expect(calls).toBeLessThanOrEqual(4)
    expect(t.latest()?.x).toBe(x)
    const c = t.candidates()
    for (let i = 1; i < c.length; i++) expect(c[i - 1].t).toBeGreaterThan(c[i].t)
  })

  it('ignores null and unsafe samples', () => {
    const t = new SafePositionTracker(1, 5)
    for (let i = 0; i < 180; i++) t.update(1 / 60, () => null)
    expect(t.latest()).toBeNull()
    for (let i = 0; i < 180; i++) t.update(1 / 60, () => ({ x: 16, z: -34, yaw: 0 }))
    expect(t.latest()).toBeNull()
  })

  it('refreshes instead of duplicating while parked, and is capped', () => {
    const t = new SafePositionTracker(1, 3)
    for (let i = 0; i < 600; i++) t.update(1 / 60, () => ({ x: 0, z: 25, yaw: 0 }))
    expect(t.size).toBe(1)
    // the sampler runs once per second: move 1 m between samples
    let x = 0
    for (let i = 0; i < 600; i++) t.update(1 / 60, () => ({ x: (x += 1), z: 25, yaw: 0 }))
    expect(t.size).toBe(3)
  })

  it('clear forgets history (after a teleport)', () => {
    const t = new SafePositionTracker(1, 3)
    t.record({ x: 0, z: 25, yaw: 0 })
    t.clear()
    expect(t.latest()).toBeNull()
  })

  it('a throwing sampler never breaks the tracker', () => {
    const t = new SafePositionTracker(1, 3)
    expect(() => {
      for (let i = 0; i < 120; i++)
        t.update(1 / 60, () => {
          throw new Error('physics gone')
        })
    }).not.toThrow()
  })
})
