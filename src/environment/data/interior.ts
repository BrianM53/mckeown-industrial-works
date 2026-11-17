/**
 * Which building interior contains a ground position (roof cutaway driver).
 * Pure logic, unit-tested. The tracker adds a little hysteresis so standing on
 * a doorway does not make the roof flicker.
 */
import type { Rect } from '@/core/types'
import { ZONE_LIST, type ZoneId } from '@/world/layout'
import { rectContains } from './rects'

export interface InteriorDef {
  id: ZoneId
  rect: Rect
}

export const INTERIORS: InteriorDef[] = ZONE_LIST.filter((z) => z.building).map((z) => ({ id: z.id, rect: z.building!.interior }))

/** Interior zone id strictly containing (x, z), or null when outdoors. */
export function interiorAt(x: number, z: number, interiors: InteriorDef[] = INTERIORS): ZoneId | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  for (const it of interiors) if (rectContains(it.rect, x, z)) return it.id
  return null
}

export interface InteriorTracker {
  /** Feed the current player position; returns the interior id (or null). */
  update(x: number, z: number): ZoneId | null
  readonly current: ZoneId | null
  reset(): void
}

/**
 * Enter as soon as the position is inside an interior rect; leave only once it
 * is more than `exitMargin` meters outside it. Non-finite input keeps the state.
 */
export function createInteriorTracker(exitMargin = 0.35, interiors: InteriorDef[] = INTERIORS): InteriorTracker {
  let current: ZoneId | null = null
  return {
    update(x: number, z: number) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return current
      if (current) {
        const def = interiors.find((i) => i.id === current)
        if (def && rectContains(def.rect, x, z, exitMargin)) return current
      }
      current = interiorAt(x, z, interiors)
      return current
    },
    get current() {
      return current
    },
    reset() {
      current = null
    },
  }
}
