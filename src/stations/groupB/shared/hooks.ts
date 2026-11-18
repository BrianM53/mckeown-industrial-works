import { useEffect, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { runtime } from '@/core/runtime'
import type { Rect } from '@/core/types'
import { useGameStore } from '@/state/game'
import { useSettings } from '@/state/settings'
import { setLampLevel } from './materials'

export const useQuality = () => useGameStore((s) => s.quality)
export const useReducedMotion = () => useSettings((s) => s.reducedMotion)

/** Latest value in a ref (read inside useFrame without re-subscribing). */
export function useLatest<T>(value: T): RefObject<T> {
  const r = useRef(value)
  r.current = value
  return r
}

/**
 * Interior visibility gate for a building station: the contents render only
 * while the player is inside, or while the camera is outside on the door side
 * within `range` meters of the door (the only opening you can see in through).
 * Saves the interior's draw calls whenever it cannot be seen. Checked at ~5 Hz.
 */
export function useInteriorGate(ref: RefObject<THREE.Object3D | null>, zoneId: string, door: { x: number; z: number; side: 'E' | 'W' | 'N' | 'S' }, range = 46): void {
  const acc = useRef(1)
  useFrame((_, dt) => {
    acc.current += dt
    if (acc.current < 0.2) return
    acc.current = 0
    const o = ref.current
    if (!o) return
    const c = runtime.camera.position
    const p = runtime.player.position
    let vis = runtime.world.interior === zoneId
    if (!vis) {
      const outsideOk =
        door.side === 'E' ? c.x > door.x - 0.6 : door.side === 'W' ? c.x < door.x + 0.6 : door.side === 'N' ? c.z < door.z + 0.6 : c.z > door.z - 0.6
      const near = Math.hypot(c.x - door.x, c.z - door.z) < range || Math.hypot(p.x - door.x, p.z - door.z) < 9
      vis = outsideOk && near
      // NaN-safe: an invalid camera never hides content
      if (!Number.isFinite(c.x) || !Number.isFinite(c.z)) vis = true
    }
    if (o.visible !== vis) o.visible = vis
  })
}

/** Hide an outdoor station beyond `range` meters from the camera. */
export function useDistanceGate(ref: RefObject<THREE.Object3D | null>, center: { x: number; z: number }, range: number): void {
  const acc = useRef(1)
  useFrame((_, dt) => {
    acc.current += dt
    if (acc.current < 0.25) return
    acc.current = 0
    const o = ref.current
    if (!o) return
    const c = runtime.camera.position
    const d = Math.hypot(c.x - center.x, c.z - center.z)
    const vis = !Number.isFinite(d) || d < range
    if (o.visible !== vis) o.visible = vis
  })
}

/** Drives the shared 'lamp' material from the Night Shift lighting level (once per frame). */
export function useLampDimmer(): void {
  useFrame(() => setLampLevel(runtime.lighting.level))
  useEffect(() => () => setLampLevel(1), [])
}

/** True when the point is inside the rect (ground plane). */
export function inRect(r: Rect, x: number, z: number, pad = 0): boolean {
  return x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad
}

/** True when the object and all its ancestors are visible (skip per-frame work for gated stations). */
export function shown(o: THREE.Object3D | null | undefined): boolean {
  if (!o) return false
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false
  return true
}
