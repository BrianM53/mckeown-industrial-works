import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { events } from '@/core/events'
import { PAD_POSITION } from './emitters'
import { resetAchievementChimes, wireAudioEvents } from './wiring'

function setup() {
  const play = vi.fn()
  const duck = vi.fn()
  const flight = { start: vi.fn(), end: vi.fn(), position: vi.fn(() => [16, 20, -34] as [number, number, number]) }
  const off = wireAudioEvents({ play, duck, flight })
  const names = () => play.mock.calls.map((c) => c[0])
  return { play, duck, flight, off, names }
}

beforeEach(() => resetAchievementChimes())
afterEach(() => vi.restoreAllMocks())

describe('event → sound wiring', () => {
  it('maps every game event to its sound (and nothing emits captions)', () => {
    const { play, duck, flight, off, names } = setup()
    const captions = vi.fn()
    const offCap = events.on('caption', captions)
    const p: [number, number, number] = [1, 0, 2]
    events.emit('sfx', { name: 'boing', position: p, volume: 0.5, rate: 1.2 })
    expect(play).toHaveBeenLastCalledWith('boing', { position: p, volume: 0.5, rate: 1.2 })
    events.emit('rocket:countdown', { rocketId: 1, secondsLeft: 9 })
    expect(play).toHaveBeenLastCalledWith('countdown-beep', { rate: 1, volume: 0.85 })
    events.emit('rocket:countdown', { rocketId: 1, secondsLeft: 2 })
    expect(play.mock.lastCall![1].rate).toBeGreaterThan(1)
    events.emit('rocket:ignition', { rocketId: 1 })
    expect(play).toHaveBeenLastCalledWith('ignition', { position: PAD_POSITION })
    events.emit('rocket:liftoff', { rocketId: 1 })
    expect(names()).toContain('liftoff-roar')
    expect(flight.start).toHaveBeenCalledTimes(1)
    expect(duck).toHaveBeenCalledWith(0.55, 9)
    events.emit('rocket:outcome', { rocketId: 1, outcome: 'explosion', stowaway: false })
    expect(play).toHaveBeenLastCalledWith('explosion', { position: [16, 20, -34] })
    expect(flight.end).toHaveBeenLastCalledWith(true)
    events.emit('rocket:outcome', { rocketId: 2, outcome: 'breakup', stowaway: false })
    expect(play).toHaveBeenLastCalledWith('breakup-clank', { position: [16, 20, -34] })
    play.mockClear()
    events.emit('rocket:outcome', { rocketId: 3, outcome: 'success', stowaway: false })
    expect(play).not.toHaveBeenCalled()
    events.emit('rocket:reset', { rocketId: 3 })
    expect(flight.end).toHaveBeenLastCalledWith(false)
    events.emit('osha:whistle', { position: p, zoneId: 'blast-zone' })
    expect(play).toHaveBeenLastCalledWith('whistle', { position: p })
    events.emit('osha:tackle', { zoneId: 'blast-zone' })
    expect(play).toHaveBeenLastCalledWith('tackle-thud')
    expect(duck).toHaveBeenLastCalledWith(0.6, 3)
    events.emit('nightshift:start', {})
    expect(names().slice(-2)).toEqual(['power-down', 'alarm'])
    events.emit('nightshift:end', {})
    expect(play).toHaveBeenLastCalledWith('power-up')
    events.emit('forklift:horn', { position: p })
    expect(play).toHaveBeenLastCalledWith('forklift-horn', { position: p })
    events.emit('forklift:impact', { position: p, strength: 1 })
    expect(play).toHaveBeenLastCalledWith('forklift-impact', { position: p, volume: 1 })
    events.emit('forklift:impact', { position: p, strength: 0.1 })
    expect(play.mock.lastCall![1].volume).toBeLessThan(0.5)
    events.emit('pa:announce', { text: 'hello' })
    expect(play).toHaveBeenLastCalledWith('pa-chime')
    events.emit('panel:open', { id: 'resume' })
    expect(play.mock.lastCall![0]).toBe('ui-open')
    events.emit('panel:close', { id: 'resume' })
    expect(play.mock.lastCall![0]).toBe('ui-close')
    events.emit('player:footstep', { position: p, run: false, surface: 'concrete' })
    expect(play.mock.lastCall![0]).toBe('footstep')
    events.emit('player:footstep', { position: p, run: true, surface: 'metal' })
    expect(play.mock.lastCall![0]).toBe('footstep-metal')
    events.emit('player:footstep', { position: p, run: false, surface: 'dirt' })
    expect(play.mock.lastCall![1].rate).toBeLessThan(1)
    expect(captions).not.toHaveBeenCalled()
    off()
    offCap()
  })

  it('chimes each real achievement once and ignores unknown ids', () => {
    const { names, off } = setup()
    events.emit('achievement', { id: 'goal' })
    events.emit('achievement', { id: 'goal' })
    events.emit('achievement', { id: 'not-a-real-achievement' })
    expect(names().filter((n) => n === 'achievement')).toHaveLength(1)
    off()
  })

  it('removes every subscription on cleanup (mount/unmount cycles never leak handlers)', () => {
    const before = events.count()
    for (let i = 0; i < 5; i++) {
      const { off } = setup()
      expect(events.count()).toBeGreaterThan(before)
      off()
    }
    expect(events.count()).toBe(before)
  })
})
