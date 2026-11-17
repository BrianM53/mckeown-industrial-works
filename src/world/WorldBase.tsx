import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { GROUPS } from '@/core/collision'
import { WORLD_BOUNDS } from './layout'

/**
 * Integrator-owned physics base: the ground slab (top surface at y = 0) and the
 * perimeter walls. Always present so the player/forklift never fall out of the
 * world, regardless of which modules loaded. Visuals for ground/walls belong to
 * the environment module.
 */
export function WorldBase() {
  const b = WORLD_BOUNDS
  const cx = (b.minX + b.maxX) / 2
  const cz = (b.minZ + b.maxZ) / 2
  const hx = (b.maxX - b.minX) / 2
  const hz = (b.maxZ - b.minZ) / 2
  const wallH = 3
  const t = 0.5
  return (
    <RigidBody type="fixed" colliders={false} name="world-base">
      {/* ground slab: 1 m thick, top at y = 0, extends 20 m past the bounds */}
      <CuboidCollider args={[hx + 20, 0.5, hz + 20]} position={[cx, -0.5, cz]} collisionGroups={GROUPS.static} friction={0.9} />
      {/* perimeter walls (inner faces on the bounds) */}
      <CuboidCollider args={[hx + t, wallH, t]} position={[cx, wallH, b.minZ - t]} collisionGroups={GROUPS.static} />
      <CuboidCollider args={[hx + t, wallH, t]} position={[cx, wallH, b.maxZ + t]} collisionGroups={GROUPS.static} />
      <CuboidCollider args={[t, wallH, hz + t]} position={[b.minX - t, wallH, cz]} collisionGroups={GROUPS.static} />
      <CuboidCollider args={[t, wallH, hz + t]} position={[b.maxX + t, wallH, cz]} collisionGroups={GROUPS.static} />
    </RigidBody>
  )
}
