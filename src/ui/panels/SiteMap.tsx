import { useId, useMemo } from 'react'
import { runtime } from '@/core/runtime'
import type { Vec2 } from '@/core/types'
import { PAD, PATHS, TOWER, TRACK, WORLD_BOUNDS, ZONE_LIST, ZONES, type ZoneDef, type ZoneId } from '@/world/layout'
import { routeToZone } from '@/world/nav'
import { sameTuple, usePoll } from '../lib/usePoll'

/**
 * Schematic site plan generated from world/layout.ts: zone bounds as coloured
 * blocks, painted paths, the tower and pad, the visitor's position (polled from
 * runtime at 4 Hz) and the active route. North is up (−Z), 1 SVG unit = 1 m.
 * Decorative companion to the directory list (which is the accessible UI).
 */
const B = WORLD_BOUNDS
const W = B.maxX - B.minX
const H = B.maxZ - B.minZ

/** Label anchor overrides where the zone centre collides with other markers. */
const LABEL_AT: Partial<Record<ZoneId, Vec2>> = {
  launch: [-6, -42.5],
  production: [0, 15.5],
  intake: [0, 38.1],
}

const round1 = (v: number) => Math.round((Number.isFinite(v) ? v : 0) * 10) / 10

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const

/** Compass direction of a point seen from the middle of the site (north = −Z). */
export function compassFromSiteCentre([x, z]: Vec2): (typeof COMPASS)[number] | 'centre' {
  const dx = x - (B.minX + B.maxX) / 2
  const dz = z - (B.minZ + B.maxZ) / 2
  if (Math.hypot(dx, dz) < 12) return 'centre'
  const bearing = (Math.atan2(dx, -dz) * 180) / Math.PI // 0 = north, 90 = east
  return COMPASS[Math.round((bearing + 360) / 45) % 8]
}

/** Text alternative for the map, derived from layout.ts so it can never disagree with the world. */
export const SITE_DESCRIPTION: string = (() => {
  const where = (id: ZoneId) => {
    const d = compassFromSiteCentre(ZONES[id].center)
    return d === 'centre' ? 'in the middle' : `to the ${d}`
  }
  const principal = ZONE_LIST.filter((z) => z.principal).map((z) => `${z.name} (${z.shortName}) ${where(z.id)}`)
  return `Schematic map, north up. Portfolio destinations: ${principal.join('; ')}. The rocket tower stands ${where('tower')} and the launch yard lies ${where('launch')}.`
})()

export interface SiteMapProps {
  showPlayer: boolean
  routeTarget: ZoneId | null
  highlight?: ZoneId | null
  /** Pointer convenience only (the directory list is the accessible UI): click a zone to find its entry. */
  onSelectZone?: (id: ZoneId) => void
  /** Zones that react to clicks (default: all, when onSelectZone is given). */
  selectable?: ReadonlySet<ZoneId>
}

export function SiteMap({ showPlayer, routeTarget, highlight, onSelectZone, selectable }: SiteMapProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const player = usePoll<[number, number, number] | null>(
    () => (showPlayer ? [round1(runtime.player.position.x), round1(runtime.player.position.z), Math.round(runtime.player.facing * 20) / 20] : null),
    4,
    showPlayer,
    sameTuple,
  )

  const route = useMemo(() => {
    if (!routeTarget || !ZONES[routeTarget]) return null
    const from: Vec2 = player ? [player[0], player[1]] : ZONES.intake.entrance
    try {
      return routeToZone(from[0], from[1], routeTarget)
    } catch {
      return null
    }
  }, [routeTarget, player])

  // Principal zones drawn last so their outlines sit on top.
  const zones = useMemo(() => [...ZONE_LIST].sort((a, b) => Number(a.principal) - Number(b.principal)), [])
  const target = routeTarget ? ZONES[routeTarget] : null

  return (
    <svg
      className="miw-map"
      viewBox={`${B.minX - 2} ${B.minZ - 2} ${W + 4} ${H + 4}`}
      role="img"
      aria-labelledby={`${uid}-t ${uid}-d`}
      data-testid="site-map"
    >
      <title id={`${uid}-t`}>Site plan of McKeown Industrial Works</title>
      <desc id={`${uid}-d`}>{SITE_DESCRIPTION}</desc>
      <defs>
        <pattern id={`${uid}-grid`} width="10" height="10" patternUnits="userSpaceOnUse" x={B.minX} y={B.minZ}>
          <path d="M10 0H0V10" fill="none" stroke="rgba(233,228,214,0.06)" strokeWidth="0.25" />
        </pattern>
        <pattern id={`${uid}-hatch`} width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="1" height="2" fill="rgba(255,176,90,0.55)" />
        </pattern>
      </defs>

      {/* site slab + grid */}
      <rect x={B.minX} y={B.minZ} width={W} height={H} rx="1.2" className="miw-map__slab" />
      <rect x={B.minX} y={B.minZ} width={W} height={H} fill={`url(#${uid}-grid)`} />

      {/* painted paths */}
      {PATHS.map((p) => (
        <rect
          key={p.id}
          x={p.rect.minX}
          y={p.rect.minZ}
          width={p.rect.maxX - p.rect.minX}
          height={p.rect.maxZ - p.rect.minZ}
          className={`miw-map__path miw-map__path--${p.kind}`}
        />
      ))}

      {/* rocket transporter track */}
      <polyline points={TRACK.points.map(([x, z]) => `${x},${z}`).join(' ')} className="miw-map__track" />

      {/* zones */}
      {zones.map((z) => (
        <ZoneBlock
          key={z.id}
          zone={z}
          active={z.id === routeTarget || z.id === highlight}
          onSelect={onSelectZone && (!selectable || selectable.has(z.id)) ? onSelectZone : undefined}
        />
      ))}

      {/* tower + pad */}
      <rect
        x={TOWER.footprint.minX}
        y={TOWER.footprint.minZ}
        width={TOWER.footprint.maxX - TOWER.footprint.minX}
        height={TOWER.footprint.maxZ - TOWER.footprint.minZ}
        fill={`url(#${uid}-hatch)`}
        className="miw-map__tower"
      />
      <text x={TOWER.center[0]} y={TOWER.center[1] + 1} className="miw-map__marker-label">
        TOWER
      </text>
      <circle cx={PAD.center[0]} cy={PAD.center[1]} r={PAD.blastRadius} className="miw-map__blast" />
      <circle cx={PAD.center[0]} cy={PAD.center[1]} r={PAD.size / 2 - 2.5} className="miw-map__pad" />
      <text x={PAD.center[0]} y={PAD.center[1] + 1} className="miw-map__marker-label">
        PAD
      </text>

      {/* route + beacon */}
      {route && route.length > 1 && <polyline points={route.map(([x, z]) => `${x},${z}`).join(' ')} className="miw-map__route" />}
      {target && (
        <g className="miw-map__beacon" transform={`translate(${target.entrance[0]} ${target.entrance[1]})`}>
          <circle r="3.4" className="miw-map__beacon-ring" />
          <circle r="1.3" className="miw-map__beacon-dot" />
        </g>
      )}

      {/* visitor */}
      {player && (
        <g className="miw-map__you" transform={`translate(${player[0]} ${player[1]}) rotate(${(-player[2] * 180) / Math.PI})`}>
          <circle r="3.2" className="miw-map__you-halo" />
          <path d="M0 -2.6 L1.9 1.9 L0 0.9 L-1.9 1.9 Z" className="miw-map__you-arrow" />
        </g>
      )}
      {player && (
        <text x={player[0]} y={player[1] < B.minZ + 8 ? player[1] + 5.8 : player[1] - 4.2} className="miw-map__you-label">
          YOU
        </text>
      )}

      {/* compass */}
      <g transform={`translate(${B.maxX - 4.5} ${B.minZ + 5})`} className="miw-map__compass" aria-hidden="true">
        <circle r="3.4" />
        <path d="M0 -2.6 L1.3 0.8 L0 0.2 L-1.3 0.8 Z" />
        <text y="6.6">N</text>
      </g>
    </svg>
  )
}

function ZoneBlock({ zone, active, onSelect }: { zone: ZoneDef; active: boolean; onSelect?: (id: ZoneId) => void }) {
  const b = zone.bounds
  const [lx, lz] = LABEL_AT[zone.id] ?? zone.center
  const big = zone.principal
  const broad = zone.id === 'launch' || zone.id === 'production' || zone.id === 'tower'
  return (
    <g
      className={`miw-map__zone${big ? ' is-principal' : ''}${broad ? ' is-broad' : ''}${active ? ' is-active' : ''}${onSelect ? ' is-clickable' : ''}`}
      style={{ ['--zone' as string]: zone.color }}
      onClick={onSelect ? () => onSelect(zone.id) : undefined}
    >
      <rect x={b.minX} y={b.minZ} width={b.maxX - b.minX} height={b.maxZ - b.minZ} rx="0.6" className="miw-map__zone-rect" />
      {zone.id !== 'tower' && (
        <text x={lx} y={lz + (big ? 1.1 : 0.9)} className="miw-map__zone-label">
          {zone.shortName}
        </text>
      )}
    </g>
  )
}
