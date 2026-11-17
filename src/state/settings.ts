import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

/**
 * Visitor preferences, persisted to localStorage when available (every access
 * is wrapped so private mode / blocked storage never breaks the site).
 */
export type QualitySetting = 'auto' | 'low' | 'medium' | 'high'

export interface SettingsState {
  masterVolume: number
  musicVolume: number
  sfxVolume: number
  /** Global mute. Audio also stays silent until `audioConsent` is true. */
  muted: boolean
  /** The visitor explicitly enabled sound at least once (opt-in after a gesture). */
  audioConsent: boolean
  reducedMotion: boolean
  /** 'system' = follow prefers-reduced-motion; 'user' = explicit choice. */
  reducedMotionSource: 'system' | 'user'
  quality: QualitySetting
  /** Orbit sensitivity multiplier (0.25..3). */
  cameraSensitivity: number
  invertY: boolean
  /** Desktop mouse-look via pointer lock (explicit opt-in). */
  pointerLock: boolean
  captions: boolean
  /** Involuntary ambient events (gags, PA). Player-triggered events always work. */
  ambientEvents: boolean
  showFps: boolean
  set: (patch: Partial<Omit<SettingsState, 'set' | 'reset'>>) => void
  reset: () => void
}

function systemReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

const DEFAULTS = {
  masterVolume: 0.8,
  musicVolume: 0.45,
  sfxVolume: 0.8,
  muted: false,
  audioConsent: false,
  reducedMotion: systemReducedMotion(),
  reducedMotionSource: 'system' as const,
  quality: 'auto' as QualitySetting,
  cameraSensitivity: 1,
  invertY: false,
  pointerLock: false,
  captions: true,
  ambientEvents: true,
  showFps: false,
}

const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value)
    } catch {
      /* ignore */
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name)
    } catch {
      /* ignore */
    }
  },
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (patch) => set(patch),
      reset: () => set({ ...DEFAULTS, reducedMotion: systemReducedMotion() }),
    }),
    {
      name: 'miw-settings-v1',
      storage: createJSONStorage(() => safeStorage),
      // Consent is session-scoped: never auto-start audio on a later visit without a new gesture.
      partialize: (s) => {
        const { set: _s, reset: _r, audioConsent: _c, ...rest } = s
        return rest
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>
        const merged = { ...current, ...p }
        if (merged.reducedMotionSource === 'system') merged.reducedMotion = systemReducedMotion()
        return merged
      },
    },
  ),
)

/** Follow OS-level reduced-motion changes unless the visitor overrode it. */
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  try {
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
      if (useSettings.getState().reducedMotionSource === 'system') useSettings.getState().set({ reducedMotion: e.matches })
    })
  } catch {
    /* ignore */
  }
}
