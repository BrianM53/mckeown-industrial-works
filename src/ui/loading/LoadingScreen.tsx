import { useEffect, useState, type MouseEvent } from 'react'
import { useGameStore } from '@/state/game'
import { Icon } from '../kit/Icon'
import { portfolioHref } from '../lib/links'
import { openPanelFromControl } from '../lib/nav'

/** Rotating status lines while the factory loads (obvious in-world jokes). */
export const LOADING_LINES = [
  'Calibrating conveyor belts…',
  'Polishing hard hats…',
  'Counting rivets (twice)…',
  'Warming up the furnace…',
  'Negotiating with the forklift…',
  'Briefing the safety inspector…',
  'Untangling the main aisle…',
  'Refilling the coffee urn…',
  'Re-attaching the rocket fins…',
]

const LINE_MS = 1600
const FADE_MS = 650

/**
 * "POWERING UP THE FACTORY" screen shown in game mode while the world loads.
 * Sits under the top bar and panels, so navigation and every portfolio panel
 * stay usable while the 3D scene streams in. Fades out on 'ready'.
 */
export function LoadingScreen() {
  const status = useGameStore((s) => s.status)
  const loaded = useGameStore((s) => s.modulesLoaded)
  const total = useGameStore((s) => s.modulesTotal)
  const [mounted, setMounted] = useState(status === 'loading')
  const [line, setLine] = useState(0)

  useEffect(() => {
    if (status === 'loading') {
      setMounted(true)
      return
    }
    const t = window.setTimeout(() => setMounted(false), FADE_MS)
    return () => window.clearTimeout(t)
  }, [status])

  useEffect(() => {
    if (status !== 'loading') return
    const id = window.setInterval(() => setLine((i) => (i + 1) % LOADING_LINES.length), LINE_MS)
    return () => window.clearInterval(id)
  }, [status])

  if (!mounted) return null
  const leaving = status !== 'loading'
  const fraction = total > 0 ? Math.min(1, loaded / total) : 0
  const pct = leaving ? 100 : Math.round(fraction * 100)

  return (
    <section className={`miw-loading${leaving ? ' is-leaving' : ''}`} aria-label="Loading the factory" data-testid="loading-screen" inert={leaving || undefined}>
      <div className="miw-loading__plate">
        <p className="miw-loading__kicker">McKeown Industrial Works · Shift start</p>
        <p className="miw-loading__title">
          <Icon name="factory" size={34} className="miw-loading__gear" />
          <span>Powering up the factory</span>
        </p>
        <div
          className="miw-loading__bar"
          role="progressbar"
          aria-label="Loading the 3D factory"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={total > 0 ? `${loaded} of ${total} systems online` : 'Starting the 3D engine'}
        >
          <span className="miw-loading__fill" style={{ transform: `scaleX(${pct / 100})` }} />
          <span className="miw-loading__ticks" aria-hidden="true" />
        </div>
        <p className="miw-loading__count">
          <span>{total > 0 ? `${Math.min(loaded, total)}/${total} systems online` : 'Starting the 3D engine'}</span>
          <span>{pct}%</span>
        </p>
        <p className="miw-loading__line" aria-hidden="true">
          <span className="miw-loading__prompt">&gt;</span> {LOADING_LINES[line]}
        </p>
        <div className="miw-loading__actions">
          <button type="button" className="miw-btn miw-btn--primary" onClick={(e: MouseEvent<HTMLButtonElement>) => openPanelFromControl('quicklinks', e)}>
            <Icon name="links" size={18} /> Portfolio quick links
          </button>
          <a className="miw-btn" href={portfolioHref()}>
            Skip game → View portfolio
          </a>
        </div>
        <p className="miw-loading__note">The factory streams in the background. Everything in the top bar already works.</p>
      </div>
    </section>
  )
}
