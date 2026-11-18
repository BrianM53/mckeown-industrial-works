import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { runtime } from '@/core/runtime'
import { useSettings } from '@/state/settings'
import { ANCHORS, ZONES } from '@/world/layout'
import { Builder } from '../lib/builder'
import type { Atlas } from '../lib/canvas'
import { C } from '../lib/materials'
import { BuiltMeshes, useBuilt } from '../lib/react'

/**
 * Personnel Office dressing that the environment's furniture does not cover:
 * a wall clock between the north windows (real local time, sweeping hand),
 * a rubber plant by the door, the "APPLICANTS" footprint decal at the print
 * spot, and the inside end of the contact mailbox's pneumatic line.
 */
const IN = ZONES.personnel.building!.interior
export const CLOCK = { x: 12.0, y: 2.18, z: IN.minZ + 0.06, r: 0.3 }
export const PLANT = { x: 8.05, z: IN.maxZ - 0.48, r: 0.32 }
/** Where the mailbox's overhead tube pierces the south wall (shared with the mailbox network). */
export const TUBE_ENTRY = { x: 8.15, y: 4.85 }

function buildDressing(atlas: Atlas): Builder {
  const b = new Builder()
  const uv = (k: string) => atlas.cells[k]?.uv ?? null
  // wall clock
  b.plane('sign', [CLOCK.x, CLOCK.y, CLOCK.z + 0.045], CLOCK.r * 2, CLOCK.r * 2, '#ffffff', [0, 0, 0], uv('clock'))
  b.cylAxis('paint', [CLOCK.x, CLOCK.y, CLOCK.z + 0.015], 'z', CLOCK.r + 0.02, 0.04, '#2a2f30', 28)
  b.torus('metal', [CLOCK.x, CLOCK.y, CLOCK.z + 0.048], CLOCK.r + 0.01, 0.025, C.brass, 'z', Math.PI * 2, 0, 8, 32)
  // rubber plant
  b.cyl('paint', PLANT.x, 0, PLANT.z, 0.26, 0.46, '#B5643C', 16, 0.3)
  b.cyl('paint', PLANT.x, 0.44, PLANT.z, 0.31, 0.05, '#9a5232', 16)
  b.cyl('dark', PLANT.x, 0.45, PLANT.z, 0.27, 0.03, '#3b2a1f', 14)
  b.tube('paint', [PLANT.x, 0.45, PLANT.z], [PLANT.x + 0.04, 1.35, PLANT.z - 0.02], 0.03, '#5d4a33', 6)
  const leaves: [number, number, number, number][] = [
    [0.18, 0.95, 0.05, 0.24],
    [-0.16, 1.1, -0.08, 0.26],
    [0.06, 1.42, 0.1, 0.27],
    [-0.1, 1.62, 0.02, 0.22],
    [0.15, 1.3, -0.14, 0.22],
    [-0.2, 0.78, 0.12, 0.2],
  ]
  for (const [dx, y, dz, r] of leaves) b.sphere('paint', [PLANT.x + dx, y, PLANT.z + dz], r, '#557F3D', 10, 8, 0.75)
  // inside end of the contact mailbox's pneumatic line: wall flange, elbow, up into the ceiling
  const zIn = IN.maxZ - 0.12
  b.cylAxis('metal', [TUBE_ENTRY.x, TUBE_ENTRY.y, IN.maxZ - 0.03], 'z', 0.12, 0.05, C.brass, 16)
  b.tube('metal', [TUBE_ENTRY.x, TUBE_ENTRY.y, IN.maxZ - 0.03], [TUBE_ENTRY.x, TUBE_ENTRY.y, zIn], 0.075, C.brass, 12)
  b.sphere('metal', [TUBE_ENTRY.x, TUBE_ENTRY.y, zIn], 0.09, C.brass, 12, 8)
  b.tube('metal', [TUBE_ENTRY.x, TUBE_ENTRY.y, zIn], [TUBE_ENTRY.x, 6.0, zIn], 0.075, C.brass, 12)
  b.cylAxis('metal', [TUBE_ENTRY.x, 5.3, zIn], 'y', 0.095, 0.06, C.brassDark, 12)
  // print-spot floor decal ("APPLICANTS" footprints), facing the machine
  const [ix, iz] = ANCHORS.resumePrinter.interact
  b.plane('decal', [ix, 0.036, iz], 0.72, 0.9, '#ffffff', [-Math.PI / 2, -Math.PI / 2, 0], uv('decal'))
  return b
}

const HAND_GEO = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
const _m = new THREE.Matrix4()
const _now = new Date()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const Z = new THREE.Vector3(0, 0, 1)
const HANDS = [
  { len: 0.16, w: 0.03, z: 0.055, color: '#1f2324' },
  { len: 0.25, w: 0.02, z: 0.061, color: '#1f2324' },
  { len: 0.27, w: 0.008, z: 0.067, color: '#c8302a' },
]

function setClockHands(mesh: THREE.InstancedMesh, now: Date, reduced: boolean): void {
  const sec = now.getSeconds() + (reduced ? 0 : now.getMilliseconds() / 1000)
  const min = now.getMinutes() + sec / 60
  const hr = (now.getHours() % 12) + min / 60
  const angles = [(hr / 12) * Math.PI * 2, (min / 60) * Math.PI * 2, (sec / 60) * Math.PI * 2]
  for (let i = 0; i < 3; i++) {
    const h = HANDS[i]
    _q.setFromAxisAngle(Z, -(Number.isFinite(angles[i]) ? angles[i] : 0))
    _m.compose(_p.set(CLOCK.x, CLOCK.y, CLOCK.z + h.z), _q, _s.set(h.w, h.len, 0.008))
    mesh.setMatrixAt(i, _m)
  }
  mesh.instanceMatrix.needsUpdate = true
}

export function OfficeDressing({ atlas, signMaterial, shadows }: { atlas: Atlas; signMaterial: THREE.Material; shadows: boolean }) {
  const meshes = useBuilt(() => buildDressing(atlas), [atlas])
  const reduced = useSettings((s) => s.reducedMotion)
  const decalMat = useMemo(
    () => new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    [atlas],
  )
  useEffect(() => () => decalMat.dispose(), [decalMat])
  const hands = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, metalness: 0.2 })
    const mesh = new THREE.InstancedMesh(HAND_GEO, mat, 3)
    const c = new THREE.Color()
    HANDS.forEach((h, i) => mesh.setColorAt(i, c.set(h.color)))
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    setClockHands(mesh, new Date(), false)
    return mesh
  }, [])
  useEffect(
    () => () => {
      ;(hands.material as THREE.Material).dispose()
      hands.dispose()
    },
    [hands],
  )
  const last = useMemo(() => ({ acc: 1 }), [])

  useFrame((_, dt) => {
    // Only tick near the office; the second hand sweeps when close, else 2 Hz.
    const p = runtime.player.position
    const d = Math.hypot(p.x - CLOCK.x, p.z - CLOCK.z)
    if (d > 30) return
    last.acc += dt
    const interval = d < 14 && !reduced ? 1 / 20 : 0.5
    if (last.acc < interval) return
    last.acc = 0
    _now.setTime(Date.now())
    setClockHands(hands, _now, reduced)
  })

  return (
    <group name="personnel-dressing">
      <BuiltMeshes meshes={meshes} shadows={shadows} materialFor={(k) => (k === 'sign' ? signMaterial : k === 'decal' ? decalMat : undefined)} />
      <primitive object={hands} />
    </group>
  )
}
