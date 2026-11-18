import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '@/state/game'
import { PALETTE } from '@/world/palette'
import { lidArt } from './art'
import { HATCH_SIZE, type HatchDef } from './config'
import { easeOutBack, easeOutCubic, PartBuilder, vertexColorMat, type V3 } from './geometry'
import type { OshaFsm } from './oshaFsm'

/**
 * Manhole-style safety hatches near each restricted zone. Flush with the floor
 * (top < 0.045 m, no colliders). The inspector pops out of them: the lid swings
 * open on its hinge (away from the zone), he climbs out, and it slams shut.
 *
 * Draw calls: 1 merged mesh for every collar + shaft opening, 1 InstancedMesh
 * for the lids.
 */

const R = HATCH_SIZE.radius
const LID_R = R - 0.025
const LID_H = 0.026
const LID_Y = HATCH_SIZE.top - LID_H / 2 - 0.001
const OPEN_ANGLE = 1.95

function buildCollars(hatches: readonly HatchDef[]): THREE.BufferGeometry {
  const b = new PartBuilder()
  const top = HATCH_SIZE.top
  const F = HATCH_SIZE.frame
  const flat: V3 = [-Math.PI / 2, 0, 0]
  for (const h of hatches) {
    const [x, z] = h.position
    // collar top: steel lip | painted yellow safety ring | steel rim (coplanar, no overlap)
    b.add(new THREE.RingGeometry(R - 0.004, R + 0.014, 32, 1), '#3B4244', { position: [x, top, z], rotation: flat })
    b.add(new THREE.RingGeometry(R + 0.014, F - 0.016, 32, 1), PALETTE.hazard, { position: [x, top, z], rotation: flat })
    b.add(new THREE.RingGeometry(F - 0.016, F, 32, 1), '#3B4244', { position: [x, top, z], rotation: flat })
    // bevelled outer edge down to the floor
    b.add(new THREE.CylinderGeometry(F, F + 0.05, top, 32, 1, true), '#30373A', { position: [x, top / 2, z] })
    // the shaft: a dark disc you only see when the lid is open
    b.add(new THREE.CircleGeometry(R - 0.01, 28), '#050606', { position: [x, 0.006, z], rotation: flat })
    // hinge knuckles on the hinge side
    const hx = -Math.sin(h.hinge)
    const hz = -Math.cos(h.hinge)
    for (const s of [-1, 1]) {
      const px = x + hx * (R + 0.02) + Math.cos(h.hinge) * 0.16 * s
      const pz = z + hz * (R + 0.02) - Math.sin(h.hinge) * 0.16 * s
      b.add(new THREE.CylinderGeometry(0.022, 0.022, 0.1, 8), '#2A2F30', { position: [px, HATCH_SIZE.top, pz], rotation: [0, h.hinge, Math.PI / 2] })
    }
  }
  return b.build()
}

let lidGeo: THREE.CylinderGeometry | null = null
let lidMat: THREE.MeshStandardMaterial | null = null
function getLid(): { geo: THREE.CylinderGeometry; mat: THREE.MeshStandardMaterial } {
  if (!lidGeo) lidGeo = new THREE.CylinderGeometry(LID_R, LID_R, LID_H, 28)
  if (!lidMat) {
    const art = lidArt()
    lidMat = new THREE.MeshStandardMaterial({ map: art?.texture ?? null, color: art ? '#ffffff' : '#41484a', roughness: 0.55, metalness: 0.45 })
    lidMat.polygonOffset = true
    lidMat.polygonOffsetFactor = -2
    lidMat.polygonOffsetUnits = -2
    lidMat.name = 'safety-hatch-lid'
  }
  return { geo: lidGeo, mat: lidMat }
}

const _m = new THREE.Matrix4()
const _a = new THREE.Matrix4()

/** Lid pose: hinged at its edge on the `hinge` side, opened by `angle` radians. */
function lidMatrix(h: HatchDef, angle: number, out: THREE.Matrix4): THREE.Matrix4 {
  const [x, z] = h.position
  // T(center) · Ry(hinge) · T(0, y, -R) · Rx(-angle) · T(0, 0, R)
  out.makeTranslation(x, LID_Y, z)
  out.multiply(_a.makeRotationY(h.hinge))
  out.multiply(_a.makeTranslation(0, 0, -LID_R))
  out.multiply(_a.makeRotationX(-angle))
  out.multiply(_a.makeTranslation(0, 0, LID_R))
  return out
}

export function HatchesVisual({ fsm }: { fsm: OshaFsm }) {
  const quality = useGameStore((s) => s.quality)
  const collars = useMemo(() => buildCollars(fsm.hatches), [fsm])
  const lids = useMemo(() => {
    const { geo, mat } = getLid()
    const mesh = new THREE.InstancedMesh(geo, mat, fsm.hatches.length)
    fsm.hatches.forEach((h, i) => mesh.setMatrixAt(i, lidMatrix(h, 0, _m)))
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.computeBoundingSphere()
    mesh.frustumCulled = false
    mesh.receiveShadow = true
    mesh.name = 'safety-hatch-lids'
    return mesh
  }, [fsm])
  useEffect(
    () => () => {
      collars.dispose()
      lids.dispose()
    },
    [collars, lids],
  )
  useEffect(() => {
    lids.castShadow = quality !== 'low'
  }, [lids, quality])

  const last = useRef<number[]>([])
  useFrame(() => {
    let changed = false
    const prev = last.current
    for (let i = 0; i < fsm.hatches.length; i++) {
      const o = fsm.hatchOpen(i)
      if (prev[i] === o) continue
      const opening = prev[i] === undefined || o >= prev[i]
      prev[i] = o
      const angle = OPEN_ANGLE * (opening ? Math.min(1.06, easeOutBack(o, 1.4)) : easeOutCubic(o))
      lids.setMatrixAt(i, lidMatrix(fsm.hatches[i], angle, _m))
      changed = true
    }
    if (changed) lids.instanceMatrix.needsUpdate = true
  })

  return (
    <group name="safety-hatches">
      <mesh geometry={collars} material={vertexColorMat(0.6, 0.4, 2)} receiveShadow />
      <primitive object={lids} />
    </group>
  )
}
