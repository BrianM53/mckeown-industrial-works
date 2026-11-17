/**
 * Focus helpers. Mouse/touch clicks on overlay buttons hand keyboard focus back
 * to the 3D view, so Space/Enter (forklift horn, etc.) never re-activate a
 * button the visitor clicked earlier. Keyboard activation keeps focus where it
 * is, so it can be restored to the control when a panel closes.
 */
export function focusGame(): void {
  if (typeof document === 'undefined') return
  const target = document.querySelector<HTMLElement>('[data-game-focus]')
  if (target) {
    try {
      target.focus({ preventScroll: true })
      return
    } catch {
      /* fall through */
    }
  }
  const active = document.activeElement
  if (active instanceof HTMLElement && active !== document.body) active.blur()
}

/** True for a click produced by a mouse/touch pointer (detail > 0), false for keyboard activation. */
export function isPointerActivation(e: { detail?: number } | null | undefined): boolean {
  return !!e && typeof e.detail === 'number' && e.detail > 0
}

/** Is the event target inside an open panel dialog? */
export function isInsidePanel(target: EventTarget | null): boolean {
  return typeof Element !== 'undefined' && target instanceof Element && target.closest('.miw-panel') !== null
}

/** Elements whose native activation already handles Space/Enter. */
export function isActivatable(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false
  return target.closest('button, a[href], [role="button"], [role="switch"], summary') !== null
}
