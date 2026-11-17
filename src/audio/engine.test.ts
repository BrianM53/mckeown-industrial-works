import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import type { SfxName } from '@/core/types'
import type { SettingsState } from '@/state/settings'
import { audio, setAudioImpl } from './api'
import { AudioEngine } from './engine'
import { MIX } from './mixer'
import { SFX_NAMES } from './synth/sfx'
import { asCtx, FakeAudioContext, FakeBufferSource, type FakeParam, type FakeSource } from './testing/fakeAudio'

/** The engine's one-sample iOS unlock buffer ends by itself; everything else must be stopped explicitly. */
const isUnlock = (s: FakeSource) => s instanceof FakeBufferSource && s.buffer?.length === 1

function makeSettings(over: Partial<SettingsState> = {}) {
  const store = createStore<SettingsState>()((set) => ({
    masterVolume: 0.8,
    musicVolume: 0.45,
    sfxVolume: 0.8,
    muted: false,
    audioConsent: false,
    reducedMotion: false,
    reducedMotionSource: 'system',
    quality: 'auto',
    cameraSensitivity: 1,
    invertY: false,
    pointerLock: false,
    captions: true,
    ambientEvents: true,
    showFps: false,
    set: (patch) => set(patch),
    reset: () => {},
    ...over,
  }))
  let listeners = 0
  const counted = {
    getState: store.getState,
    subscribe: (fn: (s: SettingsState, p: SettingsState) => void) => {
      listeners++
      const off = store.subscribe(fn)
      return () => {
        listeners--
        off()
      }
    },
    listeners: () => listeners,
  }
  return counted
}

class FakeDoc extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible'
  listeners = 0
  override addEventListener(...a: Parameters<EventTarget['addEventListener']>) {
    this.listeners++
    super.addEventListener(...a)
  }
  override removeEventListener(...a: Parameters<EventTarget['removeEventListener']>) {
    this.listeners--
    super.removeEventListener(...a)
  }
  setHidden(hidden: boolean) {
    this.visibilityState = hidden ? 'hidden' : 'visible'
    this.dispatchEvent(new Event('visibilitychange'))
  }
}

function setup(opts: { consent?: boolean; create?: () => AudioContext | null } = {}) {
  const settings = makeSettings({ audioConsent: !!opts.consent })
  const clock = { t: 100 }
  const created: FakeAudioContext[] = []
  const createContext = vi.fn(
    opts.create ??
      (() => {
        const c = new FakeAudioContext()
        created.push(c)
        return asCtx(c)
      }),
  )
  const doc = new FakeDoc()
  const eng = new AudioEngine({
    createContext,
    settings,
    now: () => clock.t,
    doc: doc as unknown as Document,
    win: null,
    seed: 7,
    releaseDelayMs: 50,
  })
  const consent = () => settings.getState().set({ audioConsent: true })
  return { settings, clock, created, createContext, doc, eng, consent }
}

const param = (p: AudioParam) => p as unknown as FakeParam
/** Let the idle-time warm-up (noise buffers, reverb) finish. */
const warmUp = () => vi.advanceTimersByTime(3000)

let engines: AudioEngine[] = []
beforeEach(() => {
  vi.useFakeTimers()
  engines = []
})
afterEach(() => {
  for (const e of engines) e.stop()
  setAudioImpl(null)
  vi.useRealTimers()
})
function track<T extends { eng: AudioEngine }>(x: T): T {
  engines.push(x.eng)
  return x
}

describe('consent gating', () => {
  it('constructs nothing before consent and every call is a silent no-op', () => {
    const { eng, createContext } = track(setup())
    eng.acquire()
    eng.api.play('explosion')
    audio.play('whistle', { position: [1, 2, 3] })
    const h = eng.api.loop('furnace-roar', { position: [0, 1, 0] })
    h.setVolume(0.5)
    h.setRate(2)
    h.setPosition(1, 1, 1)
    eng.api.duck(0.5, 2)
    eng.update(0.016)
    vi.advanceTimersByTime(1000)
    expect(createContext).not.toHaveBeenCalled()
    expect(eng.isActive()).toBe(false)
    expect(eng.getState()).toMatchObject({ contextState: 'none', consent: false, activeVoices: 0, activeLoops: 0, registeredLoops: 1, masterGain: 0 })
    h.stop()
  })

  it('creates exactly one context on consent (inside the gesture) and resumes it', () => {
    const { eng, createContext, created, consent, settings } = track(setup())
    eng.acquire()
    expect(createContext).not.toHaveBeenCalled()
    consent()
    expect(createContext).toHaveBeenCalledTimes(1)
    expect(created[0].resumeCalls).toBeGreaterThan(0)
    expect(created[0].state).toBe('running')
    settings.getState().set({ masterVolume: 0.5 })
    settings.getState().set({ muted: true })
    settings.getState().set({ muted: false })
    settings.getState().set({ audioConsent: true })
    expect(createContext).toHaveBeenCalledTimes(1)
    expect(eng.getState().contextsCreated).toBe(1)
    expect(eng.isActive()).toBe(true)
  })

  it('a pre-existing consent creates the context when the engine starts', () => {
    const { eng, createContext } = track(setup({ consent: true }))
    expect(createContext).not.toHaveBeenCalled()
    eng.acquire()
    expect(createContext).toHaveBeenCalledTimes(1)
  })

  it('revoking consent silences everything', () => {
    const { eng, consent, settings, created } = track(setup())
    eng.acquire()
    consent()
    settings.getState().set({ audioConsent: false })
    expect(param(eng.mixerForTest!.master.gain).lastValue()).toBe(0)
    eng.api.play('explosion')
    expect(eng.getState().activeVoices).toBe(0)
    vi.advanceTimersByTime(300)
    expect(created[0].state).toBe('suspended')
  })
})

describe('lifecycle (StrictMode-safe)', () => {
  it('mount → unmount → mount reuses one context; a real unmount closes it', () => {
    const { eng, createContext, created, consent, settings, doc } = track(setup())
    const r1 = eng.acquire()
    consent()
    r1()
    const r2 = eng.acquire()
    vi.advanceTimersByTime(1000)
    expect(createContext).toHaveBeenCalledTimes(1)
    expect(created[0].state).toBe('running')
    expect(eng.isStarted).toBe(true)
    expect(audio.isActive()).toBe(true)
    r2()
    r2()
    vi.advanceTimersByTime(100)
    expect(eng.isStarted).toBe(false)
    expect(created[0].state).toBe('closed')
    expect(audio.isActive()).toBe(false)
    expect(settings.listeners()).toBe(0)
    expect(doc.listeners).toBe(0)
    const r3 = eng.acquire()
    expect(createContext).toHaveBeenCalledTimes(2)
    r3()
  })

  it('stopping disposes every voice and loop (no source left playing)', () => {
    const { eng, created, consent } = track(setup())
    const release = eng.acquire()
    consent()
    warmUp()
    eng.api.loop('music')
    eng.api.loop('furnace-roar', { position: [0, 2.5, 30] })
    eng.api.play('press-thump')
    expect(eng.getState().activeLoops).toBe(2)
    release()
    vi.advanceTimersByTime(100)
    const ctx = created[0]
    expect(ctx.state).toBe('closed')
    expect(ctx.sources.filter((s) => s.stopTime === null && !isUnlock(s))).toEqual([])
  })
})

describe('mute / visibility', () => {
  it('mute ramps master to 0, then suspends; unmute resumes and ramps up', () => {
    const { eng, created, consent, settings } = track(setup())
    eng.acquire()
    consent()
    const master = param(eng.mixerForTest!.master.gain)
    expect(master.lastValue()).toBeCloseTo(0.64)
    settings.getState().set({ muted: true })
    expect(master.lastValue()).toBe(0)
    expect(eng.isActive()).toBe(false)
    expect(created[0].state).toBe('running')
    vi.advanceTimersByTime(300)
    expect(created[0].state).toBe('suspended')
    expect(eng.getState().contextState).toBe('suspended')
    eng.api.play('explosion')
    expect(eng.getState().activeVoices).toBe(0)
    settings.getState().set({ muted: false })
    expect(created[0].state).toBe('running')
    expect(master.lastValue()).toBeCloseTo(0.64)
  })

  it('quick mute/unmute does not suspend', () => {
    const { eng, created, consent, settings } = track(setup())
    eng.acquire()
    consent()
    settings.getState().set({ muted: true })
    settings.getState().set({ muted: false })
    vi.advanceTimersByTime(500)
    expect(created[0].state).toBe('running')
  })

  it('hidden page suspends; visible page resumes when allowed', () => {
    const { eng, created, consent, doc, settings } = track(setup())
    eng.acquire()
    consent()
    doc.setHidden(true)
    expect(param(eng.mixerForTest!.master.gain).lastValue()).toBe(0)
    vi.advanceTimersByTime(300)
    expect(created[0].state).toBe('suspended')
    doc.setHidden(false)
    expect(created[0].state).toBe('running')
    settings.getState().set({ muted: true })
    vi.advanceTimersByTime(300)
    doc.setHidden(true)
    doc.setHidden(false)
    expect(created[0].state).toBe('suspended')
  })
})

describe('mixer volumes and ducking', () => {
  it('maps sliders to bus gains; ambience follows sfx at a lower level', () => {
    const { eng, consent, settings } = track(setup())
    eng.acquire()
    consent()
    settings.getState().set({ musicVolume: 0.5, sfxVolume: 0.25, masterVolume: 1 })
    const mx = eng.mixerForTest!
    expect(param(mx.music.gain).lastValue()).toBeCloseTo(0.25)
    expect(param(mx.sfx.gain).lastValue()).toBeCloseTo(0.0625)
    expect(param(mx.ambience.gain).lastValue()).toBeCloseTo(0.0625 * MIX.ambienceRatio)
    expect(param(mx.master.gain).lastValue()).toBeCloseTo(1)
    expect(eng.getState()).toMatchObject({ musicGain: 0.25, sfxGain: 0.063, masterGain: 1 })
  })

  it('duck lowers music + ambience smoothly and restores afterwards', () => {
    const { eng, consent, clock } = track(setup())
    eng.acquire()
    consent()
    const mx = eng.mixerForTest!
    eng.api.duck(0.5, 2)
    expect(param(mx.musicDuck.gain).lastValue()).toBeCloseTo(0.5)
    expect(param(mx.ambienceDuck.gain).lastValue()).toBeCloseTo(0.7)
    const ev = param(mx.musicDuck.gain).events.at(-1)!
    expect(ev.type).toBe('target')
    clock.t += 3
    eng.update(0.2)
    expect(param(mx.musicDuck.gain).lastValue()).toBe(1)
    expect(param(mx.ambienceDuck.gain).lastValue()).toBe(1)
  })
})

describe('panel focus', () => {
  it('lowers the world (not UI sounds) while a panel is open, and restores it', () => {
    const { eng, consent } = track(setup())
    eng.acquire()
    consent()
    const mx = eng.mixerForTest!
    eng.setFocus(0.35)
    expect(param(mx.world.gain).lastValue()).toBeCloseTo(0.65)
    expect(param(mx.ui.gain).lastValue()).toBeCloseTo(0.64)
    expect(eng.getState().focus).toBe(0.35)
    eng.setFocus(0)
    expect(param(mx.world.gain).lastValue()).toBe(1)
  })

  it('routes UI one-shots to the UI bus and world one-shots through the crowd bus', () => {
    const { eng, consent } = track(setup())
    eng.acquire()
    consent()
    const mx = eng.mixerForTest!
    const ui = mx.ui as unknown as { inputs: number }
    const shots = mx.shots as unknown as { inputs: number }
    const u0 = ui.inputs
    const s0 = shots.inputs
    eng.api.play('ui-open')
    expect(ui.inputs).toBe(u0 + 1)
    eng.api.play('crate-bump')
    expect(shots.inputs).toBe(s0 + 1)
  })
})

describe('voices', () => {
  it('caps simultaneous one-shots at 24 with stealing', () => {
    const { eng, consent, clock } = track(setup())
    eng.acquire()
    consent()
    for (let i = 0; i < 80; i++) {
      clock.t += 0.3
      eng.api.play(SFX_NAMES[i % SFX_NAMES.length])
      expect(eng.getState().activeVoices).toBeLessThanOrEqual(24)
    }
    const st = eng.getState()
    expect(st.activeVoices).toBe(24)
    expect(st.dropped.stolen + st.dropped.rejected).toBeGreaterThan(0)
  })

  it('low quality caps at 16 voices', () => {
    const { eng, consent, clock } = track(setup())
    eng.acquire()
    eng.setQuality('low')
    consent()
    for (let i = 0; i < 60; i++) {
      clock.t += 0.3
      eng.api.play(SFX_NAMES[i % SFX_NAMES.length])
    }
    expect(eng.getState().activeVoices).toBe(16)
  })

  it('rate-limits per name (footsteps ≥ 0.18 s apart)', () => {
    const { eng, consent, clock } = track(setup())
    eng.acquire()
    consent()
    eng.api.play('footstep')
    eng.api.play('footstep')
    clock.t += 0.1
    eng.api.play('footstep')
    expect(eng.getState().activeVoices).toBe(1)
    expect(eng.getState().dropped.rateLimited).toBe(2)
    clock.t += 0.1
    eng.api.play('footstep')
    expect(eng.getState().activeVoices).toBe(2)
  })

  it('reaps finished voices and disconnects their nodes', () => {
    const { eng, consent, created } = track(setup())
    eng.acquire()
    consent()
    eng.api.play('ui-click')
    expect(eng.getState().activeVoices).toBe(1)
    const before = created[0].allNodes.filter((n) => n.disconnected).length
    created[0].advance(2)
    eng.update(0.2)
    expect(eng.getState().activeVoices).toBe(0)
    expect(created[0].allNodes.filter((n) => n.disconnected).length).toBeGreaterThan(before)
  })

  it('skips positional one-shots beyond their max distance and ignores bad input', () => {
    const { eng, consent } = track(setup())
    eng.acquire()
    consent()
    eng.setListenerOverride([0, 0, 0])
    eng.api.play('footstep', { position: [200, 0, 0] })
    expect(eng.getState().dropped.outOfRange).toBe(1)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => eng.api.play('crate-bump', { position: [Number.NaN, 0, 0] })).not.toThrow()
    expect(() => eng.api.play('not-a-sound' as SfxName)).not.toThrow()
    expect(() => eng.api.play('boing', { volume: Number.NaN, rate: Number.POSITIVE_INFINITY })).not.toThrow()
    expect(eng.getState().activeVoices).toBe(1)
    warn.mockRestore()
  })
})

describe('loops and spatial culling', () => {
  it('positional loops realize near the listener and cull beyond max + hysteresis', () => {
    const { eng, consent, created } = track(setup())
    eng.acquire()
    consent()
    warmUp()
    eng.setListenerOverride([100, 1.6, 0])
    const h = eng.api.loop('furnace-roar', { position: [0, 1.6, 0], maxDistance: 40 })
    expect(eng.getLoops()[0].active).toBe(false)
    eng.setListenerOverride([10, 1.6, 0])
    expect(eng.getLoops()[0].active).toBe(true)
    const sources = created[0].sources.length
    eng.setListenerOverride([42, 1.6, 0])
    expect(eng.getLoops()[0].active).toBe(true)
    eng.setListenerOverride([50, 1.6, 0])
    expect(eng.getLoops()[0].active).toBe(false)
    const st = eng.getState()
    expect(st.culledLoops).toBe(1)
    expect(created[0].sources.slice(0, sources).filter((s) => !isUnlock(s) && s.stopTime === null)).toEqual([])
    h.stop()
    expect(eng.getState().registeredLoops).toBe(0)
  })

  it('limits overlapping emitters of the same name to the nearest few', () => {
    const { eng, consent } = track(setup())
    eng.acquire()
    consent()
    warmUp()
    eng.setListenerOverride([0, 1, 0])
    for (let i = 0; i < 6; i++) eng.api.loop('belt-clatter', { position: [i * 3, 1, 0] })
    const loops = eng.getLoops()
    expect(loops.filter((l) => l.active).length).toBe(3)
    expect(loops.filter((l) => l.active).map((l) => l.position![0])).toEqual([0, 3, 6])
  })

  it('non-positional loops (music, ambience) start with consent', () => {
    const { eng, consent, created } = track(setup())
    eng.acquire()
    eng.api.loop('music')
    eng.api.loop('ambience-factory')
    expect(eng.getState().activeLoops).toBe(0)
    consent()
    // the click itself only creates the context; buffers + loops follow in idle time
    expect(eng.getState().activeLoops).toBe(0)
    expect(created[0].allNodes.filter((n) => n.kind === 'oscillator' || n.kind === 'bufferSource').length).toBeLessThanOrEqual(1)
    warmUp()
    expect(eng.getState().activeLoops).toBe(2)
  })

  it('the listener follows the camera pose', () => {
    const { eng, consent, created } = track(setup())
    eng.acquire()
    consent()
    eng.setListenerPose(3, 2, 1, 0, 0, -1, 0, 1, 0)
    eng.update(0.016)
    const L = created[0].listener
    expect(L.positionX.lastValue()).toBe(3)
    expect(L.positionY.lastValue()).toBe(2)
    expect(L.forwardZ.lastValue()).toBe(-1)
    const n = L.positionX.events.length
    eng.update(0.016)
    expect(L.positionX.events.length).toBe(n)
    eng.setListenerPose(Number.NaN, 0, 0, 0, 0, -1, 0, 1, 0)
    eng.update(0.016)
    expect(L.positionX.lastValue()).toBe(3)
  })
})

describe('failure modes', () => {
  it('a missing / throwing AudioContext never breaks the site', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const a = track(setup({ create: () => null }))
    a.eng.acquire()
    expect(() => a.consent()).not.toThrow()
    a.eng.api.play('explosion')
    expect(a.eng.getState().contextState).toBe('none')
    const b = track(
      setup({
        create: () => {
          throw new Error('NotAllowedError')
        },
      }),
    )
    b.eng.acquire()
    expect(() => b.consent()).not.toThrow()
    expect(b.eng.getState().contextState).toBe('none')
    expect(() => b.eng.api.loop('music').stop()).not.toThrow()
    warn.mockRestore()
  })
})
