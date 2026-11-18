import { describe, expect, it, vi } from 'vitest'
import { SimClock } from '@/core/clock'
import type { GameEventName, GameEvents } from '@/core/events'
import type { PlayerMode, Vec3 } from '@/core/types'
import { Director } from '@/systems/director'
import { getCheckpoint } from '@/world/layout'
import { HATCHES, OSHA, OSHA_TEXT } from './config'
import { NightShiftFsm } from './nightShift'
import { OshaFsm, type OshaDeps, type OshaState } from './oshaFsm'
import { ZONE_TRIGGER_POINTS, zoneAtPoint } from './zones'

interface Logged {
  name: GameEventName
  payload: GameEvents[GameEventName]
  t: number
}

const STEP = 1 / 60
const INTAKE = getCheckpoint('intake').position

/** Microtask flush (tackle promises settle asynchronously). */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

function setup(opts: { service?: boolean; tackleSeconds?: number; deps?: Partial<OshaDeps> } = {}) {
  const clock = new SimClock()
  const director = new Director(() => clock.t)
  const log: Logged[] = []
  const player = { x: INTAKE[0], z: INTAKE[1], mode: 'foot' as PlayerMode }
  const camera = { x: 0, z: 40, yaw: 0 }
  let overlay = false
  const states: Array<{ s: OshaState; t: number }> = []
  // Fake player service: the tackle tumbles for `tackleSeconds` of sim time, then
  // respawns the worker at Visitor Intake (like the real player module) and resolves.
  const tackleSeconds = opts.tackleSeconds ?? 2.3
  let pending: { at: number; resolve: () => void } | null = null
  const tackle = vi.fn((from: Vec3) => {
    void from
    player.mode = 'tackled'
    return new Promise<void>((resolve) => {
      pending = { at: clock.t + tackleSeconds, resolve }
    })
  })
  const service = { tackle }
  clock.onTick(() => {
    if (pending && clock.t >= pending.at) {
      const p = pending
      pending = null
      player.x = INTAKE[0]
      player.z = INTAKE[1]
      player.mode = 'foot'
      p.resolve()
    }
  })
  const fsm = new OshaFsm({
    now: () => clock.t,
    emit: (name, payload) => log.push({ name, payload: payload as GameEvents[GameEventName], t: clock.t }),
    director,
    player: () => ({ ...player }),
    playerService: () => (opts.service === false ? undefined : service),
    camera: () => camera,
    overlayOpen: () => overlay,
    ...opts.deps,
  })
  clock.onTick((dt) => {
    fsm.tick(dt)
    if (states[states.length - 1]?.s !== fsm.state) states.push({ s: fsm.state, t: clock.t })
  })
  /** Advance sim time in frames, flushing promise callbacks between frames. */
  async function run(seconds: number, each?: () => void): Promise<void> {
    const n = Math.round(seconds / STEP)
    for (let i = 0; i < n; i++) {
      each?.()
      clock.advance(STEP, STEP)
      await flush()
    }
  }
  async function runUntil(pred: () => boolean, maxSeconds = 30): Promise<number> {
    const t0 = clock.t
    while (!pred()) {
      if (clock.t - t0 > maxSeconds) throw new Error(`condition not met within ${maxSeconds}s (state ${fsm.state})`)
      clock.advance(STEP, STEP)
      await flush()
    }
    return clock.t - t0
  }
  const enter = (zoneId: string) => {
    const p = ZONE_TRIGGER_POINTS[zoneId]
    player.x = p.x
    player.z = p.z
  }
  const names = () => log.map((l) => l.name)
  const first = (name: GameEventName, pred: (p: GameEvents[GameEventName]) => boolean = () => true) => log.find((l) => l.name === name && pred(l.payload))
  const count = (name: GameEventName) => log.filter((l) => l.name === name).length
  return {
    clock,
    director,
    log,
    player,
    camera,
    fsm,
    tackle,
    states,
    run,
    runUntil,
    enter,
    names,
    first,
    count,
    setOverlay: (v: boolean) => (overlay = v),
  }
}

describe('OSHA FSM: entry → whistle → tackle → cooldown', () => {
  it('tackles within the deadline, respawns the visitor and reaches cooldown in < 4 s', async () => {
    const h = setup()
    await h.run(1)
    expect(h.fsm.state).toBe('patrol')
    h.enter('transformer-yard')
    await h.runUntil(() => h.fsm.state === 'alert', 1)
    const whistle = h.first('osha:whistle')
    expect(whistle).toBeTruthy()
    expect((whistle!.payload as GameEvents['osha:whistle']).zoneId).toBe('transformer-yard')
    const caption = h.log.find((l) => l.name === 'caption' && (l.payload as GameEvents['caption']).text === OSHA_TEXT.alertCaption)
    expect((caption?.payload as GameEvents['caption'])?.kind).toBe('sound')

    await h.runUntil(() => h.tackle.mock.calls.length > 0, 2)
    const contact = h.clock.t
    expect(contact - whistle!.t).toBeLessThanOrEqual(OSHA.contactDeadline + STEP + 1e-6)
    // the tackle comes from the inspector, right next to the visitor
    const from = h.tackle.mock.calls[0][0]
    expect(from.every(Number.isFinite)).toBe(true)
    const tp = ZONE_TRIGGER_POINTS['transformer-yard']
    expect(Math.hypot(from[0] - tp.x, from[2] - tp.z)).toBeLessThan(1.3)
    expect(h.first('osha:tackle')).toBeTruthy()

    await h.runUntil(() => h.fsm.state === 'cooldown', 5)
    const total = h.clock.t - whistle!.t
    expect(total).toBeLessThan(4)
    expect(h.player.x).toBe(INTAKE[0])
    expect(h.player.z).toBe(INTAKE[1])
    expect(h.log.some((l) => l.name === 'toast' && (l.payload as GameEvents['toast']).text === OSHA_TEXT.tackleToast)).toBe(true)
    expect(h.log.some((l) => l.name === 'achievement' && (l.payload as GameEvents['achievement']).id === 'tackled')).toBe(true)
    // the exclusive director lock is released once the visitor is back
    expect(h.director.exclusiveActive()).toBeNull()
    expect(h.fsm.cooldownRemaining()).toBeGreaterThan(15)
    // state order
    expect(h.states.map((s) => s.s)).toEqual(['patrol', 'alert', 'tackling', 'cooldown'])
  })

  it('never loops: nothing else happens while the visitor stays at the respawn point', async () => {
    const h = setup()
    h.enter('wet-paint')
    await h.runUntil(() => h.fsm.state === 'cooldown', 6)
    const before = h.log.length
    await h.run(60)
    expect(h.tackle).toHaveBeenCalledTimes(1)
    expect(h.log.slice(before).filter((l) => l.name.startsWith('osha:'))).toEqual([])
    expect(h.fsm.state).toBe('patrol')
  })

  it('the inspector writes a citation, then walks back to his patrol', async () => {
    const h = setup()
    h.enter('transformer-yard')
    await h.runUntil(() => h.fsm.state === 'cooldown', 6)
    const anims = new Set<string>()
    await h.run(3, () => anims.add(h.fsm.actor.anim))
    expect(anims.has('work')).toBe(true)
    const later = new Set<string>()
    await h.run(8, () => later.add(h.fsm.actor.anim))
    expect(later.has('walk')).toBe(true)
    expect(['path', 'route', 'stop']).toContain(h.fsm.brain.mode)
    // he is out of the zone again
    expect(zoneAtPoint(h.fsm.actor.x, h.fsm.actor.z)).toBeNull()
  })
})

describe('OSHA FSM: cooldown, warnings and aborts', () => {
  it('re-entry during the cooldown earns a warning only (no second tackle)', async () => {
    const h = setup()
    h.enter('blast-zone')
    await h.runUntil(() => h.fsm.state === 'cooldown', 6)
    await h.run(4)
    const whistles = h.count('osha:whistle')
    h.enter('blast-zone')
    await h.runUntil(() => h.fsm.state === 'warning', 1)
    expect(h.count('osha:warning')).toBe(1)
    expect(h.count('osha:whistle')).toBe(whistles)
    expect(h.log.some((l) => l.name === 'sfx' && (l.payload as GameEvents['sfx']).name === 'whistle')).toBe(true)
    expect(h.log.some((l) => l.name === 'caption' && (l.payload as GameEvents['caption']).text === OSHA_TEXT.warnings[0])).toBe(true)
    expect(h.log.some((l) => l.name === 'toast' && (l.payload as GameEvents['toast']).kind === 'warning')).toBe(true)
    await h.run(OSHA.warningHold + 0.2)
    expect(h.fsm.state).toBe('cooldown')
    expect(h.tackle).toHaveBeenCalledTimes(1)
  })

  it('warnings are rate limited while the visitor lingers, then the deferred tackle happens', async () => {
    const h = setup()
    h.enter('wet-paint')
    await h.runUntil(() => h.fsm.state === 'cooldown', 6)
    h.enter('wet-paint')
    await h.run(8)
    // 8 s inside: an entry warning + at most one repeat
    expect(h.count('osha:warning')).toBeGreaterThanOrEqual(1)
    expect(h.count('osha:warning')).toBeLessThanOrEqual(2)
    // stay until the cooldown runs out: the inspector comes for real
    await h.runUntil(() => h.tackle.mock.calls.length === 2, 25)
    expect(h.count('osha:whistle')).toBe(2)
  })

  it('leaving the zone before contact aborts ("I saw that."), no tackle', async () => {
    const h = setup()
    h.enter('blast-zone')
    await h.runUntil(() => h.fsm.state === 'alert', 1)
    await h.run(0.15)
    // step back out through the gap
    h.player.x = 16
    h.player.z = -22
    await h.runUntil(() => h.fsm.state === 'aborted', 0.5)
    expect(h.tackle).not.toHaveBeenCalled()
    expect(h.log.some((l) => l.name === 'caption' && (l.payload as GameEvents['caption']).text === OSHA_TEXT.abortCaption)).toBe(true)
    expect(h.director.exclusiveActive()).toBeNull()
    const anims = new Set<string>()
    await h.run(OSHA.abortHold + 0.3, () => anims.add(h.fsm.actor.anim))
    expect(anims.has('point')).toBe(true)
    expect(h.fsm.state).toBe('patrol')
    // a quick re-entry is deferred (director cooldown): warning, not a chase
    h.enter('blast-zone')
    await h.run(0.5)
    expect(h.count('osha:whistle')).toBe(1)
    expect(h.count('osha:warning')).toBe(1)
  })

  it('contact stays within the deadline even when the visitor runs away inside the zone', async () => {
    const h = setup()
    // enter on the south edge of the blast zone, then sprint north (away from the gap hatches)
    h.player.x = 16
    h.player.z = -27
    await h.runUntil(() => h.fsm.state === 'alert', 1)
    const t0 = h.clock.t
    await h.runUntil(
      () => {
        if (h.tackle.mock.calls.length) return true
        h.player.z -= 7.2 * STEP
        return false
      },
      2,
    )
    expect(h.clock.t - t0).toBeLessThanOrEqual(OSHA.contactDeadline + STEP * 2)
    expect(zoneAtPoint(h.player.x, h.player.z)?.id).toBe('blast-zone')
  })

  it('pops out of an on-screen hatch serving the zone, and the lid closes again', async () => {
    const h = setup()
    // camera behind the visitor, looking east into the transformer yard
    h.camera.x = 10
    h.camera.z = -4.5
    h.camera.yaw = -Math.PI / 2
    h.enter('transformer-yard')
    await h.runUntil(() => h.fsm.state === 'alert', 1)
    const a = h.fsm.actor
    const idx = HATCHES.findIndex((hh) => Math.hypot(hh.position[0] - a.x, hh.position[1] - a.z) < 1e-6)
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(HATCHES[idx].zone).toBe('transformer-yard')
    expect(a.rise).toBeLessThan(1)
    await h.run(0.1)
    expect(h.fsm.hatchOpen(idx)).toBeGreaterThan(0.5)
    await h.run(3)
    expect(h.fsm.hatchOpen(idx)).toBe(0)
    expect(h.log.filter((l) => l.name === 'sfx' && (l.payload as GameEvents['sfx']).name === 'machine-clank').length).toBe(2)
  })

  it('a nearby patrolling inspector chases directly (no hatch)', async () => {
    const h = setup()
    await h.run(0.5)
    // put the visitor in the transformer yard while the inspector stands at his viewing spot
    const a = h.fsm.actor
    a.x = 12.4
    a.z = -5
    h.enter('transformer-yard')
    await h.runUntil(() => h.fsm.state === 'alert', 1)
    expect(a.rise).toBe(1)
    expect(h.log.some((l) => l.name === 'sfx' && (l.payload as GameEvents['sfx']).name === 'machine-clank')).toBe(false)
  })
})

describe('OSHA FSM: exclusivity and graceful degradation', () => {
  it('night shift active → warning (deferred), never stuck; tackles once the lights are back', async () => {
    const h = setup()
    const lighting = { level: 1, emergency: 0 }
    const night = new NightShiftFsm({
      now: () => h.clock.t,
      emit: () => {},
      director: h.director,
      lighting,
      setNightShift: () => {},
      reducedMotion: () => false,
    })
    h.clock.onTick(() => night.tick())
    expect(night.start()).toBe(true)
    await h.run(1)
    h.enter('transformer-yard')
    await h.run(5)
    expect(h.count('osha:whistle')).toBe(0)
    expect(h.count('osha:warning')).toBeGreaterThanOrEqual(1)
    expect(['patrol', 'warning']).toContain(h.fsm.state)
    await h.runUntil(() => night.phase === 'cooldown', 20)
    await h.runUntil(() => h.tackle.mock.calls.length === 1, 10)
    expect(h.count('osha:whistle')).toBe(1)
    expect(lighting).toEqual({ level: 1, emergency: 0 })
  })

  it('missing player service → warnings only', async () => {
    const h = setup({ service: false })
    h.enter('wet-paint')
    await h.run(10)
    expect(h.count('osha:whistle')).toBe(0)
    expect(h.count('osha:warning')).toBe(2)
    expect(h.fsm.state === 'patrol' || h.fsm.state === 'warning').toBe(true)
  })

  it('ignores visitors reading a panel, travelling or already tackled', async () => {
    const h = setup()
    h.setOverlay(true)
    h.enter('wet-paint')
    await h.run(2)
    expect(h.names().filter((n) => n.startsWith('osha:'))).toEqual([])
    h.setOverlay(false)
    h.player.mode = 'travel'
    await h.run(2)
    h.player.mode = 'tackled'
    await h.run(2)
    expect(h.names().filter((n) => n.startsWith('osha:'))).toEqual([])
  })

  it('aborts quietly when a panel opens mid-chase', async () => {
    const h = setup()
    h.enter('wet-paint')
    await h.runUntil(() => h.fsm.state === 'alert', 1)
    h.setOverlay(true)
    await h.run(0.1)
    expect(h.fsm.state).toBe('aborted')
    expect(h.tackle).not.toHaveBeenCalled()
    expect(h.director.exclusiveActive()).toBeNull()
  })

  it('forklift in a restricted zone → its own warning toast, no chase', async () => {
    const h = setup()
    const fork = { x: 16, z: -30 }
    const h2 = setup({ deps: { forklift: () => fork } })
    h2.player.mode = 'forklift'
    h2.player.x = 16
    h2.player.z = -30
    await h2.run(20)
    const toasts = h2.log.filter((l) => l.name === 'toast')
    expect(toasts.length).toBe(2) // t≈0 and t≈15 (15 s cooldown)
    expect((toasts[0].payload as GameEvents['toast']).text).toBe("Inspector: That's a forklift. In a blast zone. I'm not even mad.")
    expect(h2.count('osha:whistle')).toBe(0)
    expect(h2.tackle).not.toHaveBeenCalled()
    void h
  })

  it('a tackle promise that never settles cannot wedge the FSM', async () => {
    const h = setup({ tackleSeconds: 1e9 })
    h.enter('wet-paint')
    await h.runUntil(() => h.tackle.mock.calls.length === 1, 2)
    await h.runUntil(() => h.fsm.state === 'cooldown', OSHA.tackleFailsafe + 1)
    expect(h.director.exclusiveActive()).toBeNull()
  })

  it('survives NaN player positions and a throwing service', async () => {
    const h = setup({
      deps: {
        player: () => ({ x: NaN, z: NaN, mode: 'foot' }),
      },
    })
    await h.run(2)
    expect(Number.isFinite(h.fsm.actor.x)).toBe(true)
    const h2 = setup({
      deps: {
        playerService: () => ({
          tackle: () => {
            throw new Error('boom')
          },
        }),
      },
    })
    h2.enter('wet-paint')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await h2.runUntil(() => h2.fsm.state === 'cooldown', 3)
    errSpy.mockRestore()
    expect(h2.director.exclusiveActive()).toBeNull()
  })

  it('reset() clears cooldowns so the next entry is tackled again (debug)', async () => {
    const h = setup()
    h.enter('wet-paint')
    await h.runUntil(() => h.fsm.state === 'cooldown', 6)
    h.fsm.reset()
    expect(h.fsm.cooldownRemaining()).toBe(0)
    h.enter('wet-paint')
    await h.runUntil(() => h.tackle.mock.calls.length === 2, 3)
  })

  it('snapshot() reports state, zone, cooldown and inspector position', async () => {
    const h = setup()
    await h.run(0.5)
    const s = h.fsm.snapshot()
    expect(s.state).toBe('patrol')
    expect(s.inspector.every(Number.isFinite)).toBe(true)
    expect(s.cooldownRemaining).toBe(0)
  })
})
