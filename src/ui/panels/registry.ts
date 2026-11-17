import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { PanelId } from '@/state/ui'

/** Props every panel component receives. */
export interface PanelComponentProps {
  params?: Record<string, string>
  onClose: () => void
}

type LazyPanel = LazyExoticComponent<ComponentType<PanelComponentProps>>

/**
 * PanelId → lazily loaded component. Owner: ui module.
 * 'console' is owned by the factory-sim module (src/factory/ui/ConsolePanel.tsx) — keep that mapping.
 */
const placeholder = lazy(() => import('./PlaceholderPanel'))

export const panelRegistry: Record<PanelId, LazyPanel> = {
  resume: placeholder,
  harmony: placeholder,
  codestory: placeholder,
  github: placeholder,
  project: placeholder,
  rec: placeholder,
  rnd: placeholder,
  contact: placeholder,
  about: placeholder,
  directory: placeholder,
  settings: placeholder,
  help: placeholder,
  achievements: placeholder,
  quicklinks: placeholder,
  console: lazy(() => import('@/factory/ui/ConsolePanel')),
}
