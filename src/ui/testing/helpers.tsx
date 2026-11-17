import { configure, render, type RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import { expect, vi } from 'vitest'
import { useGameStore } from '@/state/game'
import { useSettings } from '@/state/settings'
import { useUIStore } from '@/state/ui'
import { clearFeed } from '../lib/feed'
import { UIModeContext, type UIMode } from '../lib/mode'
import { useModality } from '../lib/modality'
import { useTopbarMenu } from '../topbar/menuStore'

// UI tests render lazily loaded panels and drive them with user-event; give them headroom so a
// busy machine (full parallel suite, shared CI runner) can't turn slow chunk loads into failures.
vi.setConfig({ testTimeout: 30_000 })
configure({ asyncUtilTimeout: 8_000 })

/** Reset every store the UI reads so tests are independent. */
export function resetUIState(): void {
  clearFeed()
  useUIStore.setState({
    panel: null,
    returnFocus: null,
    dialogue: null,
    prompt: null,
    routeTarget: null,
    fade: { opacity: 0 },
    recoveryHint: null,
    controlsHintVisible: true,
  })
  useGameStore.setState({ status: 'loading', modulesLoaded: 0, modulesTotal: 0, loadedNames: [], slotNames: [], mode: 'foot', achievements: {} })
  useSettings.getState().reset()
  useSettings.setState({ audioConsent: false, muted: false })
  useModality.setState({ touch: false, forced: null })
  useTopbarMenu.setState({ open: false })
  try {
    window.localStorage.clear()
  } catch {
    /* ignore */
  }
}

export function renderInMode(ui: ReactElement, mode: UIMode = 'game', options?: RenderOptions) {
  return render(<UIModeContext.Provider value={mode}>{ui}</UIModeContext.Provider>, options)
}

/** Every http(s) link must open in a new tab with rel="noopener noreferrer". Returns the links checked. */
export function expectSafeExternalLinks(root: HTMLElement): HTMLAnchorElement[] {
  const links = [...root.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((a) => /^https?:\/\//i.test(a.getAttribute('href') ?? ''))
  for (const a of links) {
    expect(a.getAttribute('target'), a.href).toBe('_blank')
    const rel = (a.getAttribute('rel') ?? '').split(/\s+/)
    expect(rel, a.href).toContain('noopener')
    expect(rel, a.href).toContain('noreferrer')
  }
  return links
}

export function hrefs(links: HTMLAnchorElement[]): string[] {
  return links.map((a) => a.getAttribute('href') ?? '')
}
