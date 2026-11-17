import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FallbackPortfolio from './FallbackPortfolio'

// Each test renders the whole document; leave headroom for slow CI runners and parallel suites.
vi.setConfig({ testTimeout: 15_000 })

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('FallbackPortfolio', () => {
  it.each([
    ['requested', /lite view/i, /^Try the 3D factory$/],
    ['error', /3D factory offline/i, /^Try the 3D factory again$/],
  ] as const)('%s: explains the situation and links back to the 3D factory without ?lite', (reason, label, cta) => {
    window.history.replaceState(null, '', '/?lite=1')
    render(<FallbackPortfolio reason={reason} />)
    expect(screen.getByTestId('fallback-portfolio')).toHaveAttribute('data-reason', reason)
    expect(screen.getByTestId('fallback-notice')).toHaveTextContent(label)
    const link = screen.getByTestId('fallback-try-3d')
    expect(link.textContent).toMatch(cta)
    expect(link).toHaveAttribute('href', import.meta.env.BASE_URL)
    expect(link.getAttribute('href')).not.toMatch(/lite/)
  })

  it('no-webgl: explains WebGL is missing and offers no 3D links', () => {
    const { container } = render(<FallbackPortfolio reason="no-webgl" />)
    expect(screen.getByTestId('fallback-notice')).toHaveTextContent(/WebGL/)
    expect(screen.queryByTestId('fallback-try-3d')).toBeNull()
    // (text filter instead of a whole-document getByRole name query, which is slow in jsdom)
    expect([...container.querySelectorAll('a')].filter((a) => /3d factory/i.test(a.textContent ?? ''))).toEqual([])
  })

  it('error: moves keyboard focus to the explanation (the canvas it was on is gone)', () => {
    render(<FallbackPortfolio reason="error" />)
    expect(document.activeElement).toBe(screen.getByTestId('fallback-notice'))
  })

  it('requested: does not steal focus on load', () => {
    render(<FallbackPortfolio reason="requested" />)
    expect(document.activeElement).toBe(document.body)
  })

  it('renders the full document inside exactly one <main> with one h1', () => {
    const { container } = render(<FallbackPortfolio reason="requested" />)
    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(container.querySelectorAll('h1')).toHaveLength(1)
    const main = screen.getByRole('main')
    expect(main).toContainElement(document.getElementById('resume'))
    // The document's <header>/<footer> sit inside <main>, so browsers do not expose them as
    // page-level banner/contentinfo landmarks (the app's own top bar may be the banner).
    expect(main).toContainElement(container.querySelector('header.pf-masthead') as HTMLElement)
    expect(main).toContainElement(container.querySelector('footer.pf-footer') as HTMLElement)
  })

  it('scrolls the page with Space / Page Down / arrows while focus is on <body>, and stops listening on unmount', () => {
    const { unmount } = render(<FallbackPortfolio reason="requested" />)
    const layer = screen.getByTestId('fallback-portfolio')
    Object.defineProperties(layer, {
      clientHeight: { value: 800, configurable: true },
      scrollHeight: { value: 6000, configurable: true },
      scrollTop: { value: 0, writable: true, configurable: true },
    })
    const scrollTo = vi.fn((opts: ScrollToOptions) => {
      layer.scrollTop = opts.top ?? 0
    })
    layer.scrollTo = scrollTo as unknown as typeof layer.scrollTo
    expect(document.activeElement).toBe(document.body)

    const press = (key: string, target: EventTarget = document.body) => {
      const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      target.dispatchEvent(e)
      return e
    }
    expect(press('PageDown').defaultPrevented).toBe(true)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 700, behavior: 'auto' })
    press('ArrowDown')
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 740, behavior: 'instant' })
    press('End')
    expect(layer.scrollTop).toBe(5200)

    // A focused link inside the page scrolls natively; an open modal panel owns the keyboard.
    const link = layer.querySelector('a')!
    expect(press(' ', link).defaultPrevented).toBe(false)
    const dialog = document.body.appendChild(document.createElement('div'))
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    expect(press('Home').defaultPrevented).toBe(false)
    dialog.remove()

    scrollTo.mockClear()
    unmount()
    press('PageUp')
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('scrolls a #section deep link into view once mounted', () => {
    const spy = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = spy
    try {
      window.history.replaceState(null, '', '/?lite=1#resume')
      render(<FallbackPortfolio reason="requested" />)
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.contexts[0]).toBe(document.getElementById('resume'))
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })
})
