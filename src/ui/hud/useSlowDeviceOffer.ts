import { useEffect } from 'react'
import { params } from '@/core/params'
import { runtime } from '@/core/runtime'
import { useGameStore } from '@/state/game'
import { useUIStore } from '@/state/ui'
import { liteOfferedThisSession, offerLitePortfolio } from '../lib/liteOffer'

/** Smoothed fps below this, already at the lowest quality tier, counts as struggling. */
export const SLOW_FPS = 18
/** Seconds of struggling (tab visible, playing, nothing open) before the lite portfolio is offered. */
export const SLOW_SECONDS = 8
const POLL_MS = 500

/**
 * Watches the world's smoothed frame rate (core/runtime, written by the perf monitor). When the
 * renderer has nothing left to shed (quality tier 'low') and still runs under ~18 fps for about
 * 8 s of visible play, offers the lite portfolio once per session (non-blocking toast).
 * A ?quality= URL override (dev/test runs, e.g. headless SwiftShader) opts out.
 */
export function useSlowDeviceOffer(): void {
  useEffect(() => {
    if (params.quality !== null || liteOfferedThisSession()) return
    let slowFor = 0
    const step = POLL_MS / 1000
    const id = window.setInterval(() => {
      const g = useGameStore.getState()
      if (g.status !== 'ready' || g.quality !== 'low') return
      if (document.visibilityState !== 'visible' || useUIStore.getState().panel !== null) return
      const fps = runtime.frame.fps
      if (Number.isFinite(fps) && fps > 0 && fps < SLOW_FPS) slowFor += step
      else slowFor = Math.max(0, slowFor - step)
      if (slowFor >= SLOW_SECONDS) {
        window.clearInterval(id)
        offerLitePortfolio()
      }
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [])
}
