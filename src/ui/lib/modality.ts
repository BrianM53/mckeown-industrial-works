import { create } from 'zustand'

/**
 * Current input modality. Touch controls show on coarse-pointer devices or as
 * soon as a touch is seen; using a mouse switches back (hybrid laptops/tablets).
 * `forced` is a debug/test override (__MIW__.ui.forceTouch).
 */
function coarsePointer(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

interface ModalityState {
  touch: boolean
  forced: boolean | null
  setTouch: (v: boolean) => void
  force: (v: boolean | null) => void
}

export const useModality = create<ModalityState>((set, get) => ({
  touch: coarsePointer(),
  forced: null,
  setTouch: (v) => {
    if (get().touch !== v) set({ touch: v })
  },
  force: (v) => set({ forced: v }),
}))

export function useIsTouch(): boolean {
  return useModality((s) => s.forced ?? s.touch)
}

/** Install global listeners that follow the visitor's input modality. Returns cleanup. */
export function installModalityTracking(): () => void {
  if (typeof window === 'undefined') return () => {}
  const onTouchStart = () => useModality.getState().setTouch(true)
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch') useModality.getState().setTouch(true)
    else if (e.pointerType === 'mouse') useModality.getState().setTouch(false)
  }
  const opts: AddEventListenerOptions = { capture: true, passive: true }
  window.addEventListener('touchstart', onTouchStart, opts)
  window.addEventListener('pointerdown', onPointerDown, opts)
  return () => {
    window.removeEventListener('touchstart', onTouchStart, opts)
    window.removeEventListener('pointerdown', onPointerDown, opts)
  }
}
