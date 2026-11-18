/**
 * NPC module root (spec §8): 6 / 10 / 14 workers by quality tier, each with a
 * name, role, look, home stations and short precomputed routes; "Talk" via E
 * (rotating authored dialogue); seven director-paced ambient gags with their
 * own props; reactions to the Night Shift, launches and forklift bumps;
 * occasional speech-bubble chatter.
 *
 * Debug (dev/test builds): __MIW__.npc.{list, positions, triggerGag, gags, talk,
 * wave, emit, validation, snap, roster}.
 */
import { useEffect, useMemo, useState } from 'react'
import { useRapier } from '@react-three/rapier'
import { CG, interactionGroups } from '@/core/collision'
import { registerDebug } from '@/core/debug'
import { events, type GameEventName, type GameEvents } from '@/core/events'
import { useGameStore } from '@/state/game'
import { useSettings } from '@/state/settings'
import { GAGS } from './gagDefs'
import { ConveyorProp } from './render/ConveyorProp'
import { Bubbles, Flashlights, Puffs } from './render/Fx'
import { GagProps } from './render/GagProps'
import { NpcAgent } from './render/NpcAgent'
import { ROSTER, rosterFor } from './roster'
import { NpcWorld } from './world'

/** NPCs that gags can tint (soot / slime) — they get a pre-warmed tint material. */
const TINTABLE = new Set(['smelter', 'tank'])

export default function NpcModule() {
  const quality = useGameStore((s) => s.quality)
  const reduced = useSettings((s) => s.reducedMotion)
  const [world] = useState(() => new NpcWorld())
  const [rosterVersion, setRosterVersion] = useState(0)
  const defs = useMemo(() => {
    const list = rosterFor(quality)
    world.setRoster(list) // idempotent: keyed by NPC id
    return list
    // rosterVersion: re-filter after runtime validation hides someone
  }, [quality, world, rosterVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    world.onRosterChange = () => setRosterVersion((v) => v + 1)
    const off = world.mount()
    return () => {
      world.onRosterChange = null
      off()
    }
  }, [world])

  useEffect(
    () =>
      registerDebug('npc', {
        list: () => world.debugList(),
        positions: () => world.debugPositions(),
        /** Start a gag now (forced past cooldowns / visibility), e.g. triggerGag('kick'). */
        triggerGag: (id: string) => world.triggerGag(id),
        gags: () => ({ ids: GAGS.map((g) => g.id), running: world.scheduler.running, history: world.scheduler.history.slice(-10) }),
        /** Open the dialogue with an NPC (tests / screenshots). */
        talk: (id: string) => world.talk(id),
        /** Emit a game event (simulate nightshift:start, rocket:outcome… for visual checks). */
        emit: <K extends GameEventName>(name: K, payload?: GameEvents[K]) => events.emit(name, (payload ?? {}) as GameEvents[K]),
        validation: () => world.validation,
        /** Make an NPC wave at the visitor now (Dot's greeting). */
        wave: (id: string) => world.brains.get(id)?.greet(),
        /** Teleport an NPC to one of its stations. */
        snap: (id: string, station: string) => world.brains.get(id)?.snapTo(station),
        roster: () => ROSTER.map((d) => ({ id: d.id, name: d.name, role: d.role, tier: d.tier })),
      }),
    [world],
  )

  const shadows = quality !== 'low'
  const puffScale = (quality === 'low' ? 0.5 : 1) * (reduced ? 0.6 : 1)
  const active = defs.filter((d) => world.brains.has(d.id))

  return (
    <group name="npc-root">
      {active.map((d) => (
        <NpcAgent key={d.id} world={world} brain={world.brains.get(d.id)!} def={d} shadows={shadows} tintable={TINTABLE.has(d.id)} />
      ))}
      <ConveyorProp props={world.scheduler.props} shadows={shadows} />
      <GagProps props={world.scheduler.props} shadows={shadows} reduced={reduced} />
      <Puffs world={world} scale={puffScale} />
      <Flashlights world={world} max={ROSTER.length} />
      <Bubbles world={world} reduced={reduced} />
      <PhysicsGuard world={world} />
    </group>
  )
}

/** Query groups: an NPC-sized probe that only sees STATIC colliders (not NPCs, the visitor, props or the forklift). */
const PROBE_GROUPS = interactionGroups(CG.NPC, [CG.STATIC])

/**
 * Once the world is ready, validate every station / route against the physics
 * world (other modules' machines), and provide a physics free-spot test for
 * sidesteps. Re-checks once more later to catch late-loading modules.
 */
function PhysicsGuard({ world }: { world: NpcWorld }) {
  const { world: rw, rapier } = useRapier()
  const status = useGameStore((s) => s.status)
  useEffect(() => {
    let shape: InstanceType<typeof rapier.Capsule> | null = null
    try {
      shape = new rapier.Capsule(0.46, 0.26)
    } catch {
      shape = null
    }
    const free = (x: number, z: number): boolean => {
      if (!shape || !Number.isFinite(x) || !Number.isFinite(z)) return true
      try {
        const hit = rw.intersectionWithShape({ x, y: 1.0, z }, { x: 0, y: 0, z: 0, w: 1 }, shape, rapier.QueryFilterFlags.EXCLUDE_SENSORS, PROBE_GROUPS)
        return !hit
      } catch {
        return true
      }
    }
    world.physicsFree = free
    return () => {
      world.physicsFree = () => true
    }
  }, [rw, rapier, world])

  useEffect(() => {
    if (status !== 'ready') return
    const timers = [1500, 9000].map((ms) =>
      setTimeout(() => {
        try {
          world.validate(world.physicsFree)
        } catch (err) {
          console.error('[npc] validation failed', err)
        }
      }, ms),
    )
    return () => timers.forEach(clearTimeout)
  }, [status, world])
  return null
}
