import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { RigidBody, World } from '@dimforge/rapier3d-compat'
import { GROUPS } from '@/core/collision'

/**
 * Dev/test-only geometry for verifying the controller and camera boom against
 * real colliders before/independently of the environment module:
 *   __MIW__.player.debugBox({ x, z, w, d, h, y?, cameraOnly? }) → id
 *   __MIW__.player.debugBoxClear()
 * Registered through registerDebug (a no-op in production builds).
 */
export interface DebugBoxOpts {
  x: number
  z: number
  /** Size along X / Z / Y (m). */
  w: number
  d: number
  h: number
  /** Bottom height (default 0). */
  y?: number
  /** Camera-only blocker (GROUPS.cameraBlocker) instead of a solid STATIC box. */
  cameraOnly?: boolean
}

const MAT = new THREE.MeshStandardMaterial({ color: '#8c8a80', roughness: 0.9, metalness: 0.05 })
const MAT_CAM = new THREE.MeshStandardMaterial({ color: '#6fa8c8', roughness: 0.9, transparent: true, opacity: 0.35 })
const BOX = new THREE.BoxGeometry(1, 1, 1)

export function createDebugBoxes(getWorld: () => World | null, getRapier: () => typeof RAPIER | null, scene: THREE.Scene) {
  const items = new Map<number, { body: RigidBody; mesh: THREE.Mesh }>()
  let next = 1
  return {
    add(o: DebugBoxOpts): number {
      const world = getWorld()
      const r = getRapier()
      if (!world || !r) return -1
      const y0 = o.y ?? 0
      const body = world.createRigidBody(r.RigidBodyDesc.fixed().setTranslation(o.x, y0 + o.h / 2, o.z))
      world.createCollider(
        r.ColliderDesc.cuboid(o.w / 2, o.h / 2, o.d / 2).setCollisionGroups(o.cameraOnly ? GROUPS.cameraBlocker : GROUPS.static),
        body,
      )
      const mesh = new THREE.Mesh(BOX, o.cameraOnly ? MAT_CAM : MAT)
      mesh.scale.set(o.w, o.h, o.d)
      mesh.position.set(o.x, y0 + o.h / 2, o.z)
      mesh.castShadow = mesh.receiveShadow = true
      mesh.name = 'player-debug-box'
      scene.add(mesh)
      const id = next++
      items.set(id, { body, mesh })
      return id
    },
    clear(): void {
      const world = getWorld()
      for (const { body, mesh } of items.values()) {
        try {
          if (world && world.getRigidBody(body.handle)) world.removeRigidBody(body)
        } catch {
          /* world gone */
        }
        mesh.removeFromParent()
      }
      items.clear()
    },
    count: () => items.size,
  }
}
