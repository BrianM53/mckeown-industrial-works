import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { ENV_PALETTE } from '@/world/palette'
import type { QualityTier } from '@/core/types'
import { SUN_DIR } from '../config'
import { envLight } from '../lightState'

/**
 * Late-afternoon gradient sky dome with sun glow, a distant ridge-line band and
 * (during the night shift) stars and a moon. Follows the camera, renders at the
 * far plane. Also owns the scene fog (warm haze that hides the far edge).
 */
const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`

const FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uHillFar;
uniform vec3 uHillNear;
uniform float uSun;
uniform float uNight;
uniform float uHills;
varying vec3 vDir;

float h21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float n2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float ridge(vec2 c, float s, float o) {
  return n2(c * s + o) * 0.6 + n2(c * s * 2.7 + o * 1.7) * 0.28 + n2(c * s * 7.1 - o) * 0.12;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.16, h));
  col = mix(col, uZenith, smoothstep(0.1, 0.7, h));

  // sun glow + disc
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 5.0) * 0.32 + pow(s, 40.0) * 0.55) * uSun;
  col = mix(col, vec3(1.0, 0.95, 0.82) * 2.6, smoothstep(0.99935, 0.9997, s) * uSun);

  // stars & moon (night shift)
  if (uNight > 0.01) {
    vec2 sp = d.xz / max(h, 0.05) * 60.0;
    float st = step(0.9975, h21(floor(sp))) * smoothstep(0.08, 0.4, h);
    col += vec3(0.9, 0.95, 1.0) * st * uNight * 0.9;
    float m = max(dot(d, normalize(vec3(0.55, 0.42, -0.72))), 0.0);
    col += vec3(0.75, 0.82, 1.0) * (smoothstep(0.9993, 0.9996, m) * 1.6 + pow(m, 60.0) * 0.08) * uNight;
  }

  // distant ridge lines (seamless: sampled on the unit circle of azimuth)
  vec2 c = normalize(d.xz + vec2(1e-5));
  float r1 = 0.012 + 0.032 * ridge(c, 2.2, 3.0) * uHills;
  float r2 = 0.004 + 0.018 * ridge(c, 4.1, 11.0) * uHills;
  float m1 = smoothstep(r1 + 0.0015, r1 - 0.0015, h);
  float m2 = smoothstep(r2 + 0.0015, r2 - 0.0015, h);
  col = mix(col, uHillFar, m1 * 0.55);
  col = mix(col, uHillNear, m2 * 0.7);

  // below the horizon: haze
  col = mix(col, uHaze, smoothstep(0.004, -0.05, h));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

const C = (hex: string) => new THREE.Color(hex)

// Day / night key colors (linear).
const DAY = {
  zenith: C(ENV_PALETTE.skyZenith),
  mid: C(ENV_PALETTE.skyMid),
  horizon: C(ENV_PALETTE.skyHorizon),
  haze: C(ENV_PALETTE.haze),
  hillFar: C('#B49C86'),
  hillNear: C('#8E7D6E'),
  fog: C('#C9AA8C'),
}
const NIGHT = {
  zenith: C(ENV_PALETTE.nightZenith),
  mid: C('#1B2333'),
  horizon: C(ENV_PALETTE.nightHorizon),
  haze: C(ENV_PALETTE.nightHaze),
  hillFar: C('#1E2533'),
  hillNear: C('#151A24'),
  fog: C('#242B38'),
}

export function Sky({ quality }: { quality: QualityTier }) {
  const scene = useThree((s) => s.scene)
  const fog = useMemo(() => new THREE.FogExp2(DAY.fog.getHex(), 0.0046), [])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uZenith: { value: DAY.zenith.clone() },
          uMid: { value: DAY.mid.clone() },
          uHorizon: { value: DAY.horizon.clone() },
          uHaze: { value: DAY.haze.clone() },
          uSunColor: { value: C(ENV_PALETTE.sun) },
          uSunDir: { value: SUN_DIR.clone() },
          uHillFar: { value: DAY.hillFar.clone() },
          uHillNear: { value: DAY.hillNear.clone() },
          uSun: { value: 1 },
          uNight: { value: 0 },
          uHills: { value: 1 },
        },
      }),
    [],
  )
  const geometry = useMemo(() => new THREE.SphereGeometry(400, 48, 24), [])

  useEffect(() => {
    const prev = scene.fog
    scene.fog = fog
    return () => {
      if (scene.fog === fog) scene.fog = prev ?? null
    }
  }, [scene, fog])

  useEffect(
    () => () => {
      material.dispose()
      geometry.dispose()
    },
    [material, geometry],
  )

  useEffect(() => {
    material.uniforms.uHills.value = quality === 'low' ? 0.7 : 1
  }, [material, quality])

  const u = material.uniforms
  useFrame(() => {
    const L = envLight.level
    u.uZenith.value.lerpColors(NIGHT.zenith, DAY.zenith, L)
    u.uMid.value.lerpColors(NIGHT.mid, DAY.mid, L)
    u.uHorizon.value.lerpColors(NIGHT.horizon, DAY.horizon, L)
    u.uHaze.value.lerpColors(NIGHT.haze, DAY.haze, L)
    u.uHillFar.value.lerpColors(NIGHT.hillFar, DAY.hillFar, L)
    u.uHillNear.value.lerpColors(NIGHT.hillNear, DAY.hillNear, L)
    u.uSun.value = L
    u.uNight.value = 1 - L
    fog.color.lerpColors(NIGHT.fog, DAY.fog, L)
  })

  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={-1000}
      frustumCulled={false}
      ref={(m) => {
        if (!m) return
        // Follow whichever camera renders us (exact, no frame lag).
        m.onBeforeRender = (_r, _s, cam) => {
          m.position.copy(cam.position)
          m.updateMatrixWorld()
        }
      }}
    />
  )
}
