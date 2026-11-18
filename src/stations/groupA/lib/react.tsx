import { useEffect, useMemo, type ReactNode } from 'react'
import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { GROUPS } from '@/core/collision'
import type { Builder } from './builder'
import { SHADOW_KEYS, staticMaterial } from './materials'

/**
 * React glue for station geometry: merged static meshes (disposed on unmount,
 * StrictMode-safe — three re-uploads a geometry if it is drawn after dispose),
 * fixed-body colliders, and a tiny disposal hook for textures/materials.
 */
export interface BuiltMesh {
  key: string
  geometry: THREE.BufferGeometry
}

/** Build once per `deps`; dispose the geometries when they change / on unmount. */
export function useBuilt(make: () => Builder, deps: unknown[]): BuiltMesh[] {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const built = useMemo(() => make().build(), deps)
  useEffect(
    () => () => {
      for (const b of built) b.geometry.dispose()
    },
    [built],
  )
  return built
}

/** Dispose any three.js resources created in useMemo when they change / unmount. */
export function useDisposable<T extends { dispose: () => void } | null | undefined>(value: T): T {
  useEffect(
    () => () => {
      value?.dispose()
    },
    [value],
  )
  return value
}

export function BuiltMeshes({
  meshes,
  shadows,
  receive = true,
  materialFor,
  name,
  cameraFade = false,
}: {
  meshes: BuiltMesh[]
  shadows: boolean
  receive?: boolean
  materialFor?: (key: string) => THREE.Material | undefined
  name?: string
  /** Thin decorative props: the player camera hides them while they block the worker (player/occluders). */
  cameraFade?: boolean
}) {
  return (
    <group name={name}>
      {meshes.map((m) => (
        <mesh
          key={m.key}
          geometry={m.geometry}
          material={materialFor?.(m.key) ?? staticMaterial(m.key)}
          castShadow={shadows && SHADOW_KEYS.has(m.key)}
          receiveShadow={receive && m.key !== 'glow'}
          renderOrder={m.key === 'glass' ? 2 : 0}
          {...(cameraFade ? { userData: { cameraFade: true } } : null)}
        />
      ))}
    </group>
  )
}

/** Axis-aligned box collider in world space (center + half extents). */
export interface BoxCol {
  c: [number, number, number]
  h: [number, number, number]
}

export interface CylCol {
  c: [number, number, number]
  r: number
  hh: number
}

/** All of a station's colliders in one fixed body (GROUPS.static). */
export function StaticColliders({ boxes = [], cyls = [], name, children }: { boxes?: BoxCol[]; cyls?: CylCol[]; name: string; children?: ReactNode }) {
  return (
    <RigidBody type="fixed" colliders={false} name={name}>
      {boxes.map((b, i) => (
        <CuboidCollider key={`b${i}`} args={b.h} position={b.c} collisionGroups={GROUPS.static} friction={0.6} />
      ))}
      {cyls.map((c, i) => (
        <CylinderCollider key={`c${i}`} args={[c.hh, c.r]} position={c.c} collisionGroups={GROUPS.static} friction={0.6} />
      ))}
      {children}
    </RigidBody>
  )
}

/**
 * Local (x, z) offset → world, for a station placed at `origin` with a yaw that
 * is a multiple of PI/2 (all group-A stations). Model forward is local -Z.
 */
export function localToWorld(origin: [number, number], yaw: number, lx: number, lz: number): [number, number] {
  const c = Math.round(Math.cos(yaw))
  const s = Math.round(Math.sin(yaw))
  // three.js rotation about +Y: x' = x cos + z sin, z' = -x sin + z cos
  return [origin[0] + lx * c + lz * s, origin[1] - lx * s + lz * c]
}

/** World-space AABB collider from a local box (center lx/ly/lz, full size w/h/d) on a quarter-turn station. */
export function localBox(origin: [number, number], yaw: number, lc: [number, number, number], size: [number, number, number]): BoxCol {
  const [wx, wz] = localToWorld(origin, yaw, lc[0], lc[2])
  const quarter = Math.abs(Math.round(Math.sin(yaw))) === 1
  const hx = (quarter ? size[2] : size[0]) / 2
  const hz = (quarter ? size[0] : size[2]) / 2
  return { c: [wx, lc[1], wz], h: [hx, size[1] / 2, hz] }
}
