/** Deterministic seeded randomness (mulberry32). Use for anything tests must reproduce. */
export type Rng = () => number

export function createRng(seed: number): Rng {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stable 32-bit hash of a string (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Combine seeds into a new seed. */
export function mixSeed(...parts: number[]): number {
  let h = 0x9e3779b9
  for (const p of parts) {
    h ^= p + 0x9e3779b9 + (h << 6) + (h >>> 2)
    h >>>= 0
  }
  return h
}

export function randRange(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng()
}

export function randInt(rng: Rng, minInclusive: number, maxInclusive: number): number {
  return Math.floor(randRange(rng, minInclusive, maxInclusive + 1))
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length]
}

/** Weighted choice. Weights need not sum to 1. */
export function weightedPick<T extends string>(rng: Rng, weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][]
  const total = entries.reduce((s, [, w]) => s + Math.max(0, w), 0)
  let r = rng() * total
  for (const [k, w] of entries) {
    r -= Math.max(0, w)
    if (r <= 0) return k
  }
  return entries[entries.length - 1][0]
}
