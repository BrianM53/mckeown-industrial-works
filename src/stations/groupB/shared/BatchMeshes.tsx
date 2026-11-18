import { useEffect, type ReactNode } from 'react'
import type * as THREE from 'three'
import { bmats, NO_SHADOW_KEYS, type BatchMatKey } from './materials'

/**
 * Renders the merged geometries of a built Batch: one mesh (= one draw call) per
 * material key. Unknown keys must be given in `materials` (atlas/sign materials).
 * Geometries belong to the caller's useMemo; they are disposed on unmount
 * (three.js re-uploads them transparently if StrictMode remounts).
 */
export function BatchMeshes({
  geos,
  shadows,
  materials,
  name,
  noShadowKeys,
}: {
  geos: Map<string, THREE.BufferGeometry>
  /** Cast shadows (medium/high quality, outdoor stations). */
  shadows: boolean
  materials?: Record<string, THREE.Material>
  name?: string
  noShadowKeys?: string[]
}) {
  useEffect(
    () => () => {
      geos.forEach((g) => g.dispose())
    },
    [geos],
  )
  const out: ReactNode[] = []
  geos.forEach((g, key) => {
    const mat = materials?.[key] ?? (key in bmats ? bmats[key as BatchMatKey]() : null)
    if (!mat) return
    const cast = shadows && !NO_SHADOW_KEYS.has(key) && !(noShadowKeys ?? []).includes(key)
    out.push(<mesh key={key} name={name ? `${name}:${key}` : key} geometry={g} material={mat} castShadow={cast} receiveShadow />)
  })
  return <>{out}</>
}
