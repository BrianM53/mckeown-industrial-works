import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ZONES } from '@/world/layout'
import { foamTiles, wedgeTileGeometry } from './AcousticFoam'

const IN = ZONES.radio.building!.interior
const HALF = 0.25

describe('broadcast booth acoustic foam', () => {
  const tiles = foamTiles()

  it('flanks the east-wall equalizer without touching the poster, speakers or corners', () => {
    expect(tiles.length).toBe(30)
    for (const t of tiles) {
      for (const v of [t.x, t.y, t.z, t.yaw]) expect(Number.isFinite(v)).toBe(true)
      // on the east wall, just off the environment's 4 cm lining, facing west
      expect(t.x).toBeCloseTo(IN.maxX - 0.05)
      expect(t.yaw).toBeCloseTo(-Math.PI / 2)
      // above the wainscot rail (1.21), below the call-sign band (y ≈ 4.26)
      expect(t.y - HALF).toBeGreaterThan(1.21)
      expect(t.y + HALF).toBeLessThanOrEqual(4.0)
      // inside the wall span, clear of the N/S walls' lining + environment foam (≤ 0.14 deep)
      expect(t.z - HALF).toBeGreaterThan(IN.minZ + 0.14)
      expect(t.z + HALF).toBeLessThan(IN.maxZ - 0.04)
      // equalizer frame z ≈ 9.28..12.73, floor speakers z ≈ 8.44..9.06 / 12.94..13.56,
      // environment hearing-protection poster z ≈ 13.26..13.94 (y 1.73..2.68)
      const north = t.z + HALF <= 8.44
      const south = t.z - HALF >= 13.94
      expect(north || south).toBe(true)
    }
  })

  it('alternates wedge direction like a checkerboard', () => {
    const turned = tiles.filter((t) => t.turned).length
    expect(turned).toBe(tiles.length / 2)
    // neighbours in a column differ
    const col = tiles.filter((t) => t.z === tiles[0].z).sort((a, b) => a.y - b.y)
    for (let i = 1; i < col.length; i++) expect(col[i].turned).not.toBe(col[i - 1].turned)
  })

  it('builds a tile of outward-facing wedges within its 0.5 m footprint', () => {
    const g = wedgeTileGeometry()
    g.computeBoundingBox()
    const bb = g.boundingBox!
    expect(bb.min.x).toBeCloseTo(-HALF)
    expect(bb.max.x).toBeCloseTo(HALF)
    expect(bb.min.y).toBeCloseTo(-HALF)
    expect(bb.max.y).toBeCloseTo(HALF)
    expect(bb.min.z).toBeCloseTo(0)
    expect(bb.max.z).toBeGreaterThan(0.04)
    // every face normal points out of the wall (z ≥ 0) — none face into it
    const n = g.getAttribute('normal') as THREE.BufferAttribute
    for (let i = 0; i < n.count; i++) expect(n.getZ(i)).toBeGreaterThanOrEqual(-1e-6)
    g.dispose()
  })
})
