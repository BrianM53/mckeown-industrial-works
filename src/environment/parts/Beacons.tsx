import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useSettings } from '@/state/settings'
import { ENV_PALETTE } from '@/world/palette'
import { buildKit } from '../lib/batch'
import { envMats } from '../lib/envMaterials'
import { envLight } from '../lightState'
import { EMERGENCY_BEACONS, ZONE_BEACONS } from './beaconData'

/**
 * Zone-colored beacon bulbs with soft pulsing halos, and red rotating
 * emergency beacons that light up during the Night Shift (beams + glow; steady
 * glow without rotation when reduced motion is on).
 */
const bulbGeo = buildKit((b) => b.sphere('k', 0, 0, 0, 1, '#ffffff', 12, 8))
const domeGeo = buildKit((b) => {
  b.sphere('k', 0, 0, 0, 1, '#ffffff', 12, 8, 1.15)
})
const haloGeo = new THREE.PlaneGeometry(1, 1)
/** Two crossed vertical quads extending along +X: a fake volumetric beam. */
const beamGeo = (() => {
  const g = new THREE.BufferGeometry()
  const L = 4.2
  const h0 = 0.08
  const h1 = 0.9
  // quad in the XY plane and a quad in the XZ plane, both fanning out along +X
  const pos = [0, -h0, 0, L, -h1, 0, L, h1, 0, 0, h0, 0, 0, 0, -h0, L, 0, -h1, L, 0, h1, 0, 0, h0]
  // radial glow texture: source at the texture center, fading to transparent at the far end
  const uv = [0.5, 0.45, 1, 0, 1, 1, 0.5, 0.55, 0.5, 0.45, 1, 0, 1, 1, 0.5, 0.55]
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
  return g
})()

const emergencyDomeMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true })
const emergencyHaloMat = new THREE.MeshBasicMaterial({
  map: envMats.halo().map,
  color: ENV_PALETTE.emergency,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  opacity: 0,
  toneMapped: false,
})

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _c = new THREE.Color()
const _e = new THREE.Euler()

export function Beacons() {
  const reduced = useSettings((s) => s.reducedMotion)
  const zone = useMemo(() => {
    const bulbs = new THREE.InstancedMesh(bulbGeo, envMats.glow(), ZONE_BEACONS.length)
    const halos = new THREE.InstancedMesh(haloGeo, envMats.halo(), ZONE_BEACONS.length)
    ZONE_BEACONS.forEach((bc, i) => {
      _m.compose(_p.set(bc.x, bc.y, bc.z), _q.identity(), _s.setScalar(0.14))
      bulbs.setMatrixAt(i, _m)
      bulbs.setColorAt(i, _c.set(bc.color).multiplyScalar(2.4))
      halos.setColorAt(i, _c.set(bc.color))
    })
    for (const m of [bulbs, halos]) {
      m.frustumCulled = false
      m.castShadow = false
      m.receiveShadow = false
    }
    halos.renderOrder = 5
    halos.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    return { bulbs, halos }
  }, [])
  const emer = useMemo(() => {
    const n = EMERGENCY_BEACONS.length
    const domes = new THREE.InstancedMesh(domeGeo, emergencyDomeMat, n)
    const beams = new THREE.InstancedMesh(beamGeo, envMats.beam(), n)
    const halos = new THREE.InstancedMesh(haloGeo, emergencyHaloMat, n)
    EMERGENCY_BEACONS.forEach((bc, i) => {
      _m.compose(_p.set(bc.x, bc.y, bc.z), _q.identity(), _s.set(0.15, 0.15, 0.15))
      domes.setMatrixAt(i, _m)
      domes.setColorAt(i, _c.set('#5a1410'))
    })
    for (const m of [domes, beams, halos]) {
      m.frustumCulled = false
      m.castShadow = false
      m.receiveShadow = false
    }
    beams.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    halos.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    beams.renderOrder = 6
    halos.renderOrder = 6
    return { domes, beams, halos }
  }, [])

  useEffect(
    () => () => {
      zone.bulbs.dispose()
      zone.halos.dispose()
      emer.domes.dispose()
      emer.beams.dispose()
      emer.halos.dispose()
    },
    [zone, emer],
  )

  useFrame((state) => {
    const cam = state.camera
    const t = envLight.time
    const E = envLight.emergency
    // zone halos: camera-facing, slow pulse
    _q.copy(cam.quaternion)
    for (let i = 0; i < ZONE_BEACONS.length; i++) {
      const bc = ZONE_BEACONS[i]
      const pulse = reduced ? 1 : 0.8 + 0.2 * Math.sin(t * 2.2 + i * 1.3)
      _m.compose(_p.set(bc.x, bc.y, bc.z), _q, _s.setScalar(1.3 * pulse))
      zone.halos.setMatrixAt(i, _m)
    }
    zone.halos.instanceMatrix.needsUpdate = true

    // emergency beacons
    const on = E > 0.002
    emer.beams.visible = on && !reduced
    emer.halos.visible = on
    const ec = emer.domes.instanceColor
    for (let i = 0; i < EMERGENCY_BEACONS.length; i++) {
      const bc = EMERGENCY_BEACONS[i]
      const ang = reduced ? 0 : t * 3.2 + i * 0.9
      const flash = reduced ? 0.85 : 0.55 + 0.45 * Math.max(0, Math.cos(t * 3.2 * 2 + i))
      if (ec) emer.domes.setColorAt(i, on ? _c.set(ENV_PALETTE.emergency).multiplyScalar(0.6 + E * 2.6 * flash) : _c.set('#5a1410'))
      if (on) {
        _e.set(0, ang, 0)
        _q.setFromEuler(_e)
        _m.compose(_p.set(bc.x, bc.y, bc.z), _q, _s.setScalar(1))
        emer.beams.setMatrixAt(i, _m)
        _m.compose(_p.set(bc.x, bc.y, bc.z), cam.quaternion, _s.setScalar(1.6 + 0.8 * flash))
        emer.halos.setMatrixAt(i, _m)
      }
    }
    if (ec) ec.needsUpdate = true
    if (on) {
      emer.beams.instanceMatrix.needsUpdate = true
      emer.halos.instanceMatrix.needsUpdate = true
      ;(emer.beams.material as THREE.MeshBasicMaterial).opacity = 0.5 * E
      emergencyHaloMat.opacity = 0.9 * E
    }
  })

  return (
    <group name="env-beacons">
      <primitive object={zone.bulbs} />
      <primitive object={zone.halos} />
      <primitive object={emer.domes} />
      <primitive object={emer.beams} />
      <primitive object={emer.halos} />
    </group>
  )
}
