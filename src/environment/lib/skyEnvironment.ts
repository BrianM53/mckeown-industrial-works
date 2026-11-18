import * as THREE from 'three'
import { ENV_PALETTE } from '@/world/palette'
import { SUN_DIR } from '../config'

/**
 * Generated image-based lighting: a soft late-afternoon sky gradient (teal-grey
 * zenith, warm horizon band, warm dusty ground bounce, a gentle sun lobe)
 * pre-filtered into a PMREM once at startup and used as `scene.environment`.
 *
 * Why: without an environment every metal surface in shadow renders almost
 * black (no indirect specular) and the shadow side of buildings has nothing but
 * a weak hemisphere fill. The IBL gives the "cool teal-grey shadows" of the art
 * direction, makes glass/steel read as glass/steel, and costs one small
 * texture. Night Shift scales it via `scene.environmentIntensity`.
 */
const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uGroundFar;
uniform vec3 uSun;
uniform vec3 uSunDir;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 sky = mix(uHorizon, uMid, smoothstep(0.0, 0.22, h));
  sky = mix(sky, uZenith, smoothstep(0.18, 0.85, h));
  vec3 ground = mix(uGroundFar, uGround, smoothstep(0.0, -0.4, h));
  vec3 col = mix(ground, sky, smoothstep(-0.05, 0.03, h));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSun * (pow(s, 5.0) * 0.45 + pow(s, 48.0) * 1.6);
  gl_FragColor = vec4(col, 1.0);
}
`

/** Linear-space key colors of the environment (tuned for ACES + exposure ~1). */
const KEYS = {
  zenith: new THREE.Color(ENV_PALETTE.skyZenith).multiplyScalar(1.15),
  mid: new THREE.Color(ENV_PALETTE.skyMid).multiplyScalar(0.95),
  horizon: new THREE.Color(ENV_PALETTE.skyHorizon).multiplyScalar(0.85),
  ground: new THREE.Color(ENV_PALETTE.envGround),
  groundFar: new THREE.Color(ENV_PALETTE.haze).multiplyScalar(0.7),
  sun: new THREE.Color(ENV_PALETTE.sun).multiplyScalar(0.55),
}

/** Render the gradient into a PMREM render target. Caller owns (disposes) the result. */
export function createSkyEnvironment(renderer: THREE.WebGLRenderer, size = 128): THREE.WebGLRenderTarget {
  const scene = new THREE.Scene()
  const geometry = new THREE.SphereGeometry(10, 48, 24)
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uZenith: { value: KEYS.zenith },
      uMid: { value: KEYS.mid },
      uHorizon: { value: KEYS.horizon },
      uGround: { value: KEYS.ground },
      uGroundFar: { value: KEYS.groundFar },
      uSun: { value: KEYS.sun },
      uSunDir: { value: SUN_DIR.clone() },
    },
  })
  scene.add(new THREE.Mesh(geometry, material))
  const pmrem = new THREE.PMREMGenerator(renderer)
  try {
    return pmrem.fromScene(scene, 0.03, 0.1, 50, { size })
  } finally {
    pmrem.dispose()
    geometry.dispose()
    material.dispose()
  }
}
