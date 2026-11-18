import * as THREE from 'three'
import { mats, textures } from '@/world/materials'

/**
 * Station group A materials. Merged static geometry carries its paint as
 * vertex colors, so a whole machine needs only these few shared, module-level
 * materials (created lazily once, never disposed). They reuse the shared
 * paint-wear texture from world/materials so stations match the environment's
 * worn-metal look; glass is the shared world material.
 */
const cache = new Map<string, THREE.Material>()

function once<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined
  if (!m) {
    m = make()
    m.name = `stationsA:${key}`
    cache.set(key, m)
  }
  return m
}

export type StaticKey = 'paint' | 'metal' | 'glow' | 'glass' | 'dark' | 'hazard'

export const smats = {
  /** Painted sheet metal / plastics / wood (vertex colors). */
  paint: () => once('paint', () => new THREE.MeshStandardMaterial({ vertexColors: true, map: textures.paintWear(), roughness: 0.64, metalness: 0.18 })),
  /** Polished brass, chrome, galvanized steel (vertex colors). */
  metal: () => once('metal', () => new THREE.MeshStandardMaterial({ vertexColors: true, map: textures.paintWear(), roughness: 0.3, metalness: 0.82 })),
  /** Matte rubber / fabric / foam (vertex colors, no wear map). */
  dark: () => once('dark', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02 })),
  /** Unlit glow (lamps, LEDs). Vertex colors may be HDR (> 1). */
  glow: () => once('glow', () => new THREE.MeshBasicMaterial({ vertexColors: true })),
  glass: () => mats.glass(),
}

export function staticMaterial(key: string): THREE.Material {
  switch (key) {
    case 'metal':
      return smats.metal()
    case 'dark':
      return smats.dark()
    case 'glow':
      return smats.glow()
    case 'glass':
      return smats.glass()
    case 'hazard':
      return mats.hazardStripes()
    default:
      return smats.paint()
  }
}

/** Keys whose meshes may cast shadows (glow/glass never do). */
export const SHADOW_KEYS = new Set(['paint', 'metal', 'dark', 'hazard'])

/** Palette shortcuts used across the stations (spec §2 palette + a few accents). */
export const C = {
  charcoal: '#252B2B',
  gunmetal: '#465356',
  steel: '#7D8A8C',
  steelLight: '#A9B4B3',
  concrete: '#85857D',
  rust: '#A95E39',
  hazard: '#E9B63F',
  safety: '#E57D35',
  furnace: '#FFB05A',
  teal: '#638C88',
  tealDark: '#3F5F5C',
  cream: '#EAE3D2',
  paper: '#F4EFE2',
  brass: '#C9A44A',
  brassDark: '#8E6E2A',
  copper: '#B87333',
  chrome: '#D7DCDD',
  rubber: '#1C1F20',
  soot: '#1A1E1F',
  wood: '#9A6B43',
  woodDark: '#5E3F2A',
  red: '#C8302A',
  signalRed: '#D9483B',
  green: '#5DBB63',
  blue: '#4F86A8',
  white: '#E9E6DE',
  black: '#141718',
} as const
