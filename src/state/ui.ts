import { create } from 'zustand'
import { events } from '@/core/events'

/**
 * Overlay/UI state shared between the HTML UI (src/ui) and the 3D world.
 * World modules call these actions (e.g. a station's onInteract opens its panel);
 * the ui module renders them.
 */
export type PanelId =
  | 'resume'
  | 'harmony'
  | 'codestory'
  | 'github'
  | 'project'
  | 'rec'
  | 'rnd'
  | 'contact'
  | 'about'
  | 'directory'
  | 'settings'
  | 'help'
  | 'console'
  | 'achievements'
  | 'quicklinks'

export interface PanelState {
  id: PanelId
  /** e.g. { projectId: 'gaussian-slam' } for the 'project' panel. */
  params?: Record<string, string>
}

export interface DialogueState {
  npcId: string
  name: string
  role: string
  lines: string[]
  index: number
}

export interface PromptState {
  id: string
  verb: string
  label: string
}

export interface FadeState {
  /** 0 = transparent, 1 = fully black. */
  opacity: number
  label?: string
}

interface UIStore {
  panel: PanelState | null
  /** Element focused before the panel opened; restored on close. */
  returnFocus: HTMLElement | null
  openPanel: (id: PanelId, params?: Record<string, string>) => void
  closePanel: () => void

  dialogue: DialogueState | null
  openDialogue: (d: Omit<DialogueState, 'index'>) => void
  advanceDialogue: () => void
  closeDialogue: () => void

  /** Current interaction prompt (written by the player module). */
  prompt: PromptState | null
  setPrompt: (p: PromptState | null) => void

  /** Directory waypoint / assisted route target (zone id), or null. */
  routeTarget: string | null
  setRouteTarget: (zoneId: string | null) => void

  fade: FadeState
  setFade: (f: FadeState) => void

  /** Non-intrusive recovery suggestion, e.g. "Stuck? Press R to recover". */
  recoveryHint: string | null
  setRecoveryHint: (text: string | null) => void

  /** Spawn controls hint visibility. */
  controlsHintVisible: boolean
  setControlsHintVisible: (v: boolean) => void
}

export const useUIStore = create<UIStore>((set, get) => ({
  panel: null,
  returnFocus: null,
  openPanel: (id, params) => {
    const prev = get().panel
    const active = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
    set({ panel: { id, params }, dialogue: null, returnFocus: prev ? get().returnFocus : active })
    if (prev && prev.id !== id) events.emit('panel:close', { id: prev.id })
    events.emit('panel:open', { id })
  },
  closePanel: () => {
    const prev = get().panel
    if (!prev) return
    const rf = get().returnFocus
    set({ panel: null, returnFocus: null })
    events.emit('panel:close', { id: prev.id })
    if (rf && typeof rf.focus === 'function' && document.contains(rf)) {
      try {
        rf.focus({ preventScroll: true })
      } catch {
        /* ignore */
      }
    } else if (typeof document !== 'undefined') {
      // Return focus to the game canvas region so keyboard play continues.
      const canvas = document.querySelector<HTMLElement>('[data-game-focus]')
      canvas?.focus({ preventScroll: true })
    }
  },

  dialogue: null,
  openDialogue: (d) => set({ dialogue: { ...d, index: 0 } }),
  advanceDialogue: () => {
    const d = get().dialogue
    if (!d) return
    if (d.index + 1 >= d.lines.length) set({ dialogue: null })
    else set({ dialogue: { ...d, index: d.index + 1 } })
  },
  closeDialogue: () => set({ dialogue: null }),

  prompt: null,
  setPrompt: (p) => {
    const cur = get().prompt
    if (cur === p) return
    if (cur && p && cur.id === p.id && cur.label === p.label && cur.verb === p.verb) return
    set({ prompt: p })
  },

  routeTarget: null,
  setRouteTarget: (zoneId) => set({ routeTarget: zoneId }),

  fade: { opacity: 0 },
  setFade: (f) => set({ fade: f }),

  recoveryHint: null,
  setRecoveryHint: (text) => {
    if (get().recoveryHint !== text) set({ recoveryHint: text })
  },

  controlsHintVisible: true,
  setControlsHintVisible: (v) => set({ controlsHintVisible: v }),
}))

/** True when a panel or dialogue is open: game input (movement, E, orbit) must be suppressed. */
export function isOverlayBlocking(): boolean {
  const s = useUIStore.getState()
  return s.panel !== null || s.dialogue !== null
}
