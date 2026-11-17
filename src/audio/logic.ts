/**
 * Pure audio logic: no WebAudio, no React, no three. Deterministic and
 * unit-tested (logic.test.ts). The engine composes these pieces:
 *   - slider → gain mapping (perceptual taper)
 *   - WebAudio 'inverse' distance model + an edge fade so culling is inaudible
 *   - per-name rate limiting
 *   - voice admission with stealing (quietest / oldest first)
 *   - music/ambience ducking
 *   - positional loop culling with hysteresis and per-name / global caps
 *   - simple building occlusion (listener inside vs. emitter outside)
 */

/** Spatial defaults (meters). PannerNode uses distanceModel 'inverse'. */
export const SPATIAL = {
  refDistance: 4,
  rolloff: 1.2,
  maxDistance: 45,
  /** A realized loop is culled only beyond maxDistance + hysteresis; it re-activates inside maxDistance. */
  hysteresis: 4,
  /** Distance bias (m) that keeps already-active loops from flapping at a cap boundary. */
  stickiness: 1.5,
} as const

export function clamp01(v: number): number {
  return Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0
}

/** Clamp an optional numeric option, falling back for undefined / NaN / Infinity. */
export function clampOpt(v: number | undefined, min: number, max: number, fallback: number): number {
  if (v === undefined || !Number.isFinite(v)) return fallback
  return v < min ? min : v > max ? max : v
}

/**
 * Settings slider (0..1) → linear gain. Squared taper is close to perceptual:
 * 0.5 → −12 dB, 0.71 → −6 dB, 0 → silence. Invalid input → 0.
 */
export function volumeToGain(slider: number): number {
  const v = clamp01(slider)
  return v * v
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

export function gainToDb(g: number): number {
  return g > 1e-10 ? 20 * Math.log10(g) : -200
}

/** WebAudio PannerNode 'inverse' distance gain (maxDistance is not used by this model). */
export function inverseDistanceGain(distance: number, refDistance: number, rolloff: number): number {
  if (!Number.isFinite(distance)) return 0
  const ref = Math.max(1e-3, refDistance)
  const d = Math.max(distance, ref)
  return ref / (ref + Math.max(0, rolloff) * (d - ref))
}

/**
 * Extra gain that fades a positional loop smoothly to silence as it approaches
 * maxDistance, so culling there never produces an audible step. 1 below
 * start·max, smoothstep to 0 at max.
 */
export function edgeFade(distance: number, maxDistance: number, start = 0.72): number {
  if (!Number.isFinite(distance)) return 0
  const a = maxDistance * start
  if (distance <= a) return 1
  if (distance >= maxDistance) return 0
  const x = (distance - a) / (maxDistance - a)
  return 1 - x * x * (3 - 2 * x)
}

/** Euclidean distance between two points given as loose coordinates. */
export function distance3(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = ax - bx
  const dy = ay - by
  const dz = az - bz
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/** Per-key minimum interval between plays (e.g. footsteps ≥ 0.18 s apart). */
export class RateLimiter {
  private last = new Map<string, number>()

  /** True (and records the time) when `key` may play at `now` (seconds). */
  allow(key: string, now: number, minInterval: number): boolean {
    const prev = this.last.get(key)
    if (prev !== undefined && now - prev < minInterval && now >= prev) return false
    this.last.set(key, now)
    return true
  }

  reset(): void {
    this.last.clear()
  }
}

// ---------------------------------------------------------------------------
// Ducking
// ---------------------------------------------------------------------------

/** Overlapping duck requests: the effective amount is the max of the active ones. */
export class DuckController {
  private ducks: { amount: number; until: number }[] = []

  add(amount: number, seconds: number, now: number): void {
    const a = clamp01(amount)
    if (a <= 0 || !Number.isFinite(seconds) || seconds <= 0) return
    this.ducks.push({ amount: a, until: now + Math.min(seconds, 120) })
  }

  /** Current duck amount 0..1 (expired requests are pruned in place). */
  amount(now: number): number {
    let a = 0
    let w = 0
    for (let i = 0; i < this.ducks.length; i++) {
      const d = this.ducks[i]
      if (d.until > now) {
        this.ducks[w++] = d
        if (d.amount > a) a = d.amount
      }
    }
    this.ducks.length = w
    return a
  }

  clear(): void {
    this.ducks.length = 0
  }
}

// ---------------------------------------------------------------------------
// Voice admission / stealing
// ---------------------------------------------------------------------------

export interface VoiceSlot {
  id: number
  name: string
  /** Start time (seconds, any monotonic clock). */
  started: number
  /** Estimated current audibility (level × distance gain × remaining envelope). Higher = more important. */
  score: number
}

export interface AdmitRequest {
  name: string
  score: number
  /** Max simultaneous voices with this name. */
  perNameCap: number
  /** At the per-name cap: steal the oldest same-name voice, or reject the new one. */
  policy: 'steal' | 'reject'
}

export interface Admission {
  admit: boolean
  /** Voice ids to stop (fade out quickly) before starting the new one. */
  steal: number[]
}

/**
 * Decide whether a new one-shot may start.
 * 1. Per-name cap: steal the oldest voice of the same name (or reject).
 * 2. Global cap: steal the least audible voice (lowest score, ties → oldest);
 *    if the new sound would be quieter than every playing voice, reject it.
 */
export function admitVoice(active: readonly VoiceSlot[], cap: number, req: AdmitRequest): Admission {
  if (cap <= 0 || req.perNameCap <= 0) return { admit: false, steal: [] }
  const steal: number[] = []
  let same = 0
  let oldestSame: VoiceSlot | null = null
  for (const v of active) {
    if (v.name !== req.name) continue
    same++
    if (!oldestSame || v.started < oldestSame.started) oldestSame = v
  }
  if (same >= req.perNameCap) {
    if (req.policy === 'reject' || !oldestSame) return { admit: false, steal: [] }
    steal.push(oldestSame.id)
  }
  if (active.length - steal.length >= cap) {
    let victim: VoiceSlot | null = null
    for (const v of active) {
      if (steal.includes(v.id)) continue
      if (!victim || v.score < victim.score || (v.score === victim.score && v.started < victim.started)) victim = v
    }
    if (!victim || victim.score > req.score) return { admit: false, steal: [] }
    steal.push(victim.id)
  }
  return { admit: true, steal }
}

/** Remaining-envelope weight used when scoring a playing voice (older → quieter). */
export function envelopeWeight(age: number, duration: number): number {
  if (!(duration > 0)) return 0.1
  const r = 1 - age / duration
  return r < 0.1 ? 0.1 : r > 1 ? 1 : r
}

// ---------------------------------------------------------------------------
// Positional loop culling
// ---------------------------------------------------------------------------

export interface CullItem {
  id: number
  name: string
  positional: boolean
  /** Distance from the listener (m). */
  distance: number
  maxDistance: number
  /** Currently realized (enables hysteresis and stickiness). */
  active: boolean
  /** Output: should be realized after this pass. */
  want: boolean
  /** Scratch sort key (written by computeCull). */
  key: number
  /** World position (needed for coincident-emitter merging). */
  x?: number
  y?: number
  z?: number
  /** Loudness weight (volume × level): the loudest of coincident twins survives. */
  weight?: number
}

export interface CullOptions {
  hysteresis: number
  stickiness: number
  /** Max simultaneously realized positional loops. */
  maxTotal: number
  /** Max realized positional loops sharing a name (nearest win). */
  perName: (name: string) => number
  /**
   * Same-name positional emitters closer together than this (m) are one
   * source: only the loudest plays (two modules placing the same hum on the
   * same machine never stack). 0 disables.
   */
  mergeRadius?: number
}

const byKey = (a: CullItem, b: CullItem) => a.key - b.key || a.id - b.id

/**
 * Decide which loops are realized. Non-positional loops always are.
 * Positional loops: activate inside maxDistance, deactivate beyond
 * maxDistance + hysteresis; then keep only the nearest `perName(name)` of each
 * name and the nearest `maxTotal` overall, so overlapping emitters never pile
 * up. Writes `want` on every item; returns the number of realized positional loops.
 * `order` / `counts` are optional reusable scratch containers (no per-call allocation).
 */
export function computeCull(
  items: CullItem[],
  opts: CullOptions,
  order: CullItem[] = [],
  counts: Map<string, number> = new Map(),
): number {
  order.length = 0
  for (const it of items) {
    if (!it.positional) {
      it.want = true
      continue
    }
    const limit = it.active ? it.maxDistance + opts.hysteresis : it.maxDistance
    it.want = Number.isFinite(it.distance) && it.distance <= limit
    if (it.want) {
      it.key = it.distance - (it.active ? opts.stickiness : 0)
      order.push(it)
    }
  }
  const r = opts.mergeRadius ?? 0
  if (r > 0) {
    const r2 = r * r
    for (let i = 0; i < order.length; i++) {
      const a = order[i]
      if (!a.want || a.x === undefined) continue
      for (let j = i + 1; j < order.length; j++) {
        const b = order[j]
        if (!b.want || b.name !== a.name || b.x === undefined) continue
        const dx = a.x - b.x
        const dy = (a.y ?? 0) - (b.y ?? 0)
        const dz = (a.z ?? 0) - (b.z ?? 0)
        if (dx * dx + dy * dy + dz * dz > r2) continue
        const wa = a.weight ?? 1
        const wb = b.weight ?? 1
        // keep the louder twin; on a tie keep the one already playing, then the older one
        const keepA = wa > wb || (wa === wb && (a.active !== b.active ? a.active : a.id < b.id))
        if (keepA) b.want = false
        else {
          a.want = false
          break
        }
      }
    }
    let w = 0
    for (let i = 0; i < order.length; i++) if (order[i].want) order[w++] = order[i]
    order.length = w
  }
  order.sort(byKey)
  counts.clear()
  let total = 0
  for (const it of order) {
    const n = counts.get(it.name) ?? 0
    if (n >= opts.perName(it.name) || total >= opts.maxTotal) {
      it.want = false
      continue
    }
    counts.set(it.name, n + 1)
    total++
  }
  return total
}

// ---------------------------------------------------------------------------
// Occlusion
// ---------------------------------------------------------------------------

export interface Occlusion {
  /** Lowpass cutoff (Hz) applied to the emitter. */
  cutoff: number
  /** Extra gain 0..1. */
  gain: number
}

export const OCC_NONE: Occlusion = Object.freeze({ cutoff: 22000, gain: 1 })
/** Listener inside a building, emitter outdoors: through walls / doorway. */
export const OCC_LISTENER_INSIDE: Occlusion = Object.freeze({ cutoff: 720, gain: 0.5 })
/** Listener outdoors, emitter inside a building. */
export const OCC_EMITTER_INSIDE: Occlusion = Object.freeze({ cutoff: 1000, gain: 0.6 })
/** Different buildings: two walls in between. */
export const OCC_OTHER_BUILDING: Occlusion = Object.freeze({ cutoff: 420, gain: 0.32 })

/**
 * How an emitter in `emitterSpace` (building zone id, or null = outdoors) is
 * heard from `listenerSpace` (runtime.world.interior).
 */
export function occlusionFor(listenerSpace: string | null, emitterSpace: string | null): Occlusion {
  if (listenerSpace === emitterSpace) return OCC_NONE
  if (listenerSpace === null) return OCC_EMITTER_INSIDE
  if (emitterSpace === null) return OCC_LISTENER_INSIDE
  return OCC_OTHER_BUILDING
}

/** Crowd normalization for the one-shot bus: many simultaneous voices are gently turned down. */
export function crowdGain(weightedVoices: number): number {
  const n = Number.isFinite(weightedVoices) ? weightedVoices : 0
  return 1 / Math.sqrt(Math.max(1, n / 4))
}

/** Map a forklift impact strength (0..1 nominal; larger values clamp) to a play volume. */
export function impactVolume(strength: number): number {
  if (!Number.isFinite(strength) || strength <= 0) return 0.2
  return 0.2 + 0.8 * Math.min(1, strength)
}

/** Detect a cyclic phase (0..1) crossing `at` between two samples, including wrap-around. */
export function phaseCrossed(prev: number, next: number, at: number): boolean {
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return false
  if (next >= prev) return prev < at && next >= at
  // wrapped past 1 → 0
  return prev < at || next >= at
}
