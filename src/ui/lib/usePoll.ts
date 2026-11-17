import { useEffect, useRef, useState } from 'react'

/**
 * Poll a non-reactive value (core/runtime, sim state) at `hz` and re-render only
 * when it changes according to `equal`. Used for HUD readouts (~4 Hz), never per frame.
 */
export function usePoll<T>(read: () => T, hz: number, enabled = true, equal: (a: T, b: T) => boolean = Object.is): T {
  const readRef = useRef(read)
  const equalRef = useRef(equal)
  readRef.current = read
  equalRef.current = equal
  const [value, setValue] = useState<T>(() => read())

  useEffect(() => {
    if (!enabled) return
    const tick = () => {
      const next = readRef.current()
      setValue((prev) => (equalRef.current(prev, next) ? prev : next))
    }
    tick()
    const id = window.setInterval(tick, Math.max(16, 1000 / hz))
    return () => window.clearInterval(id)
  }, [hz, enabled])

  return value
}

export function sameTuple(a: readonly unknown[] | null, b: readonly unknown[] | null): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
