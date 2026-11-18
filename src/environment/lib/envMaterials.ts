import * as THREE from 'three'
import { textures } from '@/world/materials'
import { ENV_PALETTE } from '@/world/palette'
import { WORLD_BOUNDS } from '@/world/layout'
import { BUILDINGS } from '../data/buildings'
import { paintMaskTexture } from './atlas'
import { applyEnvPatch } from './shaders'

/**
 * Environment materials: created lazily once, shared by every batch, never
 * disposed (module lifetime). Emissive/unlit ones register as "dimmables" so the
 * Night Shift lighting response can scale them every frame without allocations.
 */
interface Dimmable {
  mat: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial
  mode: 'emissive' | 'color' | 'opacity'
  base: number
  baseColor: THREE.Color
  /** Fraction kept at full blackout. */
  floor: number
}

const cache = new Map<string, THREE.Material>()
const dimmables: Dimmable[] = []

function once<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined
  if (!m) {
    m = make()
    m.name = `env:${key}`
    cache.set(key, m)
  }
  return m
}

function dimmable<T extends THREE.MeshStandardMaterial | THREE.MeshBasicMaterial>(mat: T, mode: Dimmable['mode'], floor: number): T {
  const base = mode === 'emissive' ? (mat as THREE.MeshStandardMaterial).emissiveIntensity : mode === 'opacity' ? mat.opacity : 1
  dimmables.push({ mat, mode, base, baseColor: mat.color.clone(), floor })
  return mat
}

/** Building footprints for ground contact shadows. */
function footprintRects(): THREE.Vector4[] {
  return BUILDINGS.map((b) => new THREE.Vector4(b.def.footprint.minX, b.def.footprint.minZ, b.def.footprint.maxX, b.def.footprint.maxZ))
}
const boundsVec = () => new THREE.Vector4(WORLD_BOUNDS.minX, WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxX, WORLD_BOUNDS.maxZ)

export const envMats = {
  /** Painted metal (most structures). Vertex colors carry the paint. */
  paint: () =>
    once('paint', () =>
      applyEnvPatch(new THREE.MeshStandardMaterial({ vertexColors: true, map: textures.paintWear(), roughness: 0.62, metalness: 0.28 }), { macro: 0.08, aoMin: 0.6, aoHeight: 1.6 }, 'paint'),
    ),
  /** Bare / galvanized metal (pipes, rails). */
  metal: () =>
    once('metal', () =>
      applyEnvPatch(new THREE.MeshStandardMaterial({ vertexColors: true, map: textures.paintWear(), roughness: 0.42, metalness: 0.62 }), { macro: 0.06, aoMin: 0.7, aoHeight: 1.2 }, 'metal'),
    ),
  /** Corrugated sheet walls/roofs with grime streaks. */
  corr: () =>
    once('corr', () =>
      applyEnvPatch(
        new THREE.MeshStandardMaterial({ vertexColors: true, map: textures.paintWear(), normalMap: textures.corrugatedNormal(), normalScale: new THREE.Vector2(1, 1), roughness: 0.58, metalness: 0.4 }),
        { macro: 0.1, aoMin: 0.55, aoHeight: 2.2, streaks: 0.55 },
        'corr',
      ),
    ),
  brick: () =>
    once('brick', () =>
      applyEnvPatch(new THREE.MeshStandardMaterial({ vertexColors: true, map: textures.brick(), roughness: 0.9, metalness: 0.02 }), { macro: 0.08, aoMin: 0.6, aoHeight: 1.8, streaks: 0.3 }, 'brick'),
    ),
  concrete: () =>
    once('concrete', () =>
      applyEnvPatch(new THREE.MeshStandardMaterial({ vertexColors: true, map: textures.concrete(), roughness: 0.94, metalness: 0 }), { macro: 0.1, aoMin: 0.62, aoHeight: 1.4 }, 'concrete'),
    ),
  grate: () => once('grate', () => new THREE.MeshStandardMaterial({ vertexColors: true, map: textures.grating(), roughness: 0.7, metalness: 0.5 })),
  hazard: () =>
    once('hazard', () =>
      applyEnvPatch(new THREE.MeshStandardMaterial({ vertexColors: true, map: textures.hazardStripes(), roughness: 0.62, metalness: 0.15 }), { macro: 0.06, aoMin: 0.7, aoHeight: 1 }, 'hazard'),
    ),
  /** Unlit glow (lamp lenses, LED strips). Vertex colors may be HDR (> 1). */
  glow: () => once('glow', () => dimmable(new THREE.MeshBasicMaterial({ vertexColors: true }), 'color', 0.04)),
  /** Lit dusty windows. */
  window: () => once('window', () => dimmable(new THREE.MeshBasicMaterial({ vertexColors: true, map: textures.dustyWindow() }), 'color', 0.06)),
  glass: () =>
    once('glass', () =>
      new THREE.MeshStandardMaterial({
        color: ENV_PALETTE.glassTint,
        roughness: 0.06,
        metalness: 0.35,
        transparent: true,
        opacity: 0.26,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    ),
  /** Distant backdrop silhouettes (cheap Lambert; fog does the atmosphere). */
  far: () => once('far', () => new THREE.MeshLambertMaterial({ vertexColors: true })),
  /** Unlit far emissives (refinery flare, city lights) — unaffected by the night shift. */
  farGlow: () => once('farGlow', () => new THREE.MeshBasicMaterial({ vertexColors: true })),
  /** Interior floors (tiles / carpet / epoxy via vertex color). */
  floorTile: () =>
    once('floorTile', () =>
      new THREE.MeshStandardMaterial({ vertexColors: true, map: textures.floorTiles(), roughness: 0.55, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    ),
  /** Instanced decor kits (barrels, poles...). */
  kit: () =>
    once('kit', () =>
      applyEnvPatch(new THREE.MeshStandardMaterial({ vertexColors: true, map: textures.paintWear(), roughness: 0.58, metalness: 0.3 }), { macro: 0.05, aoMin: 0.7, aoHeight: 0.9 }, 'kit'),
    ),
  /** Campus concrete slab (world-space two-scale sampling, joints, stains, contact AO). */
  ground: () =>
    once('ground', () =>
      applyEnvPatch(
        new THREE.MeshStandardMaterial({ color: '#d9d6cc', map: textures.concreteSlab(), roughness: 0.92, metalness: 0 }),
        { macro: 0.13, aoMin: 1, aoHeight: 1, ground: { tileA: 6.5, tileB: 17, joint: 6, jointDark: 0.3, stains: 1, rects: footprintRects(), bounds: boundsVec() } },
        'ground',
      ),
    ),
  /** Outside-the-fence ground (dusty, no joints). */
  groundFar: () =>
    once('groundFar', () =>
      applyEnvPatch(
        new THREE.MeshStandardMaterial({ color: '#b8a587', map: textures.concreteSlab(), roughness: 1, metalness: 0 }),
        { macro: 0.18, aoMin: 1, aoHeight: 1, ground: { tileA: 9, tileB: 31, stains: 0.6 } },
        'groundFar',
      ),
    ),
  asphalt: () =>
    once('asphalt', () =>
      applyEnvPatch(
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          map: textures.asphalt(),
          roughness: 0.9,
          metalness: 0,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -2,
        }),
        { macro: 0.12, aoMin: 1, aoHeight: 1, ground: { tileA: 3.5, tileB: 11, stains: 0.8, rects: footprintRects(), bounds: boundsVec() } },
        'asphalt',
      ),
    ),
  /** Worn floor paint fills (zone bands, walkways). */
  paintFill: () =>
    once('paintFill', () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        alphaMap: paintMaskTexture('fill', 3),
        alphaTest: 0.5,
        roughness: 0.7,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
      }),
    ),
  /** Worn painted lines (u across the line, v along it). */
  paintLine: () =>
    once('paintLine', () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        alphaMap: paintMaskTexture('line', 8),
        alphaTest: 0.5,
        roughness: 0.68,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -6,
      }),
    ),
  hazardFloor: () =>
    once('hazardFloor', () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: textures.hazardStripes(),
        roughness: 0.7,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -6,
      }),
    ),
  /** Glossy wet paint patch. */
  wetPaint: () =>
    once('wetPaint', () =>
      new THREE.MeshStandardMaterial({
        color: '#2E9C6E',
        roughness: 0.06,
        metalness: 0.1,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
      }),
    ),
  /** Additive halo sprites (beacons). */
  halo: () =>
    once('halo', () =>
      dimmable(
        new THREE.MeshBasicMaterial({ map: textures.glowDot(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: false, toneMapped: false, fog: true }),
        'color',
        0.3,
      ),
    ),
  /** Emergency beam (additive red). Opacity driven by the emergency level. */
  beam: () =>
    once('beam', () =>
      new THREE.MeshBasicMaterial({
        color: ENV_PALETTE.emergency,
        map: textures.glowDot(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    ),
}

/** Material set built around a sign atlas texture (signs glow a little; posters don't). */
export function atlasMaterials(tex: THREE.Texture, key: string) {
  return {
    sign: once(`sign:${key}`, () =>
      dimmable(
        new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.42, roughness: 0.55, metalness: 0.1, alphaTest: 0.5 }),
        'emissive',
        0.08,
      ),
    ),
    poster: once(`poster:${key}`, () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.78, metalness: 0, alphaTest: 0.5, side: THREE.FrontSide })),
  }
}

/** Floor decal material for a mask atlas (alphaMap; color from vertex colors). */
export function decalMaterial(tex: THREE.Texture, key: string): THREE.MeshStandardMaterial {
  return once(`decal:${key}`, () =>
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      alphaMap: tex,
      alphaTest: 0.45,
      roughness: 0.72,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
    }),
  )
}

export type RoofKey = 'corr' | 'paint' | 'brick' | 'window' | 'glow'

/** Per-building roof material clone with alpha-hash fading (cutaway). */
export function roofMaterial(base: RoofKey, id: string): THREE.MeshStandardMaterial | THREE.MeshBasicMaterial {
  return once(`roof:${base}:${id}`, () => {
    const src = envMats[base]() as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial
    const m = src.clone()
    m.alphaHash = true
    m.opacity = 1
    // Material.clone() does not carry onBeforeCompile; keep the env patch.
    m.onBeforeCompile = src.onBeforeCompile
    m.customProgramCacheKey = src.customProgramCacheKey
    if (base === 'glow' || base === 'window')
      dimmables.push({ mat: m, mode: 'color', base: 1, baseColor: m.color.clone(), floor: base === 'glow' ? 0.04 : 0.06 })
    return m
  })
}

/** Scale every dimmable for the night-shift lighting level (0..1). Allocation-free. */
export function applyEnvLighting(level: number): void {
  const L = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 1))
  for (const d of dimmables) {
    const k = d.floor + (1 - d.floor) * L
    if (d.mode === 'emissive') (d.mat as THREE.MeshStandardMaterial).emissiveIntensity = d.base * k
    else if (d.mode === 'opacity') d.mat.opacity = d.base * k
    else d.mat.color.copy(d.baseColor).multiplyScalar(k)
  }
}

/** Register an extra material to dim with the lighting level (e.g. per-part materials). */
export function registerDimmable(mat: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial, mode: Dimmable['mode'], floor: number): void {
  if (dimmables.some((d) => d.mat === mat)) return
  dimmable(mat, mode, floor)
}
