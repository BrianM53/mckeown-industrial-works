import { create } from 'zustand'
import type { PlayerMode, QualityTier } from '@/core/types'

/**
 * Low-frequency, reactive game state (for React UI). Per-frame values live in
 * core/runtime.ts instead.
 */
interface GameStore {
  /** 'loading' until the 3D world has rendered its first frames. */
  status: 'loading' | 'ready' | 'error'
  setStatus: (s: GameStore['status']) => void

  /** Module slots loaded / total (drives the loading progress bar). */
  modulesLoaded: number
  modulesTotal: number
  markModuleLoaded: (name: string) => void
  registerModuleSlot: (name: string) => void
  loadedNames: string[]
  slotNames: string[]

  mode: PlayerMode
  setMode: (m: PlayerMode) => void

  /** Resolved render quality tier. */
  quality: QualityTier
  setQuality: (q: QualityTier) => void

  /** Night shift (blackout comedy event) active. writer: safety module */
  nightShift: boolean
  setNightShift: (v: boolean) => void

  /** Zone id of the zone the player is currently in (low-frequency). writer: player */
  currentZone: string | null
  setCurrentZone: (z: string | null) => void

  /** Unlocked achievements: id -> unlock order. writer: ui module (listens to 'achievement' events) */
  achievements: Record<string, number>
  unlockAchievement: (id: string) => boolean
}

export const useGameStore = create<GameStore>((set, get) => ({
  status: 'loading',
  setStatus: (status) => set({ status }),

  modulesLoaded: 0,
  modulesTotal: 0,
  loadedNames: [],
  slotNames: [],
  registerModuleSlot: (name) => {
    const names = get().slotNames
    if (names.includes(name)) return
    set({ slotNames: [...names, name], modulesTotal: names.length + 1 })
  },
  markModuleLoaded: (name) => {
    const names = get().loadedNames
    if (names.includes(name)) return
    set({ loadedNames: [...names, name], modulesLoaded: names.length + 1 })
  },

  mode: 'foot',
  setMode: (mode) => set({ mode }),

  quality: 'medium',
  setQuality: (quality) => set({ quality }),

  nightShift: false,
  setNightShift: (nightShift) => set({ nightShift }),

  currentZone: null,
  setCurrentZone: (currentZone) => {
    if (get().currentZone !== currentZone) set({ currentZone })
  },

  achievements: {},
  unlockAchievement: (id) => {
    const cur = get().achievements
    if (cur[id] !== undefined) return false
    set({ achievements: { ...cur, [id]: Object.keys(cur).length + 1 } })
    return true
  },
}))
