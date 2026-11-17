import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { params } from '@/core/params'
import { recordDebugError } from '@/core/debug'
import { useGameStore } from '@/state/game'
import { useUIStore, type PanelId } from '@/state/ui'
import UIRoot from '@/ui/UIRoot'
import { webglAvailable } from './webgl'

const GameCanvas = lazy(() => import('@/world/GameCanvas'))
const FallbackPortfolio = lazy(() => import('@/portfolio/FallbackPortfolio'))

export type AppMode = 'game' | 'fallback'
export type FallbackReason = 'requested' | 'no-webgl' | 'error'

function decideMode(): { mode: AppMode; reason: FallbackReason | null } {
  if (params.lite) return { mode: 'fallback', reason: 'requested' }
  if (!webglAvailable()) return { mode: 'fallback', reason: 'no-webgl' }
  return { mode: 'game', reason: null }
}

const PANELS: PanelId[] = ['resume', 'harmony', 'codestory', 'github', 'project', 'rec', 'rnd', 'contact', 'about', 'directory', 'settings', 'help', 'console', 'achievements', 'quicklinks']

export default function App() {
  const [{ mode, reason }, setMode] = useState(decideMode)
  const status = useGameStore((s) => s.status)

  // WebGL context loss / fatal 3D error → fall back to the HTML portfolio.
  useEffect(() => {
    if (status === 'error' && mode === 'game') setMode({ mode: 'fallback', reason: 'error' })
  }, [status, mode])

  // Deep link: ?panel=resume opens a portfolio panel on load (works in both modes).
  useEffect(() => {
    if (params.panel && (PANELS as string[]).includes(params.panel)) useUIStore.getState().openPanel(params.panel as PanelId)
  }, [])

  return (
    <>
      {mode === 'game' && (
        <CanvasBoundary onError={() => setMode({ mode: 'fallback', reason: 'error' })}>
          <Suspense fallback={null}>
            <GameCanvas />
          </Suspense>
        </CanvasBoundary>
      )}
      {mode === 'fallback' && (
        <Suspense fallback={<div className="boot-fallback">Loading portfolio…</div>}>
          <FallbackPortfolio reason={reason ?? 'requested'} />
        </Suspense>
      )}
      <UIRoot mode={mode} />
    </>
  )
}

class CanvasBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error) {
    console.error('[GameCanvas] fatal', error)
    recordDebugError(`[GameCanvas] ${error?.message ?? error}`)
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}
