import { Component, Suspense, useEffect, type ReactNode } from 'react'
import { ACHIEVEMENTS } from '@/content/achievements'
import { registerDebug, recordDebugError } from '@/core/debug'
import { events, useGameEvent } from '@/core/events'
import { useGameStore } from '@/state/game'
import { useSettings } from '@/state/settings'
import { useUIStore, type PanelId } from '@/state/ui'
import { PRINCIPAL_ZONES, ZONES } from '@/world/layout'
import { Hud } from './hud/Hud'
import { Toasts } from './hud/Toasts'
import { useUIKeyboard } from './input/useUIKeyboard'
import { Panel } from './kit/Panel'
import { clearFeed, pushCaption, pushToast } from './lib/feed'
import { portfolioHref } from './lib/links'
import { UIModeContext, type UIMode } from './lib/mode'
import { installModalityTracking, useIsTouch, useModality } from './lib/modality'
import { LoadingScreen } from './loading/LoadingScreen'
import { panelRegistry, preloadPanels } from './panels/registry'
import { TopBar } from './topbar/TopBar'
import { TouchControls } from './touch/TouchControls'
import './ui.css'
import './panels/panels.css'

/**
 * The HTML overlay above the canvas.
 *   game mode:     top bar, HUD (prompt, hint, captions, launch strip, dialogue, fade…),
 *                  touch controls, loading screen, panels, toasts
 *   fallback mode: top bar, panels (directory with "Open now" only), toasts — no WebGL use
 */
export default function UIRoot({ mode }: { mode: UIMode }) {
  const touch = useIsTouch()
  const panelId = useUIStore((s) => s.panel?.id ?? null)
  useUIKeyboard(mode)
  useUIEffects(mode)

  return (
    <UIModeContext.Provider value={mode}>
      <div className="ui-root" data-mode={mode} data-touch={mode === 'game' && touch ? '' : undefined} data-panel={panelId ?? undefined}>
        <TopBar mode={mode} />
        {mode === 'game' && <Hud />}
        {mode === 'game' && <TouchControls />}
        {mode === 'game' && <LoadingScreen />}
        <PanelHost />
        <Toasts />
      </div>
    </UIModeContext.Provider>
  )
}

function PanelHost() {
  const panel = useUIStore((s) => s.panel)
  const close = useUIStore((s) => s.closePanel)
  if (!panel) return null
  const Comp = panelRegistry[panel.id]
  if (!Comp) return null
  const key = `${panel.id}:${JSON.stringify(panel.params ?? {})}`
  return (
    <PanelBoundary key={key} id={panel.id} onClose={close}>
      <Suspense fallback={<PanelLoading />}>
        <Comp params={panel.params} onClose={close} />
      </Suspense>
    </PanelBoundary>
  )
}

function PanelLoading() {
  return (
    <div className="miw-panel-loading" role="status" data-testid="panel-loading">
      <span className="miw-panel-loading__dot" aria-hidden="true" />
      Opening…
    </div>
  )
}

/** A crashing panel (or a failed chunk download) shows a graceful fallback instead of breaking the page. */
class PanelBoundary extends Component<{ id: PanelId; onClose: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error) {
    const msg = `[ui:panel:${this.props.id}] ${error?.message ?? error}`
    console.error(msg, error)
    recordDebugError(msg)
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <Panel title="Panel unavailable" kicker="Maintenance notice" size="sm" tone="paper" onClose={this.props.onClose} testId="panel-error">
        <p>This panel hit a snag while loading. The rest of the site still works.</p>
        <p>
          <a className="miw-btn miw-btn--primary" href={portfolioHref()}>
            View the plain HTML portfolio
          </a>
        </p>
      </Panel>
    )
  }
}

const PRINCIPAL_PANELS = new Set<string>(PRINCIPAL_ZONES.map((z) => ZONES[z].panel).filter((p): p is NonNullable<typeof p> => !!p))

/** Global wiring that has no visual of its own. */
function useUIEffects(mode: UIMode): void {
  const reducedMotion = useSettings((s) => s.reducedMotion)
  const motionSource = useSettings((s) => s.reducedMotionSource)
  const status = useGameStore((s) => s.status)

  // Input modality (touch vs mouse) tracking.
  useEffect(() => installModalityTracking(), [])

  // Document-level mode flags (fallback page scrolling, reduced-motion CSS).
  useEffect(() => {
    const root = document.documentElement
    root.dataset.miwMode = mode
    return () => {
      if (root.dataset.miwMode === mode) delete root.dataset.miwMode
    }
  }, [mode])
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('miw-reduced-motion', reducedMotion)
    root.classList.toggle('miw-motion-ok', !reducedMotion && motionSource === 'user')
  }, [reducedMotion, motionSource])

  // Toasts (both modes) + achievements.
  useGameEvent('toast', (p) => {
    if (p && typeof p.text === 'string') pushToast(p)
  })
  useGameEvent('achievement', (p) => {
    const a = ACHIEVEMENTS.find((x) => x.id === p?.id)
    if (!a) return
    if (!useGameStore.getState().unlockAchievement(a.id)) return
    pushToast({ title: 'Achievement unlocked', text: a.title, kind: 'success', variant: 'achievement', duration: 5 })
    events.emit('sfx', { name: 'achievement' })
  })

  // "Full Site Tour": opened all five principal destinations.
  useEffect(() => {
    const seen = new Set<string>()
    return events.on('panel:open', ({ id }) => {
      if (!PRINCIPAL_PANELS.has(id)) return
      seen.add(id)
      if (seen.size >= PRINCIPAL_PANELS.size) events.emit('achievement', { id: 'all-stations' })
    })
  }, [])

  // Panels need the cursor: release pointer lock when one opens.
  useEffect(
    () =>
      useUIStore.subscribe((s, prev) => {
        if (s.panel && !prev.panel && typeof document !== 'undefined' && document.pointerLockElement) {
          try {
            document.exitPointerLock()
          } catch {
            /* ignore */
          }
        }
      }),
    [],
  )

  // Warm panel chunks once the page is idle (after the world in game mode). Once warm, panels
  // open and switch synchronously (see panels/registry.ts).
  useEffect(() => {
    if (mode === 'game' && status === 'loading') return
    const t = window.setTimeout(() => void preloadPanels(), mode === 'game' ? 1200 : 600)
    return () => window.clearTimeout(t)
  }, [mode, status])

  // Dev/test hooks: window.__MIW__.ui
  useEffect(
    () =>
      registerDebug('ui', {
        openPanel: (id: PanelId, params?: Record<string, string>) => useUIStore.getState().openPanel(id, params),
        closePanel: () => useUIStore.getState().closePanel(),
        getState: () => {
          const s = useUIStore.getState()
          return { panel: s.panel, dialogue: s.dialogue, prompt: s.prompt, routeTarget: s.routeTarget }
        },
        // duration in seconds (optional; default = reading time)
        toast: (text: string, kind?: 'info' | 'success' | 'warning', duration?: number) => pushToast({ text, kind, duration }),
        caption: (text: string, kind?: 'sound' | 'pa' | 'info' | 'warning', duration?: number) => pushCaption({ text, kind, duration }),
        forceTouch: (on: boolean | null) => useModality.getState().force(on),
        // Staging helpers for screenshots / e2e (these normally come from other modules).
        setPrompt: (p: { id: string; verb: string; label: string } | null) => useUIStore.getState().setPrompt(p),
        openDialogue: (d: { npcId: string; name: string; role: string; lines: string[] }) => useUIStore.getState().openDialogue(d),
        setRecoveryHint: (text: string | null) => useUIStore.getState().setRecoveryHint(text),
        setFade: (opacity: number, label?: string) => useUIStore.getState().setFade({ opacity, label }),
        setRouteTarget: (zoneId: string | null) => useUIStore.getState().setRouteTarget(zoneId),
        // Re-show (true) or dismiss (false) the spawn controls hint; showing restarts its ~9 s timer.
        setControlsHint: (visible: boolean) => useUIStore.getState().setControlsHintVisible(!!visible),
      }),
    [],
  )

  useEffect(() => () => clearFeed(), [])
}
