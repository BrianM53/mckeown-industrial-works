import { describe, expect, it } from 'vitest'
import { SafePositionTracker, StuckDetector } from './recovery'

const DT = 1 / 60

describe('stuck detector', () => {
  it('flags stuck after ~1.5 s of held input with < 0.15 m displacement', () => {
    const d = new StuckDetector()
    let t = 0
    let flagged = -1
    for (let i = 0; i < 180; i++) {
      t += DT
      // jitter in place (pushing into a wall)
      if (d.update(DT, true, 5 + Math.sin(i) * 0.02, 5) && flagged < 0) flagged = t
    }
    expect(flagged).toBeGreaterThan(1.4)
    expect(flagged).toBeLessThan(1.7)
    expect(d.stuckSince).toBeLessThan(0.05)
  })
  it('does not flag while actually moving, or when no input is held', () => {
    const d = new StuckDetector()
    for (let i = 0; i < 300; i++) expect(d.update(DT, true, i * 0.07, 0)).toBe(false)
    const idle = new StuckDetector()
    for (let i = 0; i < 300; i++) expect(idle.update(DT, false, 1, 1)).toBe(false)
  })
  it('clears once the worker moves away', () => {
    const d = new StuckDetector()
    for (let i = 0; i < 120; i++) d.update(DT, true, 0, 0)
    expect(d.stuck).toBe(true)
    let x = 0
    for (let i = 0; i < 30 && d.stuck; i++) {
      x += 0.05
      d.update(DT, true, x, 0)
    }
    expect(d.stuck).toBe(false)
  })
  it('lingers a few seconds after input is released, then clears', () => {
    const d = new StuckDetector({ linger: 2 })
    for (let i = 0; i < 120; i++) d.update(DT, true, 0, 0)
    expect(d.stuck).toBe(true)
    for (let i = 0; i < 60; i++) d.update(DT, false, 0, 0)
    expect(d.stuck).toBe(true)
    for (let i = 0; i < 90; i++) d.update(DT, false, 0, 0)
    expect(d.stuck).toBe(false)
  })
  it('reset clears the flag', () => {
    const d = new StuckDetector()
    for (let i = 0; i < 120; i++) d.update(DT, true, 0, 0)
    d.reset(3, 3)
    expect(d.stuck).toBe(false)
    expect(d.update(DT, true, 3, 3)).toBe(false)
  })
})

describe('safe position tracker', () => {
  const sampleAt = (x: number, z: number, t: number) => () => ({ x, y: 0, z, yaw: 0, t })
  it('samples at the configured interval only', () => {
    const tr = new SafePositionTracker(12, 1)
    let calls = 0
    for (let i = 0; i < 300; i++)
      tr.update(DT, () => {
        calls++
        return { x: i, y: 0, z: 0, yaw: 0, t: i * DT }
      })
    expect(calls).toBeGreaterThanOrEqual(5)
    expect(calls).toBeLessThanOrEqual(6)
    expect(tr.size).toBe(calls)
  })
  it('rejects invalid samples and keeps a bounded ring buffer', () => {
    const tr = new SafePositionTracker(3, 1)
    tr.update(1, () => null)
    expect(tr.latest()).toBeNull()
    tr.push({ x: Number.NaN, y: 0, z: 0, yaw: 0, t: 0 })
    expect(tr.size).toBe(0)
    for (let i = 0; i < 5; i++) tr.push({ x: i * 2, y: 0, z: 0, yaw: 0, t: i })
    expect(tr.size).toBe(3)
    expect(tr.latest()?.x).toBe(8)
  })
  it('standing still refreshes the newest entry instead of flooding', () => {
    const tr = new SafePositionTracker(12, 1)
    for (let i = 0; i < 6; i++) tr.update(1, sampleAt(1, 1, i))
    expect(tr.size).toBe(1)
    expect(tr.latest()?.t).toBe(5)
  })
  it('candidates: newest first, min distance and recorded-before filters', () => {
    const tr = new SafePositionTracker(12, 1)
    tr.push({ x: 0, y: 0, z: 0, yaw: 0, t: 1 })
    tr.push({ x: 3, y: 0, z: 0, yaw: 0, t: 2 })
    tr.push({ x: 6, y: 0, z: 0, yaw: 0, t: 3 })
    expect(tr.candidates(6, 0).map((c) => c.x)).toEqual([6, 3, 0])
    expect(tr.candidates(6, 0, 2).map((c) => c.x)).toEqual([3, 0])
    expect(tr.candidates(6, 0, 0, 1.5).map((c) => c.x)).toEqual([0])
    tr.clear()
    expect(tr.candidates(0, 0)).toEqual([])
  })
})
