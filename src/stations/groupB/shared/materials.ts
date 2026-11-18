import * as THREE from 'three'
import { textures } from '@/world/materials'

/**
 * stations-b batch materials. Vertex colors carry the paint so one material
 * serves a whole station (see batch.ts). Created lazily once, shared by every
 * station, never disposed (module lifetime) — same policy as world/materials.ts,
 * whose textures (paint wear, grating, hazard stripes) these reuse.
 *
 * Lit materials get a cheap height-based ambient-occlusion patch so machinery
 * darkens toward the floor like the environment's own kit.
 */
export type BatchMatKey = 'paint' | 'metal' | 'matte' | 'glow' | 'lamp' | 'rubber' | 'hazard' | 'grate' | 'chrome'

const cache = new Map<string, THREE.Material>()

function once<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined
  if (!m) {
    m = make()
    m.name = `stations-b:${key}`
    cache.set(key, m)
  }
  return m
}

/** Height AO: diffuse light fades toward `aoMin` near y = 0 (world space). */
function withHeightAO<T extends THREE.MeshStandardMaterial>(mat: T, aoMin: number, aoHeight: number, key: string): T {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vSbWorldY;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n{ vec4 sbW = vec4( transformed, 1.0 );\n#ifdef USE_INSTANCING\n sbW = instanceMatrix * sbW;\n#endif\n sbW = modelMatrix * sbW; vSbWorldY = sbW.y; }',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vSbWorldY;')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>\n{ float sbAo = mix(${aoMin.toFixed(3)}, 1.0, smoothstep(0.0, ${aoHeight.toFixed(3)}, vSbWorldY));\n reflectedLight.indirectDiffuse *= sbAo; reflectedLight.directDiffuse *= mix(1.0, sbAo, 0.5); }`,
      )
  }
  mat.customProgramCacheKey = () => `sb-ao-${key}`
  return mat
}

export const bmats: Record<BatchMatKey, () => THREE.Material> = {
  /** Painted sheet metal (most machinery). */
  paint: () =>
    once('paint', () =>
      withHeightAO(new THREE.MeshStandardMaterial({ vertexColors: true, map: textures.paintWear(), roughness: 0.6, metalness: 0.26 }), 0.62, 1.4, 'paint'),
    ),
  /** Bare / galvanized metal. */
  metal: () =>
    once('metal', () =>
      withHeightAO(new THREE.MeshStandardMaterial({ vertexColors: true, map: textures.paintWear(), roughness: 0.4, metalness: 0.62 }), 0.7, 1.2, 'metal'),
    ),
  /** Polished bits (handles, chrome trim). */
  chrome: () => once('chrome', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.85 })),
  /** Plastics, fabric, wood, turf. */
  matte: () =>
    once('matte', () => withHeightAO(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.03 }), 0.66, 1.2, 'matte')),
  rubber: () => once('rubber', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })),
  /** Unlit emissive (LEDs, screens off-state frames, lamp lenses that stay on: UPS power). */
  glow: () => once('glow', () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })),
  /** Unlit lamps that follow the factory lighting level (see useLampDimmer). */
  lamp: () => once('lamp', () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })),
  hazard: () =>
    once('hazard', () =>
      withHeightAO(new THREE.MeshStandardMaterial({ vertexColors: true, map: textures.hazardStripes(), roughness: 0.62, metalness: 0.15 }), 0.72, 1.0, 'hazard'),
    ),
  grate: () => once('grate', () => new THREE.MeshStandardMaterial({ vertexColors: true, map: textures.grating(), roughness: 0.7, metalness: 0.5 })),
}

/** Material keys that should not cast shadows (thin/emissive). */
export const NO_SHADOW_KEYS = new Set<string>(['glow', 'lamp'])

/** Scale the shared 'lamp' material with the factory lighting level (Night Shift). */
export function setLampLevel(level: number): void {
  const m = bmats.lamp() as THREE.MeshBasicMaterial
  const k = 0.12 + 0.88 * Math.min(1, Math.max(0, Number.isFinite(level) ? level : 1))
  m.color.setScalar(k)
}
