import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { runtime } from '@/core/runtime'
import type { QualityTier } from '@/core/types'
import { ENV_PALETTE } from '@/world/palette'
import { useSettings } from '@/state/settings'
import { QUALITY, SUN_DIR } from '../config'
import { applyEnvLighting } from '../lib/envMaterials'
import { createSkyEnvironment } from '../lib/skyEnvironment'
import { envLight, sampleLighting } from '../lightState'
import { EMERGENCY_BEACONS } from './beaconData'

/**
 * Global lighting (environment owns it):
 *  - one shadow-casting sun (WSW, low) whose shadow frustum follows the player
 *    (pushed toward the camera's view direction, texel-snapped => stable shadows)
 *  - image-based sky lighting (generated PMREM -> scene.environment) for the
 *    cool teal-grey shadow fill and believable steel/glass, plus a hemisphere
 *    fill (carries the night-shift color shift) and a subtle ambient
 *  - 4 warm point lights (intake, personnel office, maintenance bay, tower plaza)
 *  - 2 red emergency point lights that hop to the beacons nearest the player
 * Night Shift: reads runtime.lighting.level / emergency every frame (owned by the
 * safety module) and scales everything, never below ~15% "moonlit" visibility.
 */
const SUN_I = 3.0
const HEMI_I = 0.6
const AMB_I = 0.12
/** scene.environmentIntensity at full lighting level. */
const ENV_I = 0.78
const SHADOW_DIST = 90

const C = (hex: string) => new THREE.Color(hex)
const SUN_DAY = C(ENV_PALETTE.sun)
const SUN_NIGHT = C(ENV_PALETTE.moon)
const HEMI_SKY_DAY = C(ENV_PALETTE.hemiSky)
const HEMI_SKY_NIGHT = C('#5D72A0')
const HEMI_GROUND_DAY = C(ENV_PALETTE.hemiGround)
const HEMI_GROUND_NIGHT = C('#2A2A33')

interface WarmLight {
  pos: [number, number, number]
  intensity: number
  distance: number
}

const WARM: WarmLight[] = [
  { pos: [0, 4.4, 36.4], intensity: 26, distance: 15 },
  { pos: [11.6, 4.6, 29], intensity: 22, distance: 12 },
  { pos: [-12.2, 5.0, 29], intensity: 22, distance: 12 },
  { pos: [0, 6.5, -2.8], intensity: 34, distance: 20 },
]

const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _t = new THREE.Vector3()

/** Park a red emergency point light at a beacon, pulsing in step with its rotation. */
function placeEmergencyLight(light: THREE.PointLight, bc: (typeof EMERGENCY_BEACONS)[number] | undefined, k: number, E: number, reduced: boolean): void {
  if (!bc) {
    light.intensity = 0
    return
  }
  light.position.set(bc.x, bc.y - 0.3, bc.z)
  const pulse = reduced ? 0.75 : 0.45 + 0.55 * Math.max(0, Math.cos(envLight.time * 3.2 + k * 1.7))
  light.intensity = 42 * E * pulse
}

export function Lighting({ quality }: { quality: QualityTier }) {
  const cfg = QUALITY[quality]
  const sun = useRef<THREE.DirectionalLight>(null)
  const hemi = useRef<THREE.HemisphereLight>(null)
  const amb = useRef<THREE.AmbientLight>(null)
  const warm = useRef<(THREE.PointLight | null)[]>([])
  const red = useRef<(THREE.PointLight | null)[]>([])
  const target = useMemo(() => new THREE.Object3D(), [])
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl)
  const envTex = useRef<THREE.Texture | null>(null)
  const reduced = useSettings((s) => s.reducedMotion)
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced

  // Light-space basis for texel snapping.
  useMemo(() => {
    _fwd.copy(SUN_DIR).negate()
    _right.crossVectors(_fwd, new THREE.Vector3(0, 1, 0)).normalize()
    _up.crossVectors(_right, _fwd).normalize()
  }, [])

  useEffect(() => {
    scene.add(target)
    return () => {
      scene.remove(target)
    }
  }, [scene, target])

  // Image-based sky lighting (one small PMREM, generated once per renderer).
  useEffect(() => {
    let rt: THREE.WebGLRenderTarget | null = null
    try {
      rt = createSkyEnvironment(gl)
    } catch (err) {
      console.warn('[environment] sky environment unavailable', err)
      return
    }
    const prev = scene.environment
    const prevIntensity = scene.environmentIntensity
    scene.environment = rt.texture
    scene.environmentIntensity = ENV_I
    envTex.current = rt.texture
    return () => {
      envTex.current = null
      if (scene.environment === rt!.texture) {
        scene.environment = prev
        scene.environmentIntensity = prevIntensity
      }
      rt!.dispose()
    }
  }, [gl, scene])

  // Shadow map setup / quality changes.
  useEffect(() => {
    const l = sun.current
    if (!l) return
    l.target = target
    l.castShadow = cfg.shadows
    const s = l.shadow
    s.mapSize.set(cfg.shadowMap, cfg.shadowMap)
    s.map?.dispose()
    s.map = null
    const cam = s.camera as THREE.OrthographicCamera
    cam.left = -cfg.shadowHalf
    cam.right = cfg.shadowHalf
    cam.top = cfg.shadowHalf
    cam.bottom = -cfg.shadowHalf
    cam.near = 1
    cam.far = SHADOW_DIST * 2
    // Layer 1 = shadow-only geometry (hidden roofs keep casting their shadow).
    cam.layers.enable(1)
    cam.updateProjectionMatrix()
    s.bias = -0.0006
    s.normalBias = 0.035
    s.radius = 2
    s.needsUpdate = true
  }, [cfg.shadows, cfg.shadowMap, cfg.shadowHalf, target])

  useFrame((_, dt) => {
    sampleLighting(dt)
    const L = envLight.level
    const E = envLight.emergency
    applyEnvLighting(L)

    const l = sun.current
    if (l) {
      // Follow the player, centred ~12 m ahead of them along the camera's view.
      const p = runtime.player.position
      const px = Number.isFinite(p.x) ? p.x : 0
      const pz = Number.isFinite(p.z) ? p.z : 32
      const cy = runtime.camera.yaw
      const ahead = Number.isFinite(cy) ? 12 : 0
      _t.set(px - Math.sin(cy) * ahead, 0, pz - Math.cos(cy) * ahead)
      const texel = (cfg.shadowHalf * 2) / cfg.shadowMap
      const a = Math.round(_t.dot(_right) / texel) * texel
      const b = Math.round(_t.dot(_up) / texel) * texel
      const c = _t.dot(_fwd)
      _t.copy(_right).multiplyScalar(a).addScaledVector(_up, b).addScaledVector(_fwd, c)
      target.position.copy(_t)
      target.updateMatrixWorld()
      l.position.copy(_t).addScaledVector(SUN_DIR, SHADOW_DIST)
      l.intensity = SUN_I * (0.05 + 0.95 * L)
      l.color.lerpColors(SUN_NIGHT, SUN_DAY, L)
    }
    if (hemi.current) {
      hemi.current.intensity = HEMI_I * (0.32 + 0.68 * L)
      hemi.current.color.lerpColors(HEMI_SKY_NIGHT, HEMI_SKY_DAY, L)
      hemi.current.groundColor.lerpColors(HEMI_GROUND_NIGHT, HEMI_GROUND_DAY, L)
    }
    if (amb.current) amb.current.intensity = AMB_I * (0.55 + 0.45 * L)
    if (envTex.current && scene.environment === envTex.current) scene.environmentIntensity = ENV_I * (0.08 + 0.92 * L)
    for (let i = 0; i < WARM.length; i++) {
      const w = warm.current[i]
      if (w) w.intensity = WARM[i].intensity * L
    }

    // Emergency: two red lights at the beacons nearest the player, pulsing with the rotation.
    const r0 = red.current[0]
    const r1 = red.current[1]
    if (r0 && r1) {
      if (E <= 0.001) {
        r0.intensity = 0
        r1.intensity = 0
      } else {
        const p = runtime.player.position
        let b0 = 0
        let b1 = 1
        let d0 = Infinity
        let d1 = Infinity
        for (let i = 0; i < EMERGENCY_BEACONS.length; i++) {
          const bc = EMERGENCY_BEACONS[i]
          const d = (bc.x - p.x) * (bc.x - p.x) + (bc.z - p.z) * (bc.z - p.z)
          if (d < d0) {
            d1 = d0
            b1 = b0
            d0 = d
            b0 = i
          } else if (d < d1) {
            d1 = d
            b1 = i
          }
        }
        placeEmergencyLight(r0, EMERGENCY_BEACONS[b0], 0, E, reducedRef.current)
        placeEmergencyLight(r1, EMERGENCY_BEACONS[b1], 1, E, reducedRef.current)
      }
    }
  })

  return (
    <>
      <directionalLight ref={sun} color={SUN_DAY} intensity={SUN_I} castShadow={cfg.shadows} />
      <hemisphereLight ref={hemi} args={[HEMI_SKY_DAY, HEMI_GROUND_DAY, HEMI_I]} />
      <ambientLight ref={amb} color={ENV_PALETTE.ambient} intensity={AMB_I} />
      {WARM.map((w, i) => (
        <pointLight
          key={i}
          ref={(el) => {
            warm.current[i] = el
          }}
          position={w.pos}
          color={ENV_PALETTE.lampWarm}
          intensity={w.intensity}
          distance={w.distance}
          decay={2}
        />
      ))}
      {[0, 1].map((i) => (
        <pointLight
          key={`r${i}`}
          ref={(el) => {
            red.current[i] = el
          }}
          position={[0, -50, 0]}
          color={ENV_PALETTE.emergency}
          intensity={0}
          distance={16}
          decay={2}
        />
      ))}
    </>
  )
}
