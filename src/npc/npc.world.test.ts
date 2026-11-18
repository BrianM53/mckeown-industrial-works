/**
 * NpcWorld integration (no rendering): talking (rotation, nap mumbles, the
 * 'chatty' achievement), reactions to the Night Shift and launches, runtime
 * validation, and StrictMode-safe mount/unmount of the sim-clock/event wiring.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { DIALOGUE, SLEEP_TALK } from '@/content/dialogue'
import { simClock } from '@/core/clock'
import { events } from '@/core/events'
import { runtime } from '@/core/runtime'
import { useUIStore } from '@/state/ui'
import { PAD } from '@/world/layout'
import { rosterFor } from './roster'
import { NpcWorld } from './world'

function makeWorld(seed = 77) {
  const w = new NpcWorld(seed)
  w.setRoster(rosterFor('high'))
  return w
}

afterEach(() => {
  useUIStore.getState().closeDialogue()
  runtime.player.position.x = 0
  runtime.player.position.z = 32
})

describe('NpcWorld talk', () => {
  it('opens the next conversation, never the same one twice in a row', () => {
    const w = makeWorld()
    const b = w.brains.get('greeter')!
    b.snapTo('desk')
    const seen: string[] = []
    for (let i = 0; i < 12; i++) {
      w.talk('greeter')
      const d = useUIStore.getState().dialogue
      expect(d).toMatchObject({ npcId: 'greeter', name: 'Dot', role: 'Visitor Intake' })
      const key = d!.lines.join('|')
      if (seen.length) expect(key).not.toBe(seen[seen.length - 1])
      seen.push(key)
      useUIStore.getState().closeDialogue()
    }
    const all = DIALOGUE.find((e) => e.npcId === 'greeter')!.conversations.map((c) => c.join('|'))
    expect(new Set(seen)).toEqual(new Set(all))
  })

  it('a napping worker only mumbles in their sleep', () => {
    const w = makeWorld()
    w.brains.get('driver')!.snapTo('nap')
    w.talk('driver')
    const lines = useUIStore.getState().dialogue!.lines.join('|')
    expect(SLEEP_TALK.map((c) => c.join('|'))).toContain(lines)
  })

  it("unlocks 'chatty' once, after five different workers", () => {
    const w = makeWorld()
    const got: string[] = []
    const off = events.on('achievement', (p) => got.push(p.id))
    try {
      for (const id of ['greeter', 'greeter', 'smelter', 'qc', 'chief']) w.talk(id)
      expect(got).not.toContain('chatty')
      w.talk('circuit')
      w.talk('dj')
      expect(got.filter((id) => id === 'chatty')).toHaveLength(1)
    } finally {
      off()
    }
  })

  it('cannot talk to a worker in the middle of a gag', () => {
    const w = makeWorld()
    expect(w.triggerGag('robot-arm')).toBe(true)
    expect(w.canTalk('chief')).toBe(false)
    w.talk('chief')
    expect(useUIStore.getState().dialogue).toBeNull()
    w.abortGags()
    expect(w.canTalk('chief')).toBe(true)
  })
})

describe('NpcWorld reactions', () => {
  it('night shift: panic first, then flashlights until the lights return', () => {
    const w = makeWorld()
    w.startNightShift()
    const awake = [...w.brains.values()].filter((b) => !b.napping)
    expect(awake.every((b) => b.flashlight)).toBe(true)
    expect(awake.some((b) => b.reactionKind === 'panic')).toBe(true)
    for (let i = 0; i < 150; i++) w.tick(1 / 30) // 5 s
    expect(awake.every((b) => b.reactionKind !== 'panic')).toBe(true)
    expect(awake.every((b) => b.flashlight && b.stateLabel() === 'flashlight')).toBe(true)
    w.endNightShift()
    expect([...w.brains.values()].some((b) => b.flashlight)).toBe(false)
  })

  it('night shift ends a running gag and sends its actors home first', () => {
    const w = makeWorld()
    expect(w.triggerGag('robot-arm')).toBe(true)
    for (let i = 0; i < 60; i++) w.tick(1 / 30)
    w.startNightShift()
    expect(w.scheduler.running).toBeNull()
    const chief = w.brains.get('chief')!
    expect(chief.mode).toBe('stay')
    expect(chief.stationId).toBe('arm')
    expect(chief.flashlight).toBe(true)
    w.endNightShift()
  })

  it('launch: workers near the pad turn to watch at T-3, then cheer or despair', () => {
    const w = makeWorld()
    w.onCountdown(5, 7)
    expect([...w.brains.values()].some((b) => b.reactionKind === 'watch')).toBe(false)
    w.onCountdown(5, 3)
    for (const b of w.brains.values()) {
      const near = Math.hypot(b.x - PAD.center[0], b.z - PAD.center[1]) <= 45
      if (!near) expect(b.reactionKind, b.id).toBeNull()
    }
    const watchers = [...w.brains.values()].filter((b) => b.reactionKind === 'watch')
    expect(watchers.length).toBeGreaterThan(0)
    w.onOutcome('success')
    for (const b of watchers) expect(b.reactionKind).toBe('cheer')
    w.onRocketReset()
    w.onCountdown(6, 2)
    const again = [...w.brains.values()].filter((b) => b.reactionKind === 'watch')
    w.onOutcome('explosion')
    for (const b of again) expect(b.reactionKind).toBe('panic')
    for (let i = 0; i < 30 * 4; i++) w.tick(1 / 30)
    for (const b of again) expect(['dismay', null]).toContain(b.reactionKind)
  })
})

describe('NpcWorld lifecycle & validation', () => {
  it('mount/unmount is StrictMode-safe (no leaked clock or event subscriptions)', () => {
    const w = makeWorld()
    const base = simClock.subscriberCount
    const off1 = w.mount()
    off1()
    const off2 = w.mount()
    expect(simClock.subscriberCount).toBe(base + 1)
    off2()
    expect(simClock.subscriberCount).toBe(base)
    // after unmount, events no longer reach the world
    events.emit('nightshift:start', {})
    expect([...w.brains.values()].some((b) => b.flashlight)).toBe(false)
  })

  it('skips blocked stations and hides a worker with nowhere to stand', () => {
    const w = makeWorld()
    let changed = 0
    w.onRosterChange = () => changed++
    const sys = w.brains.get('sysadmin')!
    const [bx, bz] = sys.station('rack-n').pos
    const r1 = w.validate((x, z) => Math.hypot(x - bx, z - bz) > 0.5)
    expect(r1.blockedStations).toContain('sysadmin:rack-n')
    expect(sys.blockedStations.has('rack-n')).toBe(true)
    expect(sys.stationId === 'rack-n' && sys.mode === 'stay').toBe(false)
    expect(changed).toBe(0)
    // nothing is free inside the server hall: Glenn is hidden instead of clipping into racks
    const r2 = w.validate((x, z) => !(x < -30 && x > -46 && z < -2 && z > -16))
    expect(r2.hidden).toContain('sysadmin')
    expect(w.brains.has('sysadmin')).toBe(false)
    expect(changed).toBe(1)
  })
})
