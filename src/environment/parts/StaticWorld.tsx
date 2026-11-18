import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { events } from '@/core/events'
import { runtime } from '@/core/runtime'
import type { ZoneId } from '@/world/layout'
import { createInteriorTracker } from '../data/interior'
import { envMats, roofMaterial, type RoofKey } from '../lib/envMaterials'
import { kitGeometry, type KitInstance, type KitName } from './kits'
import { CASTS, staticMaterial, type BuiltWorld } from './world'

/** Current roof opacity per building (1 = visible); read by spinners/steam. */
export const roofOpacity = new Map<string, number>()

export function StaticMeshes({ world, sign, poster, shadows }: { world: BuiltWorld; sign: THREE.Material; poster: THREE.Material; shadows: boolean }) {
  useEffect(
    () => () => {
      for (const s of world.statics) s.geometry.dispose()
    },
    [world],
  )
  return (
    <group name="env-static">
      {world.statics.map((s) => (
        <mesh
          key={s.key}
          name={`env-static:${s.key}`}
          geometry={s.geometry}
          material={staticMaterial(s.key, sign, poster)}
          castShadow={shadows && !!CASTS[s.key]}
          receiveShadow={s.key !== 'far' && s.key !== 'farGlow' && s.key !== 'glow'}
          renderOrder={s.key === 'glass' ? 2 : 0}
        />
      ))}
    </group>
  )
}

/**
 * Roofs with the interior cutaway: the building containing the player fades
 * its roof out (alpha-hash dither, no sorting issues) and then moves it to the
 * shadow-only layer so interiors keep their roof shadow. Writes
 * runtime.world.interior and emits 'world:interior' on change.
 */
export function Roofs({ world, shadows }: { world: BuiltWorld; shadows: boolean }) {
  const meshes = useRef(new Map<ZoneId, THREE.Mesh[]>())
  const mats = useMemo(() => {
    const m = new Map<ZoneId, THREE.Material[]>()
    for (const r of world.roofs) m.set(r.id, r.parts.map((p) => roofMaterial(p.key as RoofKey, r.id)))
    return m
  }, [world])
  const tracker = useMemo(() => createInteriorTracker(0.35), [])

  useEffect(() => {
    return () => {
      for (const r of world.roofs) for (const p of r.parts) p.geometry.dispose()
      tracker.reset()
      roofOpacity.clear()
      if (runtime.world.interior !== null) {
        runtime.world.interior = null
        events.emit('world:interior', { zoneId: null })
      }
    }
  }, [world, tracker])

  useFrame((_, dt) => {
    const p = runtime.player.position
    const id = tracker.update(p.x, p.z)
    if (id !== runtime.world.interior) {
      runtime.world.interior = id
      events.emit('world:interior', { zoneId: id })
    }
    const k = 1 - Math.exp(-12 * Math.min(dt, 0.1))
    for (const r of world.roofs) {
      const target = id === r.id ? 0 : 1
      let cur = roofOpacity.get(r.id) ?? 1
      cur += (target - cur) * k
      if (Math.abs(cur - target) < 0.02) cur = target
      roofOpacity.set(r.id, cur)
      const ms = mats.get(r.id)
      if (ms) for (const m of ms) m.opacity = Math.max(cur, 0)
      const list = meshes.current.get(r.id)
      if (list) for (const m of list) m.layers.set(cur <= 0.001 ? 1 : 0)
    }
  })

  return (
    <group name="env-roofs">
      {world.roofs.map((r) =>
        r.parts.map((p, i) => (
          <mesh
            key={`${r.id}:${p.key}`}
            name={`env-roof:${r.id}:${p.key}`}
            geometry={p.geometry}
            material={mats.get(r.id)![i]}
            castShadow={shadows && (p.key === 'corr' || p.key === 'paint' || p.key === 'brick')}
            receiveShadow={p.key !== 'glow' && p.key !== 'window'}
            ref={(m) => {
              if (!m) return
              const list = meshes.current.get(r.id) ?? []
              if (!list.includes(m)) list.push(m)
              meshes.current.set(r.id, list)
            }}
          />
        )),
      )}
    </group>
  )
}

function KitMesh({ name, list, shadows }: { name: KitName; list: KitInstance[]; shadows: boolean }) {
  const mesh = useMemo(() => {
    const mat = name === 'lens' ? envMats.glow() : envMats.kit()
    const m = new THREE.InstancedMesh(kitGeometry(name), mat, list.length)
    list.forEach((it, i) => {
      m.setMatrixAt(i, it.m)
      m.setColorAt(i, it.c)
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
    m.receiveShadow = name !== 'lens'
    m.name = `env-kit:${name}`
    return m
  }, [name, list])
  useEffect(() => {
    mesh.castShadow = shadows && name !== 'lens' && name !== 'cone'
  }, [mesh, shadows, name])
  useEffect(() => () => mesh.dispose(), [mesh])
  return <primitive object={mesh} />
}

export function Kits({ world, shadows }: { world: BuiltWorld; shadows: boolean }) {
  return (
    <group name="env-kits">
      {[...world.kits].map(([name, list]) => (
        <KitMesh key={name} name={name} list={list} shadows={shadows} />
      ))}
    </group>
  )
}
