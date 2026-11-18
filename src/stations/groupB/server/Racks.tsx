import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { simClock } from '@/core/clock'
import { buildAtlas } from '../shared/canvas'
import { useReducedMotion } from '../shared/hooks'
import { BACK_VARIANT, FACE_PX, FACE_VARIANTS, LED_RGB, ledsFor, paintFace } from './rackArt'
import { RACK, RACK_SLOTS } from './layout'

/**
 * Server racks: 30 cabinets as THREE instanced draw calls total —
 *   1. bodies (InstancedMesh, merged cabinet geometry)
 *   2. front/rear faces (InstancedMesh, canvas atlas, per-instance UV rect)
 *   3. LEDs (InstancedMesh of glow quads; blinking is computed on the GPU from
 *      per-instance rate/phase/mode attributes — zero CPU work per frame).
 * Reduced motion: flicker becomes steady and blink rates slow down.
 */

const FACE_W = RACK.w - 0.04
const FACE_H = RACK.h - 0.16
const FACE_Y0 = 0.08

// ---------------------------------------------------------------------------
// Cabinet body geometry (merged once, module lifetime)
// ---------------------------------------------------------------------------

let bodyGeo: THREE.BufferGeometry | null = null
function cabinetGeometry(): THREE.BufferGeometry {
  if (bodyGeo) return bodyGeo
  const parts: THREE.BufferGeometry[] = []
  const add = (g: THREE.BufferGeometry, x: number, y: number, z: number) => {
    g.translate(x, y, z)
    parts.push(g.index ? g.toNonIndexed() : g)
  }
  const { w, d, h } = RACK
  // shell (slightly inset so faces sit proud), plinth, top cap with cable brushes
  add(new THREE.BoxGeometry(w - 0.01, h - 0.1, d - 0.02), 0, (h - 0.1) / 2 + 0.06, 0)
  add(new THREE.BoxGeometry(w, 0.06, d), 0, 0.03, 0)
  add(new THREE.BoxGeometry(w + 0.01, 0.05, d + 0.01), 0, h - 0.025, 0)
  // vertical door frame posts front/back
  for (const zz of [-d / 2, d / 2])
    for (const xx of [-w / 2 + 0.015, w / 2 - 0.015]) add(new THREE.BoxGeometry(0.03, FACE_H + 0.06, 0.03), xx, FACE_Y0 + FACE_H / 2, zz)
  // top cable entry box
  add(new THREE.BoxGeometry(w * 0.5, 0.08, d * 0.3), 0, h + 0.04, d * 0.15)
  const merged = mergeNonIndexed(parts)
  parts.forEach((p) => p.dispose())
  bodyGeo = merged
  return merged
}

function mergeNonIndexed(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0
  for (const p of parts) n += p.getAttribute('position').count
  const pos = new Float32Array(n * 3)
  const nor = new Float32Array(n * 3)
  let o = 0
  for (const p of parts) {
    const pa = p.getAttribute('position')
    const na = p.getAttribute('normal')
    for (let i = 0; i < pa.count; i++) {
      pos[(o + i) * 3] = pa.getX(i)
      pos[(o + i) * 3 + 1] = pa.getY(i)
      pos[(o + i) * 3 + 2] = pa.getZ(i)
      nor[(o + i) * 3] = na.getX(i)
      nor[(o + i) * 3 + 1] = na.getY(i)
      nor[(o + i) * 3 + 2] = na.getZ(i)
    }
    o += pa.count
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  return g
}

let bodyMat: THREE.MeshStandardMaterial | null = null
function cabinetMaterial(): THREE.MeshStandardMaterial {
  if (!bodyMat) {
    bodyMat = new THREE.MeshStandardMaterial({ color: '#3a454b', roughness: 0.5, metalness: 0.32 })
    bodyMat.name = 'stations-b:rack-body'
  }
  return bodyMat
}

// ---------------------------------------------------------------------------
// Face atlas + material with per-instance UV rect
// ---------------------------------------------------------------------------

let faceMat: THREE.MeshStandardMaterial | null = null
let faceRects: [number, number, number, number][] = []
function faceMaterial(): THREE.MeshStandardMaterial {
  if (faceMat) return faceMat
  const atlas = buildAtlas(
    Array.from({ length: FACE_VARIANTS }, (_, i) => ({ id: `v${i}`, w: FACE_PX.w, h: FACE_PX.h, draw: (ctx, w, h) => paintFace(ctx, i, w, h) })),
    1024,
    4,
  )
  faceRects = Array.from({ length: FACE_VARIANTS }, (_, i) => {
    const [u0, v0, u1, v1] = atlas.uv[`v${i}`]
    return [u0, v0, u1 - u0, v1 - v0]
  })
  const m = new THREE.MeshStandardMaterial({ map: atlas.texture, color: '#e8eef0', roughness: 0.45, metalness: 0.25 })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aUvRect;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = aUvRect.xy + uv * aUvRect.zw;\n#endif')
  }
  m.customProgramCacheKey = () => 'sb-rack-face'
  m.name = 'stations-b:rack-face'
  faceMat = m
  return m
}

// ---------------------------------------------------------------------------
// LED material (GPU blink)
// ---------------------------------------------------------------------------

const ledUniforms = { uTime: { value: 0 }, uCalm: { value: 0 } }
let ledMat: THREE.ShaderMaterial | null = null
export function ledMaterial(): THREE.ShaderMaterial {
  if (ledMat) return ledMat
  ledMat = new THREE.ShaderMaterial({
    name: 'stations-b:led',
    uniforms: ledUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uCalm;
      attribute vec3 aColor;
      attribute vec4 aBlink;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vOn;
      float sbHash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        vUv = uv;
        vColor = aColor;
        float mode = aBlink.w;
        float rate = aBlink.x * mix(1.0, 0.2, uCalm);
        float t = uTime * rate + aBlink.y;
        float on = 1.0;
        if (mode > 0.5 && mode < 1.5) on = step(fract(t), aBlink.z);
        else if (mode > 1.5 && mode < 2.5) on = mix(step(aBlink.z, sbHash(floor(t) + aBlink.y * 17.0)), 1.0, uCalm);
        else if (mode > 2.5) on = 0.55 + 0.45 * sin(t * 6.2831853);
        vOn = mix(0.14, 1.0, on);
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vOn;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float core = smoothstep(0.34, 0.1, d);
        float halo = exp(-d * d * 4.5) * 0.5 * (1.0 - smoothstep(0.85, 1.0, d));
        vec3 col = vColor * (core * 1.8 + halo * 1.2) * vOn;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  })
  return ledMat
}

/** Shared LED clock (also used by kiosks / terminal status lights). */
export function useLedClock(): void {
  const reduced = useReducedMotion()
  useEffect(() => {
    ledUniforms.uCalm.value = reduced ? 1 : 0
  }, [reduced])
  useFrame(() => {
    ledUniforms.uTime.value = simClock.t
  })
}

export interface LedInstance {
  /** World matrix of the LED quad. */
  matrix: THREE.Matrix4
  rgb: [number, number, number]
  rate: number
  phase: number
  duty: number
  mode: number
}

/** Build an InstancedMesh of glow quads from LED instances (caller disposes geometry). */
export function makeLedMesh(leds: LedInstance[]): THREE.InstancedMesh {
  const geo = new THREE.PlaneGeometry(1, 1)
  const color = new Float32Array(leds.length * 3)
  const blink = new Float32Array(leds.length * 4)
  leds.forEach((l, i) => {
    color.set(l.rgb, i * 3)
    blink.set([l.rate, l.phase, l.duty, l.mode], i * 4)
  })
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(color, 3))
  geo.setAttribute('aBlink', new THREE.InstancedBufferAttribute(blink, 4))
  const mesh = new THREE.InstancedMesh(geo, ledMaterial(), Math.max(1, leds.length))
  leds.forEach((l, i) => mesh.setMatrixAt(i, l.matrix))
  mesh.count = leds.length
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
  mesh.frustumCulled = true
  mesh.renderOrder = 2
  mesh.name = 'stations-b:leds'
  return mesh
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const _m = new THREE.Matrix4()
const _l = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _y = new THREE.Vector3(0, 1, 0)

function rackMatrix(x: number, z: number, yaw: number, out: THREE.Matrix4): THREE.Matrix4 {
  return out.compose(_p.set(x, 0, z), _q.setFromAxisAngle(_y, yaw), _s.set(1, 1, 1))
}

export function Racks() {
  useLedClock()
  const built = useMemo(() => {
    // bodies
    const bodies = new THREE.InstancedMesh(cabinetGeometry(), cabinetMaterial(), RACK_SLOTS.length)
    RACK_SLOTS.forEach((s, i) => bodies.setMatrixAt(i, rackMatrix(s.x, s.z, s.yaw, _m)))
    bodies.instanceMatrix.needsUpdate = true
    bodies.computeBoundingSphere()
    bodies.name = 'stations-b:rack-bodies'

    // faces: front (variant) + rear door, one quad each
    const mat = faceMaterial()
    const faceGeo = new THREE.PlaneGeometry(FACE_W, FACE_H)
    const n = RACK_SLOTS.length * 2
    const rects = new Float32Array(n * 4)
    const faces = new THREE.InstancedMesh(faceGeo, mat, n)
    const leds: LedInstance[] = []
    RACK_SLOTS.forEach((s, i) => {
      const base = rackMatrix(s.x, s.z, s.yaw, new THREE.Matrix4())
      // front: plane faces -Z locally (rotate PI), slightly proud of the cabinet
      _l.compose(_p.set(0, FACE_Y0 + FACE_H / 2, -RACK.d / 2 - 0.004), _q.setFromAxisAngle(_y, Math.PI), _s.set(1, 1, 1))
      faces.setMatrixAt(i * 2, _m.multiplyMatrices(base, _l))
      rects.set(faceRects[s.variant], i * 8)
      // back
      _l.compose(_p.set(0, FACE_Y0 + FACE_H / 2, RACK.d / 2 + 0.004), _q.identity(), _s.set(1, 1, 1))
      faces.setMatrixAt(i * 2 + 1, _m.multiplyMatrices(base, _l))
      rects.set(faceRects[BACK_VARIANT], i * 8 + 4)
      // LEDs for both faces
      for (const [variant, front] of [
        [s.variant, true],
        [BACK_VARIANT, false],
      ] as const) {
        for (const led of ledsFor(variant)) {
          const lx = (front ? 0.5 - led.u : led.u - 0.5) * FACE_W
          const ly = FACE_Y0 + (1 - led.v) * FACE_H
          const lz = front ? -RACK.d / 2 - 0.011 : RACK.d / 2 + 0.011
          _l.compose(_p.set(lx, ly, lz), _q.setFromAxisAngle(_y, front ? Math.PI : 0), _s.set(0.07, 0.07, 1))
          leds.push({
            matrix: new THREE.Matrix4().multiplyMatrices(base, _l),
            rgb: LED_RGB[led.color],
            rate: led.rate,
            // per-rack desync so identical variants never blink in lockstep
            phase: led.phase + i * 0.37,
            duty: led.duty,
            mode: led.mode,
          })
        }
      }
    })
    faceGeo.setAttribute('aUvRect', new THREE.InstancedBufferAttribute(rects, 4))
    faces.instanceMatrix.needsUpdate = true
    faces.computeBoundingSphere()
    faces.name = 'stations-b:rack-faces'
    const ledMesh = makeLedMesh(leds)
    return { bodies, faces, ledMesh, faceGeo }
  }, [])

  useEffect(
    () => () => {
      built.faceGeo.dispose()
      built.ledMesh.geometry.dispose()
      built.bodies.dispose()
      built.faces.dispose()
      built.ledMesh.dispose()
    },
    [built],
  )

  return (
    <group name="server-racks">
      <primitive object={built.bodies} />
      <primitive object={built.faces} />
      <primitive object={built.ledMesh} />
    </group>
  )
}
