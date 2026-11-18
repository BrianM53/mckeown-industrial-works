import { describe, expect, it } from 'vitest'
import { FactorySimulation } from '@/systems/factory'
import { EventLog, Series, Telemetry, assemblyProgress, describeEvent, elapsed, plantClock, sinceDisassembly } from './telemetry'

describe('control-room telemetry', () => {
  it('formats the plant clock and elapsed timers', () => {
    expect(plantClock(0)).toBe('06:00:00')
    expect(plantClock(3661)).toBe('07:01:01')
    expect(plantClock(-5)).toBe('06:00:00')
    expect(plantClock(NaN)).toBe('06:00:00')
    expect(plantClock(18 * 3600)).toBe('00:00:00')
    expect(elapsed(14 * 60)).toBe('14:00')
    expect(elapsed(3725)).toBe('1:02:05')
    expect(elapsed(-1)).toBe('00:00')
  })

  it('event log is bounded, ordered and de-duplicates bursts', () => {
    const log = new EventLog(3)
    log.push(1, 'A')
    log.push(1.1, 'A')
    log.push(2, 'B')
    log.push(3, 'C')
    log.push(4, 'D', 'bad')
    expect(log.entries.map((e) => e.text)).toEqual(['B', 'C', 'D'])
    expect(log.entries[2].level).toBe('bad')
    const v = log.version
    log.push(9, 'E')
    expect(log.version).toBe(v + 1)
  })

  it('describes rocket events (and skips noisy ones)', () => {
    expect(describeEvent('rocket:stage', { rocketId: 4, stage: 2, stageName: 'fins' })?.text).toBe('R-4 STAGE 3/6 FINS OK')
    expect(describeEvent('rocket:countdown', { rocketId: 4, secondsLeft: 9 })).toBeNull()
    expect(describeEvent('rocket:countdown', { rocketId: 4, secondsLeft: 10 })?.level).toBe('warn')
    expect(describeEvent('rocket:outcome', { rocketId: 4, outcome: 'explosion' })?.level).toBe('bad')
    expect(describeEvent('rocket:outcome', { rocketId: 4, outcome: 'wobble' })?.level).toBe('good')
    expect(describeEvent('rocket:reset', { rocketId: 4 })?.text).toContain('R-5')
    expect(describeEvent('unknown', {})).toBeNull()
  })

  it('series keeps the newest samples in order', () => {
    const s = new Series(3)
    s.push(1)
    s.push(2)
    expect([s.at(0), s.at(1)]).toEqual([1, 2])
    s.push(3)
    s.push(4)
    expect([s.at(0), s.at(1), s.at(2)]).toEqual([2, 3, 4])
    expect(s.max()).toBe(4)
    s.push(NaN)
    expect(s.at(2)).toBe(0)
  })

  it('samples a real simulation and tracks derived values', () => {
    const sim = new FactorySimulation()
    const tel = new Telemetry()
    const s = sim.state
    expect(tel.tick(0.016, s)).toBe(true) // first sample immediately
    expect(tel.tick(0.5, s)).toBe(false)
    expect(tel.tick(0.6, s)).toBe(true)
    expect(tel.throughput.count).toBe(2)
    expect(tel.throughput.at(1)).toBeGreaterThan(0)
    const p = assemblyProgress(s)
    expect(p).toBeGreaterThanOrEqual(0)
    expect(p).toBeLessThanOrEqual(1)
    // the counter sign starts with a believable non-zero gap ("fourteen minutes")
    expect(sinceDisassembly(s)).toBeGreaterThan(60)
  })

  it('counts QC catches on rising edges only', () => {
    const sim = new FactorySimulation()
    const tel = new Telemetry()
    const s = sim.state
    s.lines.payload.defectFlash = 0
    tel.tick(0.1, s)
    s.lines.payload.defectFlash = 0.9
    tel.tick(0.1, s)
    tel.tick(0.1, s)
    s.lines.payload.defectFlash = 0
    tel.tick(0.1, s)
    s.lines.payload.defectFlash = 0.5
    tel.tick(0.1, s)
    expect(tel.qcCaught).toBe(2)
  })
})
