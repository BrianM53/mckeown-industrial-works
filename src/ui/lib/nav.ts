import { useUIStore, type PanelId } from '@/state/ui'
import { focusGame, isPointerActivation } from './focus'

/**
 * Open a panel from an overlay control. When nothing is open and the click came
 * from a pointer, focus first returns to the game view so that closing the panel
 * restores focus there (not onto the clicked button).
 */
export function openPanelFromControl(id: PanelId, e?: { detail?: number } | null, params?: Record<string, string>): void {
  const ui = useUIStore.getState()
  if (!ui.panel && isPointerActivation(e)) focusGame()
  ui.openPanel(id, params)
}

/** Toggle a panel (keyboard shortcuts M / P / ?, touch Map / Pause buttons). */
export function togglePanel(id: PanelId, e?: { detail?: number } | null): void {
  const ui = useUIStore.getState()
  if (ui.panel?.id === id) ui.closePanel()
  else openPanelFromControl(id, e)
}
