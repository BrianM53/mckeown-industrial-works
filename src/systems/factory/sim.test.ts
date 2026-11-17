import { afterEach, describe, expect, it, vi } from 'vitest'
import { SimClock } from '@/core/clock'
import type { GameEventName, GameEvents } from '@/core/events'
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
  STAGE_RECIPES,
  WORLD,
} from './config'
import { evaluate } from './model'
import { outcomeDraw, rollOutcome, rollStowaway } from './outcomes'
import { FactorySimulation, type FactorySimOptions } from './sim'
import { ROCKET_STAGES, type OptimizationParams, type RocketPhase } from './types'

interface Logged {
  name: GameEventName
  payload: GameEvents[GameEventName]
  t: number
}

const sims: FactorySimulation[] = []
afterEach(() => {
  for (const s of sims.splice(0)) s.stop()
})

function make(opts: FactorySimOptions = {}) {
  const clock = new SimClock()
  const log: Logged[] = []
  const sim = new FactorySimulation({
    clock,
    emit: (name, payload) => log.push({ name, payload: payload as GameEvents[GameEventName], t: clock.t }),
    debugNamespace: null,
    ...opts,
  })
  sims.push(sim)
  /** Phase transitions observed through notifications. */
  const transitions: Array<{ id: number; phase: RocketPhase; t: number }> = []
  let last = `${sim.state.rocket.id}:${sim.state.rocket.phase}`
  sim.subscribe(() => {
    const key = `${sim.state.rocket.id}:${sim.state.rocket.phase}`
    if (key !== last) {
      last = key
      transitions.push({ id: sim.state.rocket.id, phase: sim.state.rocket.phase, t: clock.t })
    }
  })
  sim.start()
  return { clock, sim, log, transitions }
}

/** Advance in clock frames until `pred` holds (or fail after maxSeconds). Returns sim seconds elapsed. */
function until(clock: SimClock, pred: () => boolean, maxSeconds = 2000, step = 1 / 30): number {
  const t0 = clock.t
  while (!pred()) {
    if (clock.t - t0 > maxSeconds) throw new Error(`condition not reached within ${maxSeconds}s`)
    clock.advance(step)
  }
  return clock.t - t0
}

function startOf(transitions: Array<{ id: number; phase: RocketPhase; t: number }>, id: number, phase: RocketPhase): number {
  const tr = transitions.find((x) => x.id === id && x.phase === phase)
  if (!tr) throw new Error(`no ${phase} for rocket ${id}`)
  return tr.t
}

describe('lifecycle', () => {
  it('start() subscribes once (idempotent) and stop() unsubscribes', () => {
    const clock = new SimClock()
    const sim = new FactorySimulation({ clock, emit: () => {}, debugNamespace: null })
    sims.push(sim)
    expect(clock.subscriberCount).toBe(0)
    sim.start()
    sim.start()
    expect(clock.subscriberCount).toBe(1)
    sim.stop()
    expect(clock.subscriberCount).toBe(0)
    sim.stop()
    // StrictMode mount → unmount → mount
    sim.start()
    sim.stop()
    sim.start()
    expect(clock.subscriberCount).toBe(1)
    sim.stop()
    const t = sim.state.rocket.phaseTime
    clock.advance(5)
    expect(sim.state.rocket.phaseTime).toBe(t)
  })

  it('registers the debug namespace on start and removes it on stop', () => {
    const clock = new SimClock()
    const sim = new FactorySimulation({ clock, emit: () => {}, debugNamespace: 'factoryTest' })
    sims.push(sim)
    const w = window as unknown as { __MIW__?: Record<string, Record<string, unknown> | undefined> }
    sim.start()
    const api = w.__MIW__?.factoryTest
    expect(api).toBeDefined()
    for (const k of ['getState', 'advance', 'skipToLaunch', 'forceNextOutcome', 'reset', 'setParams', 'evaluate']) expect(typeof api![k]).toBe('function')
    const snap = (api!.getState as () => { rocket: { phaseDuration: number | null } })()
    expect(snap.rocket.phaseDuration).toBeNull() // Infinity is not JSON
    ;(api!.advance as (s: number) => void)(3)
    expect(clock.t).toBeCloseTo(3, 6)
    expect((api!.evaluate as (p: Partial<OptimizationParams>) => { meetsTarget: boolean })({ conveyorSpeed: 1.3, inspection: 0.6, pressesToTanks: 3 }).meetsTarget).toBe(true)
    sim.stop()
    expect(w.__MIW__?.factoryTest?.getState).toBeUndefined()
  })
})

describe('initial state', () => {
  it('starts with a believable history and a half-built rocket on warm lines', () => {
    const { sim } = make()
    const s = sim.state
    expect(s.counters).toEqual({
      successes: INITIAL_COUNTERS.successes,
      disassemblies: INITIAL_COUNTERS.disassemblies,
      lastDisassemblyT: -14 * 60,
    })
    expect(s.t - s.counters.lastDisassemblyT).toBe(840) // the sign starts at 14:00
    expect(s.history).toEqual([])
    expect(s.rocket.id).toBe(1)
    expect(s.rocket.phase).toBe('assembling')
    expect(s.rocket.phaseDuration).toBe(Infinity)
    expect(s.rocket.stagesComplete).toBeGreaterThanOrEqual(1)
    expect(s.rocket.stagesComplete).toBeLessThan(ROCKET_STAGES.length)
    expect(s.params).toEqual(DEFAULT_PARAMS)
    expect(s.model).toEqual(evaluate(DEFAULT_PARAMS))
    for (const id of LINE_IDS) {
      const l = s.lines[id]
      expect(l.id).toBe(id)
      expect(l.items.length).toBeGreaterThan(2)
      expect(l.required).toBe(WORLD.requiredParts[id])
      expect(l.defectFlash).toBe(0)
    }
    expect(JSON.parse(JSON.stringify(sim.snapshot()))).toEqual(sim.snapshot())
  })

  it('stage recipes add up to the parts each line must deliver', () => {
    for (const id of LINE_IDS) {
      const sum = ROCKET_STAGES.reduce((acc, st) => acc + (STAGE_RECIPES[st][id] ?? 0), 0)
      expect(sum, id).toBe(WORLD.requiredParts[id])
    }
  })

  it('the first launch of a visit comes early (a part-built rocket greets the visitor)', () => {
    const { clock, sim } = make()
    const tIgnition = until(clock, () => sim.state.rocket.phase === 'ignition', 400)
    expect(tIgnition).toBeGreaterThan(60)
    expect(tIgnition).toBeLessThan(150)
  })
})

describe('rocket cycle (spec test 9)', () => {
  it('assembles, rolls out, counts down, launches, records the outcome and starts the next rocket', () => {
    const { clock, sim, transitions } = make()
    until(clock, () => sim.state.rocket.id === 3, 1200)
    const r2 = transitions.filter((x) => x.id === 2).map((x) => x.phase)
    expect(r2).toEqual([...PHASE_ORDER])
    expect(transitions.filter((x) => x.id === 3).map((x) => x.phase)).toEqual(['assembling'])
    expect(sim.state.history.map((h) => h.rocketId)).toEqual([1, 2])
    expect(sim.state.rocket.stagesComplete).toBe(0)
    expect(sim.state.rocket.outcome).toBeNull()
    expect(sim.state.rocket.transport).toBe(0)
  })

  it('cycle time at default settings is 3–5 minutes (≈150 s of assembly)', () => {
    const { clock, sim, transitions } = make()
    until(clock, () => sim.state.rocket.id === 4, 1500)
    const cycle = startOf(transitions, 3, 'assembling') - startOf(transitions, 2, 'assembling')
    expect(cycle).toBeGreaterThanOrEqual(180)
    expect(cycle).toBeLessThanOrEqual(300)
    expect(cycle).toBeCloseTo(213, -1)
    const assembly = startOf(transitions, 2, 'rollout') - startOf(transitions, 2, 'assembling')
    expect(assembly).toBeGreaterThan(140)
    expect(assembly).toBeLessThan(160)
    expect(sim.cycleSeconds()).toBeCloseTo(213, 0)
  })

  it('timed phases last as configured', () => {
    const { clock, sim, transitions } = make()
    until(clock, () => sim.state.rocket.id === 3, 1200)
    const order = PHASE_ORDER
    for (let i = 1; i < order.length; i++) {
      const phase = order[i] as Exclude<RocketPhase, 'assembling'>
      const next = i + 1 < order.length ? startOf(transitions, 2, order[i + 1]) : startOf(transitions, 3, 'assembling')
      expect(next - startOf(transitions, 2, phase), phase).toBeCloseTo(PHASE_SECONDS[phase], 1)
    }
  })

  it('a well-optimized line assembles faster (≈110 s); the worst settings stay under 220 s', () => {
    const assemblyFor = (p: Partial<OptimizationParams>) => {
      const { clock, sim, transitions } = make()
      sim.setParams(p)
      until(clock, () => sim.state.rocket.id === 4, 2000)
      const a2 = startOf(transitions, 2, 'rollout') - startOf(transitions, 2, 'assembling')
      const a3 = startOf(transitions, 3, 'rollout') - startOf(transitions, 3, 'assembling')
      return [a2, a3]
    }
    for (const a of assemblyFor({ conveyorSpeed: 1.4, inspection: 0.75, pressesToTanks: 3 })) {
      expect(a).toBeGreaterThan(95)
      expect(a).toBeLessThan(125)
    }
    for (const worst of [
      { conveyorSpeed: 0.5, inspection: 1, pressesToTanks: 1 },
      { conveyorSpeed: 0.5, inspection: 1, pressesToTanks: 5 },
    ]) {
      for (const a of assemblyFor(worst)) expect(a).toBeLessThanOrEqual(220)
    }
  })

  it('countdown runs 10 → 0 and transport eases tower → pad → back', () => {
    const { clock, sim } = make()
    sim.skipToLaunch()
    const r = sim.state.rocket
    expect(r.phase).toBe('rollout')
    expect(r.countdown).toBeNull()
    clock.advance(5)
    const quarter = r.transport
    clock.advance(5)
    expect(r.transport).toBeGreaterThan(quarter)
    expect(r.transport).toBeCloseTo(0.5, 1)
    expect(quarter).toBeLessThan(0.25) // eased: slow start
    until(clock, () => r.phase === 'pad')
    expect(r.transport).toBe(1)
    until(clock, () => r.phase === 'countdown')
    expect(r.countdown).toBe(10)
    clock.advance(3.5)
    expect(r.countdown).toBeCloseTo(6.5, 1)
    until(clock, () => r.phase === 'ignition')
    expect(r.countdown).toBeNull()
    until(clock, () => r.phase === 'aftermath')
    expect(r.transport).toBe(1)
    until(clock, () => r.phase === 'reset')
    expect(r.transport).toBeLessThan(1)
    expect(r.transport).toBeGreaterThan(0)
  })
})

describe('events', () => {
  it('fire in order, exactly once per phase (stage ×6, countdown 10…1)', () => {
    const { clock, sim, log } = make()
    sim.forceNextOutcome('breakup')
    until(clock, () => sim.state.rocket.id === 2, 600)
    sim.forceNextOutcome('explosion', true)
    until(clock, () => sim.state.rocket.id === 3, 600)
    const mine = log.filter((e) => (e.payload as { rocketId?: number }).rocketId === 2)
    const seq = mine.map((e) => (e.name === 'rocket:countdown' ? `countdown:${(e.payload as { secondsLeft: number }).secondsLeft}` : e.name === 'rocket:stage' ? `stage:${(e.payload as { stage: number }).stage}` : e.name))
    expect(seq).toEqual([
      'stage:0',
      'stage:1',
      'stage:2',
      'stage:3',
      'stage:4',
      'stage:5',
      'rocket:complete',
      'rocket:rollout',
      ...[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => `countdown:${n}`),
      'rocket:ignition',
      'rocket:liftoff',
      'rocket:outcome',
      'rocket:reset',
    ])
    const stages = mine.filter((e) => e.name === 'rocket:stage').map((e) => (e.payload as { stageName: string }).stageName)
    expect(stages).toEqual([...ROCKET_STAGES])
    const outcome = mine.find((e) => e.name === 'rocket:outcome')!
    expect(outcome.payload).toEqual({ rocketId: 2, outcome: 'explosion', stowaway: true })
    // countdown events are one second apart
    const cd = mine.filter((e) => e.name === 'rocket:countdown').map((e) => e.t)
    for (let i = 1; i < cd.length; i++) expect(cd[i] - cd[i - 1]).toBeCloseTo(1, 1)
  })

  it('captions the countdown and the PA announcer (incl. the stowaway)', () => {
    const { clock, sim, log } = make()
    sim.forceNextOutcome('wobble', true)
    until(clock, () => sim.state.rocket.id === 2, 600)
    const captions = log.filter((e) => e.name === 'caption').map((e) => e.payload as GameEvents['caption'])
    expect(captions[0]).toMatchObject({ text: '⚠ Launch countdown — clear the pad', kind: 'warning' })
    expect(captions.filter((c) => c.kind === 'pa').length).toBe(2)
    expect(captions[1].text).toMatch(/^Announcer: (Nominal|That fin)/)
    expect(captions[2].text).toMatch(/^Announcer: /)
    expect(captions.every((c) => (c.duration ?? 0) > 0 && c.text.length < 60)).toBe(true)
  })

  it("throttles 'factory:part' to a few per second", () => {
    const { clock, log } = make()
    clock.advance(120)
    const parts = log.filter((e) => e.name === 'factory:part')
    expect(parts.length).toBeGreaterThan(30)
    expect(parts.length).toBeLessThanOrEqual(120 / WORLD.partEventInterval + 1)
    for (let i = 1; i < parts.length; i++) expect(parts[i].t - parts[i - 1].t).toBeGreaterThanOrEqual(WORLD.partEventInterval - 1e-9)
    const totals = new Map<LineId, number>()
    for (const p of parts) {
      const { line, total } = p.payload as GameEvents['factory:part']
      expect(total).toBeGreaterThan(totals.get(line) ?? 0)
      totals.set(line, total)
    }
  })

  it("emits 'factory:params' once per real change", () => {
    const { sim, log } = make()
    sim.setParams({ conveyorSpeed: 1.5 })
    sim.setParams({ conveyorSpeed: 1.5 })
    sim.setParams({ conveyorSpeed: 1.52 }) // snaps to 1.5: no change
    sim.resetParams()
    expect(log.filter((e) => e.name === 'factory:params')).toHaveLength(2)
  })
})

describe('outcomes & counters', () => {
  const runLaunch = (outcome: LaunchOutcome) => {
    const env = make()
    env.sim.forceNextOutcome(outcome)
    env.sim.skipToLaunch()
    until(env.clock, () => env.sim.state.rocket.phase === 'flight')
    const liftoff = env.clock.t
    until(env.clock, () => env.sim.state.history.length === 1, 30)
    return { ...env, revealAt: env.clock.t - liftoff }
  }

  it('success and wobble count as successful launches', () => {
    for (const o of ['success', 'wobble'] as const) {
      const { sim, revealAt } = runLaunch(o)
      expect(sim.state.counters).toEqual({ successes: 4, disassemblies: 41, lastDisassemblyT: -840 })
      expect(sim.state.history[0]).toMatchObject({ rocketId: 1, outcome: o, stowaway: false })
      expect(revealAt).toBeCloseTo(OUTCOME_REVEAL_AT[o], 1)
    }
  })

  it('breakup and explosion are unscheduled disassemblies that reset the sign timer', () => {
    for (const o of ['breakup', 'explosion'] as const) {
      const { sim, clock, revealAt } = runLaunch(o)
      expect(sim.state.counters.successes).toBe(3)
      expect(sim.state.counters.disassemblies).toBe(42)
      expect(sim.state.counters.lastDisassemblyT).toBeCloseTo(clock.t, 1)
      expect(sim.state.history[0].t).toBeCloseTo(clock.t, 1)
      expect(revealAt).toBeCloseTo(OUTCOME_REVEAL_AT[o], 1)
    }
  })

  it('replaces counters/history objects on change (selectors can compare by identity)', () => {
    const { sim, clock } = make()
    const counters = sim.state.counters
    const history = sim.state.history
    sim.forceNextOutcome('success')
    sim.skipToLaunch()
    until(clock, () => sim.state.history.length === 1)
    expect(sim.state.counters).not.toBe(counters)
    expect(sim.state.history).not.toBe(history)
    expect(counters.successes).toBe(3) // old object untouched
  })

  it('decides the outcome at ignition from the live success chance', () => {
    const { sim, clock } = make({ seed: 4242 })
    sim.skipToLaunch()
    until(clock, () => sim.state.rocket.phase === 'countdown')
    expect(sim.state.rocket.outcome).toBeNull()
    sim.setParams({ conveyorSpeed: 1.4, inspection: 0.75, pressesToTanks: 3 })
    until(clock, () => sim.state.rocket.phase === 'ignition')
    expect(sim.state.rocket.outcome).toBe(rollOutcome(4242, 1, sim.state.model.successChance))
  })

  it('is deterministic for a given seed and settings', () => {
    const outcomes = (seed: number) => {
      const { sim, clock } = make({ seed })
      until(clock, () => sim.state.history.length >= 4, 2000)
      return sim.state.history.map((h) => `${h.outcome}${h.stowaway ? '+S' : ''}@${h.t.toFixed(2)}`)
    }
    const a = outcomes(777)
    expect(outcomes(777)).toEqual(a)
    expect([778, 779].some((seed) => outcomes(seed).join() !== a.join())).toBe(true)
  })

  it('setSeed re-seeds the current rocket and future launches', () => {
    const { sim } = make()
    const before = sim.state.rocket.seed
    sim.setSeed(12345)
    expect(sim.state.rocket.seed).not.toBe(before)
    expect(sim.seed).toBe(12345)
    sim.setSeed(Number.NaN)
    expect(sim.seed).toBe(DEFAULT_SEED)
  })

  it('the curated default seed gives every visit a memorable first few launches', () => {
    const sc = evaluate(DEFAULT_PARAMS).successChance
    expect([1, 2, 3, 4].map((id) => rollOutcome(DEFAULT_SEED, id, sc))).toEqual(['breakup', 'wobble', 'success', 'explosion'])
    expect([1, 2, 3, 4].map((id) => rollStowaway(DEFAULT_SEED, id))).toEqual([false, true, false, false])
    expect(rollOutcome(DEFAULT_SEED, 1, 0.75)).toBe('breakup') // even a perfect line
    expect(rollOutcome(DEFAULT_SEED, 3, 0.2)).toBe('success') // even a terrible line
    expect(rollOutcome(DEFAULT_SEED, 4, evaluate({ conveyorSpeed: 1.4, inspection: 0.85, pressesToTanks: 3 }).successChance)).toBe('success')
    // ... and the live sim agrees.
    const { sim, clock } = make()
    until(clock, () => sim.state.history.length >= 2, 900)
    expect(sim.state.history.map((h) => [h.outcome, h.stowaway])).toEqual([
      ['breakup', false],
      ['wobble', true],
    ])
  })

  it('outcome odds follow successChance and the 45/35/20 failure mix; ~12% stowaways', () => {
    const N = 6000
    const count: Record<LaunchOutcome, number> = { success: 0, wobble: 0, breakup: 0, explosion: 0 }
    let stow = 0
    for (let id = 1; id <= N; id++) {
      count[rollOutcome(99, id, 0.44)]++
      if (rollStowaway(99, id)) stow++
    }
    expect(count.success / N).toBeCloseTo(0.44, 1)
    const fails = N - count.success
    expect(count.wobble / fails).toBeCloseTo(0.45, 1)
    expect(count.breakup / fails).toBeCloseTo(0.35, 1)
    expect(count.explosion / fails).toBeCloseTo(0.2, 1)
    expect(stow / N).toBeGreaterThan(0.09)
    expect(stow / N).toBeLessThan(0.15)
    const d = outcomeDraw(99, 1)
    expect(d.u).toBeGreaterThanOrEqual(0)
    expect(d.u).toBeLessThan(1)
  })

  it('forced outcomes apply to the next launch only; null clears', () => {
    const { sim, clock } = make()
    sim.forceNextOutcome('explosion', true)
    until(clock, () => sim.state.history.length === 1, 600)
    expect(sim.state.history[0]).toMatchObject({ outcome: 'explosion', stowaway: true })
    sim.forceNextOutcome('success')
    sim.forceNextOutcome(null)
    until(clock, () => sim.state.history.length === 2, 600)
    expect(sim.state.history[1].outcome).toBe(rollOutcome(DEFAULT_SEED, 2, sim.state.model.successChance))
  })

  it('a forced stowaway applies immediately if the rocket is already on the pad', () => {
    const { sim, clock } = make()
    sim.forceNextOutcome('success', false)
    sim.skipToLaunch()
    until(clock, () => sim.state.rocket.phase === 'countdown')
    sim.forceNextOutcome('wobble', true)
    expect(sim.state.rocket.stowaway).toBe(true)
  })

  it('history is bounded', () => {
    const { sim } = make()
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) sim.skipToPhase('assembling')
    expect(sim.state.history).toHaveLength(HISTORY_LIMIT)
    expect(sim.state.history[HISTORY_LIMIT - 1].rocketId).toBe(HISTORY_LIMIT + 5)
    expect(sim.state.rocket.id).toBe(HISTORY_LIMIT + 6)
  })
})

describe('debug controls', () => {
  it('skipToLaunch finishes assembly now (with stage events) and starts rollout', () => {
    const { sim, log } = make()
    const done = sim.state.rocket.stagesComplete
    sim.skipToLaunch()
    expect(sim.state.rocket.phase).toBe('rollout')
    expect(sim.state.rocket.stagesComplete).toBe(6)
    expect(log.filter((e) => e.name === 'rocket:stage')).toHaveLength(6 - done)
    expect(log.map((e) => e.name).slice(-2)).toEqual(['rocket:complete', 'rocket:rollout'])
    sim.skipToLaunch() // no-op outside assembling
    expect(sim.state.rocket.phase).toBe('rollout')
  })

  it('skipToPhase walks the timeline in order', () => {
    const { sim, log } = make()
    sim.forceNextOutcome('breakup')
    sim.skipToPhase('flight')
    expect(sim.state.rocket.phase).toBe('flight')
    expect(sim.state.rocket.outcome).toBe('breakup')
    expect(log.filter((e) => e.name === 'rocket:countdown')).toHaveLength(10)
    sim.skipToPhase('assembling')
    expect(sim.state.rocket.id).toBe(2)
    expect(sim.state.counters.disassemblies).toBe(42)
  })

  it('skipToStage jumps the silhouette forward', () => {
    const { sim, clock } = make({ headStartSeconds: 0 })
    expect(sim.state.rocket.stagesComplete).toBe(0)
    sim.skipToStage(4, 0.5)
    expect(sim.state.rocket.stagesComplete).toBe(4)
    expect(sim.state.rocket.stageProgress).toBeCloseTo(0.5, 2)
    expect(sim.state.rocket.phase).toBe('assembling')
    clock.advance(1)
    expect(sim.state.rocket.stageProgress).toBeGreaterThanOrEqual(0.5) // never goes backwards
  })

  it('ignores invalid debug input instead of corrupting the launch', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { sim, clock, log } = make()
      const before = { id: sim.state.rocket.id, phase: sim.state.rocket.phase, events: log.length }
      sim.skipToPhase('nope' as RocketPhase)
      expect({ id: sim.state.rocket.id, phase: sim.state.rocket.phase, events: log.length }).toEqual(before)
      sim.forceNextOutcome('explosion')
      sim.forceNextOutcome('kaboom' as LaunchOutcome, true) // ignored: the previous force stays
      sim.skipToLaunch()
      until(clock, () => sim.state.history.length === 1, 120)
      expect(sim.state.history[0]).toMatchObject({ outcome: 'explosion' })
      expect(warn).toHaveBeenCalledTimes(2)
    } finally {
      warn.mockRestore()
    }
  })

  it('skipToPhase reaches a later phase of the NEXT rocket too', () => {
    const { sim } = make()
    sim.skipToPhase('flight')
    sim.skipToPhase('rollout')
    expect(sim.state.rocket.id).toBe(2)
    expect(sim.state.rocket.phase).toBe('rollout')
  })

  it('reset() starts a fresh rocket and keeps counters; reset(true) restores the opening state', () => {
    const { sim, clock, log } = make()
    sim.forceNextOutcome('explosion')
    sim.skipToPhase('aftermath')
    sim.setParams({ pressesToTanks: 3 })
    expect(sim.state.counters.disassemblies).toBe(42)
    sim.reset()
    expect(sim.state.rocket).toMatchObject({ id: 2, phase: 'assembling', stagesComplete: 0, outcome: null, transport: 0 })
    expect(sim.state.counters.disassemblies).toBe(42)
    expect(sim.state.params.pressesToTanks).toBe(3)
    expect(log.filter((e) => e.name === 'rocket:reset').length).toBeGreaterThanOrEqual(1)
    clock.advance(10)
    sim.reset(true)
    expect(sim.state.rocket.id).toBe(1)
    expect(sim.state.rocket.stagesComplete).toBeGreaterThanOrEqual(1)
    expect(sim.state.history).toEqual([])
    expect(sim.state.params).toEqual(DEFAULT_PARAMS)
    expect(sim.state.counters).toEqual({ successes: 3, disassemblies: 41, lastDisassemblyT: clock.t - 840 })
  })
})

describe('production lines', () => {
  it('belt items stay sorted, in range and spaced; deliveries never exceed requirements', () => {
    const { sim, clock } = make()
    const problems: string[] = []
    let maxItems = 0
    for (let k = 0; k < 400; k++) {
      clock.advance(0.5)
      for (const id of LINE_IDS) {
        const l = sim.state.lines[id]
        maxItems = Math.max(maxItems, l.items.length)
        for (let i = 0; i < l.items.length; i++) {
          const x = l.items[i]
          if (!(x >= 0 && x <= 1)) problems.push(`${id} item ${i} at ${x}`)
          if (i > 0 && l.items[i - 1] - x < WORLD.itemGap[id] - 1e-6) problems.push(`${id} gap ${i} @${k}`)
        }
        if (l.delivered > l.required) problems.push(`${id} over-delivered`)
        if (!(l.phase >= 0 && l.phase < 1)) problems.push(`${id} phase ${l.phase}`)
        if (!Number.isFinite(l.rate)) problems.push(`${id} rate ${l.rate}`)
      }
    }
    expect(problems.slice(0, 5)).toEqual([])
    expect(maxItems).toBeLessThanOrEqual(WORLD.maxItems)
  })

  it('slow lines visibly bottleneck: at default settings tanks hold up the tower and others back up', () => {
    const { sim, clock, transitions } = make()
    const blocked = new Set<LineId>()
    const stageTimes: number[] = []
    let lastStages = sim.state.rocket.stagesComplete
    until(
      clock,
      () => {
        for (const id of LINE_IDS) if (sim.state.lines[id].status === 'blocked') blocked.add(id)
        const r = sim.state.rocket
        if (r.id === 2 && r.stagesComplete !== lastStages && r.stagesComplete > 0) stageTimes.push(clock.t)
        lastStages = r.stagesComplete
        return r.id === 3
      },
      1200,
    )
    expect(blocked.has('tank')).toBe(false)
    expect(blocked.size).toBeGreaterThanOrEqual(3)
    // The tanks stage (index 1) takes far longer than any other stage.
    const start = startOf(transitions, 2, 'assembling')
    const durations = stageTimes.map((t, i) => t - (i === 0 ? start : stageTimes[i - 1]))
    expect(durations).toHaveLength(6)
    const tanksStage = durations[1]
    for (let i = 0; i < durations.length; i++) if (i !== 1) expect(tanksStage).toBeGreaterThan(durations[i] * 2)
  })

  it('a balanced line runs without backing up', () => {
    const { sim, clock } = make()
    sim.setParams({ conveyorSpeed: 1.4, inspection: 0.75, pressesToTanks: 3 })
    until(clock, () => sim.state.rocket.id === 3, 1200)
    let blockedSamples = 0
    for (let k = 0; k < 340; k++) {
      clock.advance(0.5)
      for (const id of LINE_IDS) if (sim.state.lines[id].status === 'blocked') blockedSamples++
    }
    expect(blockedSamples).toBe(0)
  })

  it('console settings drive the visible lines (rates & belt speed)', () => {
    const { sim, clock } = make()
    const base = sim.nominalRates()
    sim.setParams({ conveyorSpeed: 2 })
    clock.advance(0.2)
    // Smoothed: belts speed up gradually instead of jumping...
    expect(sim.nominalRates().smelt.belt).toBeGreaterThan(base.smelt.belt)
    expect(sim.nominalRates().smelt.belt).toBeLessThan(base.smelt.belt * 2 - 1e-3)
    clock.advance(8)
    const fast = sim.nominalRates()
    for (const id of LINE_IDS) {
      expect(fast[id].belt).toBeCloseTo(base[id].belt * 2, 4) // honest belt speed
      expect(fast[id].rate).toBeGreaterThan(base[id].rate) // more parts per minute
    }
    sim.setParams({ conveyorSpeed: 1, pressesToTanks: 4 })
    clock.advance(8)
    const shifted = sim.nominalRates()
    expect(shifted.tank.rate).toBeGreaterThan(base.tank.rate) // more presses on tank shells
    expect(shifted.smelt.rate).toBeLessThan(base.smelt.rate) // fewer left for fins/panels
    for (const id of LINE_IDS) expect(shifted[id].belt).toBeCloseTo(base[id].belt, 4)
  })

  it('QC defect flashes follow speed × inspection (deterministic)', () => {
    const flashes = (p: Partial<OptimizationParams>, seed = 5) => {
      const { sim, clock } = make({ seed })
      sim.setParams(p)
      let n = 0
      const prev: Record<string, number> = {}
      for (let k = 0; k < 3000; k++) {
        clock.advance(0.1)
        for (const id of LINE_IDS) {
          const f = sim.state.lines[id].defectFlash
          if (f > (prev[id] ?? 0)) n++
          prev[id] = f
        }
      }
      return n
    }
    const low = flashes({ conveyorSpeed: 1, inspection: 0 })
    const high = flashes({ conveyorSpeed: 2, inspection: 1, pressesToTanks: 3 })
    expect(low).toBe(0)
    expect(high).toBeGreaterThan(40)
    expect(flashes({ conveyorSpeed: 2, inspection: 1, pressesToTanks: 3 })).toBe(high)
  })

  it('huge frame deltas (high time scale) are subdivided safely', () => {
    const { sim, clock } = make()
    clock.timeScale = 50
    for (let k = 0; k < 300; k++) clock.step(0.1)
    const s = sim.snapshot()
    expect(s.rocket.id).toBeGreaterThan(3)
    for (const id of LINE_IDS) {
      for (const x of s.lines[id].items) expect(Number.isFinite(x)).toBe(true)
      expect(Number.isFinite(s.lines[id].phase)).toBe(true)
    }
  })

  it('two sims with the same seed and inputs stay identical', () => {
    const a = make({ seed: 31 })
    const b = make({ seed: 31 })
    for (const env of [a, b]) {
      env.clock.advance(40)
      env.sim.setParams({ conveyorSpeed: 1.7, inspection: 0.4 })
      env.clock.advance(300)
    }
    expect(b.sim.snapshot()).toEqual(a.sim.snapshot())
  })
})

describe('notifications', () => {
  it('are low-frequency: a whole launch cycle notifies a few dozen times, never per tick', () => {
    const { sim, clock } = make()
    until(clock, () => sim.state.rocket.id === 2, 600)
    let n = 0
    const off = sim.subscribe(() => n++)
    const v0 = sim.version
    const ticks = Math.round(until(clock, () => sim.state.rocket.id === 3, 600) * 30)
    off()
    expect(n).toBe(sim.version - v0)
    expect(n).toBeGreaterThan(20) // phases + stages + countdown seconds + outcome
    expect(n).toBeLessThan(80)
    expect(ticks).toBeGreaterThan(5000)
  })

  it('stay quiet while nothing low-frequency changes (mid-flight)', () => {
    const { sim, clock } = make()
    sim.forceNextOutcome('success')
    sim.skipToPhase('flight')
    clock.advance(OUTCOME_REVEAL_AT.success + 0.5)
    let n = 0
    const off = sim.subscribe(() => n++)
    clock.advance(PHASE_SECONDS.flight - OUTCOME_REVEAL_AT.success - 1)
    off()
    expect(n).toBe(0)
  })
})
