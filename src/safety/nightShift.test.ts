import { describe, expect, it } from 'vitest'
import { SimClock } from '@/core/clock'
import type { GameEventName, GameEvents } from '@/core/events'
import { createRng } from '@/core/rng'
import { Director } from '@/systems/director'
import { NIGHT } from './config'
import { NIGHT_DIRECTOR_ID, NightShiftFsm, type NightPhase } from './nightShift'

const STEP = 1 / 60

function setup(opts: { reduced?: boolean; director?: Director } = {}) {
  const clock = new SimClock()
  const director = opts.director ?? new Director(() => clock.t)
  const lighting = { level: 1, emergency: 0 }
  const log: Array<{ name: GameEventName; payload: GameEvents[GameEventName]; t: number }> = []
  const phases: Array<{ p: NightPhase; t: number }> = []
  const flags: boolean[] = []
  let real = 1000
  const fsm = new NightShiftFsm({
    now: () => clock.t,
    emit: (name, payload) => log.push({ name, payload: payload as GameEvents[GameEventName], t: clock.t }),
    director,
    lighting,
    setNightShift: (v) => flags.push(v),
    reducedMotion: () => !!opts.reduced,
    realNow: () => real,
    onPhase: (p) => phases.push({ p, t: clock.t }),
  })
  const off = clock.onTick((dt) => {
    real += dt
    fsm.tick()
  })
  const run = (seconds: number, each?: () => void) => {
    const n = Math.round(seconds / STEP)
    for (let i = 0; i < n; i++) {
      clock.advance(STEP, STEP)
      each?.()
    }
  }
  return {
    clock,
    director,
    lighting,
    log,
    phases,
    flags,
    fsm,
    run,
    off,
    addReal: (s: number) => (real += s),
    count: (name: GameEventName) => log.filter((l) => l.name === name).length,
  }
}

describe('Night Shift FSM', () => {
  it('runs idle → powerDown → blackout → restore → cooldown → idle, on schedule', () => {
    const h = setup()
    expect(h.fsm.start()).toBe(true)
    h.run(NIGHT.powerDown + NIGHT.blackout + NIGHT.restore + NIGHT.cooldown + 1)
    expect(h.phases.map((p) => p.p)).toEqual(['powerDown', 'blackout', 'restore', 'cooldown', 'idle'])
    const at = (p: NightPhase) => h.phases.find((x) => x.p === p)!.t
    expect(at('blackout')).toBeCloseTo(NIGHT.powerDown, 1)
    expect(at('restore')).toBeCloseTo(NIGHT.powerDown + NIGHT.blackout, 1)
    expect(at('cooldown')).toBeCloseTo(NIGHT.powerDown + NIGHT.blackout + NIGHT.restore, 1)
    expect(at('idle')).toBeCloseTo(NIGHT.powerDown + NIGHT.blackout + NIGHT.restore + NIGHT.cooldown, 1)
    expect(h.lighting).toEqual({ level: 1, emergency: 0 })
    expect(h.flags).toEqual([true, false])
    expect(h.count('nightshift:start')).toBe(1)
    expect(h.count('nightshift:end')).toBe(1)
    expect(h.log.some((l) => l.name === 'achievement' && (l.payload as GameEvents['achievement']).id === 'night-shift')).toBe(true)
    const pa = h.log.filter((l) => l.name === 'pa:announce').map((l) => (l.payload as GameEvents['pa:announce']).text)
    expect(pa).toEqual([NIGHT.paText, NIGHT.restorePa])
    expect(h.log.some((l) => l.name === 'caption' && (l.payload as GameEvents['caption']).text === NIGHT.startCaption)).toBe(true)
    expect(h.director.exclusiveActive()).toBeNull()
  })

  it('blackout is dark with full emergency lighting; the whole event lasts 10–20 s', () => {
    const h = setup()
    h.fsm.start()
    h.run(NIGHT.powerDown + 2)
    expect(h.fsm.phase).toBe('blackout')
    expect(h.lighting.level).toBeCloseTo(NIGHT.level, 5)
    expect(h.lighting.emergency).toBe(1)
    const total = NIGHT.powerDown + NIGHT.blackout + NIGHT.restore
    expect(total).toBeGreaterThanOrEqual(10)
    expect(total).toBeLessThanOrEqual(20)
  })

  it('enforces the cooldown', () => {
    const h = setup()
    expect(h.fsm.start()).toBe(true)
    expect(h.fsm.start()).toBe(false)
    expect(h.fsm.canStart()).toBe(false)
    h.run(NIGHT.powerDown + NIGHT.blackout + NIGHT.restore + 1)
    expect(h.fsm.phase).toBe('cooldown')
    expect(h.fsm.canStart()).toBe(false)
    expect(h.fsm.start()).toBe(false)
    const cd = h.fsm.cooldownRemaining()
    expect(cd).toBeGreaterThan(NIGHT.cooldown - 2)
    expect(cd).toBeLessThanOrEqual(NIGHT.cooldown)
    h.run(NIGHT.cooldown)
    expect(h.fsm.phase).toBe('idle')
    expect(h.fsm.cooldownRemaining()).toBe(0)
    expect(h.fsm.start()).toBe(true)
  })

  it('cooldownRemaining counts the running event too', () => {
    const h = setup()
    h.fsm.start()
    const full = h.fsm.cooldownRemaining()
    expect(full).toBeCloseTo(NIGHT.powerDown + NIGHT.blackout + NIGHT.restore + NIGHT.cooldown, 3)
    h.run(5)
    expect(h.fsm.cooldownRemaining()).toBeCloseTo(full - 5, 1)
  })

  it('restores normal lighting when disposed mid-blackout', () => {
    const h = setup()
    h.fsm.start()
    h.run(6)
    expect(h.fsm.phase).toBe('blackout')
    expect(h.lighting.level).toBeLessThan(0.5)
    h.fsm.dispose()
    expect(h.lighting).toEqual({ level: 1, emergency: 0 })
    expect(h.flags[h.flags.length - 1]).toBe(false)
    expect(h.count('nightshift:end')).toBe(1)
    expect(h.director.exclusiveActive()).toBeNull()
    // later ticks never darken anything again
    h.run(5)
    expect(h.lighting).toEqual({ level: 1, emergency: 0 })
    // and it can be revived (StrictMode remount)
    h.fsm.revive()
    expect(h.fsm.canStart()).toBe(true)
  })

  it('always ends at level 1 / emergency 0 (random frame lengths, random disposal)', () => {
    const rng = createRng(42)
    for (let trial = 0; trial < 40; trial++) {
      const h = setup({ reduced: trial % 3 === 0 })
      h.fsm.start()
      const disposeAt = rng() < 0.5 ? rng() * 30 : Infinity
      let t = 0
      while (t < 70) {
        const dt = 0.002 + rng() * 0.1
        h.clock.advance(dt, dt)
        t += dt
        expect(h.lighting.level).toBeGreaterThanOrEqual(0)
        expect(h.lighting.level).toBeLessThanOrEqual(1)
        expect(Number.isFinite(h.lighting.emergency)).toBe(true)
        if (t >= disposeAt) {
          h.fsm.dispose()
          break
        }
      }
      if (disposeAt === Infinity) h.run(1)
      expect(h.lighting).toEqual({ level: 1, emergency: 0 })
      expect(h.fsm.isActive()).toBe(false)
      expect(h.flags[h.flags.length - 1]).toBe(false)
    }
  })

  it('watchdog: a stalled clock cannot strand the visitor in the dark', () => {
    const h = setup()
    h.fsm.start()
    h.run(5)
    h.off() // the sim clock stops ticking the FSM (paused tab, broken frame loop...)
    expect(h.lighting.level).toBeLessThan(0.5)
    expect(h.fsm.watchdog()).toBe(false)
    h.addReal(NIGHT.watchdogMaxActive + 1)
    expect(h.fsm.watchdog()).toBe(true)
    expect(h.lighting).toEqual({ level: 1, emergency: 0 })
    expect(h.fsm.phase).toBe('cooldown')
    expect(h.count('nightshift:end')).toBe(1)
    expect(h.director.exclusiveActive()).toBeNull()
  })

  it('watchdog: fixes stray or NaN lighting outside an event', () => {
    const h = setup()
    h.lighting.level = 0.3
    h.lighting.emergency = 0.7
    expect(h.fsm.watchdog()).toBe(true)
    expect(h.lighting).toEqual({ level: 1, emergency: 0 })
    h.lighting.level = NaN
    expect(h.fsm.watchdog()).toBe(true)
    expect(h.lighting).toEqual({ level: 1, emergency: 0 })
    expect(h.fsm.watchdog()).toBe(false)
  })

  it('reduced motion: gentle 3 s fades without any flicker', () => {
    const h = setup({ reduced: true })
    h.fsm.start()
    const down: number[] = []
    h.run(NIGHT.gentleFade + 0.05, () => down.push(h.lighting.level))
    for (let i = 1; i < down.length; i++) expect(down[i]).toBeLessThanOrEqual(down[i - 1] + 1e-9)
    expect(h.fsm.phase).toBe('blackout')
    h.run(NIGHT.blackout - 0.1)
    const up: number[] = []
    h.run(NIGHT.gentleFade + 0.2, () => up.push(h.lighting.level))
    for (let i = 1; i < up.length; i++) expect(up[i]).toBeGreaterThanOrEqual(up[i - 1] - 1e-9)
    expect(h.lighting).toEqual({ level: 1, emergency: 0 })
    expect(h.phases.map((p) => p.p)).toEqual(['powerDown', 'blackout', 'restore', 'cooldown'])
  })

  it('normal motion flickers, but never more than 3 flashes in any second', () => {
    const h = setup()
    h.fsm.start()
    const samples: Array<{ t: number; v: number }> = []
    h.run(NIGHT.powerDown + NIGHT.blackout + NIGHT.restore + 0.5, () => samples.push({ t: h.clock.t, v: h.lighting.level }))
    // count large reversals (a flash = a pair of opposing changes)
    const reversals: number[] = []
    let dir = 0
    let anchor = samples[0].v
    for (const s of samples) {
      const d = s.v - anchor
      if (Math.abs(d) < 0.1) continue
      const nd = Math.sign(d)
      if (dir !== 0 && nd !== dir) reversals.push(s.t)
      dir = nd
      anchor = s.v
    }
    expect(reversals.length).toBeGreaterThan(0) // the lights do stutter
    for (const t of reversals) {
      const inWindow = reversals.filter((r) => r >= t && r < t + 1).length
      expect(inWindow / 2).toBeLessThanOrEqual(3)
    }
  })

  it('does not start when the director refuses (another exclusive event is running)', () => {
    const clock = new SimClock()
    const director = new Director(() => clock.t)
    expect(director.request({ id: 'osha', kind: 'player', cooldown: 20, duration: 5 })).toBe(true)
    const h = setup({ director })
    expect(h.fsm.start()).toBe(false)
    expect(h.fsm.phase).toBe('idle')
    expect(h.lighting).toEqual({ level: 1, emergency: 0 })
    expect(h.count('nightshift:start')).toBe(0)
    director.end('osha')
    expect(h.fsm.start()).toBe(true)
    expect(director.isActive(NIGHT_DIRECTOR_ID)).toBe(true)
  })

  it('forceRestore() (debug) ends the blackout early with a normal cooldown', () => {
    const h = setup()
    h.fsm.start()
    h.run(4)
    h.fsm.forceRestore()
    expect(h.lighting).toEqual({ level: 1, emergency: 0 })
    expect(h.fsm.phase).toBe('cooldown')
    h.run(1)
    expect(h.count('nightshift:end')).toBe(1)
    expect(h.flags[h.flags.length - 1]).toBe(false)
  })
})
