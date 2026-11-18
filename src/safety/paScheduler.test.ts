import { describe, expect, it } from 'vitest'
import { SimClock } from '@/core/clock'
import type { GameEventName, GameEvents } from '@/core/events'
import { createRng } from '@/core/rng'
import { Director } from '@/systems/director'
import { PA, PA_LINES } from './config'
import { PaScheduler } from './paScheduler'

function setup(opts: { blocked?: () => boolean; seed?: number } = {}) {
  const clock = new SimClock()
  const director = new Director(() => clock.t)
  let reading = false
  let ambient = true
  director.addSuppressor(() => reading)
  director.setEnabledPredicate(() => ambient)
  const log: Array<{ name: GameEventName; payload: GameEvents[GameEventName]; t: number }> = []
  const pa = new PaScheduler({
    now: () => clock.t,
    emit: (name, payload) => log.push({ name, payload: payload as GameEvents[GameEventName], t: clock.t }),
    director,
    rng: createRng(opts.seed ?? 7),
    blocked: opts.blocked,
  })
  clock.onTick(() => pa.tick())
  const announcements = () => log.filter((l) => l.name === 'pa:announce').map((l) => ({ t: l.t, text: (l.payload as GameEvents['pa:announce']).text }))
  return {
    clock,
    director,
    pa,
    log,
    announcements,
    setReading: (v: boolean) => (reading = v),
    setAmbient: (v: boolean) => (ambient = v),
    run: (s: number) => clock.advance(s, 0.1),
  }
}

describe('PA announcer pacing', () => {
  it('has about 25 lines, all distinct, including the classics', () => {
    expect(PA_LINES.length).toBeGreaterThanOrEqual(24)
    expect(new Set(PA_LINES).size).toBe(PA_LINES.length)
    expect(PA_LINES).toContain('Lost and found: one (1) fin. Rocket owner please collect.')
    expect(PA_LINES).toContain('Reminder: the forklift is not a team-building exercise.')
  })

  it('first announcement after 50–80 s, then every 90–150 s, each with a PA caption', () => {
    const h = setup()
    h.run(1200)
    const a = h.announcements()
    expect(a.length).toBeGreaterThanOrEqual(7)
    expect(a[0].t).toBeGreaterThanOrEqual(PA.firstMin)
    expect(a[0].t).toBeLessThanOrEqual(PA.firstMax + 0.2)
    for (let i = 1; i < a.length; i++) {
      const gap = a[i].t - a[i - 1].t
      expect(gap).toBeGreaterThanOrEqual(PA.minGap - 0.2)
      expect(gap).toBeLessThanOrEqual(PA.maxGap + 0.2)
    }
    for (const x of a) {
      expect(h.log.some((l) => l.name === 'caption' && (l.payload as GameEvents['caption']).kind === 'pa' && (l.payload as GameEvents['caption']).text === x.text)).toBe(true)
    }
  })

  it('never announces while a panel/dialogue is open (director suppression); resumes soon after', () => {
    const h = setup()
    h.setReading(true)
    h.run(400)
    expect(h.announcements()).toEqual([])
    h.setReading(false)
    h.run(PA.retry + 0.5)
    expect(h.announcements().length).toBe(1)
  })

  it('stays silent with ambient events disabled', () => {
    const h = setup()
    h.setAmbient(false)
    h.run(600)
    expect(h.announcements()).toEqual([])
  })

  it('defers while blocked (launch sequence / night shift)', () => {
    let blocked = true
    const h = setup({ blocked: () => blocked })
    h.run(300)
    expect(h.announcements()).toEqual([])
    blocked = false
    h.run(PA.retry + 0.5)
    expect(h.announcements().length).toBe(1)
  })

  it('keeps quiet after someone else used the PA', () => {
    const h = setup()
    h.run(h.pa.nextAt - 1)
    expect(h.announcements()).toEqual([])
    h.pa.notePa()
    const t0 = h.clock.t
    h.run(PA.quietAfterOtherPa + PA.retry + 1)
    const a = h.announcements()
    expect(a.length).toBe(1)
    expect(a[0].t - t0).toBeGreaterThanOrEqual(PA.quietAfterOtherPa - 0.2)
  })

  it('cycles through every line before repeating, never twice in a row', () => {
    const h = setup({ seed: 3 })
    const said: string[] = []
    for (let i = 0; i < PA_LINES.length * 2 + 3; i++) said.push(h.pa.announce())
    expect(new Set(said.slice(0, PA_LINES.length)).size).toBe(PA_LINES.length)
    for (let i = 1; i < said.length; i++) expect(said[i]).not.toBe(said[i - 1])
  })

  it('a debug announce() pushes the next scheduled one back', () => {
    const h = setup()
    h.run(10)
    h.pa.announce()
    h.run(PA.minGap - 5)
    expect(h.announcements().length).toBe(1)
  })
})
