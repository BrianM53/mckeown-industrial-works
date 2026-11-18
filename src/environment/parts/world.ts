import * as THREE from 'three'
import type { ZoneId } from '@/world/layout'
import type { QualityConfig } from '../config'
import { Batch } from '../lib/batch'
import { envMats } from '../lib/envMaterials'
import { addBackdrop } from './backdrop'
import { addBuildings } from './buildings'
import { addFeatures, addInteriors, addProps, addRestricted, addVents } from './decorParts'
import type { KitInstance, KitName } from './kits'
import { addPerimeter } from './perimeter'
import type { SignAtlas } from './signAtlas'
import { addStructures } from './structures'
import type { BuildCtx, Spinner, SteamEmitter } from './types'

/** World-UV tile size per static key (m per texture repeat). */
export const TILES: Record<string, number> = {
  corr: 1.6,
  brick: 1.6,
  paint: 3,
  metal: 2,
  concrete: 4,
  hazard: 0.9,
  grate: 1.0,
  far: 8,
}

export const CASTS: Record<string, boolean> = {
  corr: true,
  brick: true,
  paint: true,
  metal: true,
  concrete: true,
  hazard: true,
  grate: true,
}

export interface BuiltWorld {
  /** Merged static geometry per material key; `cast` marks the shadow-casting half of a CASTS key. */
  statics: { key: string; geometry: THREE.BufferGeometry; cast: boolean }[]
  roofs: { id: ZoneId; parts: { key: string; geometry: THREE.BufferGeometry }[] }[]
  /** Merged camera-fade geometry per material key (rendered with userData.cameraFade). */
  fade: { key: string; geometry: THREE.BufferGeometry }[]
  kits: Map<KitName, KitInstance[]>
  spinners: Spinner[]
  steam: SteamEmitter[]
  stats: { parts: number; triangles: number }
}

export function buildWorld(q: QualityConfig, atlas: SignAtlas): BuiltWorld {
  const b = new Batch(TILES)
  const ctx: BuildCtx = { b, atlas, q, spinners: [], steam: [], roofs: new Map(), kits: new Map(), fade: new Batch(TILES) }
  addBuildings(ctx)
  addStructures(ctx)
  addPerimeter(ctx)
  addFeatures(ctx)
  addProps(ctx)
  addRestricted(ctx)
  addInteriors(ctx)
  addVents(ctx)
  addBackdrop(ctx)

  const statics: BuiltWorld['statics'] = []
  let triangles = 0
  // CASTS keys are split by part size so only real silhouettes (walls, frames, tanks, big boxes)
  // render into the shadow map; rivets, bolts, rails and thin pipes stay out of the shadow pass.
  for (const key of b.keys) {
    const parts = CASTS[key] ? b.buildSplit(key) : { cast: null, rest: b.buildKey(key) }
    for (const [geometry, cast] of [
      [parts.cast, true],
      [parts.rest, false],
    ] as const) {
      if (!geometry) continue
      statics.push({ key, geometry, cast })
      triangles += (geometry.index?.count ?? 0) / 3
    }
  }
  const roofs: BuiltWorld['roofs'] = []
  for (const [id, rb] of ctx.roofs) {
    const parts = [...rb.build()].map(([key, geometry]) => {
      triangles += (geometry.index?.count ?? 0) / 3
      return { key, geometry }
    })
    roofs.push({ id, parts })
  }
  const fade: BuiltWorld['fade'] = []
  for (const [key, geometry] of ctx.fade.build()) {
    fade.push({ key, geometry })
    triangles += (geometry.index?.count ?? 0) / 3
  }
  return { statics, roofs, fade, kits: ctx.kits, spinners: ctx.spinners, steam: ctx.steam, stats: { parts: statics.length, triangles } }
}

export function staticMaterial(key: string, sign: THREE.Material, poster: THREE.Material): THREE.Material {
  if (key === 'sign') return sign
  if (key === 'poster') return poster
  const f = (envMats as unknown as Record<string, (() => THREE.Material) | undefined>)[key]
  return f ? f() : envMats.paint()
}
