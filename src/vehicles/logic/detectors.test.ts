import { describe, expect, it } from 'vitest'
import { RECOVERY } from '../constants'
import { OverturnDetector, StuckDetector } from './detectors'

const DT = 1 / 60

function feed(d: OverturnDetector, up: number, seconds: number) {
  const out: string[] = []
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    const e = d.update(DT, up)
    if (e) out.push(e)
  }
  return out
}

describe('overturn detector', () => {
  it('declares overturned only after the tilt persists for 1.5 s', () => {
    const d = new OverturnDetector()
    expect(feed(d, 0.2, 1.4)).toEqual([])
    expect(d.overturned).toBe(false)
    expect(feed(d, 0.2, 0.2)).toEqual(['overturned'])
    expect(d.overturned).toBe(true)
  })

  it('a brief wobble (wheelie) does not count', () => {
    const d = new OverturnDetector()
    feed(d, 0.3, 1.0)
    feed(d, 0.95, 0.1)
    expect(feed(d, 0.3, 1.0)).toEqual([])
    expect(d.overturned).toBe(false)
  })

  it('upside down counts too', () => {
    const d = new OverturnDetector()
    expect(feed(d, -1, RECOVERY.overturnAfter + 0.05)).toEqual(['overturned'])
  })

  it('rights itself with hysteresis', () => {
    const d = new OverturnDetector()
    feed(d, 0, 2)
    // between thresholds: still overturned
    expect(feed(d, 0.6, 2)).toEqual([])
    expect(d.overturned).toBe(true)
    expect(feed(d, 0.98, RECOVERY.rightedAfter + 0.05)).toEqual(['righted'])
    expect(d.overturned).toBe(false)
  })

  it('treats NaN as tipped and reset clears state', () => {
    const d = new OverturnDetector()
    expect(feed(d, Number.NaN, 2)).toEqual(['overturned'])
    d.reset()
    expect(d.overturned).toBe(false)
    expect(d.tippedFor).toBe(0)
  })
})

describe('stuck detector', () => {
  function run(d: StuckDetector, held: boolean, speed: number, seconds: number) {
    const out: string[] = []
    for (let t = 0; t < seconds - 1e-9; t += DT) {
      const e = d.update(DT, held, speed)
      if (e) out.push(e)
    }
    return out
  }

  it('throttle held while not moving for 2 s → stuck', () => {
    const d = new StuckDetector()
    expect(run(d, true, 0.1, 1.9)).toEqual([])
    expect(run(d, true, 0.1, 0.15)).toEqual(['stuck'])
  })

  it('not stuck when moving or when no throttle', () => {
    const d = new StuckDetector()
    expect(run(d, true, 2, 5)).toEqual([])
    expect(run(d, false, 0, 5)).toEqual([])
    expect(d.stuck).toBe(false)
  })

  it('clears when moving again or after the driver lets go', () => {
    const d = new StuckDetector()
    run(d, true, 0, 2.1)
    expect(run(d, true, 2, 0.35)).toEqual(['free'])
    run(d, true, 0, 2.1)
    expect(d.stuck).toBe(true)
    expect(run(d, false, 0, 2.6)).toEqual(['free'])
  })
})
