import { createContext, useContext } from 'react'

/** 'game' = 3D factory running underneath; 'fallback' = HTML-only portfolio (no WebGL). */
export type UIMode = 'game' | 'fallback'

export const UIModeContext = createContext<UIMode>('game')

export function useUIMode(): UIMode {
  return useContext(UIModeContext)
}
