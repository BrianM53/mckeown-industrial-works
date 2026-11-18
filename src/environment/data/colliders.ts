/**
 * Every collider the environment module creates, as plain data. The physics
 * component renders exactly this list and the layout tests check it against
 * lanes, waypoint segments, doors and anchors.
 */
import type { Rect } from '@/core/types'
import { BUILDINGS, FADE_DOOR_BUILDINGS, wallBoxes } from './buildings'
import {
  ARCH,
  BARRIERS,
  DOOR_BOLLARDS,
  EXEC_OFFICE,
  FEATURES,
  FURNITURE,
  GANTRY,
  HALL,
  INCIDENT_BOARD,
  OBS_DECK,
  PROPS,
  PROP_HEIGHT,
  PROP_RADIUS,
  REC_GATE,
  RESTRICTED_SIGNS,
  TRANSFORMER,
  WATER_TOWER_LEGS,
  WEST_RACK_EXTRA_Z,
  featureFootprint,
} from './decor'
import { rotatedRectBounds } from './rects'
import { SIGNPOSTS } from './signposts'

export interface ColliderDef {
  id: string
  shape: 'box' | 'cyl'
  /** Center. */
  x: number
  y: number
  z: number
  /** Box half extents (local axes). */
  hx?: number
  hy?: number
  hz?: number
  /** Cylinder radius (half height = hy). */
  r?: number
  /** Rotation about +Y. */
  yaw?: number
  /** Rotation about +X (ramps). */
  pitch?: number
  /** 'static' blocks bodies and the camera; 'camera' blocks only the camera boom. */
  group: 'static' | 'camera'
  /** Category for tests/debug. */
  kind: 'building' | 'furniture' | 'feature' | 'prop' | 'barrier' | 'structure' | 'sign'
}

function box(id: string, kind: ColliderDef['kind'], r: Rect, y0: number, y1: number, group: ColliderDef['group'] = 'static'): ColliderDef {
  return {
    id,
    kind,
    shape: 'box',
    x: (r.minX + r.maxX) / 2,
    y: (y0 + y1) / 2,
    z: (r.minZ + r.maxZ) / 2,
    hx: (r.maxX - r.minX) / 2,
    hy: (y1 - y0) / 2,
    hz: (r.maxZ - r.minZ) / 2,
    group,
  }
}

function cyl(id: string, kind: ColliderDef['kind'], x: number, z: number, r: number, h: number): ColliderDef {
  return { id, kind, shape: 'cyl', x, y: h / 2, z, r, hy: h / 2, group: 'static' }
}

function obox(id: string, kind: ColliderDef['kind'], cx: number, cz: number, w: number, d: number, y0: number, y1: number, yaw: number): ColliderDef {
  return { id, kind, shape: 'box', x: cx, y: (y0 + y1) / 2, z: cz, hx: w / 2, hy: (y1 - y0) / 2, hz: d / 2, yaw, group: 'static' }
}

function buildColliders(): ColliderDef[] {
  const out: ColliderDef[] = []

  // Buildings: wall segments + door headers (headers block bodies above head height and the camera).
  for (const b of BUILDINGS) {
    wallBoxes(b).forEach((w, i) => {
      if (w.kind === 'header' && FADE_DOOR_BUILDINGS.has(b.id)) return
      out.push(box(`bldg:${b.id}:${w.kind}:${i}`, 'building', w.rect, w.y0, w.y1))
    })
  }

  // Interior furniture.
  FURNITURE.forEach((f, i) => out.push(box(`furn:${f.kind}:${i}`, 'furniture', f.rect, 0, f.h)))
  // Executive office: the glass door is part of the locked partition (covered by the glass walls).
  void EXEC_OFFICE

  // Features.
  FEATURES.forEach((f, i) => {
    if (f.detail) return
    if (f.kind === 'waterTower') {
      WATER_TOWER_LEGS.forEach(([dx, dz], k) => out.push(cyl(`feat:water:${i}:${k}`, 'feature', f.x + dx, f.z + dz, 0.32, 11)))
      return
    }
    const fp = featureFootprint(f)
    if (!fp) return
    if (fp.round) out.push(cyl(`feat:${f.kind}:${i}`, 'feature', f.x, f.z, fp.round, fp.h))
    else out.push(obox(`feat:${f.kind}:${i}`, 'feature', f.x, f.z, fp.w, fp.d, 0, fp.h, f.yaw ?? 0))
  })

  // Props.
  PROPS.forEach((p, i) => {
    if (p.noCollide) return
    out.push(cyl(`prop:${p.kind}:${i}`, 'prop', p.x, p.z, PROP_RADIUS[p.kind], PROP_HEIGHT[p.kind]))
  })
  DOOR_BOLLARDS.forEach(([x, z], i) => out.push(cyl(`prop:bollard-door:${i}`, 'prop', x, z, PROP_RADIUS.bollard, PROP_HEIGHT.bollard)))

  // Restricted-zone chain barriers (each span is a thin oriented box; posts are inside the spans).
  for (const bar of BARRIERS) {
    bar.spans.forEach((s, i) => {
      const dx = s.b[0] - s.a[0]
      const dz = s.b[1] - s.a[1]
      const len = Math.hypot(dx, dz)
      const yaw = Math.atan2(-dz, dx) // rotate local +x onto the span direction
      out.push(obox(`barrier:${bar.zone}:${i}`, 'barrier', (s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, len, 0.12, 0, 1.1, yaw))
    })
  }
  out.push(box('feat:transformer', 'feature', { minX: TRANSFORMER.x - TRANSFORMER.w / 2, maxX: TRANSFORMER.x + TRANSFORMER.w / 2, minZ: TRANSFORMER.z - TRANSFORMER.d / 2, maxZ: TRANSFORMER.z + TRANSFORMER.d / 2 }, 0, TRANSFORMER.h))
  out.push(cyl('feat:transformer-pole', 'feature', TRANSFORMER.pole[0], TRANSFORMER.pole[1], 0.14, 7.5))
  RESTRICTED_SIGNS.forEach((s, i) => {
    out.push(obox(`sign:restricted:${i}`, 'sign', s.x, s.z, 1.4, 0.14, 0, 2.3, s.yaw))
  })

  // Welcome arch, gantry, incident board.
  for (const sx of [-1, 1]) {
    const px = sx * ARCH.pillarX
    out.push(box(`struct:arch-pillar:${sx}`, 'structure', { minX: px - ARCH.pillar / 2, maxX: px + ARCH.pillar / 2, minZ: ARCH.z - ARCH.pillar / 2, maxZ: ARCH.z + ARCH.pillar / 2 }, 0, ARCH.height))
    const gx = sx * GANTRY.legX
    out.push(box(`struct:gantry-leg:${sx}`, 'structure', { minX: gx - GANTRY.leg / 2, maxX: gx + GANTRY.leg / 2, minZ: GANTRY.z - GANTRY.leg / 2, maxZ: GANTRY.z + GANTRY.leg / 2 }, 0, GANTRY.height))
  }
  out.push(box('struct:arch-beam', 'structure', { minX: -ARCH.pillarX, maxX: ARCH.pillarX, minZ: ARCH.z - 0.35, maxZ: ARCH.z + 0.35 }, ARCH.beamY0, ARCH.height, 'camera'))
  out.push(box('struct:gantry-beam', 'structure', { minX: -GANTRY.legX, maxX: GANTRY.legX, minZ: GANTRY.z - 0.45, maxZ: GANTRY.z + 0.45 }, Math.min(GANTRY.beamY0, GANTRY.panelY - GANTRY.panelH / 2 - 0.05), GANTRY.height, 'camera'))
  out.push(cyl('struct:incident-post', 'structure', INCIDENT_BOARD.postX, INCIDENT_BOARD.z, 0.09, INCIDENT_BOARD.y1))
  out.push(cyl('struct:rec-gate-n', 'structure', REC_GATE.x, REC_GATE.z0, 0.14, REC_GATE.height))
  out.push(cyl('struct:rec-gate-s', 'structure', REC_GATE.x, REC_GATE.z1, 0.14, REC_GATE.height))

  // Production hall columns (shared with the avenue racks) + extra west rack columns.
  const c = HALL.column / 2
  for (const z of HALL.columnZ)
    for (const sx of [-1, 1]) out.push(box(`struct:hall-col:${sx}:${z}`, 'structure', { minX: sx * HALL.x - c, maxX: sx * HALL.x + c, minZ: z - c, maxZ: z + c }, 0, HALL.trussY1))
  for (const z of WEST_RACK_EXTRA_Z) out.push(box(`struct:rack-col:${z}`, 'structure', { minX: -HALL.x - c, maxX: -HALL.x + c, minZ: z - c, maxZ: z + c }, 0, 6.2))

  // Observation deck: solid platform, ramp, landing, railings (opening at the landing).
  const d = OBS_DECK
  out.push(box('struct:obs-deck', 'structure', d.rect, 0, d.height))
  out.push(box('struct:obs-landing', 'structure', d.landing, 0, d.height))
  {
    const r = d.ramp
    const len = Math.abs(r.z1 - r.z0)
    const slope = Math.atan2(d.height, len)
    const hyp = Math.hypot(len, d.height)
    const t = 0.2
    out.push({
      id: 'struct:obs-ramp',
      kind: 'structure',
      shape: 'box',
      x: (r.minX + r.maxX) / 2,
      y: d.height / 2 - (t / 2) * Math.cos(slope),
      z: (r.z0 + r.z1) / 2 - (t / 2) * Math.sin(slope),
      hx: (r.maxX - r.minX) / 2,
      hy: t / 2,
      hz: hyp / 2,
      pitch: slope,
      group: 'static',
    })
  }
  const top = d.height
  const rail = (id: string, rr: Rect) => out.push(box(`struct:obs-rail:${id}`, 'structure', rr, top, top + 1.05))
  rail('n', { minX: d.landing.minX, maxX: d.rect.maxX, minZ: d.rect.minZ - 0.06, maxZ: d.rect.minZ + 0.06 })
  rail('e', { minX: d.rect.maxX - 0.06, maxX: d.rect.maxX + 0.06, minZ: d.rect.minZ, maxZ: d.rect.maxZ })
  rail('s', { minX: d.rect.minX, maxX: d.rect.maxX, minZ: d.rect.maxZ - 0.12, maxZ: d.rect.maxZ })
  rail('w', { minX: d.rect.minX - 0.06, maxX: d.rect.minX + 0.06, minZ: d.landing.maxZ + 0.1, maxZ: d.rect.maxZ })
  rail('landing-w', { minX: d.landing.minX - 0.06, maxX: d.landing.minX + 0.06, minZ: d.landing.minZ, maxZ: d.landing.maxZ })
  // ramp outer rail (follows the slope roughly: a low wall along the ramp's west edge)
  out.push(box('struct:obs-ramp-rail', 'structure', { minX: d.ramp.minX - 0.06, maxX: d.ramp.minX + 0.06, minZ: d.ramp.z1, maxZ: d.ramp.z0 }, 0, top + 1.05))

  // Signposts (thin posts).
  for (const s of SIGNPOSTS) out.push(cyl(`sign:post:${s.id}`, 'sign', s.position[0], s.position[1], 0.09, 3.1))

  return out
}

let cached: ColliderDef[] | null = null

export function environmentColliders(): ColliderDef[] {
  if (!cached) cached = buildColliders()
  return cached
}

/** Conservative ground-plane bounds of a collider. */
export function colliderBounds(c: ColliderDef): Rect {
  if (c.shape === 'cyl') {
    const r = c.r ?? 0
    return { minX: c.x - r, maxX: c.x + r, minZ: c.z - r, maxZ: c.z + r }
  }
  const hx = c.hx ?? 0
  let hz = c.hz ?? 0
  if (c.pitch) hz = Math.abs(hz * Math.cos(c.pitch)) + Math.abs((c.hy ?? 0) * Math.sin(c.pitch))
  return rotatedRectBounds(c.x, c.z, hx * 2, hz * 2, c.yaw ?? 0)
}

/** Top of a collider in world y. */
export function colliderTop(c: ColliderDef): number {
  return c.y + (c.hy ?? 0)
}
