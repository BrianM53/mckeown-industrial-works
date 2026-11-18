import { useEffect } from 'react'
import { actions, isTypingTarget } from '@/core/actions'
import { useUIStore } from '@/state/ui'
import { isActivatable, isInsidePanel } from '../lib/focus'
import type { UIMode } from '../lib/mode'
import { togglePanel } from '../lib/nav'
import { focusMenuButton, useTopbarMenu } from '../topbar/menuStore'

/** Ignore the key event that opened a dialogue (another module's E handler can run first). */
const DIALOGUE_GRACE_MS = 150
/** Esc that just released pointer lock must not also open the pause menu. */
const UNLOCK_GRACE_MS = 300

/**
 * UI-owned keys (capture phase, so they work wherever focus is):
 *   M  toggle directory      P  toggle quick links      ?  toggle help
 *   Esc  close menu → close panel (if focus is outside it; the Panel handles its own)
 *        → close dialogue → (game mode, pointer not locked) open quick links as a pause menu
 *   E / Space  advance the dialogue bubble while it is open (consumed: never reaches game handlers)
 * Also registers the 'map' | 'menu' | 'quicklinks' | 'help' actions for touch buttons.
 */
export function useUIKeyboard(mode: UIMode): void {
  useEffect(() => {
    let dialogueOpenedAt = -Infinity
    let lastUnlock = -Infinity
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

    const offStore = useUIStore.subscribe((s, prev) => {
      if (s.dialogue && !prev.dialogue) dialogueOpenedAt = now()
    })
    const onLockChange = () => {
      if (!document.pointerLockElement) lastUnlock = now()
    }
    document.addEventListener('pointerlockchange', onLockChange)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      const ui = useUIStore.getState()
      const key = e.key

      if (key === 'Escape') {
        const menu = useTopbarMenu.getState()
        if (menu.open) {
          e.preventDefault()
          menu.setOpen(false)
          focusMenuButton()
          return
        }
        if (ui.panel) {
          // Inside the dialog the Panel closes itself; elsewhere (e.g. focus on the top bar) close it here.
          if (!isInsidePanel(e.target)) {
            e.preventDefault()
            ui.closePanel()
          }
          return
        }
        if (ui.dialogue) {
          e.preventDefault()
          ui.closeDialogue()
          return
        }
        if (mode !== 'game' || isTypingTarget(e.target)) return
        if (document.pointerLockElement || now() - lastUnlock < UNLOCK_GRACE_MS) return
        e.preventDefault()
        ui.openPanel('quicklinks')
        return
      }

      if (ui.dialogue && !ui.panel && !isTypingTarget(e.target)) {
        const isE = key === 'e' || key === 'E'
        const isSpace = key === ' ' && !isActivatable(e.target)
        if (isE || isSpace) {
          // The dialogue owns this key press. Stop it here (window, capture phase) so it never
          // reaches the player's E handler: advancing past the last line closes the bubble, and
          // the same keydown would otherwise re-interact and reopen the conversation at once.
          e.preventDefault()
          e.stopPropagation()
          if (e.repeat || now() - dialogueOpenedAt < DIALOGUE_GRACE_MS) return
          ui.advanceDialogue()
          return
        }
      }

      if (e.repeat || isTypingTarget(e.target)) return
      if (key === 'm' || key === 'M') {
        e.preventDefault()
        togglePanel('directory')
      } else if (key === 'p' || key === 'P') {
        e.preventDefault()
        togglePanel('quicklinks')
      } else if (key === '?') {
        e.preventDefault()
        togglePanel('help')
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    const offActions = [
      actions.on('map', () => togglePanel('directory')),
      actions.on('menu', () => togglePanel('quicklinks')),
      actions.on('quicklinks', () => togglePanel('quicklinks')),
      actions.on('help', () => togglePanel('help')),
    ]
    return () => {
      offStore()
      document.removeEventListener('pointerlockchange', onLockChange)
      window.removeEventListener('keydown', onKeyDown, true)
      offActions.forEach((off) => off())
    }
  }, [mode])
}
