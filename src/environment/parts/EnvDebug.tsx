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
 *   __MIW__.environment.measure()                -> renders one frame with ONLY the environment visible and
 *                                                   returns its draw calls / triangles (incl. shadow pass)
 *                                                   next to the whole scene's, for the perf budget
 *   __MIW__.environment.split(names?)            -> per-module calls/triangles (+ shadow share, casters) at this view
 *   __MIW__.environment.breakdown()              -> triangles per environment mesh (largest first)
 *   __MIW__.environment.setLighting(level, em)   -> force the environment's lighting response (visual-only
 *                                                   override; runtime.lighting stays owned by safety).
 *                                                   setLighting(null) clears it. Real blackout: __MIW__.nightShift.start()
 *   __MIW__.environment.interior()               -> current roof-cutaway interior
 *   __MIW__.environment.setPlayer(x, z, yaw?)    -> teleport the player (or move the focus when no player module)
 *   __MIW__.envcam.look(px,py,pz, tx,ty,tz)      -> place the default camera (overridden by the player rig)
 */
const SPLIT_ROOTS = ['environment-root', 'production-spine', 'factory-rocket', 'npc-root', 'stations-a', 'stations-b', 'vehicles-root', 'safety', 'player']

export function EnvDebug({ world }: { world: BuiltWorld | null }) {
  const gl = useThree((s) => s.gl)
  const get = useThree((s) => s.get)
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
      measure: () => {
        const root = scene.getObjectByName('environment-root')
        const camera = get().camera
        if (!root) return null
        const renderCounts = () => {
          gl.info.reset()
          gl.render(scene, camera)
          return { calls: gl.info.render.calls, triangles: gl.info.render.triangles }
        }
        const autoReset = gl.info.autoReset
        gl.info.autoReset = false
        const hidden: THREE.Object3D[] = []
        try {
          const all = renderCounts()
          // Hide every renderable outside the environment. Lights stay as they are: changing the
          // light set would force every material to recompile (very slow on software GL).
          for (let node: THREE.Object3D = root; node.parent; node = node.parent) {
            for (const sib of node.parent.children) {
              if (sib === node) continue
              sib.traverse((o) => {
                const r = o as THREE.Mesh & { isPoints?: boolean; isLine?: boolean; isSprite?: boolean }
                if (o.visible && (r.isMesh || r.isPoints || r.isLine || r.isSprite)) {
                  o.visible = false
                  hidden.push(o)
                }
              })
            }
          }
          const environment = renderCounts()
          return { environment, scene: all, budget: { calls: 200, triangles: 300_000 } }
        } finally {
          for (const h of hidden) h.visible = true
          gl.info.autoReset = autoReset
          gl.info.reset()
        }
      },
      /**
       * Per-module cost at the current view: for each named root, renders it alone (lights untouched)
       * with and without the shadow pass. Shadow pass is skipped via shadowMap.autoUpdate (no recompile).
       */
      split: (names: string[] = SPLIT_ROOTS) => {
        const camera = get().camera
        const sm = gl.shadowMap
        const autoReset = gl.info.autoReset
        const smAuto = sm.autoUpdate
        gl.info.autoReset = false
        const renderables: THREE.Object3D[] = []
        scene.traverse((o) => {
          const r = o as THREE.Mesh & { isPoints?: boolean; isLine?: boolean; isSprite?: boolean }
          if (o.visible && (r.isMesh || r.isPoints || r.isLine || r.isSprite)) renderables.push(o)
        })
        const count = (withShadow: boolean) => {
          sm.autoUpdate = withShadow
          sm.needsUpdate = withShadow
          gl.info.reset()
          gl.render(scene, camera)
          return { calls: gl.info.render.calls, triangles: gl.info.render.triangles }
        }
        const isVisibleChain = (o: THREE.Object3D) => {
          for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible) return false
          return true
        }
        const out: Record<string, unknown> = {}
        try {
          const all = count(true)
          const allNo = count(false)
          out.scene = { ...all, shadowCalls: all.calls - allNo.calls, shadowTriangles: all.triangles - allNo.triangles }
          let sumT = 0
          for (const name of names) {
            const root = scene.getObjectByName(name)
            if (!root) continue
            const keep = new Set<THREE.Object3D>()
            root.traverse((o) => keep.add(o))
            const hidden: THREE.Object3D[] = []
            for (const o of renderables) if (!keep.has(o)) { o.visible = false; hidden.push(o) }
            let casters = 0
            root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.castShadow && isVisibleChain(o)) casters++ })
            const a = count(true)
            const b = count(false)
            for (const h of hidden) h.visible = true
            sumT += a.triangles
            out[name] = { calls: a.calls, triangles: a.triangles, shadowCalls: a.calls - b.calls, shadowTriangles: a.triangles - b.triangles, casters }
          }
          out.unattributedTriangles = all.triangles - sumT
          return out
        } finally {
          for (const o of renderables) o.visible = true
          sm.autoUpdate = smAuto
          sm.needsUpdate = true
          gl.info.autoReset = autoReset
          gl.info.reset()
        }
      },
      /** Shadow casters under a named root (largest first): name, triangles, instances, bounding radius. */
      casters: (name = 'environment-root', n = 25) => {
        const rows: [string, number, number, number][] = []
        const sph = new THREE.Sphere()
        scene.getObjectByName(name)?.traverse((o) => {
          const m = o as THREE.Mesh
          if (!m.isMesh || !m.castShadow) return
          for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return
          const g = m.geometry as THREE.BufferGeometry
          const base = g.index ? g.index.count / 3 : (g.getAttribute('position')?.count ?? 0) / 3
          const im = o as THREE.InstancedMesh
          const inst = im.isInstancedMesh ? im.count : 1
          if (!g.boundingSphere) g.computeBoundingSphere()
          sph.copy(g.boundingSphere!).applyMatrix4(m.matrixWorld)
          rows.push([m.name || m.parent?.name || '?', Math.round(base * inst), inst, Math.round(sph.radius * 10) / 10])
        })
        return rows.sort((a, b) => b[1] - a[1]).slice(0, n)
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
        const camera = get().camera
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
  }, [gl, get, scene, world])
  return null
}
