/**
 * Seeded launch outcomes, stowaways and announcer lines. Pure functions of
 * (base seed, rocket id, success chance) so a given ?seed always replays the
 * same launches for the same console settings.
 */
import { createRng, mixSeed, weightedPick, type Rng } from '@/core/rng'
import type { LaunchOutcome } from '@/core/types'
import { FAILURE_WEIGHTS, STOWAWAY_CHANCE } from './config'

const SALT_ROCKET = 0x52c4e7
const SALT_OUTCOME = 0x0c0ffee
const SALT_STOWAWAY = 0x57a3a7
const SALT_LINE = 0xa11ce
const SALT_DEFECT = 0xdef3c7

/** Per-rocket seed for visual variety (asymmetry, attachments). Never 0. */
export function rocketSeed(baseSeed: number, rocketId: number): number {
  return mixSeed(baseSeed, rocketId, SALT_ROCKET) || 1
}

function rngFor(baseSeed: number, rocketId: number, salt: number): Rng {
  return createRng(mixSeed(baseSeed, rocketId, salt))
}

/**
 * The launch outcome for a rocket. One uniform draw decides clean success
 * (probability = successChance); otherwise a second draw picks the kind of
 * failure with FAILURE_WEIGHTS (~45 wobble / 35 breakup / 20 explosion).
 */
export function rollOutcome(baseSeed: number, rocketId: number, successChance: number): LaunchOutcome {
  const rng = rngFor(baseSeed, rocketId, SALT_OUTCOME)
  const u = rng()
  if (u < successChance) return 'success'
  return weightedPick(rng, FAILURE_WEIGHTS)
}

/** The raw draw behind rollOutcome (tests/tools: how "lucky" a rocket is). */
export function outcomeDraw(baseSeed: number, rocketId: number): { u: number; failure: Exclude<LaunchOutcome, 'success'> } {
  const rng = rngFor(baseSeed, rocketId, SALT_OUTCOME)
  const u = rng()
  return { u, failure: weightedPick(rng, FAILURE_WEIGHTS) }
}

/** Did a worker forget to disembark? (~12%, decided when rollout completes.) */
export function rollStowaway(baseSeed: number, rocketId: number): boolean {
  return rngFor(baseSeed, rocketId, SALT_STOWAWAY)() < STOWAWAY_CHANCE
}

/** Counts toward SUCCESSFUL LAUNCHES on the sign (a wobble is a success with drama). */
export function isSuccessfulOutcome(o: LaunchOutcome): boolean {
  return o === 'success' || o === 'wobble'
}

/** murmur3 finalizer: avalanches a 32-bit integer. */
function fmix32(x: number): number {
  let h = x >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** Deterministic 0..1 hash for per-part decisions (QC defect flashes). Allocation-free (runs per part). */
export function partHash(baseSeed: number, lineIndex: number, cycle: number): number {
  let h = fmix32(baseSeed ^ SALT_DEFECT)
  h = fmix32(h ^ Math.imul(SALT_LINE + lineIndex, 0x9e3779b1))
  h = fmix32(h ^ Math.imul(cycle | 0, 0x632be5ab))
  return h / 4294967296
}

/** PA announcer lines (in-world fiction). The first line of each pool is the classic. */
const ANNOUNCER: Record<LaunchOutcome, readonly string[]> = {
  success: ['Announcer: Clean ascent. Nobody touch anything.', 'Announcer: Rocket has left the building. On purpose.', 'Announcer: Launch successful. Act like we planned that.'],
  wobble: ['Announcer: Nominal.', 'Announcer: Nominal. Mostly nominal.', 'Announcer: That fin was optional.'],
  breakup: ['Announcer: That was… also data.', 'Announcer: Rocket delivered. In several parts.'],
  explosion: ['Announcer: Unscheduled disassembly. Again.', 'Announcer: Please reset the sign.'],
}

const STOWAWAY_LINES: readonly string[] = ['Announcer: Reminder: the rocket is not a ride.', 'Announcer: Headcount is one short. …Never mind.']

/** Announcer caption for an outcome. Half the time it is the classic line. */
export function announcerLine(outcome: LaunchOutcome, baseSeed: number, rocketId: number): string {
  const pool = ANNOUNCER[outcome]
  const rng = rngFor(baseSeed, rocketId, SALT_OUTCOME + 7)
  if (rng() < 0.5) return pool[0]
  return pool[1 + Math.floor(rng() * (pool.length - 1))]
}

export function stowawayLine(baseSeed: number, rocketId: number): string {
  const rng = rngFor(baseSeed, rocketId, SALT_STOWAWAY + 3)
  return STOWAWAY_LINES[Math.floor(rng() * STOWAWAY_LINES.length)]
}

export const COUNTDOWN_CAPTION = '⚠ Launch countdown — clear the pad'
