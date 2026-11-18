import { useEffect, useState } from 'react'
import { simClock } from '@/core/clock'
import { registerDebug } from '@/core/debug'
import { events } from '@/core/events'
import { runtime } from '@/core/runtime'
import { getService } from '@/core/services'
import type { PlayerMode } from '@/core/types'
import { useGameStore } from '@/state/game'
import { isOverlayBlocking } from '@/state/ui'
import { director } from '@/systems/director'
import { RESTRICTED_ZONES } from '@/world/layout'
import { HatchesVisual } from './Hatches'
import { InspectorVisual } from './Inspector'
import { OshaFsm } from './oshaFsm'
import { nearestZone, triggerPointFor } from './zones'

/**
 * OSHA-style inspector system: the FSM (ticked by simClock), its inputs from
 * runtime/services, the 'gag:start' investigations, debug hooks and the visuals.
 */

function createOsha(): OshaFsm {
  // Reused snapshots: the FSM reads these synchronously every tick (no per-frame allocation).
  const player = { x: 0, z: 0, mode: 'foot' as PlayerMode }
  const fork = { x: 0, z: 0 }
  const cam = { x: 0, z: 0, yaw: 0 }
  return new OshaFsm({
    now: () => simClock.t,
    emit: (name, payload) => events.emit(name, payload),
    director,
    player: () => {
      const p = runtime.player.position
      player.x = p.x
      player.z = p.z
      player.mode = runtime.player.mode
      return player
    },
    playerService: () => getService('player'),
    forklift: () => {
      fork.x = runtime.forklift.position.x
      fork.z = runtime.forklift.position.z
      return fork
    },
    camera: () => {
      cam.x = runtime.camera.position.x
      cam.z = runtime.camera.position.z
      cam.yaw = runtime.camera.yaw
      return cam
    },
    overlayOpen: isOverlayBlocking,
    dark: () => useGameStore.getState().nightShift,
  })
}

export function OshaSystem() {
  const [fsm] = useState(createOsha)
  useEffect(() => {
    fsm.revive()
    const offs = [
      simClock.onTick((dt) => fsm.tick(dt)),
      events.on('gag:start', (p) => {
        if (p && typeof p.id === 'string' && Array.isArray(p.position)) fsm.onGag(p.id, p.position)
      }),
      registerDebug('osha', {
        /**
         * Simulate a visitor entering a restricted zone: teleports the worker to a
         * free spot just inside it (default: the zone nearest the worker). Pass
         * { force: true } to clear cooldowns first, { hatch: true } to make him
         * pop out of a hatch even if he is patrolling nearby.
         */
        trigger: (zoneId?: string, opts?: { force?: boolean; hatch?: boolean }) => {
          const p = runtime.player.position
          const id = zoneId && RESTRICTED_ZONES.some((z) => z.id === zoneId) ? zoneId : nearestZone(p.x, p.z).id
          const tp = triggerPointFor(id)
          const svc = getService('player')
          if (!tp || !svc) return false
          if (opts?.force) fsm.reset()
          if (opts?.hatch) fsm.preferHatchNext()
          svc.teleport(tp.x, tp.z, tp.yaw)
          return id
        },
        getState: () => fsm.snapshot(),
        /** Clear cooldowns; the inspector goes back to his patrol. */
        reset: () => fsm.reset(),
        zones: () => RESTRICTED_ZONES.map((z) => z.id),
      }),
    ]
    return () => {
      for (const off of offs) off()
      fsm.dispose()
    }
  }, [fsm])
  return (
    <group name="safety-osha">
      <InspectorVisual fsm={fsm} />
      <HatchesVisual fsm={fsm} />
    </group>
  )
}
