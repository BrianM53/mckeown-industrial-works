import { describe, expect, it } from 'vitest'
import { PLAYABLE_BOUNDS } from '@/world/layout'
import { PROPS } from '../constants'
import { isDisplaced, isLost, propRule, type PropSnapshot } from './propRules'

const base: PropSnapshot = { x: -38, y: 0, z: 28, up: 1, homeX: -38, homeY: 0, homeZ: 28, playerX: -36, playerZ: 30 }

function simulate(p: PropSnapshot, seconds: number, dt = 0.5) {
  let t = 0
  const verdicts: string[] = []
  for (let s = 0; s < seconds - 1e-9; s += dt) {
    const r = propRule(p, t, dt)
    t = r.displacedFor
    verdicts.push(r.verdict)
  }
  return verdicts
}

describe('prop reset rules', () => {
  it('a prop at home is fine', () => {
    expect(isDisplaced(base)).toBe(false)
    expect(propRule(base, 0, 1).verdict).toBe('ok')
  })

  it('small nudges are not displacement; > 0.5 m or tipped over is', () => {
    expect(isDisplaced({ ...base, x: base.x + 0.3 })).toBe(false)
    expect(isDisplaced({ ...base, x: base.x + 0.6 })).toBe(true)
    expect(isDisplaced({ ...base, up: 0.1 })).toBe(true)
  })

  it('resets immediately when lost (fell, NaN, out of bounds)', () => {
    expect(isLost({ ...base, y: -5 })).toBe(true)
    expect(isLost({ ...base, x: Number.NaN })).toBe(true)
    expect(isLost({ ...base, x: PLAYABLE_BOUNDS.maxX + 2 })).toBe(true)
    expect(propRule({ ...base, y: -5 }, 0, 0.1).verdict).toBe('reset-now')
  })

  it('a displaced prop is left alone while the visitor is nearby', () => {
    const p = { ...base, x: base.x + 3 }
    const v = simulate(p, 300)
    expect(v.every((x) => x === 'displaced')).toBe(true)
  })

  it('a displaced prop resets 60 s after the visitor walked > 25 m away', () => {
    const far = { ...base, x: base.x + 3, playerX: 10, playerZ: 30 }
    const v = simulate(far, PROPS.resetAfter + 1)
    expect(v.slice(0, -3).every((x) => x === 'displaced')).toBe(true)
    expect(v).toContain('reset')
  })

  it('the visitor standing near the HOME spot also blocks the reset (no popping in their face)', () => {
    const p = { ...base, x: base.x + 30, playerX: base.homeX + 2, playerZ: base.homeZ }
    expect(simulate(p, 120)).not.toContain('reset')
  })

  it('returning home on its own clears the timer', () => {
    const r1 = propRule({ ...base, x: base.x + 2, playerX: 40 }, 50, 1)
    expect(r1.displacedFor).toBe(51)
    const r2 = propRule(base, r1.displacedFor, 1)
    expect(r2.verdict).toBe('ok')
    expect(r2.displacedFor).toBe(0)
  })
})
