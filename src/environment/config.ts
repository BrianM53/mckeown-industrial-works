import * as THREE from 'three'
import type { QualityTier } from '@/core/types'

/**
 * Environment tuning constants. Sun: low, warm, from the west-southwest
 * (compass bearing ~248°, ~21° above the horizon) so shadows run long to the ENE.
 */
const SUN_BEARING = (248 * Math.PI) / 180
const SUN_ELEVATION = (21 * Math.PI) / 180

/** Unit vector pointing FROM the scene TOWARD the sun. */
export const SUN_DIR = new THREE.Vector3(
  Math.sin(SUN_BEARING) * Math.cos(SUN_ELEVATION),
  Math.sin(SUN_ELEVATION),
  -Math.cos(SUN_BEARING) * Math.cos(SUN_ELEVATION),
).normalize()

export interface QualityConfig {
  shadows: boolean
  shadowMap: number
  /** Half-size of the shadow camera frustum (m). */
  shadowHalf: number
  particles: number
  /** Extra decor / detail meshes. */
  detail: boolean
  /** Sign atlas canvas scale. */
  atlasScale: number
  anisotropy: number
}

export const QUALITY: Record<QualityTier, QualityConfig> = {
  low: { shadows: false, shadowMap: 512, shadowHalf: 28, particles: 70, detail: false, atlasScale: 0.5, anisotropy: 2 },
  medium: { shadows: true, shadowMap: 1024, shadowHalf: 30, particles: 190, detail: true, atlasScale: 1, anisotropy: 8 },
  high: { shadows: true, shadowMap: 2048, shadowHalf: 32, particles: 340, detail: true, atlasScale: 1, anisotropy: 12 },
}
