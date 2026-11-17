import { afterEach, describe, expect, it, vi } from 'vitest'
import { LINE_STEP, forwardScrollKeys, scrollTargetForKey } from './keyboardScroll'

const at = (scrollTop: number) => ({ scrollTop, scrollHeight: 5000, clientHeight: 800 })
const PAGE = 700 // 800 * 0.875

describe('scrollTargetForKey', () => {
  it('maps arrows (instant), paging keys and Space (smooth) to a new position', () => {
    expect(scrollTargetForKey('ArrowDown', false, at(100))).toEqual({ top: 100 + LINE_STEP, smooth: false })
    expect(scrollTargetForKey('ArrowUp', false, at(100))).toEqual({ top: 100 - LINE_STEP, smooth: false })
    expect(scrollTargetForKey('PageDown', false, at(100))).toEqual({ top: 100 + PAGE, smooth: true })
    expect(scrollTargetForKey('PageUp', false, at(1000))).toEqual({ top: 1000 - PAGE, smooth: true })
    expect(scrollTargetForKey(' ', false, at(0))).toEqual({ top: PAGE, smooth: true })
    expect(scrollTargetForKey(' ', true, at(1000))).toEqual({ top: 1000 - PAGE, smooth: true })
    expect(scrollTargetForKey('Home', false, at(1000))).toEqual({ top: 0, smooth: true })
    expect(scrollTargetForKey('End', false, at(0))).toEqual({ top: 4200, smooth: true })
  })

  it('clamps to the scroll range and reports nothing to do at an edge', () => {
    expect(scrollTargetForKey('PageDown', false, at(4000))).toEqual({ top: 4200, smooth: true })
    expect(scrollTargetForKey('End', false, at(4200))).toBeNull()
    expect(scrollTargetForKey('ArrowUp', false, at(0))).toBeNull()
    expect(scrollTargetForKey('PageDown', false, { scrollTop: 0, scrollHeight: 500, clientHeight: 800 })).toBeNull()
  })

  it('ignores keys that do not scroll the page', () => {
    for (const key of ['Enter', 'Tab', 'm', 'ArrowLeft', 'ArrowRight', 'Escape']) expect(scrollTargetForKey(key, false, at(100)), key).toBeNull()
  })
})

describe('forwardScrollKeys', () => {
  let cleanup: (() => void) | null = null
  afterEach(() => {
    cleanup?.()
    cleanup = null
    document.body.innerHTML = ''
  })

  function setup() {
    const layer = document.body.appendChild(document.createElement('div'))
    const button = layer.appendChild(document.createElement('button'))
    Object.defineProperties(layer, {
      clientHeight: { value: 800, configurable: true },
      scrollHeight: { value: 5000, configurable: true },
      scrollTop: { value: 0, writable: true, configurable: true },
    })
    const scrollTo = vi.fn()
    layer.scrollTo = scrollTo as unknown as typeof layer.scrollTo
    cleanup = forwardScrollKeys(layer)
    return { layer, button, scrollTo }
  }

  const press = (target: EventTarget, init: KeyboardEventInit) => {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(e)
    return e
  }

  it('scrolls the layer for keys aimed at <body> and swallows them', () => {
    const { scrollTo } = setup()
    expect(press(document.body, { key: 'PageDown' }).defaultPrevented).toBe(true)
    expect(scrollTo).toHaveBeenCalledWith({ top: PAGE, behavior: 'auto' })
  })

  it('leaves focused controls, modifier shortcuts, handled keys and open dialogs alone', () => {
    const { button, scrollTo } = setup()
    expect(press(button, { key: ' ' }).defaultPrevented).toBe(false)
    expect(press(document.body, { key: 'End', ctrlKey: true }).defaultPrevented).toBe(false)
    expect(press(document.body, { key: 'ArrowDown', altKey: true }).defaultPrevented).toBe(false)

    const handled = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true })
    handled.preventDefault()
    document.body.dispatchEvent(handled)

    const dialog = document.body.appendChild(document.createElement('div'))
    dialog.setAttribute('aria-modal', 'true')
    expect(press(document.body, { key: 'PageDown' }).defaultPrevented).toBe(false)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('stops listening after cleanup', () => {
    const { scrollTo } = setup()
    cleanup?.()
    cleanup = null
    press(document.body, { key: 'PageDown' })
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
