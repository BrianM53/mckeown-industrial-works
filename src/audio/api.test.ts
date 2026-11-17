import { afterEach, describe, expect, it, vi } from 'vitest'
import { audio, clearAudioImpl, liveLoopCount, setAudioImpl, type AudioApi, type LoopHandle, type LoopOptions } from './api'

function fakeImpl() {
  const handles: { name: string; opts: LoopOptions; h: LoopHandle & { calls: string[] } }[] = []
  const impl: AudioApi = {
    play: vi.fn(),
    loop: vi.fn((name, opts) => {
      const calls: string[] = []
      const h = {
        calls,
        setVolume: (v: number) => calls.push(`vol:${v}`),
        setRate: (r: number) => calls.push(`rate:${r}`),
        setPosition: (x: number, y: number, z: number) => calls.push(`pos:${x},${y},${z}`),
        stop: () => calls.push('stop'),
      }
      handles.push({ name, opts: { ...opts }, h })
      return h
    }),
    duck: vi.fn(),
    isActive: () => true,
  }
  return { impl, handles }
}

afterEach(() => setAudioImpl(null))

describe('audio api (deferred loop handles)', () => {
  it('is a silent no-op before an engine is installed', () => {
    expect(() => audio.play('explosion')).not.toThrow()
    expect(() => audio.duck(0.5, 2)).not.toThrow()
    expect(audio.isActive()).toBe(false)
    const h = audio.loop('fan-hum', { position: [1, 2, 3] })
    expect(() => {
      h.setVolume(0.5)
      h.setRate(2)
      h.setPosition(4, 5, 6)
    }).not.toThrow()
    h.stop()
  })

  it('binds loop handles created before the engine started, with their latest state', () => {
    const before = liveLoopCount()
    const h = audio.loop('forklift-engine', { position: [0, 0, 0], volume: 1 })
    h.setVolume(0.4)
    h.setRate(2)
    h.setPosition(5, 0, -3)
    expect(liveLoopCount()).toBe(before + 1)
    const { impl, handles } = fakeImpl()
    setAudioImpl(impl)
    expect(handles).toHaveLength(1)
    expect(handles[0].name).toBe('forklift-engine')
    expect(handles[0].opts).toMatchObject({ volume: 0.4, rate: 2, position: [5, 0, -3] })
    h.setRate(1.5)
    expect(handles[0].h.calls).toContain('rate:1.5')
    h.stop()
    expect(handles[0].h.calls).toContain('stop')
    expect(liveLoopCount()).toBe(before)
  })

  it('never binds a handle that was stopped before the engine started', () => {
    const h = audio.loop('music')
    h.stop()
    const { impl, handles } = fakeImpl()
    setAudioImpl(impl)
    expect(handles).toHaveLength(0)
  })

  it('re-binds live handles when the engine is replaced (HMR / remount) and survives uninstall', () => {
    const a = fakeImpl()
    setAudioImpl(a.impl)
    const h = audio.loop('belt-clatter', { position: [1, 1, 1] })
    expect(a.handles).toHaveLength(1)
    setAudioImpl(null)
    expect(a.handles[0].h.calls).toContain('stop')
    h.setVolume(0.3)
    const b = fakeImpl()
    setAudioImpl(b.impl)
    expect(b.handles).toHaveLength(1)
    expect(b.handles[0].opts.volume).toBe(0.3)
    h.stop()
  })

  it('clearAudioImpl only removes the matching implementation', () => {
    const a = fakeImpl()
    const b = fakeImpl()
    setAudioImpl(a.impl)
    clearAudioImpl(b.impl)
    expect(audio.isActive()).toBe(true)
    clearAudioImpl(a.impl)
    expect(audio.isActive()).toBe(false)
  })

  it('ignores setPosition on non-positional loops and forwards play/duck', () => {
    const a = fakeImpl()
    setAudioImpl(a.impl)
    const h = audio.loop('ambience-factory')
    h.setPosition(1, 2, 3)
    expect(a.handles[0].h.calls).toEqual([])
    audio.play('whistle', { position: [1, 2, 3] })
    audio.duck(0.5, 3)
    expect(a.impl.play).toHaveBeenCalledWith('whistle', { position: [1, 2, 3] })
    expect(a.impl.duck).toHaveBeenCalledWith(0.5, 3)
    h.stop()
  })

  it('a throwing engine never breaks callers', () => {
    const bad: AudioApi = {
      play() {},
      loop() {
        throw new Error('boom')
      },
      duck() {},
      isActive: () => false,
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setAudioImpl(bad)
    const h = audio.loop('fan-hum')
    expect(() => h.setVolume(1)).not.toThrow()
    h.stop()
    warn.mockRestore()
  })
})
