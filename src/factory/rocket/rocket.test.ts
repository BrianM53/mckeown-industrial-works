/**
 * Rocket module: pure choreography, geometry/flight-plan invariants and a
 * full launch cycle of the RocketRuntime driven by the real factory sim
 * (SPEC §12 test 9 from the visual side; test 17 reduced motion).
 */
import * as THREE from 'three'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { events } from '@/core/events'
import { runtime } from '@/core/runtime'
import type { LaunchOutcome } from '@/core/types'
import { DEFAULT_PARAMS, factory, OUTCOME_REVEAL_AT, PHASE_SECONDS, type FactorySimulation, type RocketPhase } from '@/systems/factory'
import { PAD, RESTRICTED_ZONES, TOWER, TRACK } from '@/world/layout'
import { binocularsText, craneState, createCraneState, kioskText, launchEta, launchTime, transportTarget } from './choreo'
import { BLAST_RADIUS, CREW_SAFE_SPOTS, CUSHION, PAD_BEACONS, PAD_MAST, PAD_SLAB_R, PAD_WATER_TOWER, ROCKET_LIMITS, T_END, T_IGNITION, T_LIFTOFF } from './config'
import { buildFlightPlan, evalTrack, type FlightPlan, type PieceTrack } from './flight'
import { buildRocket, STAGE_COUNT } from './rocketBuild'
import { RocketRuntime } from './runtime'
import { formatCount, formatHMS } from './signBoard'
import { TRACK_PATH } from './track'

const sim = factory as unknown as FactorySimulation
const OUTCOMES: LaunchOutcome[] = ['success', 'wobble', 'breakup', 'explosion']
const PHASES: RocketPhase[] = ['rollout', 'pad', 'countdown', 'ignition', 'flight', 'aftermath', 'reset']

/** Minimal no-op 2D context (jsdom has no canvas): drawing calls do nothing. */
function fakeContext2D(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const props: Record<string | symbol, unknown> = {
    canvas,
    measureText: (s: string) => ({ width: String(s).length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createPattern: () => ({}),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  }
  return new Proxy(props, {
    get: (t, k) => (k in t ? t[k] : () => undefined),
    set: (t, k, v) => {
      t[k] = v
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return fakeContext2D(this)
  } as unknown as HTMLCanvasElement['getContext'])
})

describe('choreography', () => {
  it('launch time is continuous and increasing across the launch phases', () => {
    let prevEnd = -Infinity
    for (const phase of PHASES) {
      const start = launchTime({ phase, phaseTime: 0 })
      const end = launchTime({ phase, phaseTime: PHASE_SECONDS[phase as keyof typeof PHASE_SECONDS] })
      if (prevEnd > -Infinity) expect(start).toBeCloseTo(prevEnd, 6)
      expect(end).toBeGreaterThan(start)
      prevEnd = end
    }
    expect(launchTime({ phase: 'countdown', phaseTime: 0 })).toBe(0)
    expect(launchTime({ phase: 'flight', phaseTime: 0 })).toBe(T_LIFTOFF)
    expect(launchTime({ phase: 'assembling', phaseTime: 0 })).toBe(T_END)
    expect(launchTime({ phase: 'rollout', phaseTime: Number.NaN })).toBeLessThan(0)
  })

  it('transporter target: tower → pad during rollout, pad until flight, home again by the end of reset', () => {
    expect(transportTarget('assembling', 50)).toBe(0)
    expect(transportTarget('rollout', 0)).toBeCloseTo(0, 6)
    expect(transportTarget('rollout', PHASE_SECONDS.rollout)).toBeCloseTo(1, 6)
    let prev = -1
    for (let t = 0; t <= PHASE_SECONDS.rollout; t += 0.25) {
      const u = transportTarget('rollout', t)
      expect(u).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = u
    }
    for (const phase of ['pad', 'countdown', 'ignition', 'flight'] as RocketPhase[]) expect(transportTarget(phase, 1)).toBe(1)
    expect(transportTarget('aftermath', 0)).toBeCloseTo(1, 6)
    expect(transportTarget('reset', PHASE_SECONDS.reset)).toBeCloseTo(0, 6)
  })

  it('crane hook stays finite and inside the tower envelope for every stage/progress', () => {
    const model = buildRocket(4242)
    const c = createCraneState()
    for (let k = 0; k < STAGE_COUNT; k++) {
      for (let p = 0; p <= 1.0001; p += 0.02) {
        craneState('assembling', 0, k, p, model.stageInfo, c)
        for (const v of [c.hx, c.hy, c.hz, c.jib, c.trolley]) expect(Number.isFinite(v)).toBe(true)
        expect(c.hy).toBeLessThan(TOWER.height + 4)
        expect(c.hy).toBeGreaterThan(0)
        expect(c.hx).toBeGreaterThan(TOWER.footprint.minX - 0.5)
        expect(c.hx).toBeLessThan(TOWER.footprint.maxX + 0.5)
        expect(c.hz).toBeGreaterThan(TOWER.footprint.minZ - 0.5)
        expect(c.hz).toBeLessThan(TOWER.footprint.maxZ + 0.5)
      }
      // the part ends up seated on the rocket axis
      craneState('assembling', 0, k, 0.95, model.stageInfo, c)
      expect(c.hanging).toBe(k)
      expect(Math.hypot(c.hx - TOWER.center[0], c.hz - TOWER.center[1])).toBeLessThan(0.05)
    }
    model.dispose()
  })

  it('binoculars and kiosk report assembly progress and an ETA that shrinks as work advances', () => {
    const base = { id: 3, seed: 1, phaseDuration: Infinity, countdown: null, transport: 0, outcome: null, stowaway: false }
    const early = { ...base, phase: 'assembling' as const, phaseTime: 10, stagesComplete: 1, stageProgress: 0.2 }
    const late = { ...early, stagesComplete: 5, stageProgress: 0.6 }
    expect(binocularsText(early, DEFAULT_PARAMS)).toMatch(/^Next launch: assembly \d+% — ETA ~\d+ (s|min)$/)
    expect(launchEta(late, DEFAULT_PARAMS)!).toBeLessThan(launchEta(early, DEFAULT_PARAMS)!)
    expect(kioskText(late, DEFAULT_PARAMS)).toContain('stage 6 of 6')
    const flying = { ...early, phase: 'flight' as const }
    expect(launchEta(flying, DEFAULT_PARAMS)).toBeNull()
    expect(binocularsText(flying, DEFAULT_PARAMS).length).toBeGreaterThan(5)
  })

  it('formats the counter board', () => {
    expect(formatHMS(0)).toBe('00:00:00')
    expect(formatHMS(14 * 60)).toBe('00:14:00')
    expect(formatHMS(3725.9)).toBe('01:02:05')
    expect(formatHMS(Number.NaN)).toBe('00:00:00')
    expect(formatHMS(-5)).toBe('00:00:00')
    expect(formatHMS(1e9)).toBe('99:59:59')
    expect(formatCount(7)).toBe('0007')
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe('0000')
  })
})

describe('layout', () => {
  it('track runs from the tower to the pad with a rounded corner', () => {
    const a = { x: 0, z: 0, yaw: 0, tx: 0, tz: 0 }
    TRACK_PATH.sample(0, a)
    expect(a.x).toBeCloseTo(TRACK.points[0][0], 5)
    expect(a.z).toBeCloseTo(TRACK.points[0][1], 5)
    TRACK_PATH.sample(TRACK_PATH.length, a)
    expect(a.x).toBeCloseTo(PAD.center[0], 5)
    expect(a.z).toBeCloseTo(PAD.center[1], 5)
    const straight = 16 + 24
    expect(TRACK_PATH.length).toBeLessThan(straight)
    expect(TRACK_PATH.length).toBeGreaterThan(straight - 2 * TRACK.cornerRadius)
    const proj = { s: 0, lateral: 0, distance: 0 }
    TRACK_PATH.project(16, -25, proj)
    expect(proj.distance).toBeLessThan(0.01)
    TRACK_PATH.sample(proj.s, a)
    expect(a.z).toBeCloseTo(-25, 3)
  })

  it('pad structures stay inside the blast circle; crew safe spots stay outside it', () => {
    const blast = RESTRICTED_ZONES.find((z) => z.id === 'blast-zone')!
    expect(blast.shape.kind).toBe('circle')
    const d = (p: readonly [number, number]) => Math.hypot(p[0] - PAD.center[0], p[1] - PAD.center[1])
    for (const p of [PAD_MAST, PAD_WATER_TOWER, CUSHION, ...PAD_BEACONS]) expect(d(p)).toBeLessThan(BLAST_RADIUS)
    expect(PAD_SLAB_R).toBeLessThan(BLAST_RADIUS)
    for (const p of CREW_SAFE_SPOTS) expect(d(p)).toBeGreaterThan(BLAST_RADIUS + 1.5)
  })
})

describe('rocket geometry', () => {
  it('is deterministic per seed, varied across seeds and within the tower envelope', () => {
    const heights = new Set<number>()
    for (let seed = 1; seed <= 12; seed++) {
      const m = buildRocket(seed * 7919)
      expect(m.stages).toHaveLength(STAGE_COUNT)
      expect(m.height).toBeGreaterThan(10)
      expect(m.height).toBeLessThan(16.5)
      expect(m.maxRadius).toBeLessThanOrEqual(ROCKET_LIMITS.maxRadius + 1e-6)
      expect(m.triangles).toBeLessThan(40000)
      expect(m.chunks.length).toBeGreaterThanOrEqual(4)
      heights.add(Math.round(m.height * 10))
      const again = buildRocket(seed * 7919)
      expect(again.triangles).toBe(m.triangles)
      expect(again.height).toBe(m.height)
      m.dispose()
      again.dispose()
    }
    expect(heights.size).toBeGreaterThan(3)
  })
})

describe('flight plans', () => {
  const restInside = (tr: PieceTrack) => {
    const r = Math.hypot(tr.rest[0] - PAD.center[0], tr.rest[2] - PAD.center[1])
    expect(r).toBeLessThan(BLAST_RADIUS)
    for (const h of tr.hops) expect(Math.hypot(h.b[0] - PAD.center[0], h.b[2] - PAD.center[1])).toBeLessThan(BLAST_RADIUS)
  }

  it('every outcome is deterministic, reveals on the sim schedule and lands debris inside the blast zone', () => {
    const model = buildRocket(9001)
    const input = {
      height: model.height,
      tapedFinPivot: model.tapedFinPivot,
      chunkPivots: model.chunks.map((c) => ({ pivot: c.pivot, radius: c.radius })),
      stowawayAnchor: model.stowawayAnchor,
      debrisCount: 14,
      reduced: false,
      stowaway: true,
    }
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    for (const outcome of OUTCOMES) {
      for (const seed of [1, 77, 4096]) {
        const plan: FlightPlan = buildFlightPlan(seed, outcome, input)
        const again = buildFlightPlan(seed, outcome, input)
        expect(Array.from(again.py)).toEqual(Array.from(plan.py))
        expect(plan.revealAt).toBe(OUTCOME_REVEAL_AT[outcome])
        for (let i = 0; i < plan.n; i++) expect(Number.isFinite(plan.px[i] + plan.py[i] + plan.pz[i] + plan.qw[i])).toBe(true)
        if (outcome === 'success' || outcome === 'wobble') {
          expect(plan.intactUntil).toBe(Infinity)
          // it climbs out of sight by the end of the flight phase
          expect(plan.py[plan.n - 1]).toBeGreaterThan(150)
        } else {
          expect(plan.intactUntil).toBe(plan.revealAt)
        }
        if (outcome === 'wobble') {
          expect(plan.fin).not.toBeNull()
          restInside(plan.fin!)
        }
        if (outcome === 'breakup') {
          expect(plan.chunks.length).toBeGreaterThanOrEqual(4)
          expect(plan.chunks.length).toBeLessThanOrEqual(6)
          plan.chunks.forEach(restInside)
        }
        if (outcome === 'explosion') {
          expect(plan.fireball).not.toBeNull()
          expect(plan.debris.length).toBe(14)
          plan.debris.forEach(restInside)
          restInside(plan.hero!)
        }
        // the stowaway always lands on the cushion
        const st = plan.stowaway!
        evalTrack(st, st.tRest + 0.01, pos, quat)
        expect(Math.hypot(pos.x - CUSHION[0], pos.z - CUSHION[1])).toBeLessThan(1)
      }
    }
    model.dispose()
  })

  it('reduced motion makes a smaller fireball', () => {
    const model = buildRocket(5)
    const base = {
      height: model.height,
      tapedFinPivot: model.tapedFinPivot,
      chunkPivots: model.chunks.map((c) => ({ pivot: c.pivot, radius: c.radius })),
      stowawayAnchor: model.stowawayAnchor,
      debrisCount: 8,
      stowaway: false,
    }
    const full = buildFlightPlan(5, 'explosion', { ...base, reduced: false })
    const soft = buildFlightPlan(5, 'explosion', { ...base, reduced: true })
    expect(soft.fireball!.radius).toBeLessThan(full.fireball!.radius)
    model.dispose()
  })
})

// ---------------------------------------------------------------------------
// Full cycle: the runtime follows the real sim through a whole launch
// ---------------------------------------------------------------------------

describe('RocketRuntime full launch cycle', () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500)
  let rt: RocketRuntime
  let captions: string[]
  let off: (() => void)[]

  beforeEach(() => {
    sim.reset(true)
    camera.position.set(0, 2, 15)
    camera.updateMatrixWorld()
    runtime.player.position.set(0, 0, 30)
    rt = new RocketRuntime()
    rt.mount('medium')
    captions = []
    off = [events.on('caption', (p) => captions.push(p.text))]
  })

  afterEach(() => {
    rt.unmount()
    for (const f of off) f()
    sim.forceNextOutcome(null)
    sim.reset(true)
    runtime.player.position.set(0, 0, 0)
  })

  const finiteMatrix = (m: THREE.Matrix4) => m.elements.every((e) => Number.isFinite(e))

  function step(seconds: number, each?: () => void): void {
    const dt = 1 / 30
    for (let t = 0; t < seconds; t += dt) {
      sim.advance(dt)
      rt.update(camera, dt)
      each?.()
    }
  }

  for (const outcome of OUTCOMES) {
    it(`${outcome}: rolls out, launches, records the outcome, cleans up and starts the next rocket`, () => {
      const firstId = factory.state.rocket.id
      sim.forceNextOutcome(outcome, outcome === 'explosion')
      sim.skipToLaunch()
      let maxDraws = 0
      let maxSmoke = 0
      let sawOnPad = false
      let sawPlan = false
      const counters = { ...factory.state.counters }
      step(PHASE_SECONDS.rollout + PHASE_SECONDS.pad + PHASE_SECONDS.countdown + PHASE_SECONDS.ignition + PHASE_SECONDS.flight + PHASE_SECONDS.aftermath + PHASE_SECONDS.reset + 1.5, () => {
        const r = factory.state.rocket
        expect(finiteMatrix(rt.rocketMatrix)).toBe(true)
        expect(finiteMatrix(rt.transporterMatrix)).toBe(true)
        const s = rt.stats()
        maxDraws = Math.max(maxDraws, s.drawCalls)
        maxSmoke = Math.max(maxSmoke, s.particles.smoke)
        expect(s.particles.smoke).toBeLessThanOrEqual(s.particles.smokeCap)
        expect(s.particles.glow).toBeLessThanOrEqual(s.particles.glowCap)
        for (const c of s.crew) expect(Number.isFinite(c.x + c.z)).toBe(true)
        if (r.phase === 'countdown') {
          // the transporter is parked on the pad before the countdown ends
          expect(Math.abs(s.transporter.u - 1)).toBeLessThan(0.02)
          sawOnPad = true
          // crew run outside the blast zone during the countdown
          if (r.phaseTime > 6) for (const c of s.crew) if (outcome !== 'explosion') expect(Math.hypot(c.x - PAD.center[0], c.z - PAD.center[1])).toBeGreaterThan(BLAST_RADIUS)
        }
        if (r.phase === 'flight' && r.phaseTime > 0.5) {
          expect(s.plan?.outcome).toBe(outcome)
          sawPlan = true
        }
      })
      const r = factory.state.rocket
      expect(sawOnPad).toBe(true)
      expect(sawPlan).toBe(true)
      expect(r.phase).toBe('assembling')
      expect(r.id).toBe(firstId + 1)
      // outcome recorded by the sim (the sign reads these)
      const after = factory.state.counters
      if (outcome === 'success' || outcome === 'wobble') expect(after.successes).toBe(counters.successes + 1)
      else expect(after.disassemblies).toBe(counters.disassemblies + 1)
      // transporter home, rocket stages hidden for the fresh (empty) rocket
      const s = rt.stats()
      expect(s.transporter.u).toBeLessThan(0.01)
      expect(maxDraws).toBeLessThanOrEqual(80)
      expect(maxSmoke).toBeGreaterThan(0)
      // smoke dissipates: nothing (or almost nothing) left of the launch cloud
      step(6)
      expect(rt.stats().particles.smoke).toBeLessThan(maxSmoke * 0.25 + 1)
    })
  }

  it('ignition and liftoff happen on the sim schedule (one ignition per launch)', () => {
    const seen: string[] = []
    const offs = [events.on('rocket:ignition', () => seen.push('ignition')), events.on('rocket:liftoff', () => seen.push('liftoff'))]
    sim.forceNextOutcome('success', false)
    sim.skipToLaunch()
    step(PHASE_SECONDS.rollout + PHASE_SECONDS.pad + PHASE_SECONDS.countdown + 0.2)
    expect(rt.T).toBeGreaterThanOrEqual(T_IGNITION)
    step(PHASE_SECONDS.ignition + 0.5)
    expect(seen).toEqual(['ignition', 'liftoff'])
    offs.forEach((f) => f())
  })

  it('a visitor standing on the track pauses the transporter with a caption, which then catches up', () => {
    sim.forceNextOutcome('success', false)
    sim.skipToLaunch()
    step(3)
    const s0 = rt.stats().transporter.s
    // stand on the straight just ahead of the moving crawler
    const a = { x: 0, z: 0, yaw: 0, tx: 0, tz: 0 }
    TRACK_PATH.sample(s0 + 5, a)
    runtime.player.position.set(a.x, 0, a.z)
    step(1.5)
    const blocked = rt.stats().transporter
    expect(blocked.blocked).toBe(true)
    expect(captions).toContain('Crew: Clear the track!')
    const sBlocked = blocked.s
    step(2)
    expect(rt.stats().transporter.s).toBeCloseTo(sBlocked, 1)
    // step aside: it resumes and still reaches the pad before the countdown ends
    runtime.player.position.set(-20, 0, 30)
    let maxU = 0
    while (factory.state.rocket.phase !== 'ignition') {
      step(0.5)
      maxU = Math.max(maxU, rt.stats().transporter.u)
      if (factory.state.rocket.phase === 'countdown') break
    }
    step(PHASE_SECONDS.countdown - 0.5)
    expect(rt.stats().transporter.u).toBeGreaterThan(0.99)
    expect(rt.stats().transporter.blocked).toBe(false)
  })

  it('follows debug time jumps during rollout instead of crawling after them', () => {
    sim.forceNextOutcome('success', false)
    sim.skipToLaunch()
    step(0.5)
    sim.advance(11)
    rt.update(camera, 0.1)
    const u = rt.stats().transporter.u
    const want = transportTarget('rollout', factory.state.rocket.phaseTime)
    expect(factory.state.rocket.phase).toBe('rollout')
    expect(want).toBeGreaterThan(0.4)
    expect(Math.abs(u - want)).toBeLessThan(0.02)
  })

  it('survives StrictMode-style mount → unmount → mount and big debug time jumps', () => {
    rt.unmount()
    rt.mount('low')
    sim.forceNextOutcome('breakup', true)
    sim.skipToLaunch()
    sim.advance(PHASE_SECONDS.rollout + PHASE_SECONDS.pad + PHASE_SECONDS.countdown + PHASE_SECONDS.ignition + 3.4)
    rt.update(camera, 1 / 30)
    rt.update(camera, 1 / 30)
    expect(factory.state.rocket.phase).toBe('flight')
    expect(rt.stats().plan?.outcome).toBe('breakup')
    expect(finiteMatrix(rt.rocketMatrix)).toBe(true)
    rt.update(camera, Number.NaN)
    rt.update(camera, 5)
    expect(rt.stats().quality).toBe('low')
  })
})
