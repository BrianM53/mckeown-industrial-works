/**
 * Gag scheduling & the NPC state machine (spec §12 test 12): ambient gags respect
 * per-gag cooldowns, director exclusivity, quiet time and visibility; there are no
 * overlapping gags; every actor walks back to (and settles at) a valid station
 * afterwards; aborts restore props; workers yield to the visitor and never block
 * a lane indefinitely. Runs on a fake clock with the real brains, gags and director.
 */
import { describe, expect, it } from 'vitest'
import { createRng } from '@/core/rng'
import type { Vec2 } from '@/core/types'
import { Director } from '@/systems/director'
import { BRAIN, NpcBrain, type BrainEnv } from './brain'
import { GAGS, type GagDef } from './gagDefs'
import { CRATE_REST, NO_FX } from './gagKit'
import { inPlayable, inRect, inWallBand, laneAt, nearRestricted, walkable } from './geo'
import { JACK_A, JACK_B, propFootprints } from './propsData'
import { ROSTER } from './roster'
import { compileNpc, legKey } from './routes'
import { GagScheduler, SCHEDULER, type SchedulerHost } from './scheduler'
import { DialogueRotation } from './world'
import { TOWER } from '@/world/layout'

const DT = 1 / 30
const PROPS = propFootprints()

interface Sim {
  director: Director
  brains: Map<string, NpcBrain>
  scheduler: GagScheduler
  host: SchedulerHost
  env: BrainEnv
  flags: { quiet: boolean; visible: boolean; talking: string | null }
  starts: { id: string; at: number }[]
  ends: { id: string; at: number; aborted: boolean }[]
  now(): number
  step(n?: number): void
}

function makeSim(seed = 7): Sim {
  let now = 0
  const director = new Director(() => now)
  const rand = createRng(seed)
  const brains = new Map(ROSTER.map((d) => [d.id, new NpcBrain(compileNpc(d), rand)]))
  const flags = { quiet: false, visible: true, talking: null as string | null }
  const starts: Sim['starts'] = []
  const ends: Sim['ends'] = []
  const host: SchedulerHost = {
    brain: (id) => brains.get(id),
    talking: (id) => flags.talking === id,
    visible: () => flags.visible,
    quiet: () => flags.quiet,
    player: { x: 0, z: 400 },
    clock: 0,
  }
  const scheduler = new GagScheduler(GAGS, director, () => now, rand, NO_FX, {
    started: (d) => starts.push({ id: d.id, at: now }),
    ended: (d, aborted) => ends.push({ id: d.id, at: now, aborted }),
  })
  const env: BrainEnv = {
    // the visitor is far away (not an obstacle) unless a test moves it
    player: { x: 0, z: 400, active: false },
    forklift: { x: 0, z: 400, active: false },
    talking: false,
    isFree: (x, z) => walkable(x, z, PROPS),
    rand,
  }
  return {
    director,
    brains,
    scheduler,
    host,
    env,
    flags,
    starts,
    ends,
    now: () => now,
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        now += DT
        host.clock = now
        for (const b of brains.values()) {
          env.talking = flags.talking === b.id
          b.update(DT, env)
        }
        scheduler.tick(DT, host)
      }
    },
  }
}

const near = (a: Vec2, x: number, z: number, tol: number) => Math.hypot(a[0] - x, a[1] - z) <= tol

/** Open floor for a walking body: playable, no walls (doors ok), no tower, no NPC props. */
function floorOk(x: number, z: number, r = 0.25): boolean {
  return inPlayable(x, z, r) && !inWallBand(x, z, r) && !inRect(x, z, TOWER.footprint, r) && !PROPS.some((p) => inRect(x, z, p, r))
}

describe('gag scheduler (fake clock)', () => {
  it('respects per-gag cooldowns, runs one gag at a time, and pauses for exclusive events, quiet time and visibility', () => {
    const sim = makeSim(11)
    const windows = {
      exclusive: [600, 700] as const,
      quiet: [900, 1000] as const,
      hidden: [1200, 1300] as const,
    }
    let running: string | null = null
    let overlaps = 0
    let tackled = false
    const total = 2400 // 40 simulated minutes
    for (let t = 0; t < total; t += DT) {
      const now = sim.now()
      if (!tackled && now >= windows.exclusive[0]) {
        tackled = true
        expect(sim.director.request({ id: 'osha:tackle', kind: 'player', cooldown: 0, duration: windows.exclusive[1] - windows.exclusive[0] })).toBe(true)
      }
      sim.flags.quiet = now >= windows.quiet[0] && now < windows.quiet[1]
      sim.flags.visible = !(now >= windows.hidden[0] && now < windows.hidden[1])
      const before = sim.starts.length
      sim.step()
      if (sim.starts.length > before) {
        if (running !== null) overlaps++
        running = sim.starts[sim.starts.length - 1].id
      }
      if (sim.scheduler.running === null) running = null
    }
    expect(overlaps).toBe(0)
    // every gag got its moment
    const ids = new Set(sim.starts.map((s) => s.id))
    for (const g of GAGS) expect(ids.has(g.id), g.id).toBe(true)
    // per-gag cooldowns
    for (const g of GAGS) {
      const at = sim.starts.filter((s) => s.id === g.id).map((s) => s.at)
      for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1], g.id).toBeGreaterThanOrEqual(g.cooldown - 1e-6)
    }
    // breathers between gags, and nothing in the blocked windows
    for (let i = 1; i < sim.starts.length; i++) {
      const prevEnd = sim.ends.find((e) => e.at >= sim.starts[i - 1].at)
      expect(prevEnd, 'previous gag ended').toBeDefined()
      expect(sim.starts[i].at - prevEnd!.at).toBeGreaterThanOrEqual(SCHEDULER.restAfter[0] - 1e-6)
    }
    for (const s of sim.starts) {
      for (const [a, b] of Object.values(windows)) expect(s.at >= a && s.at < b, `${s.id} started at ${s.at.toFixed(1)}`).toBe(false)
    }
    // every start has a matching end (the last one may still be running)
    expect(sim.ends.length).toBeGreaterThanOrEqual(sim.starts.length - 1)
  })

  it('never starts a gag whose actor is talking to the visitor, nor while ambient events are disabled', () => {
    const sim = makeSim(5)
    sim.director.setEnabledPredicate(() => false)
    sim.step(Math.round(300 / DT))
    expect(sim.starts).toEqual([])
    sim.director.setEnabledPredicate(() => true)
    // everyone with a gag role is "in conversation": only actor-less gags may run
    const actorIds = new Set(GAGS.flatMap((g) => g.actors.map((a) => a.npc)))
    sim.host.talking = (id) => actorIds.has(id)
    sim.step(Math.round(600 / DT))
    for (const s of sim.starts) expect(GAGS.find((g) => g.id === s.id)!.actors, s.id).toEqual([])
  })
})

describe('gag scheduler: keeping the visitor out of the choreography', () => {
  it('does not start a gag while the visitor stands where it will happen', () => {
    const standoff = GAGS.find((g) => g.id === 'gag:standoff')!
    const [cx, cz] = standoff.keepClear![0]
    const sim = makeSim(13)
    sim.host.player.x = cx + 0.5
    sim.host.player.z = cz
    sim.step(Math.round(1500 / DT))
    expect(sim.starts.map((s) => s.id)).not.toContain('gag:standoff')
    expect(sim.starts.length).toBeGreaterThan(3)
    // every gag that sweeps through the floor declares its keep-clear zones
    for (const g of GAGS) if (g.actors.length) expect(g.keepClear?.length, g.id).toBeGreaterThan(0)
  })
})

describe('NPC state machine around gags', () => {
  const withActors = GAGS.filter((g) => g.actors.length > 0)

  it.each(withActors.map((g) => [g.id, g] as [string, GagDef]))('%s: actors walk back along walkable ground and settle at their station', (_id, def) => {
    const sim = makeSim(3)
    expect(sim.scheduler.trigger(def.id, sim.host)).toBe(true)
    for (const a of def.actors) expect(sim.brains.get(a.npc)!.inGag, a.npc).toBe(true)
    // the timeline runs to completion
    sim.step(Math.ceil((def.duration + 0.5) / DT))
    expect(sim.scheduler.running).toBeNull()
    expect(sim.ends.at(-1)).toMatchObject({ id: def.id, aborted: false })
    // then each actor walks home: every step stays on walkable ground, never in a restricted zone
    const problems: string[] = []
    for (let i = 0; i < Math.round(60 / DT); i++) {
      sim.step()
      for (const a of def.actors) {
        const b = sim.brains.get(a.npc)!
        if (!Number.isFinite(b.x) || !Number.isFinite(b.z)) problems.push(`${a.npc} non-finite`)
        else if (nearRestricted(b.x, b.z, 0.3)) problems.push(`${a.npc} in a restricted zone at ${b.x.toFixed(2)},${b.z.toFixed(2)}`)
        else if (b.mode === 'return' && !floorOk(b.x, b.z)) problems.push(`${a.npc} off the walkable floor at ${b.x.toFixed(2)},${b.z.toFixed(2)}`)
      }
      if (def.actors.every((a) => sim.brains.get(a.npc)!.mode !== 'return')) break
    }
    expect([...new Set(problems)]).toEqual([])
    for (const a of def.actors) {
      const b = sim.brains.get(a.npc)!
      const st = b.station(a.returnTo)
      // arrived (it may already have moved on along its routine, but never mid-gag or lost)
      expect(b.mode, a.npc).not.toBe('gag')
      expect(b.mode, a.npc).not.toBe('return')
      expect(b.hidden, a.npc).toBe(false)
      expect(b.solid, a.npc).toBe(true)
      if (b.mode === 'stay') {
        expect(b.c.stations.has(b.stationId)).toBe(true)
        if (b.stationId === a.returnTo) expect(near(st.pos, b.x, b.z, 0.15), `${a.npc} at ${b.x},${b.z}`).toBe(true)
      }
    }
    // tints wash off
    sim.step(Math.round(12 / DT))
    for (const a of def.actors) {
      expect(sim.brains.get(a.npc)!.soot, a.npc).toBe(0)
      expect(sim.brains.get(a.npc)!.slime, a.npc).toBe(0)
    }
  })

  it('an aborted gag snaps its actors home and puts every prop back', () => {
    for (const def of GAGS) {
      const sim = makeSim(9)
      expect(sim.scheduler.trigger(def.id, sim.host), def.id).toBe(true)
      sim.step(Math.round((def.duration * 0.5) / DT))
      expect(sim.scheduler.running).toBe(def.id)
      sim.scheduler.abort(sim.host)
      expect(sim.scheduler.running).toBeNull()
      expect(sim.director.isActive(def.id)).toBe(false)
      for (const a of def.actors) {
        const b = sim.brains.get(a.npc)!
        expect(b.isSettledAt(a.returnTo), `${def.id} ${a.npc}`).toBe(true)
        const st = b.station(a.returnTo)
        expect(near(st.pos, b.x, b.z, 1e-6)).toBe(true)
      }
      const P = sim.scheduler.props
      expect(P.napCrate).toMatchObject(CRATE_REST)
      expect(P.conveyorRun).toBe(0)
      expect(P.jackA).toMatchObject({ x: JACK_A.pos[0], z: JACK_A.pos[1], moving: false })
      expect(P.jackB).toMatchObject({ x: JACK_B.pos[0], z: JACK_B.pos[1], moving: false })
      expect(P.printerLength).toBe(0)
      expect(P.kickSputter).toBe(0)
      expect(P.armOverride).toBe(false)
    }
  })

  it('a forced trigger pulls actors out of their routine and still returns them to valid stations', () => {
    const sim = makeSim(21)
    // let everyone wander for a while so actors are mid-leg
    sim.step(Math.round(37 / DT))
    for (const def of GAGS) {
      expect(sim.scheduler.trigger(def.id, sim.host), def.id).toBe(true)
      sim.step(Math.ceil((def.duration + 0.2) / DT))
      sim.step(Math.round(30 / DT))
      for (const b of sim.brains.values()) {
        expect(b.mode === 'gag' && !sim.scheduler.hasActor(b.id), `${b.id} stuck in gag mode`).toBe(false)
        expect(Number.isFinite(b.x) && Number.isFinite(b.z)).toBe(true)
      }
    }
  })
})

describe('NPC routine & yielding', () => {
  /** Put a brain on a leg and return it mid-way along the first long segment. */
  function walker(id: string, from: string, to: string) {
    const sim = makeSim(4)
    const b = sim.brains.get(id)!
    b.snapTo(from)
    b.stayLeft = 0
    sim.step(2)
    expect(b.mode).toBe('move')
    expect(b.destination).toBe(to)
    sim.step(Math.round(0.8 / DT))
    return { sim, b }
  }

  it('pauses for a visitor standing ~1 m ahead, sidesteps after 2 s, never touches them and never waits forever', () => {
    // Dot walks from her desk to the intake arch along the aisle edge
    const { sim, b } = walker('greeter', 'desk', 'arch')
    const [tx, tz] = b.remainingPath()[1]
    const d = Math.hypot(tx - b.x, tz - b.z)
    const dir = { x: (tx - b.x) / d, z: (tz - b.z) / d }
    const P = sim.env.player
    P.active = true
    P.x = b.x + dir.x * 1.0
    P.z = b.z + dir.z * 1.0
    const start = { x: b.x, z: b.z }
    let closest = Infinity
    const stepWatch = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds / DT); i++) {
        sim.step()
        closest = Math.min(closest, Math.hypot(b.x - P.x, b.z - P.z))
      }
    }
    stepWatch(1.5)
    expect(b.speed).toBeLessThan(0.05)
    expect(Math.hypot(b.x - start.x, b.z - start.z)).toBeLessThan(0.25)
    expect(b.stateLabel()).toContain('waiting')
    // the sidestep (at 2 s) moves it off the visitor's line
    stepWatch(2.0)
    const lateral = Math.abs((b.x - start.x) * -dir.z + (b.z - start.z) * dir.x)
    expect(lateral).toBeGreaterThan(0.3)
    // the visitor stays put in the way: the NPC still gets somewhere (around, or back)
    let settled = false
    for (let i = 0; i < Math.round(40 / DT) && !settled; i++) {
      stepWatch(DT)
      settled = b.mode === 'stay'
    }
    expect(settled).toBe(true)
    expect(closest).toBeGreaterThan(0.6)
  })

  it('a worker walled in by a parked forklift backs off, then gives up and snaps to its station', () => {
    const { sim, b } = walker('smelter', 'furnace', 'press')
    const [tx, tz] = b.remainingPath()[1]
    const d = Math.hypot(tx - b.x, tz - b.z)
    // park the forklift right in front, and the visitor right behind: nowhere to go
    sim.env.forklift.active = true
    sim.env.forklift.x = b.x + ((tx - b.x) / d) * 1.5
    sim.env.forklift.z = b.z + ((tz - b.z) / d) * 1.5
    sim.env.player.active = true
    sim.env.player.x = b.x - ((tx - b.x) / d) * 0.7
    sim.env.player.z = b.z - ((tz - b.z) / d) * 0.7
    let settled = false
    for (let i = 0; i < Math.round((BRAIN.reverseAfter + BRAIN.giveUpAfter + 6) / DT) && !settled; i++) {
      sim.step()
      settled = b.mode === 'stay'
    }
    expect(settled).toBe(true)
    expect(['furnace', 'press']).toContain(b.stationId)
    const st = b.station(b.stationId)
    expect(Math.hypot(b.x - st.pos[0], b.z - st.pos[1])).toBeLessThan(0.1)
  })

  it('20 simulated minutes of routines keep every worker on walkable ground and out of restricted zones', () => {
    const sim = makeSim(17)
    const rand = createRng(99)
    // the visitor wanders around the factory (sometimes right next to NPCs)
    sim.env.player.active = true
    const bad: string[] = []
    const lingerInLane = new Map<string, number>()
    for (let i = 0; i < Math.round(1200 / DT); i++) {
      if (i % 90 === 0) {
        const ids = [...sim.brains.keys()]
        const target = sim.brains.get(ids[Math.floor(rand() * ids.length)])!
        sim.env.player.x = target.x + (rand() - 0.5) * 3
        sim.env.player.z = target.z + (rand() - 0.5) * 3
      }
      sim.step()
      for (const b of sim.brains.values()) {
        if (!Number.isFinite(b.x) || !Number.isFinite(b.z)) bad.push(`${b.id} non-finite`)
        if (nearRestricted(b.x, b.z, 0.25)) bad.push(`${b.id} restricted`)
        const onProp = b.mode === 'mount' || b.mode === 'unmount' || b.mode === 'gag' || (b.mode === 'stay' && b.currentStation.onProp)
        if (!onProp && !floorOk(b.x, b.z)) bad.push(`${b.id} ${b.stateLabel()} at ${b.x.toFixed(1)},${b.z.toFixed(1)}`)
        // nobody stands in a lane for long (lane-edge peeks are short stays)
        const lane = laneAt(b.x, b.z, 0.3)
        if (lane && b.speed < 0.05) lingerInLane.set(b.id, (lingerInLane.get(b.id) ?? 0) + DT)
        else lingerInLane.set(b.id, 0)
        if ((lingerInLane.get(b.id) ?? 0) > 25) bad.push(`${b.id} loitering in ${lane}`)
      }
      if (bad.length > 20) break
    }
    expect([...new Set(bad)].slice(0, 10)).toEqual([])
  })

  it('every leg is walked with the carry box only on carry legs', () => {
    for (const d of ROSTER) {
      const c = compileNpc(d)
      for (const leg of d.legs) if (leg.carry) expect(c.carry.has(legKey(leg.from, leg.to)), d.id).toBe(true)
      if (d.legs.some((l) => l.carry)) expect(d.carries, `${d.id} renders a box`).toBe(true)
    }
  })
})

describe('dialogue rotation', () => {
  it('cycles every conversation and never repeats one back-to-back', () => {
    const rot = new DialogueRotation(createRng(42))
    for (const count of [2, 3, 4, 5]) {
      let last = -1
      const seen = new Set<number>()
      for (let i = 0; i < 200; i++) {
        const k = rot.next(`npc${count}`, count)
        expect(k).not.toBe(last)
        expect(k).toBeGreaterThanOrEqual(0)
        expect(k).toBeLessThan(count)
        seen.add(k)
        last = k
      }
      expect(seen.size).toBe(count)
    }
    expect(rot.next('solo', 1)).toBe(0)
  })
})
