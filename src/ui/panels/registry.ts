import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { PanelId } from '@/state/ui'

/** Props every panel component receives. */
export interface PanelComponentProps {
  params?: Record<string, string>
  onClose: () => void
}

type PanelModule = { default: ComponentType<PanelComponentProps> }
type LazyPanel = LazyExoticComponent<ComponentType<PanelComponentProps>>

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

export const panelRegistry: Record<PanelId, LazyPanel> = Object.fromEntries(
  (Object.keys(loaders) as PanelId[]).map((id) => [id, lazy(loaders[id])]),
) as Record<PanelId, LazyPanel>

/** Warm every panel chunk (called once the page is idle) so panels open instantly. */
export function preloadPanels(): void {
  for (const load of Object.values(loaders)) load().catch(() => {})
}
