import { useEffect, useRef } from 'react'
import type { PlayerMode } from './types'

/**
 * Interaction registry. Any module registers interactables (machines, NPCs,
 * the forklift, balls, buttons). The player module selects ONE target per
 * frame with `selectTarget`, shows the prompt, and calls `onInteract` when the
 * visitor presses E / taps the interact button — never while an overlay
 * (panel/dialogue) is open.
 */
export interface Interactable {
  /** Unique, stable id, e.g. 'station:resume', 'npc:welder', 'forklift'. */
  id: string
  /** What it is, shown in the prompt: "Résumé-O-Matic 3000". */
  label: string
  /** Prompt verb: "Inspect", "Talk", "Drive", "Kick", "Press", "Open"... */
  verb: string
  /** Current world position of the interaction point (feet level is fine). */
  getPosition: () => { x: number; y: number; z: number }
  /** Activation radius on the ground plane in meters. Default 2.6. */
  radius?: number
  /** Tie-breaker: higher wins when distances are similar. Default 0. */
  priority?: number
  /** Which control modes may use it. Default ['foot']. */
  modes?: PlayerMode[]
  /** Dynamic availability (e.g. ball out of reach, button on cooldown). */
  enabled?: () => boolean
  onInteract: () => void
}

const registry = new Map<string, Interactable>()
const listeners = new Set<() => void>()

export function registerInteractable(def: Interactable): () => void {
  registry.set(def.id, def)
  listeners.forEach((l) => l())
  return () => {
    if (registry.get(def.id) === def) {
      registry.delete(def.id)
      listeners.forEach((l) => l())
    }
  }
}

export function listInteractables(): Interactable[] {
  return [...registry.values()]
}

export function getInteractable(id: string): Interactable | undefined {
  return registry.get(id)
}

export function onRegistryChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export const DEFAULT_INTERACT_RADIUS = 2.6

/**
 * Pure target selection (unit-tested). Picks the enabled interactable within
 * range that minimizes a score of normalized distance, preferring targets in
 * front of the player and higher priority.
 */
export function selectTarget(
  player: { x: number; z: number },
  facingYaw: number,
  mode: PlayerMode,
  candidates: Iterable<Interactable>,
): Interactable | null {
  const fx = -Math.sin(facingYaw)
  const fz = -Math.cos(facingYaw)
  let best: Interactable | null = null
  let bestScore = Infinity
  for (const c of candidates) {
    const modes = c.modes ?? ['foot']
    if (!modes.includes(mode)) continue
    if (c.enabled && !safeEnabled(c)) continue
    const p = c.getPosition()
    const dx = p.x - player.x
    const dz = p.z - player.z
    const dist = Math.hypot(dx, dz)
    const radius = c.radius ?? DEFAULT_INTERACT_RADIUS
    if (dist > radius) continue
    const facingDot = dist > 1e-4 ? (dx * fx + dz * fz) / dist : 1
    const score = dist / radius - 0.25 * facingDot - 0.15 * (c.priority ?? 0)
    if (score < bestScore) {
      bestScore = score
      best = c
    }
  }
  return best
}

function safeEnabled(c: Interactable): boolean {
  try {
    return c.enabled ? c.enabled() : true
  } catch {
    return false
  }
}

/**
 * React hook: registers `def` while mounted. The latest `def` object is used
 * on every call (no stale closures), so callbacks may read changing props.
 * Pass null to temporarily unregister.
 */
export function useInteractable(def: Interactable | null): void {
  const ref = useRef(def)
  ref.current = def
  const id = def?.id ?? null
  useEffect(() => {
    if (!id || !ref.current) return
    const proxy: Interactable = {
      id,
      get label() {
        return ref.current?.label ?? ''
      },
      get verb() {
        return ref.current?.verb ?? 'Inspect'
      },
      get radius() {
        return ref.current?.radius
      },
      get priority() {
        return ref.current?.priority
      },
      get modes() {
        return ref.current?.modes
      },
      getPosition: () => ref.current?.getPosition() ?? { x: 1e9, y: 0, z: 1e9 },
      enabled: () => (ref.current ? (ref.current.enabled ? ref.current.enabled() : true) : false),
      onInteract: () => ref.current?.onInteract(),
    }
    return registerInteractable(proxy)
  }, [id])
}
