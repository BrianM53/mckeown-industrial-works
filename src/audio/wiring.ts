import { ACHIEVEMENTS } from '@/content/achievements'
import { events } from '@/core/events'
import type { SfxName, Vec3 } from '@/core/types'
import type { PlayOptions } from './api'
import { PAD_POSITION } from './emitters'
import { impactVolume } from './logic'

/**
 * GAME EVENT → SOUND WIRING. Event owners emit the captions; this only plays
 * sounds. Returns one cleanup function that removes every subscription.
 *
 * Modules that emit these events should NOT also play the mapped sound (the
 * per-source rate limiter would usually swallow the duplicate, but don't rely on it).
 */
export interface WiringDeps {
  play(name: SfxName, opts?: PlayOptions): void
  duck(amount: number, seconds: number): void
  /** The rocket flight rumble (positional loop that climbs with the rocket). */
  flight: { start(): void; end(fast: boolean): void; position(): Vec3 }
  /** Monotonic seconds (tests inject a clock). */
  now?: () => number
}

/** Achievements chime once per id per session (modules may re-emit them). */
const chimedAchievements = new Set<string>()
const knownAchievement = (id: string) => ACHIEVEMENTS.some((a) => a.id === id)

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000

export function wireAudioEvents({ play, duck, flight, now = defaultNow }: WiringDeps): () => void {
  /** When a panel last opened: its own chime already confirms that interaction. */
  let panelOpenedAt = -Infinity
  const paChime = () => {
    play('pa-chime')
    duck(0.25, 2.5)
  }
  const offs = [
    events.on('sfx', (p) => {
      if (!p) return
      play(p.name, { position: p.position, volume: p.volume, rate: p.rate })
    }),
    // last three seconds a fourth higher (the sim counts 10…1, then ignition)
    events.on('rocket:countdown', (p) => {
      const s = p.secondsLeft
      play('countdown-beep', { rate: s <= 0 ? 2 : s <= 3 ? 1.335 : 1, volume: s <= 3 ? 1 : 0.85 })
    }),
    events.on('rocket:ignition', () => play('ignition', { position: PAD_POSITION })),
    events.on('rocket:liftoff', () => {
      play('liftoff-roar', { position: PAD_POSITION })
      flight.start()
      duck(0.55, 9)
    }),
    events.on('rocket:outcome', (p) => {
      if (p.outcome === 'explosion') {
        play('explosion', { position: flight.position() })
        duck(0.5, 4)
        flight.end(true)
      } else if (p.outcome === 'breakup') {
        play('breakup-clank', { position: flight.position() })
        flight.end(true)
      } else if (p.outcome === 'wobble') {
        // "Nominal." — a fin rattles off; the rocket keeps going
        play('breakup-clank', { position: flight.position(), volume: 0.4, rate: 1.2 })
      }
    }),
    events.on('rocket:reset', () => flight.end(false)),
    events.on('osha:whistle', (p) => play('whistle', { position: p.position })),
    events.on('osha:tackle', () => {
      play('tackle-thud')
      duck(0.6, 3)
    }),
    events.on('nightshift:start', () => {
      play('power-down')
      play('alarm')
      duck(0.5, 5)
    }),
    events.on('nightshift:end', () => play('power-up')),
    events.on('forklift:horn', (p) => play('forklift-horn', { position: p.position })),
    events.on('forklift:impact', (p) => play('forklift-impact', { position: p.position, volume: impactVolume(p.strength) })),
    events.on('pa:announce', paChime),
    // PA lines that arrive as captions (e.g. the launch announcer) chime too;
    // a 'pa:announce' + caption pair for the same line chimes once (1.5 s rate limit).
    events.on('caption', (p) => {
      if (p?.kind === 'pa') paChime()
    }),
    // The UI also emits sfx 'achievement' for new unlocks; the per-id set and the
    // 0.3 s per-name rate limit guarantee a single chime either way.
    events.on('achievement', (p) => {
      if (!p || chimedAchievements.has(p.id) || !knownAchievement(p.id)) return
      chimedAchievements.add(p.id)
      play('achievement')
    }),
    events.on('panel:open', () => {
      panelOpenedAt = now()
      play('ui-open', { volume: 0.7 })
    }),
    events.on('panel:close', () => play('ui-close', { volume: 0.65 })),
    // Generic "you used something" click for every E-interaction (stations add their own machine sounds).
    events.on('player:interact', () => {
      if (now() - panelOpenedAt < 0.1) return
      play('interact', { volume: 0.55 })
    }),
    events.on('player:footstep', (p) =>
      play(p.surface === 'metal' ? 'footstep-metal' : 'footstep', {
        position: p.position,
        volume: p.run ? 0.95 : 0.7,
        rate: p.surface === 'dirt' ? 0.82 : 1,
      }),
    ),
  ]
  return () => {
    for (const off of offs) off()
  }
}

/** Test helper: forget which achievements already chimed. */
export function resetAchievementChimes(): void {
  chimedAchievements.clear()
}
