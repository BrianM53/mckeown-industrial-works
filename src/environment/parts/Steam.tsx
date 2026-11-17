import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { createRng } from '@/core/rng'
import { useSettings } from '@/state/settings'
import { textures } from '@/world/materials'
import { envLight } from '../lightState'
import { roofOpacity } from './StaticWorld'
import type { SteamEmitter, SteamKind } from './types'

/**
 * Pooled steam / smoke sprites: ONE draw call (instanced camera-facing quads,
 * CPU-simulated, depth-sorted). Pool size is quality-scaled; reduced motion
 * halves emission. Nothing allocates per frame.
 */
interface KindParams {
  rate: number
  life: number
  s0: number
  s1: number
  rise: number
  wind: number
  alpha: number
  shade: number
  spread: number
  /** Bursty emitters fire `burst` puffs every `gap` seconds. */
  burst?: number
  gap?: number
}

const KINDS: Record<SteamKind, KindParams> = {
  vent: { rate: 2.4, life: 3.4, s0: 0.5, s1: 2.3, rise: 0.85, wind: 0.35, alpha: 0.3, shade: 0.05, spread: 0.35 },
  exhaust: { rate: 1.4, life: 3.6, s0: 0.45, s1: 2.0, rise: 1.1, wind: 0.6, alpha: 0.26, shade: 0.15, spread: 0.12 },
  stack: { rate: 1.2, life: 4, s0: 0.5, s1: 2.4, rise: 1.2, wind: 0.6, alpha: 0.3, shade: 0.3, spread: 0.15 },
  valve: { rate: 0, life: 1.7, s0: 0.3, s1: 1.5, rise: 1.6, wind: 0.4, alpha: 0.45, shade: 0, spread: 0.25, burst: 7, gap: 7 },
  smoke: { rate: 0.75, life: 15, s0: 4, s1: 15, rise: 2.4, wind: 2.6, alpha: 0.34, shade: 0.55, spread: 0.8 },
  cooling: { rate: 0.6, life: 17, s0: 11, s1: 28, rise: 3.2, wind: 1.5, alpha: 0.42, shade: 0.05, spread: 3 },
}

const WIND = new THREE.Vector3(0.92, 0, -0.38).normalize()

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iData;
varying vec2 vUv;
varying float vAlpha;
varying float vShade;
#include <fog_pars_vertex>
void main() {
  vUv = position.xy + 0.5;
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iData.z);
  float s = sin(iData.z);
  mvPosition.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iData.x;
  gl_Position = projectionMatrix * mvPosition;
  vAlpha = iData.y;
  vShade = iData.w;
  #include <fog_vertex>
}
`

const FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec3 uLit;
uniform vec3 uDark;
uniform float uLevel;
varying vec2 vUv;
varying float vAlpha;
varying float vShade;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uTex, vUv);
  float a = t.a * vAlpha;
  if (a < 0.004) discard;
  vec3 col = mix(uDark, uLit, t.r) * (1.0 - 0.6 * vShade) * uLevel;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

export function Steam({ emitters, max }: { emitters: SteamEmitter[]; max: number }) {
  const reduced = useSettings((s) => s.reducedMotion)
  const sim = useMemo(() => {
    // Share the pool by steady-state demand (rate * life), at least 3 per emitter.
    const demand = emitters.map((e) => {
      const k = KINDS[e.kind]
      return Math.max(3, (k.burst ? k.burst : k.rate * k.life) * 1.1)
    })
    const total = demand.reduce((a, b) => a + b, 0)
    const scale = Math.min(1, max / Math.max(1, total))
    const slices: { start: number; count: number; next: number; timer: number }[] = []
    let start = 0
    emitters.forEach((_, i) => {
      const count = Math.max(2, Math.floor(demand[i] * scale))
      slices.push({ start, count, next: 0, timer: (i * 0.37) % 1 })
      start += count
    })
    const n = start
    return {
      n,
      slices,
      px: new Float32Array(n),
      py: new Float32Array(n),
      pz: new Float32Array(n),
      vx: new Float32Array(n),
      vy: new Float32Array(n),
      vz: new Float32Array(n),
      age: new Float32Array(n).fill(1e9),
      life: new Float32Array(n).fill(1),
      rot: new Float32Array(n),
      spin: new Float32Array(n),
      owner: new Int16Array(n),
      depth: new Float32Array(n),
      order: Array.from({ length: n }, (_, i) => i),
      rng: createRng(99),
    }
  }, [emitters, max])

  const { geometry, material, mesh, iPos, iData } = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry()
    const quad = new THREE.PlaneGeometry(1, 1)
    g.index = quad.index
    g.setAttribute('position', quad.getAttribute('position'))
    const iPos = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, sim.n) * 3), 3)
    const iData = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, sim.n) * 4), 4)
    iPos.setUsage(THREE.DynamicDrawUsage)
    iData.setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('iPos', iPos)
    g.setAttribute('iData', iData)
    g.instanceCount = 0
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTex: { value: null },
          uLit: { value: new THREE.Color('#F4E9DA') },
          uDark: { value: new THREE.Color('#8E9AA0') },
          uLevel: { value: 1 },
        },
      ]),
    })
    m.uniforms.uTex.value = textures.smokePuff()
    const mesh = new THREE.Mesh(g, m)
    mesh.frustumCulled = false
    mesh.renderOrder = 3
    mesh.name = 'env-steam'
    return { geometry: g, material: m, mesh, iPos, iData }
  }, [sim.n])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useFrame((state, delta) => {
    const dt = Math.min(Math.max(delta, 0), 0.1)
    const s = sim
    const emit = reduced ? 0.5 : 1
    // spawn
    for (let e = 0; e < emitters.length; e++) {
      const em = emitters[e]
      const k = KINDS[em.kind]
      const sl = s.slices[e]
      if (em.building && (roofOpacity.get(em.building) ?? 1) < 0.5) continue
      sl.timer -= dt
      if (sl.timer > 0) continue
      const n = k.burst ? Math.max(1, Math.round(k.burst * emit)) : 1
      sl.timer = k.burst ? (k.gap ?? 6) * (0.7 + s.rng() * 0.6) : 1 / Math.max(0.01, k.rate * emit)
      for (let j = 0; j < n; j++) {
        const i = sl.start + (sl.next++ % sl.count)
        s.px[i] = em.x + (s.rng() - 0.5) * k.spread
        s.py[i] = em.y + (s.rng() - 0.5) * k.spread * 0.3
        s.pz[i] = em.z + (s.rng() - 0.5) * k.spread
        s.vx[i] = (s.rng() - 0.5) * 0.25 * (k.burst ? 2 : 1)
        s.vy[i] = k.rise * (0.8 + s.rng() * 0.4)
        s.vz[i] = (s.rng() - 0.5) * 0.25 * (k.burst ? 2 : 1)
        s.age[i] = -j * 0.05
        s.life[i] = k.life * (0.8 + s.rng() * 0.4)
        s.rot[i] = s.rng() * Math.PI * 2
        s.spin[i] = (s.rng() - 0.5) * 0.4
        s.owner[i] = e
      }
    }
    // integrate + write
    const cam = state.camera
    const cx = cam.position.x
    const cy = cam.position.y
    const cz = cam.position.z
    let count = 0
    for (let i = 0; i < s.n; i++) {
      if (s.age[i] >= s.life[i]) continue
      s.age[i] += dt
      if (s.age[i] < 0) continue
      const k = KINDS[emitters[s.owner[i]].kind]
      const t = s.age[i] / s.life[i]
      const w = k.wind * Math.min(1, t * 2.5)
      s.px[i] += (s.vx[i] + WIND.x * w) * dt
      s.py[i] += s.vy[i] * dt * (1 - t * 0.55)
      s.pz[i] += (s.vz[i] + WIND.z * w) * dt
      s.rot[i] += s.spin[i] * dt
      const dx = s.px[i] - cx
      const dy = s.py[i] - cy
      const dz = s.pz[i] - cz
      s.depth[i] = dx * dx + dy * dy + dz * dz
      s.order[count++] = i
    }
    // back-to-front
    const ord = s.order
    const depth = s.depth
    for (let a = 1; a < count; a++) {
      const v = ord[a]
      const dv = depth[v]
      let b = a - 1
      while (b >= 0 && depth[ord[b]] < dv) {
        ord[b + 1] = ord[b]
        b--
      }
      ord[b + 1] = v
    }
    const P = iPos.array as Float32Array
    const D = iData.array as Float32Array
    for (let j = 0; j < count; j++) {
      const i = ord[j]
      const k = KINDS[emitters[s.owner[i]].kind]
      const t = Math.min(1, s.age[i] / s.life[i])
      const fadeIn = Math.min(1, t * 6)
      const fadeOut = 1 - t * t
      P[j * 3] = s.px[i]
      P[j * 3 + 1] = s.py[i]
      P[j * 3 + 2] = s.pz[i]
      D[j * 4] = k.s0 + (k.s1 - k.s0) * Math.sqrt(t)
      D[j * 4 + 1] = k.alpha * fadeIn * fadeOut
      D[j * 4 + 2] = s.rot[i]
      D[j * 4 + 3] = k.shade
    }
    geometry.instanceCount = count
    iPos.needsUpdate = true
    iData.needsUpdate = true
    iPos.clearUpdateRanges()
    iData.clearUpdateRanges()
    iPos.addUpdateRange(0, count * 3)
    iData.addUpdateRange(0, count * 4)
    material.uniforms.uLevel.value = 0.3 + 0.7 * envLight.level
  })

  return <primitive object={mesh} />
}
