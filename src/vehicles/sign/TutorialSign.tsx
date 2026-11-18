import { useMemo } from 'react'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { GROUPS } from '@/core/collision'
import { PALETTE } from '@/world/palette'
import { TUTORIAL_SIGN } from '../constants'
import { tutorialSignTexture } from '../lib/canvasTextures'
import { GeoBuilder, lin } from '../lib/GeoBuilder'

/**
 * Free-standing "FORKLIFT OPERATION" placard in the Maintenance Bay. Thin, so
 * it uses prop-group colliders (bodies bump into it, the camera boom does not)
 * and fades out when it blocks the view of the worker.
 */
const S = TUTORIAL_SIGN
const POST_X = S.boardWidth / 2 - S.postInset
const TOP = S.boardBottom + S.boardHeight
const MID = S.boardBottom + S.boardHeight / 2

let frameGeo: THREE.BufferGeometry | null = null
let faceGeo: THREE.BufferGeometry | null = null
let frameMat: THREE.MeshStandardMaterial | null = null
let faceMat: THREE.MeshStandardMaterial | null = null

function assets() {
  if (!frameGeo) {
    const b = new GeoBuilder()
    const dark = lin(PALETTE.charcoal)
    const steel = lin(PALETTE.gunmetal)
    const yellow = lin(PALETTE.hazard)
    for (const s of [-1, 1]) {
      b.box([s * POST_X, (TOP + 0.08) / 2, 0.035], [0.06, TOP + 0.08, 0.06], steel)
      b.box([s * POST_X, 0.012, 0.035], [0.26, 0.024, 0.26], dark)
      // bolts
      for (const dx of [-0.08, 0.08]) for (const dz of [-0.08, 0.08]) b.cyl([s * POST_X + dx, 0.03, 0.035 + dz], 0.014, 0.02, steel, 6)
    }
    // backing panel (slightly larger than the face) + yellow trim
    b.box([0, MID, 0.012], [S.boardWidth + 0.06, S.boardHeight + 0.06, 0.022], dark)
    b.box([0, TOP + 0.045, 0.01], [S.boardWidth + 0.1, 0.03, 0.09], yellow)
    b.box([0, S.boardBottom - 0.045, 0.01], [S.boardWidth + 0.1, 0.03, 0.09], yellow)
    frameGeo = b.build()
    // face: plane turned to face -Z (models face -Z; group yaw points it at the door)
    faceGeo = new THREE.PlaneGeometry(S.boardWidth, S.boardHeight)
    faceGeo.rotateY(Math.PI)
    faceGeo.translate(0, MID, -0.0015)
    frameMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35, name: 'vehicles:sign-frame' })
    const tex = tutorialSignTexture()
    faceMat = new THREE.MeshStandardMaterial({
      map: tex,
      emissive: '#ffffff',
      emissiveMap: tex,
      emissiveIntensity: 0.14,
      roughness: 0.78,
      metalness: 0.02,
      name: 'vehicles:sign-face',
    })
  }
  return { frameGeo: frameGeo!, faceGeo: faceGeo!, frameMat: frameMat!, faceMat: faceMat! }
}

const POS: [number, number, number] = [S.x, 0, S.z]
const ROT: [number, number, number] = [0, S.yaw, 0]

export function TutorialSign() {
  const a = assets()
  const userData = useMemo(() => ({ cameraFade: true }), [])
  return (
    <group name="vehicles-tutorial-sign">
      <group position={POS} rotation={ROT} userData={userData}>
        <mesh geometry={a.frameGeo} material={a.frameMat} castShadow receiveShadow />
        <mesh geometry={a.faceGeo} material={a.faceMat} receiveShadow />
      </group>
      <RigidBody type="fixed" colliders={false} position={POS} rotation={ROT} name="forklift-sign">
        <CuboidCollider args={[S.boardWidth / 2 + 0.03, S.boardHeight / 2 + 0.03, 0.04]} position={[0, MID, 0.012]} collisionGroups={GROUPS.prop} />
        {[-1, 1].map((s) => (
          <CuboidCollider key={s} args={[0.04, S.boardBottom / 2, 0.04]} position={[s * POST_X, S.boardBottom / 2, 0.035]} collisionGroups={GROUPS.prop} />
        ))}
      </RigidBody>
    </group>
  )
}
