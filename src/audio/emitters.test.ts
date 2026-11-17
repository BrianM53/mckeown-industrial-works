import { describe, expect, it } from 'vitest'
import { ANCHORS, LINES, PAD, RESTRICTED_ZONES, WORLD_BOUNDS, ZONES } from '@/world/layout'
import { estimateRocketAltitude, PAD_POSITION, PRESS_POSITION, SeededTimer, spaceAt, STEAM_SPOTS, WELD_SPOTS, WORLD_EMITTERS } from './emitters'
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
