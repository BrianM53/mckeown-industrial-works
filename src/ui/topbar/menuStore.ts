import { create } from 'zustand'

/** Narrow-screen top-bar menu (disclosure) state, shared with the global keyboard handler (Esc). */
interface TopbarMenuState {
  open: boolean
  setOpen: (open: boolean) => void
}

export const useTopbarMenu = create<TopbarMenuState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))

export const MENU_BUTTON_ID = 'miw-topbar-menu-button'

export function focusMenuButton(): void {
  document.getElementById(MENU_BUTTON_ID)?.focus({ preventScroll: true })
}
