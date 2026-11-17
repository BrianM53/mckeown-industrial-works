import * as THREE from 'three'
import { ENV_PALETTE, PALETTE } from '@/world/palette'
import { buildKit } from '../lib/batch'
import type { BuildCtx } from './types'

/**
 * Instanced decor kits: one merged, vertex-colored geometry per kit, drawn
 * with ONE InstancedMesh each. Per-instance tint multiplies the vertex colors.
 */
export type KitName = 'barrel' | 'pallet' | 'crate' | 'cone' | 'bollard' | 'hydrant' | 'plant' | 'pole' | 'lens' | 'tire' | 'cylinder'

export interface KitInstance {
  m: THREE.Matrix4
  c: THREE.Color
}

const geoms = new Map<KitName, THREE.BufferGeometry>()

export function kitGeometry(name: KitName): THREE.BufferGeometry {
  let g = geoms.get(name)
  if (g) return g
  g = makeKit(name)
  geoms.set(name, g)
  return g
}

function makeKit(name: KitName): THREE.BufferGeometry {
  switch (name) {
    case 'barrel':
      return buildKit((b) => {
        b.cylY('k', 0, 0, 0, 0.29, 0.88, '#ffffff', 14)
        for (const y of [0.29, 0.59]) b.cylY('k', 0, y - 0.02, 0, 0.3, 0.04, '#b8b8b8', 14)
        b.cylY('k', 0, 0.87, 0, 0.27, 0.025, '#707070', 14)
        b.cylY('k', 0.12, 0.88, 0.05, 0.04, 0.03, '#505050', 6)
      })
    case 'pallet':
      return buildKit((b) => {
        for (const x of [-0.55, 0, 0.55]) b.boxB('k', x, 0.02, 0, 0.1, 0.08, 1.0, '#c9a77e')
        for (const z of [-0.43, -0.215, 0, 0.215, 0.43]) b.boxB('k', 0, 0.1, z, 1.2, 0.026, 0.13, '#e0c194')
        for (const z of [-0.43, 0, 0.43]) b.boxB('k', 0, 0, z, 1.2, 0.022, 0.13, '#b89670')
      })
    case 'crate':
      return buildKit((b) => {
        b.boxB('k', 0, 0, 0, 0.96, 0.96, 0.96, '#ffffff')
        const e = 0.07
        for (const [x, z] of [
          [-0.47, -0.47],
          [0.47, -0.47],
          [-0.47, 0.47],
          [0.47, 0.47],
        ]) b.boxB('k', x, 0, z, e, 0.98, e, '#9a8a74')
        for (const y of [0.02, 0.94]) {
          b.boxB('k', 0, y, -0.47, 0.98, e, e, '#9a8a74')
          b.boxB('k', 0, y, 0.47, 0.98, e, e, '#9a8a74')
          b.boxB('k', -0.47, y, 0, e, e, 0.98, '#9a8a74')
          b.boxB('k', 0.47, y, 0, e, e, 0.98, '#9a8a74')
        }
        b.box('k', 0, 0.48, 0, 0.98, 0.06, 0.06, '#b0a088', 0, 0, 0.78)
      })
    case 'cone':
      return buildKit((b) => {
        b.boxB('k', 0, 0, 0, 0.4, 0.035, 0.4, '#202020')
        b.cylY('k', 0, 0.035, 0, 0.17, 0.62, PALETTE.safety, 12, 0.035)
        b.cylY('k', 0, 0.3, 0, 0.115, 0.09, '#f2f2ee', 12, 0.1)
      })
    case 'bollard':
      return buildKit((b) => {
        b.cylY('k', 0, 0, 0, 0.13, 0.98, PALETTE.hazard, 12)
        for (const y of [0.55, 0.78]) b.cylY('k', 0, y, 0, 0.133, 0.08, '#1d1f20', 12)
        b.sphere('k', 0, 0.98, 0, 0.13, PALETTE.hazard, 12, 6, 0.5)
        b.cylY('k', 0, 0, 0, 0.2, 0.03, '#555', 10)
      })
    case 'hydrant':
      return buildKit((b) => {
        b.cylY('k', 0, 0, 0, 0.17, 0.08, '#8f2a20', 10)
        b.cylY('k', 0, 0.08, 0, 0.12, 0.55, '#C8302A', 10)
        b.cylY('k', 0, 0.63, 0, 0.15, 0.06, '#C8302A', 10)
        b.sphere('k', 0, 0.69, 0, 0.12, '#D9B13B', 10, 6, 0.8)
        for (const s of [-1, 1]) b.cylBetween('k', [0, 0.45, 0], [s * 0.2, 0.45, 0], 0.055, '#C8302A', 8)
        b.cylBetween('k', [0, 0.38, 0], [0, 0.38, -0.21], 0.075, '#C8302A', 8)
      })
    case 'plant':
      return buildKit((b) => {
        b.cylY('k', 0, 0, 0, 0.26, 0.52, ENV_PALETTE.terracotta, 12, 0.32)
        b.cylY('k', 0, 0.48, 0, 0.3, 0.05, '#8a4a2c', 12)
        b.cylY('k', 0, 0.5, 0, 0.04, 0.5, '#5a4030', 5)
        b.sphere('k', 0, 1.05, 0, 0.36, ENV_PALETTE.foliage, 8, 6)
        b.sphere('k', 0.18, 1.3, 0.08, 0.26, '#6A9548', 8, 6)
        b.sphere('k', -0.16, 1.24, -0.1, 0.25, '#4C7234', 8, 6)
        b.sphere('k', 0.02, 1.48, -0.05, 0.2, '#628B44', 8, 6)
      })
    case 'pole':
      return buildKit((b) => {
        b.cylY('k', 0, 0, 0, 0.2, 0.32, '#9C998E', 10)
        b.cylY('k', 0, 0.32, 0, 0.09, 7.1, '#59656A', 8, 0.065)
        b.cylBetween('k', [0, 7.25, 0], [0, 7.35, -1.35], 0.05, '#59656A', 6)
        b.box('k', 0, 7.36, -1.5, 0.36, 0.16, 0.66, '#3A4244')
        b.box('k', 0, 1.3, 0.1, 0.22, 0.32, 0.12, '#3A4244')
      })
    case 'lens':
      return buildKit((b) => {
        b.box('k', 0, 7.275, -1.5, 0.28, 0.02, 0.54, new THREE.Color(ENV_PALETTE.lampWarm).multiplyScalar(3.2))
      })
    case 'tire':
      return buildKit((b) => {
        b.torus('k', 0, 0.12, 0, 0.32, 0.12, '#1d1f20', 'y')
      })
    case 'cylinder':
      return buildKit((b) => {
        b.cylY('k', 0, 0, 0, 0.12, 1.32, '#ffffff', 10)
        b.sphere('k', 0, 1.32, 0, 0.12, '#ffffff', 10, 5, 0.6)
        b.cylY('k', 0, 1.38, 0, 0.04, 0.12, '#6b6b6b', 6)
      })
  }
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()

export function addKit(ctx: BuildCtx, name: KitName, x: number, y: number, z: number, yaw = 0, scale: number | [number, number, number] = 1, color: THREE.ColorRepresentation = '#ffffff', tiltX = 0, tiltZ = 0): void {
  let list = ctx.kits.get(name)
  if (!list) {
    list = []
    ctx.kits.set(name, list)
  }
  _e.set(tiltX, yaw, tiltZ, 'YXZ')
  _q.setFromEuler(_e)
  if (Array.isArray(scale)) _s.set(scale[0], scale[1], scale[2])
  else _s.setScalar(scale)
  _m.compose(_p.set(x, y, z), _q, _s)
  list.push({ m: _m.clone(), c: new THREE.Color(color) })
}
