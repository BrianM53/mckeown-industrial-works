import { describe, expect, it } from 'vitest'
import {
  admitVoice,
  computeCull,
  crowdGain,
  DuckController,
  edgeFade,
  envelopeWeight,
  impactVolume,
  inverseDistanceGain,
  OCC_EMITTER_INSIDE,
  OCC_LISTENER_INSIDE,
  OCC_NONE,
  OCC_OTHER_BUILDING,
  occlusionFor,
  phaseCrossed,
  RateLimiter,
  SPATIAL,
  volumeToGain,
  type CullItem,
  type VoiceSlot,
} from './logic'

describe('volume mapping', () => {
  it('maps sliders through a squared (perceptual) taper and rejects junk', () => {
    expect(volumeToGain(0)).toBe(0)
    expect(volumeToGain(1)).toBe(1)
    expect(volumeToGain(0.5)).toBeCloseTo(0.25)
    expect(volumeToGain(-1)).toBe(0)
    expect(volumeToGain(2)).toBe(1)
    expect(volumeToGain(Number.NaN)).toBe(0)
    let prev = -1
    for (let v = 0; v <= 1.0001; v += 0.05) {
      const g = volumeToGain(v)
      expect(g).toBeGreaterThanOrEqual(prev)
      prev = g
    }
  })
})

describe('distance model', () => {
  it('follows the WebAudio inverse model', () => {
    expect(inverseDistanceGain(0, 4, 1.2)).toBe(1)
    expect(inverseDistanceGain(4, 4, 1.2)).toBe(1)
    expect(inverseDistanceGain(14, 4, 1.2)).toBeCloseTo(4 / (4 + 1.2 * 10))
    expect(inverseDistanceGain(Number.POSITIVE_INFINITY, 4, 1.2)).toBe(0)
  })
  it('edge fade is 1 near, 0 at maxDistance and monotonic in between', () => {
    expect(edgeFade(10, 45)).toBe(1)
    expect(edgeFade(45, 45)).toBe(0)
    expect(edgeFade(60, 45)).toBe(0)
    let prev = 1
    for (let d = 30; d <= 45; d += 0.5) {
      const f = edgeFade(d, 45)
      expect(f).toBeLessThanOrEqual(prev + 1e-12)
      prev = f
    }
  })
})

describe('RateLimiter', () => {
  it('keeps footsteps ≥ 0.18 s apart and impacts ≥ 0.1 s apart, per name', () => {
    const r = new RateLimiter()
    expect(r.allow('footstep', 10, 0.18)).toBe(true)
    expect(r.allow('footstep', 10.1, 0.18)).toBe(false)
    expect(r.allow('footstep', 10.17, 0.18)).toBe(false)
    expect(r.allow('footstep', 10.19, 0.18)).toBe(true)
    expect(r.allow('crate-bump', 10.19, 0.1)).toBe(true)
    expect(r.allow('crate-bump', 10.25, 0.1)).toBe(false)
    expect(r.allow('crate-bump', 10.3, 0.1)).toBe(true)
  })
  it('a rejected call does not extend the window; reset clears it', () => {
    const r = new RateLimiter()
    r.allow('x', 0, 1)
    r.allow('x', 0.9, 1)
    expect(r.allow('x', 1.01, 1)).toBe(true)
    r.reset()
    expect(r.allow('x', 1.02, 1)).toBe(true)
  })
})

describe('DuckController', () => {
  it('uses the strongest active duck and restores after it expires', () => {
    const d = new DuckController()
    d.add(0.5, 4, 0)
    expect(d.amount(0.5)).toBe(0.5)
    d.add(0.8, 1, 1)
    expect(d.amount(1.5)).toBe(0.8)
    expect(d.amount(2.5)).toBe(0.5)
    expect(d.amount(4.5)).toBe(0)
  })
  it('ignores invalid requests', () => {
    const d = new DuckController()
    d.add(Number.NaN, 2, 0)
    d.add(0.5, -1, 0)
    d.add(0.5, Number.NaN, 0)
    expect(d.amount(0.1)).toBe(0)
  })
})

describe('voice admission / stealing', () => {
  const v = (id: number, name: string, started: number, score: number): VoiceSlot => ({ id, name, started, score })

  it('admits freely below the cap', () => {
    expect(admitVoice([v(1, 'a', 0, 1)], 4, { name: 'b', score: 0.1, perNameCap: 4, policy: 'steal' })).toEqual({ admit: true, steal: [] })
  })

  it('at the global cap steals the quietest voice (ties → oldest)', () => {
    const active = [v(1, 'a', 0, 0.5), v(2, 'b', 1, 0.2), v(3, 'c', 2, 0.2), v(4, 'd', 3, 0.9)]
    expect(admitVoice(active, 4, { name: 'e', score: 0.6, perNameCap: 4, policy: 'steal' })).toEqual({ admit: true, steal: [2] })
  })

  it('rejects a new sound quieter than everything already playing', () => {
    const active = [v(1, 'a', 0, 0.5), v(2, 'b', 1, 0.4)]
    expect(admitVoice(active, 2, { name: 'c', score: 0.1, perNameCap: 4, policy: 'steal' }).admit).toBe(false)
  })

  it('per-name cap steals the oldest of that name, or rejects by policy', () => {
    const active = [v(1, 'step', 0, 0.3), v(2, 'step', 1, 0.3), v(3, 'x', 0.5, 0.1)]
    expect(admitVoice(active, 24, { name: 'step', score: 0.3, perNameCap: 2, policy: 'steal' })).toEqual({ admit: true, steal: [1] })
    expect(admitVoice(active, 24, { name: 'step', score: 0.3, perNameCap: 2, policy: 'reject' }).admit).toBe(false)
  })

  it('never exceeds the cap across a burst', () => {
    let active: VoiceSlot[] = []
    let id = 0
    for (let i = 0; i < 100; i++) {
      const a = admitVoice(active, 24, { name: `n${i % 13}`, score: (i % 7) / 7 + 0.01, perNameCap: 4, policy: 'steal' })
      if (!a.admit) continue
      active = active.filter((x) => !a.steal.includes(x.id))
      active.push(v(++id, `n${i % 13}`, i, (i % 7) / 7 + 0.01))
      expect(active.length).toBeLessThanOrEqual(24)
    }
    expect(active.length).toBe(24)
  })

  it('older voices weigh less (envelope weight)', () => {
    expect(envelopeWeight(0, 2)).toBe(1)
    expect(envelopeWeight(1, 2)).toBeCloseTo(0.5)
    expect(envelopeWeight(5, 2)).toBe(0.1)
  })
})

describe('spatial culling', () => {
  const item = (id: number, name: string, distance: number, active = false, positional = true, maxDistance = 45): CullItem => ({
    id,
    name,
    positional,
    distance,
    maxDistance,
    active,
    want: false,
    key: 0,
  })
  const opts = { hysteresis: SPATIAL.hysteresis, stickiness: SPATIAL.stickiness, maxTotal: 12, perName: () => 3 }

  it('activates inside maxDistance and keeps active ones through the hysteresis band', () => {
    const items = [item(1, 'a', 44), item(2, 'b', 47), item(3, 'c', 47, true), item(4, 'd', 50, true)]
    computeCull(items, opts)
    expect(items.map((i) => i.want)).toEqual([true, false, true, false])
  })

  it('non-positional loops are always realized', () => {
    const items = [item(1, 'music', Number.POSITIVE_INFINITY, false, false)]
    computeCull(items, opts)
    expect(items[0].want).toBe(true)
  })

  it('caps instances per name (nearest win) and in total', () => {
    const items = [1, 2, 3, 4, 5].map((k) => item(k, 'belt', k * 5))
    computeCull(items, { ...opts, perName: () => 3 })
    expect(items.filter((i) => i.want).map((i) => i.id)).toEqual([1, 2, 3])
    const many = Array.from({ length: 20 }, (_, k) => item(k + 1, `n${k}`, k + 1))
    const total = computeCull(many, { ...opts, maxTotal: 8 })
    expect(total).toBe(8)
    expect(many.filter((i) => i.want).map((i) => i.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('stickiness keeps an active emitter from flapping at the cap boundary', () => {
    const items = [item(1, 'belt', 10, true), item(2, 'belt', 9.5, false)]
    computeCull(items, { ...opts, perName: () => 1 })
    expect(items[0].want).toBe(true)
    expect(items[1].want).toBe(false)
  })

  it('merges coincident same-name emitters: only the loudest twin plays', () => {
    const a = { ...item(1, 'transformer-hum', 10), x: 17.5, y: 1.5, z: -4.5, weight: 0.36 }
    const b = { ...item(2, 'transformer-hum', 9.9), x: 17.6, y: 1.4, z: -4.6, weight: 0.18 }
    const far = { ...item(3, 'transformer-hum', 30), x: 40, y: 1.5, z: -4.5, weight: 0.18 }
    const other = { ...item(4, 'fan-hum', 10), x: 17.5, y: 1.5, z: -4.5, weight: 0.1 }
    computeCull([a, b, far, other], { ...opts, mergeRadius: 3 })
    expect([a.want, b.want, far.want, other.want]).toEqual([true, false, true, true])
    // without merging both twins would play
    computeCull([a, b], opts)
    expect([a.want, b.want]).toEqual([true, true])
  })

  it('a listener walking away culls, walking back re-activates (simulation)', () => {
    const e = item(1, 'furnace', 0)
    const states: boolean[] = []
    for (const d of [10, 40, 46, 48, 50, 47, 44, 30]) {
      e.distance = d
      e.active = e.want
      computeCull([e], opts)
      states.push(e.want)
    }
    expect(states).toEqual([true, true, true, true, false, false, true, true])
  })
})

describe('occlusion', () => {
  it('muffles across walls', () => {
    expect(occlusionFor(null, null)).toBe(OCC_NONE)
    expect(occlusionFor('server', 'server')).toBe(OCC_NONE)
    expect(occlusionFor(null, 'server')).toBe(OCC_EMITTER_INSIDE)
    expect(occlusionFor('server', null)).toBe(OCC_LISTENER_INSIDE)
    expect(occlusionFor('server', 'radio')).toBe(OCC_OTHER_BUILDING)
    expect(OCC_OTHER_BUILDING.gain).toBeLessThan(OCC_LISTENER_INSIDE.gain)
  })
})

describe('helpers', () => {
  it('crowd gain turns many voices down gently', () => {
    expect(crowdGain(0)).toBe(1)
    expect(crowdGain(4)).toBe(1)
    expect(crowdGain(16)).toBeCloseTo(0.5)
    expect(crowdGain(Number.NaN)).toBe(1)
  })
  it('impact volume grows with strength and is clamped', () => {
    expect(impactVolume(0)).toBe(0.2)
    expect(impactVolume(0.5)).toBeCloseTo(0.6)
    expect(impactVolume(1)).toBe(1)
    expect(impactVolume(50)).toBe(1)
    expect(impactVolume(Number.NaN)).toBe(0.2)
  })
  it('detects phase crossings including wrap-around', () => {
    expect(phaseCrossed(0.4, 0.6, 0.5)).toBe(true)
    expect(phaseCrossed(0.5, 0.6, 0.5)).toBe(false)
    expect(phaseCrossed(0.1, 0.2, 0.5)).toBe(false)
    expect(phaseCrossed(0.9, 0.1, 0.5)).toBe(false)
    expect(phaseCrossed(0.4, 0.1, 0.5)).toBe(true)
    expect(phaseCrossed(0.9, 0.6, 0.5)).toBe(true)
    expect(phaseCrossed(Number.NaN, 0.6, 0.5)).toBe(false)
  })
})
