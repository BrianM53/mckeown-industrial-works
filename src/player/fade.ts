import { useUIStore } from '@/state/ui'

/**
 * Screen fade helpers built on the ui store's fade overlay. Tweens run on
 * requestAnimationFrame with a timeout fallback (background tabs), and every
 * tween can be cancelled. A cancelled/aborted sequence must always call
 * `clearFade()` so the screen never stays black.
 */
export interface Cancel {
  cancelled: boolean
}

function setOpacity(opacity: number, label?: string): void {
  const o = Math.min(1, Math.max(0, opacity))
  const st = useUIStore.getState()
  const endpoint = o === 0 || o === 1
  // Skip imperceptible intermediate updates, but always land exactly on 0 / 1.
  if (st.fade.label === label && (st.fade.opacity === o || (!endpoint && Math.abs(st.fade.opacity - o) < 0.004))) return
  st.setFade(label ? { opacity: o, label } : { opacity: o })
}

export function currentFade(): number {
  return useUIStore.getState().fade.opacity
}

export function clearFade(): void {
  setOpacity(0)
}

/** Tween the overlay opacity to `to` over `ms`. Resolves early if cancelled. */
export function fadeTo(to: number, ms: number, cancel: Cancel, label?: string): Promise<void> {
  const from = currentFade()
  if (ms <= 0 || Math.abs(from - to) < 1e-3) {
    if (!cancel.cancelled) setOpacity(to, label)
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const start = performance.now()
    let done = false
    let raf = 0
    const finish = () => {
      if (done) return
      done = true
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      if (!cancel.cancelled) setOpacity(to, label)
      resolve()
    }
    const tick = () => {
      if (done) return
      if (cancel.cancelled) return finish()
      const u = Math.min(1, (performance.now() - start) / ms)
      const e = u * u * (3 - 2 * u)
      setOpacity(from + (to - from) * e, label)
      if (u >= 1) finish()
      else raf = requestAnimationFrame(tick)
    }
    // Fallback so hidden tabs (no rAF) still complete the sequence.
    const timer = setTimeout(finish, ms + 120)
    raf = requestAnimationFrame(tick)
  })
}

/** Cancellable wait. */
export function wait(ms: number, cancel: Cancel): Promise<void> {
  return new Promise((resolve) => {
    if (cancel.cancelled || ms <= 0) return resolve()
    const t = setTimeout(resolve, ms)
    // poll cancellation cheaply
    const iv = setInterval(() => {
      if (cancel.cancelled) {
        clearTimeout(t)
        clearInterval(iv)
        resolve()
      }
    }, 50)
    setTimeout(() => clearInterval(iv), ms + 10)
  })
}
