import { describe, expect, it } from 'vitest'
import type { Rect } from '@/core/types'
import { ANCHORS, LINES, PATHS, QC_ARCH, WAYPOINTS, ZONE_LIST } from '@/world/layout'
import { ARCH, COLLECTOR_CFG, COLLIDERS, CONSOLE, GROUND_LINES, ITEM_STAGES, lineDef, MONORAIL, PLAQUES, REJECT, type ColliderSpec } from './config'
import { ALL_LINE_WORKER_SPOTS, LINE_WORKER_SPOTS } from './spots'

/** Distance from a point to a rect (0 inside). */
function distRect(x: number, z: number, r: Rect): number {
  const dx = Math.max(r.minX - x, 0, x - r.maxX)
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ)
  return Math.hypot(dx, dz)
}
function distCollider(x: number, z: number, c: ColliderSpec): number {
  if (c.shape === 'cyl' && c.c && c.r) return Math.max(0, Math.hypot(x - c.c[0], z - c.c[1]) - c.r)
  return distRect(x, z, c.rect)
}
const overlaps = (a: Rect, b: Rect) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ

/** Ground-level blockers (bodies collide with these). */
const GROUND = COLLIDERS.filter((c) => c.group === 'static' && c.y0 < 2.0)

describe('production colliders keep paths and doors clear', () => {
  it('collider specs are well formed and ids unique', () => {
    const ids = new Set<string>()
    for (const c of COLLIDERS) {
      expect(ids.has(c.id), c.id).toBe(false)
      ids.add(c.id)
      expect(c.rect.maxX > c.rect.minX && c.rect.maxZ > c.rect.minZ && c.y1 > c.y0, c.id).toBe(true)
      for (const v of [c.rect.minX, c.rect.maxX, c.rect.minZ, c.rect.maxZ, c.y0, c.y1]) expect(Number.isFinite(v), c.id).toBe(true)
    }
  })

  it('no ground collider intrudes on the main aisle, cross aisle, avenues or walkways', () => {
    const keepClear = PATHS.filter((p) => p.kind !== 'plaza' && p.kind !== 'spur')
    const bad: string[] = []
    for (const c of GROUND) for (const p of keepClear) if (overlaps(c.rect, p.rect)) bad.push(`${c.id} ∩ ${p.id}`)
    expect(bad).toEqual([])
  })

  it('ground machinery stays inside its line strip (or the band between the aisle and the strips)', () => {
    for (const id of GROUND_LINES) {
      const l = lineDef(id)
      for (const c of GROUND.filter((g) => g.id.startsWith(`${id}:`))) {
        expect(c.rect.minX, c.id).toBeGreaterThanOrEqual(l.x - l.width / 2 - 1e-6)
        expect(c.rect.maxX, c.id).toBeLessThanOrEqual(l.x + l.width / 2 + 1e-6)
        expect(c.rect.minZ, c.id).toBeGreaterThanOrEqual(l.zEnd - 1e-6)
      }
    }
  })

  it('every waypoint link keeps ≥ 0.6 m from ground machinery', () => {
    const bad: string[] = []
    for (const w of Object.values(WAYPOINTS)) {
      for (const id of w.links) {
        const o = WAYPOINTS[id]
        const [ax, az] = w.position
        const [bx, bz] = o.position
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.1))
        for (let i = 0; i <= n; i++) {
          const x = ax + ((bx - ax) * i) / n
          const z = az + ((bz - az) * i) / n
          for (const c of GROUND) if (distCollider(x, z, c) < 0.6) bad.push(`${w.id}>${id}: ${c.id}`)
        }
      }
    }
    expect([...new Set(bad)]).toEqual([])
  })

  it('no ground collider within 2.5 m of a building door', () => {
    for (const z of ZONE_LIST) {
      const b = z.building
      if (!b) continue
      const f = b.footprint
      const [s0, s1] = b.doorSpan
      const door: Rect =
        b.doorSide === 'E' ? { minX: f.maxX - 0.3, maxX: f.maxX + 0.3, minZ: s0, maxZ: s1 }
        : b.doorSide === 'W' ? { minX: f.minX - 0.3, maxX: f.minX + 0.3, minZ: s0, maxZ: s1 }
        : b.doorSide === 'N' ? { minX: s0, maxX: s1, minZ: f.minZ - 0.3, maxZ: f.minZ + 0.3 }
        : { minX: s0, maxX: s1, minZ: f.maxZ - 0.3, maxZ: f.maxZ + 0.3 }
      const grown: Rect = { minX: door.minX - 2.5, maxX: door.maxX + 2.5, minZ: door.minZ - 2.5, maxZ: door.maxZ + 2.5 }
      for (const c of GROUND) expect(overlaps(c.rect, grown), `${c.id} near ${z.id} door`).toBe(false)
    }
  })

  it('QC arch legs never narrow the aisle (inner faces at |x| ≥ 3.7)', () => {
    const legs = COLLIDERS.filter((c) => c.id.startsWith('arch:leg'))
    expect(legs).toHaveLength(2)
    for (const l of legs) expect(Math.min(Math.abs(l.rect.minX), Math.abs(l.rect.maxX))).toBeGreaterThanOrEqual(3.7)
    expect(ARCH.z).toBe(QC_ARCH.position[1])
    expect(ARCH.inner * 2).toBeCloseTo(QC_ARCH.width)
    expect(ARCH.detectHalfW).toBeLessThanOrEqual(ARCH.inner)
    // the reject bin sits beside the aisle, never in it
    expect(REJECT.bin.minX).toBeGreaterThan(3.5)
  })

  it('collector supports only at x = ±9 / ±16 near z = 0 (never on walkways or the aisle)', () => {
    expect([...COLLECTOR_CFG.supportX].sort((a, b) => a - b)).toEqual([-16, -9, 9, 16])
    const cols = COLLIDERS.filter((c) => c.id.startsWith('collector:col'))
    expect(cols).toHaveLength(4)
    for (const c of cols) {
      expect(Math.abs(c.c![1])).toBeLessThan(1.5)
      const x = c.c![0]
      const onWalk = (x > -14 - 0.3 && x < -11 + 0.3) || (x > 11 - 0.3 && x < 14 + 0.3)
      expect(onWalk || Math.abs(x) < 3.5, c.id).toBe(false)
    }
    // overhead collector / bridges only block the camera
    for (const c of COLLIDERS.filter((k) => k.id.startsWith('collector:') && !k.id.startsWith('collector:col'))) expect(c.group).toBe('camera')
  })

  it('monorail portal legs stand outside the aisle', () => {
    for (const z of MONORAIL.portalZ) {
      const legs = COLLIDERS.filter((c) => c.id.startsWith(`portal:${z}:`))
      expect(legs).toHaveLength(2)
      for (const l of legs) expect(Math.min(Math.abs(l.rect.minX), Math.abs(l.rect.maxX))).toBeGreaterThan(3.5)
    }
  })

  it('the console desk faces the aisle and its interact spot is free and close', () => {
    const [ix, iz] = ANCHORS.console.interact
    for (const c of GROUND) expect(distCollider(ix, iz, c), c.id).toBeGreaterThan(0.35)
    expect(distRect(ix, iz, CONSOLE.rect)).toBeLessThan(1.2)
    expect(CONSOLE.rect.maxZ).toBeLessThan(19.5) // cross aisle starts at z 19.5
  })

  it('line plaques stand at the south end of every line', () => {
    for (const l of LINES) {
      const p = PLAQUES[l.id]
      expect(p).toBeDefined()
      expect(p.z).toBeGreaterThan(l.overhead ? 10 : 18)
    }
  })

  it('item stage thresholds are ordered along each line', () => {
    const s = ITEM_STAGES
    expect(0 < s.smelt.sheetAt && s.smelt.sheetAt < s.smelt.panelAt && s.smelt.panelAt < 1).toBe(true)
    expect(0 < s.pipe.elbowAt && s.pipe.elbowAt < s.pipe.valveAt && s.pipe.valveAt < s.pipe.bundleAt && s.pipe.bundleAt < 1).toBe(true)
    expect(s.circuit.populatedAt > 0 && s.circuit.populatedAt < 1).toBe(true)
    expect(s.tank.fuelAt > 0 && s.tank.fuelAt < 1).toBe(true)
  })
})

describe('worker spots (npc module contract)', () => {
  it('exports spots for every line with unique ids and finite values', () => {
    for (const l of LINES) expect(LINE_WORKER_SPOTS[l.id].length, l.id).toBeGreaterThan(0)
    const ids = ALL_LINE_WORKER_SPOTS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of ALL_LINE_WORKER_SPOTS) {
      expect(Number.isFinite(s.position[0]) && Number.isFinite(s.position[1]) && Number.isFinite(s.yaw), s.id).toBe(true)
      expect(['work', 'point', 'idle']).toContain(s.anim)
    }
  })

  it('spots are clear of machinery and outside the aisle, walkways and cross aisle', () => {
    const keepClear = PATHS.filter((p) => p.kind !== 'plaza' && p.kind !== 'spur')
    for (const s of ALL_LINE_WORKER_SPOTS) {
      const [x, z] = s.position
      for (const c of GROUND) expect(distCollider(x, z, c), `${s.id} vs ${c.id}`).toBeGreaterThanOrEqual(0.45)
      for (const p of keepClear) expect(distRect(x, z, p.rect), `${s.id} in ${p.id}`).toBeGreaterThan(0.35)
    }
  })

  it('keeps the spot ids the npc roster relies on', () => {
    const ids = new Set(ALL_LINE_WORKER_SPOTS.map((s) => s.id))
    for (const id of ['smelt:furnace', 'smelt:press', 'pipe:lathe', 'pipe:robot', 'circuit:booth', 'circuit:test', 'tank:gauge', 'payload:qc']) expect(ids.has(id), id).toBe(true)
  })
})
