import { describe, expect, it } from 'vitest'
import { BURST, STATION_MHZ, dialFraction, dialMhz, eqLevel, inBurst, onAirTarget, stepLight } from './onAir'

describe('broadcast booth ON AIR logic', () => {
  it('runs periodic live segments of the configured length', () => {
    let on = 0
    const step = 0.05
    for (let t = 0; t < BURST.period * 10; t += step) if (inBurst(t)) on += step
    // ~ length / period of the time, minus the partial first period
    expect(on / (BURST.period * 10)).toBeGreaterThan((BURST.length / BURST.period) * 0.85)
    expect(on / (BURST.period * 10)).toBeLessThan((BURST.length / BURST.period) * 1.05)
    expect(inBurst(BURST.offset + 0.1)).toBe(true)
    expect(inBurst(BURST.offset + BURST.length + 0.1)).toBe(false)
    expect(inBurst(-1)).toBe(false)
    expect(inBurst(NaN)).toBe(false)
  })

  it('is on while the Code Story panel is open or the jingle plays', () => {
    const quiet = BURST.offset + BURST.length + 5
    expect(inBurst(quiet)).toBe(false)
    expect(onAirTarget({ t: quiet, panelOpen: false, jingleUntil: -Infinity })).toBe(false)
    expect(onAirTarget({ t: quiet, panelOpen: true, jingleUntil: -Infinity })).toBe(true)
    expect(onAirTarget({ t: quiet, panelOpen: false, jingleUntil: quiet + 1 })).toBe(true)
    expect(onAirTarget({ t: quiet, panelOpen: false, jingleUntil: quiet - 1 })).toBe(false)
  })

  it('light fades toward the target and settles exactly (slower with reduced motion)', () => {
    let a = 0
    let b = 0
    for (let i = 0; i < 10; i++) {
      a = stepLight(a, true, 1 / 60, false)
      b = stepLight(b, true, 1 / 60, true)
    }
    expect(a).toBeGreaterThan(b)
    for (let i = 0; i < 400; i++) a = stepLight(a, true, 1 / 60, false)
    expect(a).toBe(1)
    for (let i = 0; i < 400; i++) a = stepLight(a, false, 1 / 60, false)
    expect(a).toBe(0)
    expect(stepLight(0.5, true, NaN, false)).toBeCloseTo(0.5)
  })

  it('equalizer levels stay in range and calm down at low energy', () => {
    let idle = 0
    let live = 0
    for (let t = 0; t < 20; t += 0.1)
      for (let i = 0; i < 16; i++) {
        const lo = eqLevel(i, 16, t, 0.35)
        const hi = eqLevel(i, 16, t, 1)
        expect(lo).toBeGreaterThanOrEqual(0)
        expect(hi).toBeLessThanOrEqual(1)
        idle += lo
        live += hi
      }
    expect(live).toBeGreaterThan(idle * 1.8)
  })

  it('tuning dial settles on the station when tuned', () => {
    expect(dialFraction(88)).toBe(0)
    expect(dialFraction(108)).toBe(1)
    expect(dialFraction(200)).toBe(1)
    expect(dialMhz(123.4, 1)).toBeCloseTo(STATION_MHZ)
    const free = dialMhz(3, 0)
    expect(free).toBeGreaterThanOrEqual(87.5)
    expect(free).toBeLessThanOrEqual(108.5)
  })
})
