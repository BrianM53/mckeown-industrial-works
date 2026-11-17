/**
 * The factory simulation (implements the FactorySim contract in types.ts).
 *
 * Pure TypeScript, ticked by a SimClock. Deterministic given (seed, params,
 * the clock's tick sequence). Production lines feed the tower; the tower crew
 * builds the six stages in order; a finished rocket rolls out, counts down,
 * launches and records a seeded outcome; then the next rocket starts.
 *
 * Mutation rules for readers (3D modules read `state` every frame):
 *  - `state.lines[id]` and `state.rocket` are stable objects mutated in place;
 *    `items` arrays are mutated in place too (index 0 = nearest the tower).
 *  - `state.params`, `state.model`, `state.counters` and `state.history` are
 *    replaced with new objects when they change (so React selectors can
 *    compare them by identity).
 */
import { simClock as globalClock, type SimClock } from '@/core/clock'
import { registerDebug } from '@/core/debug'
import { events, type GameEventName, type GameEvents } from '@/core/events'
import { clamp } from '@/core/math'
import type { LaunchOutcome, LineId } from '@/core/types'
import {
  DEFAULT_PARAMS,
  DEFAULT_SEED,
  HISTORY_LIMIT,
  INITIAL_COUNTERS,
  LINE_IDS,
  OUTCOME_REVEAL_AT,
  PHASE_ORDER,
  PHASE_SECONDS,
  STAGE_CREW_SECONDS,
  STAGE_RECIPES,
  WORLD,
} from './config'
import { catchRate, evaluate, normalizeParams, paramsEqual, rawDefectRate } from './model'
import { announcerLine, COUNTDOWN_CAPTION, isSuccessfulOutcome, rocketSeed, rollOutcome, rollStowaway, stowawayLine } from './outcomes'
import { lineTargets, ProductionLine, worldCycleSeconds, type LineStateWithBelt } from './production'
import {
  ROCKET_STAGES,
  type FactorySim,
  type FactoryState,
  type LaunchRecord,
  type OptimizationParams,
  type RocketPhase,
  type RocketState,
} from './types'

export type FactoryEmit = <K extends GameEventName>(name: K, payload: GameEvents[K]) => void

export interface FactorySimOptions {
  /** Clock to tick from (default: the app-wide simClock). */
  clock?: SimClock
  /** Event sink (default: the global events bus). */
  emit?: FactoryEmit
  /** Base seed (default: config DEFAULT_SEED). */
  seed?: number
  /** Seconds of line production simulated before the visit starts (default WORLD.preloadSeconds). */
  preloadSeconds?: number
  /** Seconds of assembly already done on rocket #1 (default WORLD.headStartSeconds). */
  headStartSeconds?: number
  /** Debug namespace registered on start() (default 'factory'; null = none). */
  debugNamespace?: string | null
}

/** Largest internal sub-step; bigger clock deltas (high time scales) are subdivided. */
const MAX_STEP = 0.1
/** Fixed step used for tests/debug fast-forwards. */
const FIXED_STEP = 1 / 30
/** Coarser fixed step for the construction-time warm-up (keeps module import cheap). */
const WARMUP_STEP = 0.1

const STAGE_COUNT = ROCKET_STAGES.length

/** needs[k][line] and the cumulative needs of all stages before k. */
const STAGE_NEEDS: Array<Record<LineId, number>> = ROCKET_STAGES.map((stage) => {
  const r = STAGE_RECIPES[stage]
  const out = {} as Record<LineId, number>
  for (const id of LINE_IDS) out[id] = r[id] ?? 0
  return out
})
const STAGE_NEEDS_BEFORE: Array<Record<LineId, number>> = ROCKET_STAGES.map((_, k) => {
  const out = {} as Record<LineId, number>
  for (const id of LINE_IDS) {
    let sum = 0
    for (let j = 0; j < k; j++) sum += STAGE_NEEDS[j][id]
    out[id] = sum
  }
  return out
})
const STAGE_TOTALS: number[] = STAGE_NEEDS.map((n) => LINE_IDS.reduce((s, id) => s + n[id], 0))

function easeInOut(x: number): number {
  const t = clamp(x, 0, 1)
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function phaseSeconds(phase: RocketPhase): number {
  return phase === 'assembling' ? Infinity : PHASE_SECONDS[phase]
}

function freshRocket(id: number, seed: number): RocketState {
  return {
    id,
    seed,
    phase: 'assembling',
    phaseTime: 0,
    phaseDuration: Infinity,
    stagesComplete: 0,
    stageProgress: 0,
    countdown: null,
    transport: 0,
    outcome: null,
    stowaway: false,
  }
}

function initialCounters(t: number): FactoryState['counters'] {
  return {
    successes: INITIAL_COUNTERS.successes,
    disassemblies: INITIAL_COUNTERS.disassemblies,
    lastDisassemblyT: t - INITIAL_COUNTERS.minutesSinceDisassembly * 60,
  }
}

function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return DEFAULT_SEED
  return Math.floor(Math.abs(seed)) >>> 0
}

export class FactorySimulation implements FactorySim {
  readonly state: FactoryState
  private readonly clock: SimClock
  private readonly emitFn: FactoryEmit
  private readonly preloadSeconds: number
  private readonly headStartSeconds: number
  private readonly debugNamespace: string | null
  private readonly lineSims: Record<LineId, ProductionLine>
  private readonly subs = new Set<() => void>()
  private _version = 0
  private baseSeed: number
  private offClock: (() => void) | null = null
  private offDebug: (() => void) | null = null
  private forcedOutcome: LaunchOutcome | null = null
  private forcedStowaway: boolean | null = null
  private revealed = false
  /** > 0 while warming up / fast-forwarding: no events, no notifications. */
  private silent = 0
  private lastPartEventT = -Infinity
  private readonly ctx = {
    assembling: false,
    caughtDefectChance: 0,
    seed: 0,
    onDeliver: (line: ProductionLine, toRocket: boolean) => this.onPartDelivered(line, toRocket),
  }

  constructor(options: FactorySimOptions = {}) {
    this.clock = options.clock ?? globalClock
    this.emitFn = options.emit ?? ((name, payload) => events.emit(name, payload))
    this.baseSeed = normalizeSeed(options.seed ?? DEFAULT_SEED)
    this.preloadSeconds = Math.max(0, options.preloadSeconds ?? WORLD.preloadSeconds)
    this.headStartSeconds = Math.max(0, options.headStartSeconds ?? WORLD.headStartSeconds)
    this.debugNamespace = options.debugNamespace === undefined ? 'factory' : options.debugNamespace

    const lineSims = {} as Record<LineId, ProductionLine>
    const lines = {} as Record<LineId, LineStateWithBelt>
    for (const id of LINE_IDS) {
      lineSims[id] = new ProductionLine(id)
      lines[id] = lineSims[id].state
    }
    this.lineSims = lineSims
    const params = { ...DEFAULT_PARAMS }
    this.state = {
      t: this.clock.t,
      lines,
      rocket: freshRocket(1, rocketSeed(this.baseSeed, 1)),
      counters: initialCounters(this.clock.t),
      params,
      model: evaluate(params),
      history: [],
    }
    this.initialize()
  }

  // -------------------------------------------------------------------------
  // FactorySim contract
  // -------------------------------------------------------------------------

  get version(): number {
    return this._version
  }

  get started(): boolean {
    return this.offClock !== null
  }

  get seed(): number {
    return this.baseSeed
  }

  start(): void {
    if (this.offClock) return
    this.state.t = this.clock.t
    this.offClock = this.clock.onTick(this.onTick)
    if (this.debugNamespace) this.offDebug = registerDebug(this.debugNamespace, this.debugApi())
  }

  stop(): void {
    this.offClock?.()
    this.offClock = null
    this.offDebug?.()
    this.offDebug = null
  }

  /** Bound so it can be handed to useSyncExternalStore directly. */
  subscribe = (fn: () => void): (() => void) => {
    this.subs.add(fn)
    return () => {
      this.subs.delete(fn)
    }
  }

  setParams(p: Partial<OptimizationParams>): void {
    const next = normalizeParams(p, this.state.params)
    if (paramsEqual(next, this.state.params)) return
    this.state.params = next
    this.state.model = evaluate(next)
    this.applyLineTargets(false)
    this.emit('factory:params', {})
    this.notify()
  }

  resetParams(): void {
    this.setParams(DEFAULT_PARAMS)
  }

  setSeed(seed: number): void {
    const s = normalizeSeed(seed)
    if (s === this.baseSeed) return
    this.baseSeed = s
    this.state.rocket.seed = rocketSeed(s, this.state.rocket.id)
    this.notify()
  }

  forceNextOutcome(o: LaunchOutcome | null, stowaway?: boolean): void {
    if (o === null) {
      this.forcedOutcome = null
      this.forcedStowaway = null
      return
    }
    // Debug/test input: ignore anything that is not a real outcome.
    if (!Object.prototype.hasOwnProperty.call(OUTCOME_REVEAL_AT, o)) {
      console.warn(`[factory] forceNextOutcome: unknown outcome "${String(o)}" ignored`)
      return
    }
    this.forcedOutcome = o
    this.forcedStowaway = typeof stowaway === 'boolean' ? stowaway : null
    // The stowaway is normally decided when rollout completes; if that already
    // happened for a rocket that has not ignited yet, apply it right away.
    const r = this.state.rocket
    if (this.forcedStowaway !== null && (r.phase === 'pad' || r.phase === 'countdown')) {
      r.stowaway = this.forcedStowaway
      this.forcedStowaway = null
      this.notify()
    }
  }

  skipToLaunch(): void {
    const r = this.state.rocket
    if (r.phase !== 'assembling') return
    for (const id of LINE_IDS) {
      const l = this.lineSims[id].state
      l.delivered = l.required
    }
    while (r.stagesComplete < STAGE_COUNT) this.completeStage()
    this.completeAssembly()
  }

  reset(hard = false): void {
    const oldId = this.state.rocket.id
    const midLaunch = this.state.rocket.phase !== 'assembling'
    if (hard) {
      if (midLaunch) this.emit('rocket:reset', { rocketId: oldId })
      const oldParams = this.state.params
      this.initialize()
      if (!paramsEqual(oldParams, this.state.params)) this.emit('factory:params', {})
    } else {
      this.emit('rocket:reset', { rocketId: oldId })
      this.beginNextRocket()
    }
    this.notify()
  }

  // -------------------------------------------------------------------------
  // Extras (debug / tests)
  // -------------------------------------------------------------------------

  /** Advance the simulation directly by `seconds` (no clock). Tests/tools only. */
  advance(seconds: number, step = FIXED_STEP): void {
    let remaining = seconds
    while (remaining > 1e-9) {
      const dt = Math.min(step, remaining)
      this.state.t += dt
      this.step(dt)
      remaining -= dt
    }
  }

  /**
   * Jump the current rocket's timeline to the start of `phase` (finishing
   * assembly first if needed). Events fire in order as phases are passed.
   * Production lines are not advanced. Target 'assembling' = the next rocket.
   */
  skipToPhase(phase: RocketPhase): void {
    const r = this.state.rocket
    if (!PHASE_ORDER.includes(phase)) {
      console.warn(`[factory] skipToPhase: unknown phase "${String(phase)}" ignored`)
      return
    }
    if (r.phase === phase && phase !== 'assembling') return
    if (r.phase === 'assembling') this.skipToLaunch()
    let guard = 0
    while (r.phase !== phase && guard++ < 20000) {
      // Passing into the next rocket on the way to a later phase: build it instantly too.
      if (r.phase === 'assembling') this.skipToLaunch()
      else this.updateRocket(0.05)
    }
  }

  /** Debug: jump assembly to `stages` complete stages (0..5) with `progress` (0..1) on the next one. */
  skipToStage(stages: number, progress = 0): void {
    const r = this.state.rocket
    if (r.phase !== 'assembling') return
    const target = clamp(Math.floor(stages), 0, STAGE_COUNT - 1)
    if (target < r.stagesComplete) return
    const p = clamp(Number.isFinite(progress) ? progress : 0, 0, 0.99)
    for (const id of LINE_IDS) {
      const l = this.lineSims[id].state
      const want = STAGE_NEEDS_BEFORE[target][id] + Math.ceil(STAGE_NEEDS[target][id] * p)
      l.delivered = Math.max(l.delivered, Math.min(l.required, want))
    }
    while (r.stagesComplete < target) this.completeStage()
    r.stageProgress = Math.max(r.stageProgress, Math.min(p, this.stagePartsFraction(target)))
    this.notify()
  }

  /** Current steady-state seconds per rocket for the live params. */
  cycleSeconds(): number {
    return worldCycleSeconds(this.state.params)
  }

  /** Parts waiting in each line's tower hopper for the next rocket. */
  hopperStock(): Record<LineId, number> {
    const out = {} as Record<LineId, number>
    for (const id of LINE_IDS) out[id] = this.lineSims[id].stock
    return out
  }

  /** Nominal machine rate (parts/min) and belt speed (lengths/s) per line, ignoring waits. */
  nominalRates(): Record<LineId, { rate: number; belt: number }> {
    const out = {} as Record<LineId, { rate: number; belt: number }>
    for (const id of LINE_IDS) out[id] = { rate: this.lineSims[id].nominalRate, belt: this.lineSims[id].nominalBelt }
    return out
  }

  /** JSON-safe deep snapshot (no Infinity / NaN). */
  snapshot() {
    const s = this.state
    const lines = {} as Record<LineId, LineStateWithBelt & { stock: number; totalDelivered: number; nominalRate: number; nominalBelt: number }>
    for (const id of LINE_IDS) {
      const l = this.lineSims[id]
      lines[id] = {
        ...l.state,
        items: [...l.state.items],
        stock: l.stock,
        totalDelivered: l.totalDelivered,
        nominalRate: l.nominalRate,
        nominalBelt: l.nominalBelt,
      }
    }
    const raw = {
      t: s.t,
      version: this._version,
      started: this.started,
      seed: this.baseSeed,
      forced: { outcome: this.forcedOutcome, stowaway: this.forcedStowaway },
      cycleSeconds: this.cycleSeconds(),
      params: { ...s.params },
      model: { ...s.model, explanation: [...s.model.explanation] },
      counters: { ...s.counters },
      history: s.history.map((h) => ({ ...h })),
      rocket: { ...s.rocket, phaseDuration: Number.isFinite(s.rocket.phaseDuration) ? s.rocket.phaseDuration : null },
      lines,
    }
    return JSON.parse(JSON.stringify(raw, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v))) as typeof raw
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private onTick = (dt: number, t: number): void => {
    this.state.t = t
    this.step(dt)
  }

  private step(dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return
    let remaining = dt
    while (remaining > 1e-12) {
      const h = Math.min(MAX_STEP, remaining)
      this.updateLines(h)
      this.updateRocket(h)
      remaining -= h
    }
  }

  private emit<K extends GameEventName>(name: K, payload: GameEvents[K]): void {
    if (this.silent > 0) return
    try {
      this.emitFn(name, payload)
    } catch (err) {
      console.error(`[factory] emit ${name} failed`, err)
    }
  }

  private caption(text: string, kind: GameEvents['caption']['kind'], duration = 4): void {
    this.emit('caption', { text, kind, duration })
  }

  private notify(): void {
    if (this.silent > 0) return
    this._version++
    for (const fn of [...this.subs]) {
      try {
        fn()
      } catch (err) {
        console.error('[factory] subscriber threw', err)
      }
    }
  }

  /** (Re)build the whole session state: defaults, history, warm lines, rocket #1 part-built. */
  private initialize(): void {
    const t = this.clock.t
    const s = this.state
    s.t = t
    s.params = { ...DEFAULT_PARAMS }
    s.model = evaluate(s.params)
    s.counters = initialCounters(t)
    s.history = []
    Object.assign(s.rocket, freshRocket(1, rocketSeed(this.baseSeed, 1)))
    this.forcedOutcome = null
    this.forcedStowaway = null
    this.revealed = false
    this.lastPartEventT = -Infinity
    for (const id of LINE_IDS) this.lineSims[id].clear()
    this.applyLineTargets(true)
    this.warmUp()
  }

  private warmUp(): void {
    const r = this.state.rocket
    this.silent++
    try {
      // 1. The factory was already running before the visitor arrived: belts and
      //    hoppers fill while the tower waits for the next rocket.
      r.phase = 'reset'
      for (let tt = 0; tt < this.preloadSeconds - 1e-9; tt += WARMUP_STEP) this.updateLines(WARMUP_STEP)
      r.phase = 'assembling'
      r.phaseDuration = Infinity
      r.phaseTime = 0
      for (const id of LINE_IDS) this.lineSims[id].startRocket()
      // 2. Rocket #1 is already part-built when the visit starts.
      for (let tt = 0; tt < this.headStartSeconds - 1e-9; tt += WARMUP_STEP) {
        if (r.phase !== 'assembling' || r.stagesComplete >= STAGE_COUNT - 1) break
        this.updateLines(WARMUP_STEP)
        this.updateRocket(WARMUP_STEP)
      }
    } finally {
      this.silent--
    }
    for (const id of LINE_IDS) this.lineSims[id].state.defectFlash = 0
  }

  private applyLineTargets(immediate: boolean): void {
    const targets = lineTargets(this.state.params)
    for (const id of LINE_IDS) this.lineSims[id].setTargets(targets[id], immediate)
  }

  private updateLines(dt: number): void {
    const p = this.state.params
    const ctx = this.ctx
    ctx.assembling = this.state.rocket.phase === 'assembling'
    ctx.caughtDefectChance = rawDefectRate(p.conveyorSpeed) * catchRate(p.inspection)
    ctx.seed = this.baseSeed
    let changed = false
    for (const id of LINE_IDS) if (this.lineSims[id].step(dt, ctx)) changed = true
    if (changed) this.notify()
  }

  private onPartDelivered(line: ProductionLine, _toRocket: boolean): void {
    if (this.silent > 0) return
    const t = this.state.t
    if (t - this.lastPartEventT < WORLD.partEventInterval) return
    this.lastPartEventT = t
    this.emit('factory:part', { line: line.id, total: line.totalDelivered })
  }

  /** 0..1 share of stage k's parts that have arrived. */
  private stagePartsFraction(k: number): number {
    const needs = STAGE_NEEDS[k]
    const before = STAGE_NEEDS_BEFORE[k]
    let have = 0
    for (const id of LINE_IDS) {
      const need = needs[id]
      if (need === 0) continue
      have += clamp(this.lineSims[id].state.delivered - before[id], 0, need)
    }
    return STAGE_TOTALS[k] > 0 ? have / STAGE_TOTALS[k] : 1
  }

  private enterPhase(phase: RocketPhase): void {
    const r = this.state.rocket
    r.phase = phase
    r.phaseTime = 0
    r.phaseDuration = phaseSeconds(phase)
  }

  private updateRocket(dt: number): void {
    const r = this.state.rocket
    let remaining = dt
    let guard = 0
    while (remaining > 1e-12 && guard++ < 16) {
      if (r.phase === 'assembling') {
        r.phaseTime += remaining
        this.updateAssembly(remaining)
        return
      }
      const before = r.phaseTime
      const used = Math.min(remaining, r.phaseDuration - r.phaseTime)
      r.phaseTime += used
      remaining -= used
      this.updateTimedPhase(before, r.phaseTime)
      if (r.phaseTime >= r.phaseDuration - 1e-9) this.finishPhase()
    }
  }

  private updateAssembly(dt: number): void {
    const r = this.state.rocket
    let crewTime = dt
    while (r.stagesComplete < STAGE_COUNT) {
      const k = r.stagesComplete
      const perSecond = 1 / STAGE_CREW_SECONDS[ROCKET_STAGES[k]]
      const parts = this.stagePartsFraction(k)
      const crew = r.stageProgress + crewTime * perSecond
      if (parts >= 1 && crew >= 1 - 1e-9) {
        crewTime = Math.max(0, crewTime - (1 - r.stageProgress) / perSecond)
        this.completeStage()
        continue
      }
      r.stageProgress = Math.max(r.stageProgress, Math.min(crew, parts, 0.999))
      break
    }
    if (r.stagesComplete >= STAGE_COUNT) this.completeAssembly()
  }

  private completeStage(): void {
    const r = this.state.rocket
    const k = r.stagesComplete
    r.stagesComplete = k + 1
    r.stageProgress = 0
    this.emit('rocket:stage', { rocketId: r.id, stage: k, stageName: ROCKET_STAGES[k] })
    this.notify()
  }

  private completeAssembly(): void {
    const r = this.state.rocket
    r.stagesComplete = STAGE_COUNT
    r.stageProgress = 0
    this.emit('rocket:complete', { rocketId: r.id })
    this.enterPhase('rollout')
    r.transport = 0
    this.emit('rocket:rollout', { rocketId: r.id })
    this.notify()
  }

  private updateTimedPhase(before: number, now: number): void {
    const r = this.state.rocket
    switch (r.phase) {
      case 'rollout':
        r.transport = easeInOut(now / r.phaseDuration)
        break
      case 'countdown': {
        const dur = r.phaseDuration
        r.countdown = Math.max(0, dur - now)
        const prevLeft = Math.ceil(dur - before - 1e-6)
        const left = Math.ceil(dur - now - 1e-6)
        if (left < prevLeft && left >= 1) {
          this.emit('rocket:countdown', { rocketId: r.id, secondsLeft: left })
          this.notify()
        }
        break
      }
      case 'flight':
        if (!this.revealed && r.outcome && now >= OUTCOME_REVEAL_AT[r.outcome] - 1e-9) this.reveal()
        break
      case 'aftermath':
      case 'reset': {
        const back = PHASE_SECONDS.aftermath + PHASE_SECONDS.reset
        const elapsed = r.phase === 'aftermath' ? now : PHASE_SECONDS.aftermath + now
        r.transport = 1 - easeInOut(elapsed / back)
        break
      }
      default:
        break
    }
  }

  private finishPhase(): void {
    const r = this.state.rocket
    switch (r.phase) {
      case 'rollout':
        r.transport = 1
        r.stowaway = this.forcedStowaway ?? rollStowaway(this.baseSeed, r.id)
        this.forcedStowaway = null
        this.enterPhase('pad')
        break
      case 'pad':
        this.enterPhase('countdown')
        r.countdown = r.phaseDuration
        this.emit('rocket:countdown', { rocketId: r.id, secondsLeft: Math.round(r.phaseDuration) })
        this.caption(COUNTDOWN_CAPTION, 'warning', 5)
        break
      case 'countdown':
        r.countdown = null
        this.enterPhase('ignition')
        r.outcome = this.forcedOutcome ?? rollOutcome(this.baseSeed, r.id, this.state.model.successChance)
        this.forcedOutcome = null
        this.revealed = false
        this.emit('rocket:ignition', { rocketId: r.id })
        break
      case 'ignition':
        this.enterPhase('flight')
        this.emit('rocket:liftoff', { rocketId: r.id })
        break
      case 'flight':
        if (!this.revealed) this.reveal()
        this.enterPhase('aftermath')
        if (r.stowaway) this.caption(stowawayLine(this.baseSeed, r.id), 'pa', 4)
        break
      case 'aftermath':
        this.enterPhase('reset')
        this.emit('rocket:reset', { rocketId: r.id })
        break
      case 'reset':
        this.beginNextRocket()
        break
      default:
        return
    }
    this.notify()
  }

  private reveal(): void {
    const r = this.state.rocket
    const outcome = r.outcome
    if (!outcome || this.revealed) return
    this.revealed = true
    const t = this.state.t
    const c = this.state.counters
    this.state.counters = isSuccessfulOutcome(outcome)
      ? { ...c, successes: c.successes + 1 }
      : { ...c, disassemblies: c.disassemblies + 1, lastDisassemblyT: t }
    const record: LaunchRecord = { rocketId: r.id, outcome, stowaway: r.stowaway, t }
    const history = [...this.state.history, record]
    this.state.history = history.length > HISTORY_LIMIT ? history.slice(history.length - HISTORY_LIMIT) : history
    this.emit('rocket:outcome', { rocketId: r.id, outcome, stowaway: r.stowaway })
    this.caption(announcerLine(outcome, this.baseSeed, r.id), 'pa', 4)
    this.notify()
  }

  private beginNextRocket(): void {
    const r = this.state.rocket
    const id = r.id + 1
    Object.assign(r, freshRocket(id, rocketSeed(this.baseSeed, id)))
    this.revealed = false
    for (const lid of LINE_IDS) this.lineSims[lid].startRocket()
  }

  private debugApi(): Record<string, unknown> {
    return {
      getState: () => this.snapshot(),
      advance: (seconds: number) => {
        const s = Number(seconds)
        if (Number.isFinite(s) && s > 0) this.clock.advance(Math.min(s, 3600))
        return this.snapshot().rocket
      },
      skipToLaunch: () => {
        this.skipToLaunch()
        return this.state.rocket.phase
      },
      skipToPhase: (phase: RocketPhase) => {
        this.skipToPhase(phase)
        return this.state.rocket.phase
      },
      skipToStage: (stages: number, progress?: number) => {
        this.skipToStage(stages, progress)
        return this.state.rocket.stagesComplete
      },
      forceNextOutcome: (o: LaunchOutcome | null, stowaway?: boolean) => this.forceNextOutcome(o, stowaway),
      reset: (hard?: boolean) => this.reset(Boolean(hard)),
      setParams: (p: Partial<OptimizationParams>) => {
        this.setParams(p)
        return { ...this.state.params }
      },
      resetParams: () => this.resetParams(),
      setSeed: (seed: number) => this.setSeed(seed),
      evaluate: (p: Partial<OptimizationParams>) => evaluate(p ?? {}),
      cycleSeconds: () => this.cycleSeconds(),
    }
  }
}
