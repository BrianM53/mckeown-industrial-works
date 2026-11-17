import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { FactorySim, FactoryState } from './types'

/**
 * Subscribe a component to a factory simulation through a selector.
 *
 * The sim only notifies on low-frequency changes (phase/stage, countdown
 * seconds, counters, params, line status), and the component re-renders only
 * when the SELECTED value changes (Object.is by default, or `isEqual`). So
 * `useFactoryStore(sim, s => s.rocket.phase)` renders once per phase change.
 * Never select values that change every tick (phaseTime, items): read
 * `sim.state` in useFrame / requestAnimationFrame for those.
 */
export function useFactoryStore<T>(
  sim: FactorySim,
  selector: (s: FactoryState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const subscribe = useCallback((fn: () => void) => sim.subscribe(fn), [sim])
  const getSnapshot = useMemo(() => {
    let has = false
    let memoVersion = -1
    let memo: T
    return (): T => {
      const version = sim.version
      if (has && version === memoVersion) return memo
      const next = selector(sim.state)
      memoVersion = version
      if (has && isEqual(memo, next)) return memo
      has = true
      memo = next
      return next
    }
  }, [sim, selector, isEqual])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Shallow equality for selectors that return small objects/arrays. */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  }
  return true
}
