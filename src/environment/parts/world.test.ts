import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { QUALITY } from '../config'
import { Batch } from '../lib/batch'
import { addBackdrop } from './backdrop'
import { addBuildings } from './buildings'
import { addFeatures, addInteriors, addProps, addRestricted, addVents } from './decorParts'
import { kitGeometry, type KitName } from './kits'
import { addPerimeter } from './perimeter'
import type { SignAtlas } from './signAtlas'
import { addStructures } from './structures'
import type { BuildCtx } from './types'
import { buildWorld, TILES } from './world'

/** Headless sign atlas: every lookup misses, so sign quads are skipped (geometry only). */
const fakeAtlas = { texture: null as unknown as THREE.CanvasTexture, cells: {} } as SignAtlas

function trianglesOf(b: Batch): number {
  let n = 0
  for (const g of b.build().values()) n += (g.index?.count ?? 0) / 3
  return n
}

describe('static world build', () => {
  const world = buildWorld(QUALITY.medium, fakeAtlas)

  it('produces finite geometry for every batch', () => {
    const geos = [...world.statics.map((s) => s.geometry), ...world.roofs.flatMap((r) => r.parts.map((p) => p.geometry))]
    expect(geos.length).toBeGreaterThan(10)
    for (const g of geos) {
      const pos = g.getAttribute('position').array as Float32Array
      for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) throw new Error(`non-finite vertex in ${g.uuid}`)
      const nor = g.getAttribute('normal').array as Float32Array
      for (let i = 0; i < nor.length; i++) if (!Number.isFinite(nor[i])) throw new Error(`non-finite normal in ${g.uuid}`)
    }
  })

  it('has a roof batch for every building and only known material keys', () => {
    expect(world.roofs.map((r) => r.id).sort()).toEqual(['breakroom', 'control', 'maintenance', 'personnel', 'radio', 'rnd', 'server', 'warehouse'])
    const known = new Set([...Object.keys(TILES), 'sign', 'poster', 'glow', 'window', 'glass', 'farGlow'])
    for (const s of world.statics) expect(known.has(s.key), s.key).toBe(true)
  })

  it('stays within the static triangle budget (medium)', () => {
    // Static batches + roofs (instanced kits are counted separately below).
    expect(world.stats.triangles).toBeLessThan(115_000)
    let kitTris = 0
    for (const [name, list] of world.kits) kitTris += ((kitGeometry(name as KitName).index?.count ?? 0) / 3) * list.length
    expect(kitTris).toBeLessThan(40_000)
  })

  it('emits spinners and steam emitters with finite positions', () => {
    expect(world.spinners.length).toBeGreaterThan(10)
    expect(world.steam.length).toBeGreaterThan(8)
    for (const s of [...world.spinners, ...world.steam]) expect(Number.isFinite(s.x + s.y + s.z)).toBe(true)
  })

  it('reports where the triangles go (informational)', () => {
    const steps: [string, (c: BuildCtx) => void][] = [
      ['buildings', addBuildings],
      ['structures', addStructures],
      ['perimeter', addPerimeter],
      ['features', addFeatures],
      ['props', addProps],
      ['restricted', addRestricted],
      ['interiors', addInteriors],
      ['vents', addVents],
      ['backdrop', addBackdrop],
    ]
    const report: Record<string, number> = {}
    for (const [name, fn] of steps) {
      const ctx: BuildCtx = { b: new Batch(TILES), atlas: fakeAtlas, q: QUALITY.medium, spinners: [], steam: [], roofs: new Map(), kits: new Map(), fade: new Batch(TILES) }
      fn(ctx)
      let roofs = 0
      for (const rb of ctx.roofs.values()) roofs += trianglesOf(rb)
      report[name] = Math.round(trianglesOf(ctx.b) + trianglesOf(ctx.fade) + roofs)
    }
    if (process.env.ENV_REPORT) console.log(JSON.stringify(report))
    expect(Object.values(report).every((n) => n >= 0)).toBe(true)
  })
})
