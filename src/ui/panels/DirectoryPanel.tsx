import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { getService } from '@/core/services'
import { useSettings } from '@/state/settings'
import { useUIStore } from '@/state/ui'
import type { ZoneId } from '@/world/layout'
import { Icon } from '../kit/Icon'
import { Panel } from '../kit/Panel'
import { DESTINATIONS, type Destination } from '../lib/destinations'
import { openPanelFromControl } from '../lib/nav'
import { useUIMode } from '../lib/mode'
import { usePoll } from '../lib/usePoll'
import { SiteMap } from './SiteMap'
import type { PanelComponentProps } from './registry'

/**
 * Factory directory (M). Every destination offers "Open now" (opens its panel in
 * both modes). In game mode it also offers "Show route" (in-world route +
 * beacon, rendered by the player module) and "Travel there" (explicit fast
 * travel with a fade). World-only destinations are hidden in fallback mode.
 */
export default function DirectoryPanel({ onClose }: PanelComponentProps) {
  const mode = useUIMode()
  const game = mode === 'game'
  const routeTarget = useUIStore((s) => s.routeTarget) as ZoneId | null
  const [highlight, setHighlight] = useState<string | null>(null)
  // The player service appears once the 3D world has loaded (the directory also works before that).
  const canTravel = usePoll(() => getService('player') !== undefined, 2, game)
  const listRef = useRef<HTMLDivElement>(null)

  const entries = useMemo(() => (game ? DESTINATIONS : DESTINATIONS.filter((d) => d.panel !== null)), [game])
  const principal = entries.filter((d) => d.principal)
  const more = entries.filter((d) => !d.principal)
  const selectable = useMemo(() => new Set<ZoneId>(entries.map((d) => d.zoneId)), [entries])

  useEffect(() => {
    if (!highlight) return
    const t = window.setTimeout(() => setHighlight(null), 1600)
    return () => window.clearTimeout(t)
  }, [highlight])

  const openNow = (d: Destination, e: MouseEvent<HTMLButtonElement>) => {
    if (d.panel) openPanelFromControl(d.panel, e)
  }
  const showRoute = (d: Destination) => {
    const ui = useUIStore.getState()
    if (ui.routeTarget === d.zoneId) ui.setRouteTarget(null)
    else ui.setRouteTarget(d.zoneId)
    onClose()
  }
  const travel = (d: Destination) => {
    getService('player')?.teleport(d.travel.x, d.travel.z, d.travel.yaw, { fade: true })
    onClose()
  }
  const selectZone = (zoneId: ZoneId) => {
    const d = entries.find((x) => x.zoneId === zoneId && x.key !== 'contact') ?? entries.find((x) => x.zoneId === zoneId)
    if (!d) return
    setHighlight(d.key)
    const el = listRef.current?.querySelector<HTMLElement>(`[data-dest="${d.key}"]`)
    el?.scrollIntoView?.({ block: 'nearest', behavior: useSettings.getState().reducedMotion ? 'auto' : 'smooth' })
  }

  const renderEntry = (d: Destination, index: number | null) => {
    const routed = routeTarget === d.zoneId
    return (
      <li
        key={d.key}
        className={`miw-dest${highlight === d.key ? ' is-highlight' : ''}${routed ? ' is-routed' : ''}`}
        style={{ '--zone': d.color } as CSSProperties}
        data-dest={d.key}
        data-testid={`dest-${d.key}`}
      >
        <span className="miw-dest__chip" aria-hidden="true">
          {index !== null ? String(index + 1).padStart(2, '0') : <Icon name={d.icon} size={16} />}
        </span>
        <div className="miw-dest__main">
          <h4 className="miw-dest__name">
            {d.name}
            <span className="miw-dest__short">{d.shortName}</span>
          </h4>
          <p className="miw-dest__blurb">{d.blurb}</p>
          <div className="miw-dest__actions">
            {d.panel && (
              <button type="button" className="miw-btn miw-btn--primary miw-btn--sm" aria-label={`Open now: ${d.name}`} onClick={(e) => openNow(d, e)}>
                <Icon name="open" size={16} /> Open now
              </button>
            )}
            {game && (
              <button type="button" className="miw-btn miw-btn--sm" aria-pressed={routed} aria-label={`${routed ? 'Hide route' : 'Show route'}: ${d.name}`} onClick={() => showRoute(d)}>
                <Icon name="route" size={16} /> {routed ? 'Hide route' : 'Show route'}
              </button>
            )}
            {game && (
              <button
                type="button"
                className="miw-btn miw-btn--sm"
                onClick={() => travel(d)}
                disabled={!canTravel}
                title={canTravel ? 'Fast travel (the screen fades briefly)' : 'Available once the factory has loaded'}
                aria-label={`Travel there: ${d.name}`}
              >
                <Icon name="travel" size={16} /> Travel there
              </button>
            )}
          </div>
        </div>
      </li>
    )
  }

  return (
    <Panel title="Factory directory" kicker={game ? 'Site plan · You are here' : 'Site plan'} size="lg" tone="hmi" onClose={onClose} testId="panel-directory">
      <div className="miw-dir">
        <div className="miw-dir__list" ref={listRef}>
          <h3 className="miw-dir__group">Portfolio destinations</h3>
          <ol className="miw-dests">{principal.map((d, i) => renderEntry(d, i))}</ol>
          {more.length > 0 && (
            <>
              <h3 className="miw-dir__group">More of the factory</h3>
              <ul className="miw-dests">{more.map((d) => renderEntry(d, null))}</ul>
            </>
          )}
          {game && (
            <p className="miw-meta miw-dir__note">
              <strong>Open now</strong> skips the walk. <strong>Show route</strong> paints a path and beacon in the factory.{' '}
              <strong>Travel there</strong> fast-travels you with a short fade.
            </p>
          )}
        </div>
        <div className="miw-dir__map">
          <SiteMap
            showPlayer={game}
            routeTarget={game ? routeTarget : null}
            highlight={highlight ? (entries.find((d) => d.key === highlight)?.zoneId ?? null) : null}
            onSelectZone={selectZone}
            selectable={selectable}
          />
          {game && routeTarget && (
            <button type="button" className="miw-btn miw-btn--sm miw-dir__clear" onClick={() => useUIStore.getState().setRouteTarget(null)}>
              <Icon name="close" size={16} /> Clear route
            </button>
          )}
          <p className="miw-dir__legend" aria-hidden="true">
            {game && (
              <>
                <span className="miw-dir__legend-you" /> You
                <span className="miw-dir__legend-route" /> Route
              </>
            )}
            <span className="miw-dir__legend-pad" /> Launch pad blast zone (keep out)
          </p>
        </div>
      </div>
    </Panel>
  )
}
