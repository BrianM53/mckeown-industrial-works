import { describe, expect, it } from 'vitest'
import { ANCHORS, LINES, PAD, QC_ARCH, RESTRICTED_ZONES, WORLD_BOUNDS, ZONES } from '@/world/layout'
import {
  estimateRocketAltitude,
  MarkWatcher,
  newestItemPast,
  PAD_POSITION,
  PRESS_POSITION,
  QC_MARK,
  QC_SCANNER_POSITION,
  SeededTimer,
  spaceAt,
  STEAM_SPOTS,
  WELD_SPOTS,
  WORLD_EMITTERS,
} from './emitters'
import { LOOP_META } from './synth/loops'

describe('world sound map', () => {
  it('every emitter is inside the world and uses a real loop', () => {
    for (const e of WORLD_EMITTERS) {
      const [x, , z] = e.position
      expect(x >= WORLD_BOUNDS.minX && x <= WORLD_BOUNDS.maxX && z >= WORLD_BOUNDS.minZ && z <= WORLD_BOUNDS.maxZ, e.id).toBe(true)
      expect(LOOP_META[e.loop], e.id).toBeDefined()
      expect(e.position.every(Number.isFinite), e.id).toBe(true)
    }
    expect(new Set(WORLD_EMITTERS.map((e) => e.id)).size).toBe(WORLD_EMITTERS.length)
  })

  it('places machinery where the layout says', () => {
    const smelt = LINES.find((l) => l.id === 'smelt')!
    const furnace = WORLD_EMITTERS.find((e) => e.loop === 'furnace-roar')!
    expect(furnace.position[0]).toBe(smelt.x)
    expect(Math.abs(furnace.position[2] - smelt.zStart)).toBeLessThanOrEqual(1)

    const ground = LINES.filter((l) => !l.overhead)
    for (const l of ground) {
      const belt = WORLD_EMITTERS.find((e) => e.id === `belt-${l.id}`)!
      expect(belt.loop).toBe('belt-clatter')
      expect(belt.line).toBe(l.id)
      expect(belt.position[0]).toBe(l.x)
      expect(belt.position[2]).toBeCloseTo((l.zStart + l.zEnd) / 2)
    }

    const yard = RESTRICTED_ZONES.find((r) => r.id === 'transformer-yard')!
    const tr = WORLD_EMITTERS.find((e) => e.loop === 'transformer-hum')!
    if (yard.shape.kind !== 'rect') throw new Error('expected rect')
    expect(tr.position[0]).toBeCloseTo((yard.shape.rect.minX + yard.shape.rect.maxX) / 2)
    expect(tr.position[2]).toBeCloseTo((yard.shape.rect.minZ + yard.shape.rect.maxZ) / 2)

    const fan = WORLD_EMITTERS.find((e) => e.loop === 'fan-hum')!
    expect([fan.position[0], fan.position[2]]).toEqual(ANCHORS.serverFan.position)
    const radio = WORLD_EMITTERS.find((e) => e.loop === 'radio-music')!
    expect([radio.position[0], radio.position[2]]).toEqual(ANCHORS.radioDesk.position)
    const racks = WORLD_EMITTERS.find((e) => e.loop === 'server-hum')!
    expect(spaceAt(racks.position[0], racks.position[2])).toBe('server')

    expect(PRESS_POSITION[0]).toBe(smelt.x)
    expect([PAD_POSITION[0], PAD_POSITION[2]]).toEqual(PAD.center)
    expect(WELD_SPOTS.length).toBeGreaterThan(0)
    expect(STEAM_SPOTS.length).toBeGreaterThanOrEqual(2)
  })

  it('spaceAt resolves building interiors (occlusion) and outdoors', () => {
    expect(spaceAt(ANCHORS.serverFan.position[0], ANCHORS.serverFan.position[1])).toBe('server')
    expect(spaceAt(ZONES.radio.center[0], ZONES.radio.center[1])).toBe('radio')
    expect(spaceAt(0, 10)).toBeNull()
    expect(spaceAt(39, -14)).toBeNull() // rec yard has no building
  })
})

describe('SeededTimer', () => {
  it('is reproducible and fires within its interval range', () => {
    const a = new SeededTimer('audio:weld', 2, 4)
    const b = new SeededTimer('audio:weld', 2, 4)
    const fires = (t: SeededTimer) => {
      const at: number[] = []
      for (let i = 0; i < 2000; i++) if (t.tick(0.01)) at.push(Math.round(i))
      return at
    }
    const fa = fires(a)
    expect(fires(b)).toEqual(fa)
    expect(fa.length).toBeGreaterThanOrEqual(4)
    for (let i = 1; i < fa.length; i++) {
      const gap = (fa[i] - fa[i - 1]) * 0.01
      expect(gap).toBeGreaterThanOrEqual(1.99)
      expect(gap).toBeLessThanOrEqual(4.02)
    }
    expect(new SeededTimer('audio:other', 2, 4).tick(0)).toBe(false)
  })

  it('bursty timers mix short and long gaps', () => {
    const t = new SeededTimer('audio:weld', 3, 6, { chance: 0.6, min: 0.2, max: 0.5 })
    const gaps: number[] = []
    let last = 0
    for (let i = 1; i <= 20000; i++) {
      if (t.tick(0.01)) {
        gaps.push((i - last) * 0.01)
        last = i
      }
    }
    expect(gaps.some((g) => g < 0.6)).toBe(true)
    expect(gaps.some((g) => g > 2.9)).toBe(true)
  })
})

describe('QC scanner (payload items passing the arch)', () => {
  it('the mark is where the payload line crosses the QC arch', () => {
    const p = LINES.find((l) => l.id === 'payload')!
    expect(p.zStart + (p.zEnd - p.zStart) * QC_MARK).toBeCloseTo(QC_ARCH.position[1])
    expect(QC_SCANNER_POSITION[2]).toBe(QC_ARCH.position[1])
    expect(QC_SCANNER_POSITION[1]).toBeLessThan(QC_ARCH.height)
  })

  it('newestItemPast returns the cycle id of the newest item beyond the mark', () => {
    // items sorted descending; item i was made by cycle cycles - (len - 1 - i)
    expect(newestItemPast([0.9, 0.6, 0.3, 0.1], 20, 0.5)).toBe(18)
    expect(newestItemPast([0.9, 0.6, 0.3, 0.1], 20, 0.95)).toBe(-1)
    expect(newestItemPast([], 5, 0.5)).toBe(-1)
  })

  it('fires once per item passing, never for the initial belt or after a reset', () => {
    const w = new MarkWatcher(0.5)
    const items = [0.9, 0.6, 0.45, 0.2]
    let cycles = 30
    expect(w.tick(items, cycles)).toBe(false) // first look
    const fired: number[] = []
    for (let f = 0; f < 400; f++) {
      for (let i = 0; i < items.length; i++) items[i] += 0.004
      while (items.length && items[0] >= 1) items.shift()
      if (f % 40 === 0) {
        items.push(0)
        cycles++
      }
      if (w.tick(items, cycles)) fired.push(f)
    }
    // every item that crossed 0.5 fired exactly once
    expect(fired.length).toBeGreaterThanOrEqual(9)
    for (let i = 1; i < fired.length; i++) expect(fired[i] - fired[i - 1]).toBeGreaterThanOrEqual(30)
    // hard reset: belt cleared, cycles restart → silent
    expect(w.tick([], 0)).toBe(false)
    expect(w.tick([0.1], 1)).toBe(false)
    expect(w.tick([0.55], 1)).toBe(true)
    expect(w.tick(undefined, undefined)).toBe(false)
  })
})

describe('rocket altitude estimate', () => {
  it('rises monotonically and is capped', () => {
    let prev = -1
    for (let t = 0; t < 20; t += 0.5) {
      const y = estimateRocketAltitude(t)
      expect(y).toBeGreaterThanOrEqual(prev)
      prev = y
    }
    expect(estimateRocketAltitude(100)).toBe(70)
    expect(estimateRocketAltitude(-5)).toBe(2)
  })
})
