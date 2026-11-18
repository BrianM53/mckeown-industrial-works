import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier'
import { GROUPS } from '@/core/collision'
import type { Rect } from '@/core/types'

/**
 * Static collider definitions as pure data (so layout tests can check them
 * against lanes, doors, waypoint segments and interaction spots) plus a renderer
 * that mounts them on one fixed body per station (GROUPS.static).
 */
export type ColliderDef =
  | { id: string; shape: 'box'; x: number; y: number; z: number; hx: number; hy: number; hz: number; yaw?: number }
  | { id: string; shape: 'cyl'; x: number; y: number; z: number; r: number; hh: number }

/** Box from a ground rect, bottom y0 to top y1. */
export function boxCollider(id: string, r: Rect, y0: number, y1: number): ColliderDef {
  return {
    id,
    shape: 'box',
    x: (r.minX + r.maxX) / 2,
    y: (y0 + y1) / 2,
    z: (r.minZ + r.maxZ) / 2,
    hx: (r.maxX - r.minX) / 2,
    hy: (y1 - y0) / 2,
    hz: (r.maxZ - r.minZ) / 2,
  }
}

/** Vertical cylinder standing on y0. */
export function cylCollider(id: string, x: number, z: number, r: number, h: number, y0 = 0): ColliderDef {
  return { id, shape: 'cyl', x, y: y0 + h / 2, z, r, hh: h / 2 }
}

/** Thin wall/fence segment from a to b (any direction), `t` thick, `h` tall. */
export function segmentCollider(id: string, a: readonly [number, number], b: readonly [number, number], t: number, h: number, y0 = 0): ColliderDef {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len = Math.hypot(dx, dz)
  // local +X runs along the segment: yaw so that rotating (1,0,0) by yaw gives (dx,dz)
  const yaw = Math.atan2(-dz, dx)
  return { id, shape: 'box', x: (a[0] + b[0]) / 2, y: y0 + h / 2, z: (a[1] + b[1]) / 2, hx: len / 2, hy: h / 2, hz: t / 2, yaw }
}

/** Conservative ground-plane bounds. */
export function colliderBounds(c: ColliderDef): Rect {
  if (c.shape === 'cyl') return { minX: c.x - c.r, maxX: c.x + c.r, minZ: c.z - c.r, maxZ: c.z + c.r }
  const yaw = c.yaw ?? 0
  const cs = Math.abs(Math.cos(yaw))
  const sn = Math.abs(Math.sin(yaw))
  const ex = c.hx * cs + c.hz * sn
  const ez = c.hx * sn + c.hz * cs
  return { minX: c.x - ex, maxX: c.x + ex, minZ: c.z - ez, maxZ: c.z + ez }
}

/** Bottom height of a collider. */
export function colliderBottom(c: ColliderDef): number {
  return c.y - (c.shape === 'cyl' ? c.hh : c.hy)
}

/** Exact point-in-collider test on the ground plane (with a margin). */
export function pointInCollider(c: ColliderDef, x: number, z: number, margin = 0): boolean {
  if (c.shape === 'cyl') return Math.hypot(x - c.x, z - c.z) <= c.r + margin
  const yaw = c.yaw ?? 0
  const dx = x - c.x
  const dz = z - c.z
  // inverse-rotate into the box frame (rotation about +Y by -yaw)
  const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw)
  const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw)
  return Math.abs(lx) <= c.hx + margin && Math.abs(lz) <= c.hz + margin
}

export function StaticColliders({ defs, name }: { defs: ColliderDef[]; name: string }) {
  return (
    <RigidBody type="fixed" colliders={false} name={name}>
      {defs.map((c) =>
        c.shape === 'box' ? (
          <CuboidCollider key={c.id} args={[c.hx, c.hy, c.hz]} position={[c.x, c.y, c.z]} rotation={[0, c.yaw ?? 0, 0]} collisionGroups={GROUPS.static} friction={0.8} />
        ) : (
          <CylinderCollider key={c.id} args={[c.hh, c.r]} position={[c.x, c.y, c.z]} collisionGroups={GROUPS.static} friction={0.8} />
        ),
      )}
    </RigidBody>
  )
}
