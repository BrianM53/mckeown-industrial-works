import { createElement, lazy, type ComponentType, type ReactElement } from 'react'
import type { PanelId } from '@/state/ui'

/** Props every panel component receives. */
export interface PanelComponentProps {
  params?: Record<string, string>
  onClose: () => void
}

type PanelModule = { default: ComponentType<PanelComponentProps> }

/** A code-split panel: render it like a component; `preload()` fetches its chunk ahead of time. */
export interface LazyPanel {
  (props: PanelComponentProps): ReactElement
  preload: () => Promise<PanelModule>
  displayName?: string
}

/**
 * PanelId → lazily loaded component. Owner: ui module.
 * 'console' is owned by the factory-sim module (src/factory/ui/ConsolePanel.tsx) — keep that mapping.
 */
const loaders: Record<PanelId, () => Promise<PanelModule>> = {
  resume: () => import('./ResumePanel'),
  harmony: () => import('./HarmonyPanel'),
  codestory: () => import('./CodeStoryPanel'),
  github: () => import('./GithubPanel'),
  project: () => import('./ProjectPanel'),
  rec: () => import('./RecPanel'),
  rnd: () => import('./RndPanel'),
  contact: () => import('./ContactPanel'),
  about: () => import('./AboutPanel'),
  directory: () => import('./DirectoryPanel'),
  settings: () => import('./SettingsPanel'),
  help: () => import('./HelpPanel'),
  achievements: () => import('./AchievementsPanel'),
  quicklinks: () => import('./QuickLinksPanel'),
  console: () => import('@/factory/ui/ConsolePanel'),
}

/**
 * Like React.lazy, except that once the chunk has loaded (opened before, or warmed by
 * preloadPanels) the panel renders synchronously. React.lazy alone suspends on its first render
 * even for an already-downloaded chunk, and React then throttles the reveal (~300 ms), so every
 * panel-to-panel switch (Quick links → Résumé, Directory → Open now) flashed the backdrop.
 * Before the chunk arrives it renders through React.lazy (normal Suspense fallback). A failed
 * download is retried on the next open (React.lazy caches rejections, so it is recreated).
 */
export function lazyPanel(id: PanelId, load: () => Promise<PanelModule>): LazyPanel {
  let loaded: PanelModule | null = null
  let pending: Promise<PanelModule> | null = null
  const preload = (): Promise<PanelModule> => {
    if (!pending) {
      pending = load().then(
        (m) => {
          loaded = m
          return m
        },
        (err: unknown) => {
          pending = null
          viaLazy = lazy(preload)
          throw err
        },
      )
    }
    return pending
  }
  let viaLazy = lazy(preload)
  const Panel = ((props: PanelComponentProps) => createElement(loaded ? loaded.default : viaLazy, props)) as LazyPanel
  Panel.preload = preload
  Panel.displayName = `Panel(${id})`
  return Panel
}

export const panelRegistry: Record<PanelId, LazyPanel> = Object.fromEntries(
  (Object.keys(loaders) as PanelId[]).map((id) => [id, lazyPanel(id, loaders[id])]),
) as Record<PanelId, LazyPanel>

/** Warm every panel chunk (called once the page is idle) so panels open instantly. Never rejects. */
export function preloadPanels(): Promise<void> {
  return Promise.allSettled(Object.values(panelRegistry).map((p) => p.preload())).then(() => undefined)
}
