import { createRng, type Rng } from '@/core/rng'
import type { LoopName, QualityTier, SfxName, Vec3 } from '@/core/types'
import { useSettings, type SettingsState } from '@/state/settings'
import { clearAudioImpl, setAudioImpl, type AudioApi, type LoopHandle, type LoopOptions, type PlayOptions } from './api'
import { spaceAt } from './emitters'
import {
  admitVoice,
  clampOpt,
  computeCull,
  crowdGain,
  crowdWeight,
  distance3,
  DuckController,
  edgeFade,
  envelopeWeight,
  inverseDistanceGain,
  OCC_NONE,
  occlusionFor,
  RateLimiter,
  SPATIAL,
  voiceLoudness,
  volumeToGain,
  type CullItem,
  type Occlusion,
  type VoiceSlot,
} from './logic'
import { createMixer, MIX, type Mixer } from './mixer'
import { DEBUG_ENABLED } from '@/core/debug'
import { clatterBuffer, impulse, noiseBuffer } from './synth/buffers'
import { idle, panningModelFor, type Synth } from './synth/core'
import { LOOP_LIBRARY, LOOP_META } from './synth/loops'
import { SFX_LIBRARY, SFX_META } from './synth/sfx'
import type { LoopEnv, LoopMeta, SfxMeta } from './synth/types'
import { buildLoop, buildOneShot, placePanner, type BuiltLoop } from './voice'

/**
 * AUDIO ENGINE — module-level singleton with refcounted start/stop.
 *
 * Consent & lifecycle: no AudioContext exists until settings.audioConsent is
 * true (set by the UI's Sound button — a user gesture; the store notifies us
 * synchronously inside that click, so the context is created and resumed
 * within the gesture). Muted / page hidden → master ramps to 0, then the
 * context suspends; unmuted / visible → resume and ramp up. Release (unmount)
 * keeps everything for a short grace period so StrictMode / HMR remounts reuse
 * the same context; a real unmount closes it.
 *
 * Every public entry point is exception-safe: audio problems never break the site.
 */
type SettingsStore = {
  getState(): SettingsState
  subscribe(listener: (state: SettingsState, prev: SettingsState) => void): () => void
}

export interface EngineDeps {
  /** Context factory (tests inject a fake). Return null when WebAudio is unavailable. */
  createContext?: () => AudioContext | null
  settings?: SettingsStore
  /** Monotonic seconds (rate limiting / ducking). */
  now?: () => number
  doc?: Document | null
  win?: Window | null
  seed?: number
  /** Grace period before a released engine shuts down (ms). */
  releaseDelayMs?: number
}

export type ContextStateName = 'none' | 'running' | 'suspended' | 'closed'

export interface AudioDebugState {
  contextState: ContextStateName
  consent: boolean
  muted: boolean
  hidden: boolean
  masterGain: number
  musicGain: number
  sfxGain: number
  ambienceGain: number
  duck: number
  /** Panel-focus attenuation of the world bus (0 = none). */
  focus: number
  activeVoices: number
  activeLoops: number
  culledLoops: number
  registeredLoops: number
  contextsCreated: number
  quality: QualityTier
  interior: string | null
  power: number
  listener: [number, number, number]
  lastPlayed: string[]
  dropped: { rateLimited: number; rejected: number; stolen: number; outOfRange: number }
}

export interface LoopDebugInfo {
  id: number
  name: LoopName
  positional: boolean
  position: [number, number, number] | null
  distance: number
  active: boolean
  volume: number
  space: string | null
}

interface Voice extends VoiceSlot {
  synth: Synth
  out: GainNode
  /** Context time when silent. */
  end: number
  dur: number
  /** Score before envelope weighting. */
  base: number
  /** Linear peak level at the listener (target peak × volume × distance × occlusion), for crowd normalization. */
  loud: number
  /** Wall-clock seconds when queued (drops voices queued on a context that never started). */
  queued: number
}

/**
 * Right after the visitor's click the context may still report 'suspended'
 * for a moment (Firefox / Safari start it asynchronously). Sounds requested in
 * that window are scheduled anyway and start as soon as it runs — so the
 * Sound button's own confirmation click is heard everywhere.
 */
const RESUME_GRACE_S = 0.6
/** Queued voices older than this (wall clock) when the context finally runs are dropped, never played late. */
const STALE_VOICE_S = 1

interface Emitter extends CullItem {
  loop: LoopName
  meta: LoopMeta
  x: number
  y: number
  z: number
  validPos: boolean
  volume: number
  rate: number
  ref: number
  rolloff: number
  space: string | null
  built: BuiltLoop | null
  occ: Occlusion
  appliedGain: number
  stopped: boolean
}

const NOOP_HANDLE: LoopHandle = { setVolume() {}, setRate() {}, setPosition() {}, stop() {} }

/** Realization priority: non-positional beds (music, ambience) first, then nearest first. */
const realizeKey = (e: Emitter) => (!e.positional ? -1 : Number.isFinite(e.distance) ? e.distance : Number.MAX_VALUE)
const byRealizeOrder = (a: Emitter, b: Emitter) => realizeKey(a) - realizeKey(b)

function defaultCreateContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const w = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  const Ctor = w.AudioContext ?? w.webkitAudioContext
  if (!Ctor) return null
  try {
    return new Ctor({ latencyHint: 'interactive' })
  } catch {
    return new Ctor()
  }
}

const finite3 = (p: readonly number[] | undefined): p is Vec3 =>
  !!p && p.length >= 3 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2])

export class AudioEngine {
  readonly api: AudioApi

  private readonly createContextFn: () => AudioContext | null
  private readonly settings: SettingsStore
  private readonly now: () => number
  private readonly doc: Document | null
  private readonly win: Window | null
  private readonly releaseDelayMs: number
  private readonly rng: Rng

  private refs = 0
  private started = false
  private stopTimer: ReturnType<typeof setTimeout> | null = null
  private suspendTimer: ReturnType<typeof setTimeout> | null = null
  private unsubs: (() => void)[] = []

  ctx: AudioContext | null = null
  private mixer: Mixer | null = null
  private contextsCreated = 0
  private createFailures = 0
  /** Buffers pre-generated and reverb attached: loops may be realized. */
  private warm = false
  private readonly perf = { frames: 0, total: 0, worst: 0, listener: 0, slow: 0, realize: 0, realized: 0, createMs: 0 }

  // settings mirror
  private consent = false
  private muted = false
  private hidden = false
  private masterVolume = 0.8
  private musicVolume = 0.45
  private sfxVolume = 0.8

  private voices: Voice[] = []
  private dying: { synth: Synth; at: number }[] = []
  private emitters: Emitter[] = []
  private nextId = 1
  private readonly limiter = new RateLimiter()
  private readonly ducks = new DuckController()
  private duckApplied = 0
  private crowdApplied = 1
  private focus = 0
  private readonly cullOrder: CullItem[] = []
  private readonly cullCounts = new Map<string, number>()
  private readonly cullOpts = {
    hysteresis: SPATIAL.hysteresis,
    stickiness: SPATIAL.stickiness,
    maxTotal: 12,
    perName: (n: string) => (LOOP_META as Record<string, LoopMeta | undefined>)[n]?.perName ?? 2,
    mergeRadius: 3,
  }

  private listener = { x: 0, y: 2.5, z: 37.5, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0, dirty: true }
  private listenerOverride: Vec3 | null = null
  private interior: string | null = null
  private power = 1
  private quality: QualityTier = 'medium'
  private slowAcc = 0
  /** Wall-clock time of the last resume() request while not running (0 = none pending). */
  private resumeAt = 0
  /** update() saw the context running last frame (detects suspended → running transitions). */
  private wasRunning = false
  private lastPlayed: string[] = []
  private dropped = { rateLimited: 0, rejected: 0, stolen: 0, outOfRange: 0 }
  private warned = new Set<string>()

  constructor(deps: EngineDeps = {}) {
    this.createContextFn = deps.createContext ?? defaultCreateContext
    this.settings = deps.settings ?? useSettings
    this.now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000)
    this.doc = deps.doc !== undefined ? deps.doc : typeof document !== 'undefined' ? document : null
    this.win = deps.win !== undefined ? deps.win : typeof window !== 'undefined' ? window : null
    this.releaseDelayMs = deps.releaseDelayMs ?? 400
    this.rng = createRng(deps.seed ?? ((Math.random() * 0xffffffff) >>> 0))
    this.api = {
      play: (name, opts) => this.guard('play', () => this.play(name, opts)),
      loop: (name, opts) => this.guard('loop', () => this.loop(name, opts)) ?? NOOP_HANDLE,
      duck: (amount, seconds) => this.guard('duck', () => this.duck(amount, seconds)),
      isActive: () => this.isActive(),
    }
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /** Refcounted start. Returns an idempotent release function. */
  acquire(): () => void {
    this.refs++
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer)
      this.stopTimer = null
    }
    if (!this.started) this.start()
    let released = false
    return () => {
      if (released) return
      released = true
      this.refs = Math.max(0, this.refs - 1)
      if (this.refs > 0 || this.stopTimer !== null) return
      this.stopTimer = setTimeout(() => {
        this.stopTimer = null
        if (this.refs === 0) this.stop()
      }, this.releaseDelayMs)
    }
  }

  get isStarted(): boolean {
    return this.started
  }

  private start(): void {
    this.started = true
    this.readSettings(this.settings.getState())
    this.unsubs.push(this.settings.subscribe((s) => this.guard('settings', () => this.onSettings(s))))
    const doc = this.doc
    if (doc) {
      const onVis = () => this.guard('visibility', () => this.onVisibility())
      doc.addEventListener('visibilitychange', onVis)
      this.unsubs.push(() => doc.removeEventListener('visibilitychange', onVis))
      this.hidden = doc.visibilityState === 'hidden'
    }
    const win = this.win
    if (win) {
      const onGesture = () => this.guard('gesture', () => this.onGesture())
      const evs = ['pointerdown', 'keydown', 'touchend'] as const
      for (const e of evs) win.addEventListener(e, onGesture, { capture: true, passive: true })
      this.unsubs.push(() => {
        for (const e of evs) win.removeEventListener(e, onGesture, { capture: true })
      })
    }
    setAudioImpl(this.api)
    if (this.consent) this.ensureContext()
  }

  /** Full shutdown: uninstall, unsubscribe, close the context. */
  stop(): void {
    if (!this.started) return
    this.started = false
    clearAudioImpl(this.api)
    for (const u of this.unsubs.splice(0)) {
      try {
        u()
      } catch {
        /* ignore */
      }
    }
    for (const e of [...this.emitters]) this.removeEmitter(e)
    this.closeContext()
    this.limiter.reset()
    this.ducks.clear()
    this.duckApplied = 0
    this.crowdApplied = 1
  }

  private closeContext(): void {
    if (this.suspendTimer !== null) {
      clearTimeout(this.suspendTimer)
      this.suspendTimer = null
    }
    for (const v of this.voices) v.synth.dispose()
    this.voices.length = 0
    for (const d of this.dying) d.synth.dispose()
    this.dying.length = 0
    for (const e of this.emitters) {
      if (e.built) {
        try {
          e.built.voice.stop(0)
        } catch {
          /* ignore */
        }
        e.built.synth.dispose()
        e.built = null
        e.active = false
      }
    }
    this.mixer?.dispose()
    this.mixer = null
    this.warm = false
    this.wasRunning = false
    this.resumeAt = 0
    const ctx = this.ctx
    this.ctx = null
    if (ctx && ctx.state !== 'closed') {
      try {
        ctx.close().catch(() => {})
      } catch {
        /* ignore */
      }
    }
  }

  // =========================================================================
  // Settings / consent / mute / visibility
  // =========================================================================

  private readSettings(s: SettingsState): void {
    this.consent = s.audioConsent === true
    this.muted = s.muted === true
    this.masterVolume = s.masterVolume
    this.musicVolume = s.musicVolume
    this.sfxVolume = s.sfxVolume
  }

  private onSettings(s: SettingsState): void {
    const prev = { consent: this.consent, muted: this.muted, master: this.masterVolume, music: this.musicVolume, sfx: this.sfxVolume }
    this.readSettings(s)
    if (!this.started) return
    if (this.consent && !this.ctx) this.ensureContext()
    if (prev.consent !== this.consent || prev.muted !== this.muted || prev.master !== this.masterVolume) this.applyMaster()
    if (prev.music !== this.musicVolume || prev.sfx !== this.sfxVolume) this.applyBuses(false)
  }

  private onVisibility(): void {
    const hidden = this.doc?.visibilityState === 'hidden'
    if (hidden === this.hidden) return
    this.hidden = hidden
    this.applyMaster()
  }

  private onGesture(): void {
    if (!this.started || !this.consent) return
    if (!this.ctx && this.createFailures < 3) this.ensureContext()
    const ctx = this.ctx
    if (ctx && this.masterTarget() > 0 && ctx.state !== 'running' && ctx.state !== 'closed') this.resume()
  }

  /** Create the context lazily, once (only with consent). */
  private ensureContext(): void {
    if (!this.started || !this.consent) return
    if (this.ctx && this.ctx.state !== 'closed') return
    let ctx: AudioContext | null = null
    const tCreate = DEBUG_ENABLED ? performance.now() : 0
    try {
      ctx = this.createContextFn()
    } catch (err) {
      this.warnOnce('create', err)
    }
    if (!ctx) {
      this.createFailures++
      return
    }
    this.ctx = ctx
    this.contextsCreated++
    try {
      this.mixer = createMixer(ctx, { reverb: this.quality !== 'low', master: 0, deferReverb: true })
      this.unlock(ctx)
    } catch (err) {
      this.warnOnce('mixer', err)
      this.closeContext()
      this.createFailures++
      return
    }
    this.duckApplied = 0
    this.crowdApplied = 1
    this.listener.dirty = true
    this.applyBuses(true)
    this.applyMaster()
    this.startWarmUp(ctx)
    if (DEBUG_ENABLED) this.perf.createMs = +(performance.now() - tCreate).toFixed(2)
  }

  /**
   * Everything expensive happens after the gesture, one task per idle slot:
   * noise buffers, clatter loop, impulse responses, reverb attachment. Loops
   * are realized once this finishes (the master is still fading in anyway).
   */
  private startWarmUp(ctx: AudioContext): void {
    this.warm = false
    const mx = this.mixer
    const lowQ = this.quality === 'low'
    const tasks: (() => unknown)[] = [
      () => noiseBuffer(ctx, 'pink'),
      () => noiseBuffer(ctx, 'brown'),
      () => noiseBuffer(ctx, 'white'),
      () => noiseBuffer(ctx, 'smooth'),
      () => noiseBuffer(ctx, 'crackle'),
      () => clatterBuffer(ctx),
      () => (lowQ ? null : impulse(ctx, 'yard')),
      () => mx?.attachReverb(),
      () => impulse(ctx, lowQ ? 'small' : 'hall'),
    ]
    const step = () => {
      if (this.ctx !== ctx || !this.started) return
      const task = tasks.shift()
      if (task) {
        this.guard('warmup', task)
        idle(step, 100)
        return
      }
      this.warm = true
      this.cullTick()
    }
    idle(step, 100)
  }

  /** iOS/Safari unlock: start a silent one-sample buffer inside the gesture. */
  private unlock(ctx: AudioContext): void {
    try {
      const b = ctx.createBuffer(1, 1, ctx.sampleRate)
      const src = ctx.createBufferSource()
      src.buffer = b
      src.connect(ctx.destination)
      src.start(0)
      src.onended = () => {
        try {
          src.disconnect()
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }

  private masterTarget(): number {
    return this.consent && !this.muted && !this.hidden ? volumeToGain(this.masterVolume) : 0
  }

  private applyMaster(): void {
    const ctx = this.ctx
    const mx = this.mixer
    if (!ctx || !mx || ctx.state === 'closed') return
    const target = this.masterTarget()
    const now = ctx.currentTime
    const g = mx.master.gain
    g.cancelScheduledValues(now)
    g.setTargetAtTime(target, now, target > 0 ? 0.12 : 0.03)
    if (target > 0) {
      if (this.suspendTimer !== null) {
        clearTimeout(this.suspendTimer)
        this.suspendTimer = null
      }
      this.resume()
    } else if (this.suspendTimer === null) {
      this.suspendTimer = setTimeout(() => {
        this.suspendTimer = null
        this.resumeAt = 0
        const c = this.ctx
        if (c && this.masterTarget() === 0 && c.state === 'running') {
          try {
            c.suspend().catch(() => {})
          } catch {
            /* ignore */
          }
        }
      }, 220)
    }
  }

  private resume(): void {
    const ctx = this.ctx
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return
    this.resumeAt = this.now()
    try {
      ctx.resume().catch(() => {})
    } catch {
      /* ignore */
    }
  }

  /**
   * May one-shots be scheduled right now? Running, or a resume was requested
   * moments ago (see RESUME_GRACE_S). Never while muted / hidden / without consent.
   */
  private canSchedule(ctx: AudioContext): boolean {
    if (!this.consent || this.muted || this.hidden) return false
    if (ctx.state === 'running') return true
    return ctx.state === 'suspended' && this.resumeAt > 0 && this.now() - this.resumeAt < RESUME_GRACE_S
  }

  private applyBuses(fast: boolean): void {
    const ctx = this.ctx
    const mx = this.mixer
    if (!ctx || !mx) return
    const now = ctx.currentTime
    const k = fast ? 0.02 : 0.08
    const sfx = volumeToGain(this.sfxVolume)
    mx.music.gain.setTargetAtTime(volumeToGain(this.musicVolume), now, k)
    mx.sfx.gain.setTargetAtTime(sfx, now, k)
    mx.ui.gain.setTargetAtTime(sfx, now, k)
    mx.ambience.gain.setTargetAtTime(sfx * MIX.ambienceRatio, now, k)
    mx.world.gain.setTargetAtTime(1 - this.focus, now, 0.25)
  }

  /**
   * Panel focus: while a portfolio panel is open the world (sfx, ambience,
   * music) is gently lowered so reading is never drowned out. UI sounds are not.
   */
  setFocus(amount: number): void {
    const a = Math.min(0.9, Math.max(0, Number.isFinite(amount) ? amount : 0))
    if (a === this.focus) return
    this.focus = a
    const ctx = this.ctx
    const mx = this.mixer
    if (ctx && mx) mx.world.gain.setTargetAtTime(1 - a, ctx.currentTime, a > 0 ? 0.2 : 0.5)
  }

  isActive(): boolean {
    const ctx = this.ctx
    return !!ctx && ctx.state === 'running' && this.consent && !this.muted && !this.hidden
  }

  /** Debug/test: grant consent (as the Sound button would) and wait briefly for the context to run. */
  async enableForTest(timeoutMs = 1500): Promise<AudioDebugState> {
    this.settings.getState().set({ audioConsent: true, muted: false })
    const ctx = this.ctx
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') {
      await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, timeoutMs))])
    }
    return this.getState()
  }

  // =========================================================================
  // One-shots
  // =========================================================================

  private maxVoices(): number {
    return this.quality === 'low' ? 16 : 24
  }

  play(name: SfxName, opts?: PlayOptions): void {
    const ctx = this.ctx
    const mx = this.mixer
    if (!ctx || !mx || !this.canSchedule(ctx)) return
    const meta = (SFX_META as Record<string, SfxMeta | undefined>)[name]
    if (!meta || !(name in SFX_LIBRARY)) return
    const volume = clampOpt(opts?.volume, 0, 4, 1)
    if (volume <= 0) return
    const rate = clampOpt(opts?.rate, 0.25, 4, 1)
    let pos: Vec3 | null = null
    if (opts?.position !== undefined) {
      if (!finite3(opts.position)) {
        this.warnOnce(`pos:${name}`, new Error(`non-finite position for '${name}'`))
        return
      }
      pos = [opts.position[0], opts.position[1], opts.position[2]]
    }
    const L = this.listenerPos()
    let dist = 0
    let distGain = 1
    let occ = OCC_NONE
    if (pos) {
      dist = distance3(pos[0], pos[1], pos[2], L[0], L[1], L[2])
      if (dist > meta.max) {
        this.dropped.outOfRange++
        return
      }
      distGain = inverseDistanceGain(dist, meta.ref, meta.rolloff)
      occ = occlusionFor(this.interior, spaceAt(pos[0], pos[2]))
    }
    const wall = this.now()
    if (!this.limiter.allow(name, wall, meta.minInterval, pos ? pos[0] : Number.NaN, pos ? pos[2] : Number.NaN)) {
      this.dropped.rateLimited++
      return
    }
    const t = ctx.currentTime
    this.reap(t)
    for (const v of this.voices) v.score = v.base * envelopeWeight(t - v.started, v.dur)
    // audibility at the listener: the normalized peak (not the raw synth gain) × volume × distance × walls
    const loud = voiceLoudness(meta.peakDb, volume, distGain, occ.gain)
    const score = loud * meta.priority
    // Interface feedback is never refused for being quiet: in a full pool it replaces the least audible voice.
    const admitScore = meta.ui ? Number.POSITIVE_INFINITY : score
    const adm = admitVoice(this.voices, this.maxVoices(), { name, score: admitScore, perNameCap: meta.maxVoices, policy: meta.onLimit })
    if (!adm.admit) {
      this.dropped.rejected++
      return
    }
    for (const id of adm.steal) this.killVoice(id)
    const start = t + 0.01
    const built = buildOneShot(
      ctx,
      mx,
      {
        name,
        volume,
        rate,
        position: pos,
        occlusion: occ,
        panningModel: panningModelFor(this.quality),
        wet: pos ? Math.min(1, 0.3 + dist / 40) : 1,
        rng: this.rng,
      },
      start,
    )
    if (!built) return
    this.voices.push({
      id: this.nextId++,
      name,
      started: t,
      score,
      base: score,
      loud,
      queued: wall,
      synth: built.synth,
      out: built.out,
      end: built.end,
      dur: built.end - start,
    })
    this.lastPlayed.push(name)
    if (this.lastPlayed.length > 16) this.lastPlayed.shift()
    this.updateCrowd()
  }

  /** The context just started running: drop voices queued long ago on a context that would not start. */
  private dropStaleVoices(): void {
    const wall = this.now()
    const now = this.ctx ? this.ctx.currentTime : 0
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i]
      // queued long ago but the context clock has not reached it: it was never heard
      if (wall - v.queued > STALE_VOICE_S && v.started >= now - 0.05) this.killVoice(v.id, false)
    }
  }

  private killVoice(id: number, stolen = true): void {
    let i = -1
    for (let k = 0; k < this.voices.length; k++) {
      if (this.voices[k].id === id) {
        i = k
        break
      }
    }
    if (i < 0) return
    const v = this.voices[i]
    this.voices.splice(i, 1)
    if (stolen) this.dropped.stolen++
    const ctx = this.ctx
    const now = ctx ? ctx.currentTime : 0
    try {
      v.out.gain.cancelScheduledValues(now)
      v.out.gain.setTargetAtTime(0, now, 0.012)
    } catch {
      /* ignore */
    }
    v.synth.stopAll(now + 0.08)
    this.dying.push({ synth: v.synth, at: now + 0.15 })
  }

  private reap(now: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      if (now >= this.voices[i].end + 0.05) {
        this.voices[i].synth.dispose()
        this.voices.splice(i, 1)
      }
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      if (now >= this.dying[i].at) {
        this.dying[i].synth.dispose()
        this.dying.splice(i, 1)
      }
    }
  }

  private updateCrowd(): void {
    const ctx = this.ctx
    const mx = this.mixer
    if (!ctx || !mx) return
    const t = ctx.currentTime
    let n = 0
    for (const v of this.voices) {
      // UI sounds bypass the one-shot bus; decaying voices weigh less
      if (SFX_META[v.name as SfxName]?.ui) continue
      n += crowdWeight(v.loud * envelopeWeight(t - v.started, v.dur))
    }
    const g = crowdGain(n)
    if (Math.abs(g - this.crowdApplied) < 0.02) return
    this.crowdApplied = g
    mx.shots.gain.setTargetAtTime(g, ctx.currentTime, 0.05)
  }

  // =========================================================================
  // Ducking
  // =========================================================================

  duck(amount: number, seconds: number): void {
    this.ducks.add(amount, seconds, this.now())
    this.applyDuck()
  }

  private applyDuck(): void {
    const a = this.ducks.amount(this.now())
    if (Math.abs(a - this.duckApplied) < 0.005) return
    const down = a > this.duckApplied
    this.duckApplied = a
    const ctx = this.ctx
    const mx = this.mixer
    if (!ctx || !mx) return
    const now = ctx.currentTime
    mx.musicDuck.gain.setTargetAtTime(1 - a, now, down ? 0.08 : 0.6)
    mx.ambienceDuck.gain.setTargetAtTime(1 - a * 0.6, now, down ? 0.1 : 0.6)
  }

  // =========================================================================
  // Loops / emitters
  // =========================================================================

  loop(name: LoopName, opts?: LoopOptions): LoopHandle {
    const meta = (LOOP_META as Record<string, LoopMeta | undefined>)[name]
    if (!meta || !(name in LOOP_LIBRARY)) return NOOP_HANDLE
    const positional = opts?.position !== undefined
    const valid = positional && finite3(opts!.position)
    const p = valid ? opts!.position! : ([0, 0, 0] as Vec3)
    const e: Emitter = {
      id: this.nextId++,
      name,
      loop: name,
      meta,
      positional,
      x: p[0],
      y: p[1],
      z: p[2],
      validPos: valid,
      volume: clampOpt(opts?.volume, 0, 4, 1),
      rate: clampOpt(opts?.rate, 0.1, 4, 1),
      ref: clampOpt(opts?.refDistance, 0.1, 500, meta.ref),
      rolloff: meta.rolloff,
      maxDistance: clampOpt(opts?.maxDistance, 1, 5000, meta.max),
      space: valid ? spaceAt(p[0], p[2]) : null,
      distance: Infinity,
      active: false,
      want: false,
      key: 0,
      built: null,
      occ: OCC_NONE,
      appliedGain: -1,
      stopped: false,
    }
    this.emitters.push(e)
    // realize on the next frame's cull tick (budgeted): a burst of loop() calls never spikes one frame
    this.slowAcc = Math.max(this.slowAcc, 0.1)
    // Handle methods may be called every frame (movers): inline try/catch, no per-call closures.
    return {
      setVolume: (v) => {
        try {
          const nv = clampOpt(v, 0, 4, e.volume)
          if (nv === e.volume || e.stopped) return
          e.volume = nv
          this.applyEmitterGain(e, false)
        } catch (err) {
          this.warnOnce('setVolume', err)
        }
      },
      setRate: (r) => {
        try {
          const nr = clampOpt(r, 0.1, 4, e.rate)
          if (Math.abs(nr - e.rate) < 1e-3 || e.stopped) return
          e.rate = nr
          const ctx = this.ctx
          if (e.built && ctx) e.built.voice.setRate(nr, ctx.currentTime)
        } catch (err) {
          this.warnOnce('setRate', err)
        }
      },
      setPosition: (x, y, z) => {
        try {
          this.moveEmitter(e, x, y, z)
        } catch (err) {
          this.warnOnce('setPosition', err)
        }
      },
      stop: () => {
        try {
          this.removeEmitter(e)
        } catch (err) {
          this.warnOnce('stop', err)
        }
      },
    }
  }

  private moveEmitter(e: Emitter, x: number, y: number, z: number): void {
    if (!e.positional || e.stopped || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return
    if (e.validPos && Math.abs(x - e.x) < 0.005 && Math.abs(y - e.y) < 0.005 && Math.abs(z - e.z) < 0.005) return
    e.x = x
    e.y = y
    e.z = z
    e.validPos = true
    e.space = spaceAt(x, z)
    const ctx = this.ctx
    const panner = e.built?.panner
    if (!panner || !ctx) return
    // glide while running; jump while suspended (no clock to glide on) so it is right on resume
    if (ctx.state === 'running') placePanner(panner, x, y, z, 0.03, ctx.currentTime)
    else placePanner(panner, x, y, z, 0, null)
  }

  private removeEmitter(e: Emitter): void {
    if (e.stopped) return
    e.stopped = true
    const i = this.emitters.indexOf(e)
    if (i >= 0) this.emitters.splice(i, 1)
    if (e.built) this.derealize(e)
  }

  private emitterTarget(e: Emitter): number {
    const power = 1 - e.meta.power * (1 - this.power)
    const fade = e.positional ? edgeFade(e.distance, e.maxDistance) : 1
    return e.volume * e.meta.level * fade * e.occ.gain * power
  }

  private applyEmitterGain(e: Emitter, force: boolean): void {
    const ctx = this.ctx
    const b = e.built
    if (!ctx || !b) return
    const target = this.emitterTarget(e)
    if (!force && Math.abs(target - e.appliedGain) < Math.max(0.002, e.appliedGain * 0.02)) return
    e.appliedGain = target
    b.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.15)
  }

  private realize(e: Emitter): void {
    const ctx = this.ctx
    const mx = this.mixer
    if (!ctx || !mx) return
    let built: BuiltLoop
    try {
      built = buildLoop(ctx, mx, {
        name: e.loop,
        rate: e.rate,
        quality: this.quality,
        position: e.positional ? [e.x, e.y, e.z] : null,
        ref: e.ref,
        rolloff: e.rolloff,
        maxDistance: e.maxDistance,
        panningModel: panningModelFor(this.quality),
        rng: this.rng,
      })
    } catch (err) {
      this.warnOnce(`loop:${e.loop}`, err)
      e.stopped = true
      const i = this.emitters.indexOf(e)
      if (i >= 0) this.emitters.splice(i, 1)
      return
    }
    e.built = built
    e.active = true
    e.occ = e.positional ? occlusionFor(this.interior, e.space) : OCC_NONE
    if (built.occ) built.occ.frequency.value = e.occ.cutoff
    const target = this.emitterTarget(e)
    e.appliedGain = target
    const now = ctx.currentTime
    built.gain.gain.setValueAtTime(0, now)
    built.gain.gain.setTargetAtTime(target, now, e.meta.fadeIn)
    built.voice.update?.({ interior: this.interior, power: this.power }, now)
  }

  private derealize(e: Emitter): void {
    const b = e.built
    e.built = null
    e.active = false
    if (!b) return
    const ctx = this.ctx
    const now = ctx ? ctx.currentTime : 0
    try {
      b.gain.gain.cancelScheduledValues(now)
      b.gain.gain.setTargetAtTime(0, now, 0.12)
      b.voice.stop(now + 0.7)
    } catch {
      /* ignore */
    }
    this.dying.push({ synth: b.synth, at: now + 0.8 })
  }

  private readonly env: LoopEnv = { interior: null, power: 1 }
  private readonly tickList: Emitter[] = []

  /** Distances, culling, realize/derealize, per-emitter gains and loop env updates (~10 Hz). */
  private cullTick(): void {
    const L = this.listenerPos()
    for (const e of this.emitters) {
      e.active = !!e.built
      e.distance = !e.positional ? 0 : e.validPos ? distance3(e.x, e.y, e.z, L[0], L[1], L[2]) : Infinity
      e.weight = e.volume * e.meta.level
    }
    this.cullOpts.maxTotal = this.quality === 'low' ? 8 : this.quality === 'high' ? 14 : 12
    computeCull(this.emitters, this.cullOpts, this.cullOrder, this.cullCounts)
    const ctx = this.ctx
    if (!ctx || !this.mixer || ctx.state !== 'running') return
    const now = ctx.currentTime
    this.env.interior = this.interior
    this.env.power = this.power
    let budget = 2
    const list = this.tickList
    list.length = 0
    for (const e of this.emitters) list.push(e)
    // realization is budgeted: beds first, then the nearest emitters (after a teleport the closest sound comes first)
    list.sort(byRealizeOrder)
    for (const e of list) {
      if (e.want && !e.built) {
        if (!this.warm || budget <= 0) continue
        budget--
        const tr = DEBUG_ENABLED ? performance.now() : 0
        this.realize(e)
        if (DEBUG_ENABLED) {
          this.perf.realize += performance.now() - tr
          this.perf.realized++
        }
      } else if (!e.want && e.built) this.derealize(e)
      const b = e.built
      if (!b) continue
      if (e.positional) {
        const occ = occlusionFor(this.interior, e.space)
        if (occ !== e.occ) {
          e.occ = occ
          b.occ?.frequency.setTargetAtTime(occ.cutoff, now, 0.25)
        }
      }
      this.applyEmitterGain(e, false)
      b.voice.update?.(this.env, now)
    }
  }

  // =========================================================================
  // Per-frame
  // =========================================================================

  /** Camera pose (world). Forward/up must be non-zero, non-parallel. */
  setListenerPose(px: number, py: number, pz: number, fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void {
    if (!Number.isFinite(px + py + pz + fx + fy + fz + ux + uy + uz)) return
    const L = this.listener
    const moved =
      Math.abs(px - L.x) > 1e-3 ||
      Math.abs(py - L.y) > 1e-3 ||
      Math.abs(pz - L.z) > 1e-3 ||
      Math.abs(fx - L.fx) > 1e-3 ||
      Math.abs(fy - L.fy) > 1e-3 ||
      Math.abs(fz - L.fz) > 1e-3 ||
      Math.abs(ux - L.ux) > 1e-3 ||
      Math.abs(uy - L.uy) > 1e-3 ||
      Math.abs(uz - L.uz) > 1e-3
    if (!moved) return
    L.x = px
    L.y = py
    L.z = pz
    L.fx = fx
    L.fy = fy
    L.fz = fz
    L.ux = ux
    L.uy = uy
    L.uz = uz
    L.dirty = true
  }

  /** Debug: pin the listener position (null = follow the camera). */
  setListenerOverride(p: Vec3 | null): void {
    this.listenerOverride = p && finite3(p) ? [p[0], p[1], p[2]] : null
    this.listener.dirty = true
    if (this.ctx) this.cullTick()
  }

  private readonly lpos: Vec3 = [0, 0, 0]

  /** Current listener position (override or camera). Returns a reused tuple — copy if you keep it. */
  private listenerPos(): Vec3 {
    const o = this.listenerOverride
    if (o) return o
    const p = this.lpos
    p[0] = this.listener.x
    p[1] = this.listener.y
    p[2] = this.listener.z
    return p
  }

  setInterior(zone: string | null): void {
    this.interior = zone
  }

  setPower(level: number): void {
    if (Number.isFinite(level)) this.power = Math.min(1, Math.max(0, level))
  }

  setQuality(q: QualityTier): void {
    if (q === this.quality) return
    this.quality = q
    const model = panningModelFor(q)
    for (const e of this.emitters) {
      if (e.built?.panner) {
        try {
          e.built.panner.panningModel = model
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** Called every frame by AudioScene. */
  update(dt: number): void {
    if (!this.started) return
    const ctx = this.ctx
    if (!ctx || !this.mixer) return
    if (ctx.state !== 'running') {
      this.wasRunning = false
      return
    }
    const t0 = DEBUG_ENABLED ? performance.now() : 0
    // (inline try/catch rather than guard(): no closure allocated per frame)
    try {
      if (!this.wasRunning) {
        this.wasRunning = true
        this.resumeAt = 0
        this.dropStaleVoices()
      }
      const tl = DEBUG_ENABLED ? performance.now() : 0
      this.applyListener(dt)
      if (DEBUG_ENABLED) this.perf.listener += performance.now() - tl
      this.slowAcc += Number.isFinite(dt) ? dt : 0
      if (this.slowAcc >= 0.1) {
        this.slowAcc = 0
        const ts = DEBUG_ENABLED ? performance.now() : 0
        this.reap(ctx.currentTime)
        this.cullTick()
        this.applyDuck()
        this.updateCrowd()
        if (DEBUG_ENABLED) this.perf.slow += performance.now() - ts
      }
    } catch (err) {
      this.warnOnce('update', err)
    }
    if (DEBUG_ENABLED) {
      const d = performance.now() - t0
      const p = this.perf
      p.frames++
      p.total += d
      if (d > p.worst) p.worst = d
    }
  }

  /** Debug: average / worst engine.update() cost since the last call (ms). */
  takePerf(): Record<string, number> {
    const p = this.perf
    const f = Math.max(1, p.frames)
    const r = {
      frames: p.frames,
      avgMs: +(p.total / f).toFixed(3),
      worstMs: +p.worst.toFixed(3),
      listenerAvgMs: +(p.listener / f).toFixed(3),
      slowAvgMs: +(p.slow / f).toFixed(3),
      realizeMsEach: +(p.realize / Math.max(1, p.realized)).toFixed(3),
      realized: p.realized,
      createMs: p.createMs,
    }
    p.frames = p.total = p.worst = p.listener = p.slow = p.realize = p.realized = 0
    return r
  }

  private applyListener(dt: number): void {
    const ctx = this.ctx
    const L = this.listener
    if (!ctx || !L.dirty) return
    L.dirty = false
    const P = this.listenerPos()
    const x = P[0]
    const y = P[1]
    const z = P[2]
    const ls = ctx.listener
    if (ls.positionX) {
      const end = ctx.currentTime + Math.min(0.1, Math.max(0.016, Number.isFinite(dt) ? dt : 0.016))
      ls.positionX.linearRampToValueAtTime(x, end)
      ls.positionY.linearRampToValueAtTime(y, end)
      ls.positionZ.linearRampToValueAtTime(z, end)
      ls.forwardX.linearRampToValueAtTime(L.fx, end)
      ls.forwardY.linearRampToValueAtTime(L.fy, end)
      ls.forwardZ.linearRampToValueAtTime(L.fz, end)
      ls.upX.linearRampToValueAtTime(L.ux, end)
      ls.upY.linearRampToValueAtTime(L.uy, end)
      ls.upZ.linearRampToValueAtTime(L.uz, end)
    } else {
      const old = ls as AudioListener & {
        setPosition(x: number, y: number, z: number): void
        setOrientation(x: number, y: number, z: number, ux: number, uy: number, uz: number): void
      }
      old.setPosition(x, y, z)
      old.setOrientation(L.fx, L.fy, L.fz, L.ux, L.uy, L.uz)
    }
  }

  // =========================================================================
  // Debug
  // =========================================================================

  getState(): AudioDebugState {
    const ctx = this.ctx
    const st = ctx ? ctx.state : 'none'
    const contextState: ContextStateName = st === 'running' || st === 'closed' || st === 'none' ? st : 'suspended'
    let active = 0
    for (const e of this.emitters) if (e.built) active++
    const L = [...this.listenerPos()]
    const r3 = (v: number) => Math.round(v * 1000) / 1000
    // live (not the last applied value): update() only re-applies ducks while the context runs
    const duck = this.ducks.amount(this.now())
    return {
      contextState,
      consent: this.consent,
      muted: this.muted,
      hidden: this.hidden,
      masterGain: r3(ctx && this.mixer ? this.masterTarget() : 0),
      musicGain: r3(volumeToGain(this.musicVolume) * (1 - duck)),
      sfxGain: r3(volumeToGain(this.sfxVolume)),
      ambienceGain: r3(volumeToGain(this.sfxVolume) * MIX.ambienceRatio * (1 - duck * 0.6)),
      duck: r3(duck),
      focus: r3(this.focus),
      activeVoices: this.voices.length,
      activeLoops: active,
      culledLoops: this.emitters.length - active,
      registeredLoops: this.emitters.length,
      contextsCreated: this.contextsCreated,
      quality: this.quality,
      interior: this.interior,
      power: r3(this.power),
      listener: [r3(L[0]), r3(L[1]), r3(L[2])],
      lastPlayed: [...this.lastPlayed],
      dropped: { ...this.dropped },
    }
  }

  getLoops(): LoopDebugInfo[] {
    return this.emitters.map((e) => ({
      id: e.id,
      name: e.loop,
      positional: e.positional,
      position: e.positional ? [e.x, e.y, e.z] : null,
      distance: Math.round(e.distance * 10) / 10,
      active: !!e.built,
      volume: e.volume,
      space: e.space,
    }))
  }

  /** Test hook: the live context's master gain node value target. */
  get mixerForTest(): Mixer | null {
    return this.mixer
  }

  private guard<T>(what: string, fn: () => T): T | undefined {
    try {
      return fn()
    } catch (err) {
      this.warnOnce(what, err)
      return undefined
    }
  }

  private warnOnce(key: string, err: unknown): void {
    if (this.warned.has(key)) return
    this.warned.add(key)
    console.warn(`[audio] ${key} failed (audio continues without it)`, err)
  }
}

/** The app-wide engine (AudioScene acquires / releases it). */
export const engine = new AudioEngine()
