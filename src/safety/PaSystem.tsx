import { useEffect, useState } from 'react'
import { simClock } from '@/core/clock'
import { registerDebug } from '@/core/debug'
import { events } from '@/core/events'
import { params } from '@/core/params'
import { createRng } from '@/core/rng'
import { useGameStore } from '@/state/game'
import { director } from '@/systems/director'
import { factory, type RocketPhase } from '@/systems/factory'
import { PaScheduler } from './paScheduler'

/**
 * PA announcer: implausible corporate notices every ~90–150 s through the
 * director (ambient: never while reading a panel, off with ambient events
 * disabled / ?noevents=1). Quiet during the launch sequence (the factory's own
 * announcer owns the PA then) and during the Night Shift.
 */
const LAUNCH_BUSY = new Set<RocketPhase>(['rollout', 'pad', 'countdown', 'ignition', 'flight', 'aftermath'])

function launchBusy(): boolean {
  try {
    return LAUNCH_BUSY.has(factory.state.rocket.phase)
  } catch {
    return false
  }
}

function createPa(): PaScheduler {
  const seed = params.seed ?? Math.floor(Math.random() * 0x7fffffff)
  return new PaScheduler({
    now: () => simClock.t,
    emit: (name, payload) => events.emit(name, payload),
    director,
    rng: createRng(seed ^ 0x9a5),
    blocked: () => useGameStore.getState().nightShift || launchBusy(),
  })
}

export function PaSystem() {
  const [pa] = useState(createPa)
  useEffect(() => {
    const offs = [
      simClock.onTick(() => pa.tick()),
      events.on('pa:announce', () => pa.notePa()),
      events.on('caption', (p) => {
        if (p?.kind === 'pa') pa.notePa()
      }),
      registerDebug('pa', {
        /** Read the next line now (bypasses pacing). */
        announce: () => pa.announce(),
        getState: () => ({ nextIn: Math.round((pa.nextAt - simClock.t) * 10) / 10, recent: pa.history.slice(-5) }),
      }),
    ]
    return () => {
      for (const off of offs) off()
    }
  }, [pa])
  return null
}
