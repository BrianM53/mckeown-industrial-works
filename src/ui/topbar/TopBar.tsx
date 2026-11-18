import { useEffect, useRef, type MouseEvent } from 'react'
import { PROFILE } from '@/content/profile'
import { HARMONY } from '@/content/stations'
import { events } from '@/core/events'
import { useSettings } from '@/state/settings'
import { useUIStore, type PanelId } from '@/state/ui'
import { Icon, type IconName } from '../kit/Icon'
import { Keycap } from '../kit/Keycap'
import { focusGame, isPointerActivation } from '../lib/focus'
import { portfolioHref } from '../lib/links'
import type { UIMode } from '../lib/mode'
import { useIsTouch } from '../lib/modality'
import { openPanelFromControl } from '../lib/nav'
import { MENU_BUTTON_ID, useTopbarMenu } from './menuStore'

/**
 * Always-visible top bar (both modes): wordmark, portfolio navigation, opt-in
 * sound toggle and the "Skip game → View portfolio" escape hatch. Below the
 * desktop breakpoint the navigation collapses into a disclosure menu.
 */
interface NavItem {
  id: PanelId
  label: string
  icon: IconName
  shortcut?: string
  /** Icon-only on desktop widths (label stays in the accessible name and in the narrow menu). */
  compact?: boolean
  testId: string
  title: string
}

const NAV_LEAD: NavItem[] = [
  { id: 'directory', label: 'Directory', icon: 'map', shortcut: 'M', testId: 'open-directory', title: 'Factory directory & map (M)' },
  { id: 'quicklinks', label: 'Portfolio', icon: 'links', shortcut: 'P', testId: 'open-quicklinks', title: 'Portfolio quick links (P)' },
  { id: 'contact', label: 'Contact', icon: 'mail', testId: 'open-contact', title: 'Contact Brian' },
]

const NAV_TAIL: NavItem[] = [
  { id: 'settings', label: 'Settings', icon: 'sliders', compact: true, testId: 'open-settings', title: 'Settings' },
  { id: 'help', label: 'Help', icon: 'help', shortcut: '?', compact: true, testId: 'open-help', title: 'Help & controls (?)' },
]

const LIST_ID = 'miw-topbar-list'

export function TopBar({ mode }: { mode: UIMode }) {
  const activePanel = useUIStore((s) => s.panel?.id ?? null)
  const menuOpen = useTopbarMenu((s) => s.open)
  const setMenuOpen = useTopbarMenu((s) => s.setOpen)
  const touch = useIsTouch()
  const navRef = useRef<HTMLElement>(null)

  // Close the narrow-screen menu on any pointer press outside it, or when keyboard focus moves
  // to something outside it (Tab past the last item, a panel taking focus). `focusin` rather than
  // blur: Safari does not focus buttons on tap, so a blur-based close would hide the list mid-tap.
  useEffect(() => {
    if (!menuOpen) return
    const outside = (t: EventTarget | null) => !!navRef.current && t instanceof Node && !navRef.current.contains(t)
    const onDown = (e: PointerEvent) => {
      if (outside(e.target)) setMenuOpen(false)
    }
    const onFocusIn = (e: FocusEvent) => {
      if (outside(e.target)) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [menuOpen, setMenuOpen])

  // Never leave the menu hanging open on unmount (e.g. game → fallback switch).
  useEffect(() => () => useTopbarMenu.getState().setOpen(false), [])

  const onNav = (item: NavItem) => (e: MouseEvent<HTMLButtonElement>) => {
    setMenuOpen(false)
    const ui = useUIStore.getState()
    if (ui.panel?.id === item.id) {
      ui.closePanel()
      return
    }
    openPanelFromControl(item.id, e)
  }

  const renderItem = (item: NavItem) => (
    <li key={item.id}>
      <button
        type="button"
        className={`miw-tb-btn${item.compact ? ' miw-tb-btn--compact' : ''}${activePanel === item.id ? ' is-active' : ''}`}
        onClick={onNav(item)}
        aria-haspopup="dialog"
        aria-keyshortcuts={item.shortcut}
        title={item.title}
        data-testid={item.testId}
      >
        <Icon name={item.icon} />
        <span className="miw-tb-btn__label">{item.label}</span>
        {item.shortcut && !touch && (
          <span className="miw-tb-btn__key" aria-hidden="true">
            <Keycap size="sm">{item.shortcut}</Keycap>
          </span>
        )}
      </button>
    </li>
  )

  return (
    <header className="miw-topbar" data-testid="topbar" data-menu-open={menuOpen ? '' : undefined}>
      {mode === 'game' && (
        // First tab stop on the page: keyboard and screen-reader visitors can leave the 3D view at once.
        <a className="miw-skiplink" href={portfolioHref()} data-testid="skip-link">
          Skip the 3D factory: view the portfolio page
        </a>
      )}
      <button
        type="button"
        className="miw-wordmark"
        onClick={(e) => openPanelFromControl('about', e)}
        title="About this site"
        aria-haspopup="dialog"
        data-testid="open-about"
      >
        <span className="miw-wordmark__logo" aria-hidden="true">
          <Icon name="factory" size={22} />
        </span>
        <span className="miw-wordmark__text">
          <span className="miw-wordmark__name">McKEOWN INDUSTRIAL WORKS</span>
          <span className="miw-wordmark__sub">
            {PROFILE.name}
            <span className="miw-wordmark__role">
              {' · '}
              {HARMONY.role}, {HARMONY.company}
            </span>
          </span>
        </span>
        <span className="sr-only"> (about this site)</span>
      </button>

      <nav ref={navRef} className="miw-topbar__nav" aria-label="Site">
        <button
          id={MENU_BUTTON_ID}
          type="button"
          className="miw-tb-btn miw-topbar__menu-btn"
          aria-expanded={menuOpen}
          aria-controls={LIST_ID}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <Icon name={menuOpen ? 'close' : 'menu'} />
          <span className="miw-tb-btn__label">Menu</span>
        </button>
        <ul id={LIST_ID} className="miw-topbar__list">
          {NAV_LEAD.map(renderItem)}
          <li>
            <SoundToggle onToggled={() => setMenuOpen(false)} available={mode === 'game'} />
          </li>
          {NAV_TAIL.map(renderItem)}
        </ul>
      </nav>

      <a className="miw-skip" href={portfolioHref()} data-testid="skip-game">
        {mode === 'game' ? (
          <>
            <span className="miw-skip__lead">Skip game →</span> <span className="miw-skip__main">View portfolio</span>
          </>
        ) : (
          <>
            <span className="miw-skip__main">View portfolio</span>
            <span className="miw-skip__tail"> page</span>
          </>
        )}
      </a>
    </header>
  )
}

/**
 * Opt-in sound switch. Sound never starts on its own: the first click records
 * consent (settings.audioConsent) and unmutes; later clicks toggle mute.
 * `available` is false in the HTML fallback (no audio engine runs there): the switch then
 * stays visible but inert and says why, instead of claiming "On" while nothing can play.
 */
export function SoundToggle({ onToggled, available = true }: { onToggled?: () => void; available?: boolean }) {
  const consent = useSettings((s) => s.audioConsent)
  const muted = useSettings((s) => s.muted)
  const on = available && consent && !muted

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (!available) return
    const s = useSettings.getState()
    if (!s.audioConsent) s.set({ audioConsent: true, muted: false })
    else s.set({ muted: !s.muted })
    const nowOn = useSettings.getState().audioConsent && !useSettings.getState().muted
    if (nowOn) events.emit('sfx', { name: 'ui-click' })
    onToggled?.()
    if (isPointerActivation(e)) focusGame()
  }

  const title = !available ? 'Sound plays in the 3D factory only' : on ? 'Sound is on. Click to mute.' : 'Sound is off. Click to turn it on.'
  return (
    <button
      type="button"
      className={`miw-tb-btn miw-tb-btn--sound${on ? ' is-on' : ''}`}
      aria-pressed={on}
      aria-disabled={available ? undefined : true}
      onClick={onClick}
      title={title}
      data-testid="sound-toggle"
    >
      <Icon name={on ? 'sound-on' : 'sound-off'} />
      <span className="miw-tb-btn__label">Sound</span>
      {!available && <span className="sr-only"> (plays in the 3D factory only)</span>}
      <span className="miw-tb-btn__state" aria-hidden="true">
        <span className="miw-led" />
        {on ? 'On' : 'Off'}
      </span>
    </button>
  )
}
