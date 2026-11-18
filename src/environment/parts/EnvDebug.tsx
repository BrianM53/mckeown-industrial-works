import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { registerDebug } from '@/core/debug'
import { runtime } from '@/core/runtime'
import { yawFromDirection } from '@/core/math'
import { environmentColliders } from '../data/colliders'
import { getLightingOverride, setLightingOverride } from '../lightState'
import type { BuiltWorld } from './world'

/**
 * Dev/test hooks (stripped in production by registerDebug):
 *   __MIW__.environment.stats()                  -> renderer + environment counts
 *   __MIW__.environment.breakdown()              -> triangles per environment mesh (largest first)
 *   __MIW__.environment.setLighting(level, em)   -> force the environment's lighting response (visual-only
 *                                                   override; runtime.lighting stays owned by safety).
 *                                                   setLighting(null) clears it. Real blackout: __MIW__.nightShift.start()
 *   __MIW__.environment.interior()               -> current roof-cutaway interior
 *   __MIW__.environment.setPlayer(x, z, yaw?)    -> teleport the player (or move the focus when no player module)
 *   __MIW__.envcam.look(px,py,pz, tx,ty,tz)      -> place the default camera (overridden by the player rig)
 */
export function EnvDebug({ world }: { world: BuiltWorld | null }) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    const hasPlayer = () => {
      const w = window as unknown as { __MIW__?: { player?: { teleport?: unknown } } }
      return typeof w.__MIW__?.player?.teleport === 'function'
    }
    const offEnv = registerDebug('environment', {
      stats: () => {
        let envMeshes = 0
        let envInstances = 0
        const root = scene.getObjectByName('environment-root')
        root?.traverseVisible((o) => {
          const m = o as THREE.Mesh
          if (m.isMesh) {
            envMeshes++
            const im = o as THREE.InstancedMesh
            if (im.isInstancedMesh) envInstances += im.count
          }
        })
        return {
          calls: gl.info.render.calls,
          triangles: gl.info.render.triangles,
          points: gl.info.render.points,
          lines: gl.info.render.lines,
          geometries: gl.info.memory.geometries,
          textures: gl.info.memory.textures,
          programs: gl.info.programs?.length ?? null,
          envMeshes,
          envInstances,
          envStaticTriangles: world?.stats.triangles ?? null,
          colliders: environmentColliders().length,
          spinners: world?.spinners.length ?? 0,
          steamEmitters: world?.steam.length ?? 0,
        }
      },
      breakdown: () => {
        const rows: { name: string; material: string; triangles: number; instances: number; castShadow: boolean; visible: boolean }[] = []
        scene.getObjectByName('environment-root')?.traverse((o) => {
          const m = o as THREE.Mesh
          if (!m.isMesh) return
          const g = m.geometry as THREE.BufferGeometry
          const base = g.index ? g.index.count / 3 : (g.getAttribute('position')?.count ?? 0) / 3
          const im = o as THREE.InstancedMesh
          const ig = g as THREE.InstancedBufferGeometry
          const instances = im.isInstancedMesh ? im.count : ig.isInstancedBufferGeometry ? ig.instanceCount : 1
          const mat = Array.isArray(m.material) ? m.material[0] : m.material
          rows.push({ name: m.name || m.parent?.name || '?', material: mat?.name ?? '', triangles: Math.round(base * instances), instances, castShadow: m.castShadow, visible: m.visible })
        })
        return rows.sort((a, b) => b.triangles - a.triangles)
      },
      setLighting: (level: number | null, emergency = 0) => {
        if (level === null || level === undefined) setLightingOverride(null)
        else setLightingOverride({ level: Number(level), emergency: Number(emergency) })
        return getLightingOverride() ?? { ...runtime.lighting }
      },
      interior: () => runtime.world.interior,
      setPlayer: (x: number, z: number, yaw?: number) => {
        // Prefer the real player (runtime.player is owned by it); fall back for player-less test scenes.
        const w = window as unknown as { __MIW__?: { player?: { teleport?: (x: number, z: number, yaw?: number) => boolean } } }
        const teleport = w.__MIW__?.player?.teleport
        if (typeof teleport === 'function') return teleport(x, z, yaw)
        runtime.player.position.set(x, 0, z)
        if (yaw !== undefined) runtime.camera.yaw = yaw
        return [x, z]
      },
    })
    const offCam = registerDebug('envcam', {
      look: (px: number, py: number, pz: number, tx: number, ty: number, tz: number) => {
        camera.position.set(px, py, pz)
        camera.lookAt(tx, ty, tz)
        camera.updateMatrixWorld()
        if (!hasPlayer()) {
          runtime.player.position.set(tx, 0, tz)
          runtime.camera.yaw = yawFromDirection(tx - px, tz - pz)
        }
        return true
      },
    })
    return () => {
      offEnv()
      offCam()
      setLightingOverride(null)
    }
  }, [gl, camera, scene, world])
  return null
}
