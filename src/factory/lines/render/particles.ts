/**
 * Pooled, capped particles for the production spine (one draw call each):
 *  - SparkPool: additive streaks / glows (lathe + weld sparks, embers,
 *    flash halos). Streaks stretch along their screen-space velocity.
 *  - PuffPool: soft alpha puffs (stack smoke, press dust, steam leaks, fumes).
 * Simulation is CPU-side with struct-of-arrays (no per-frame allocation);
 * dead particles are swap-removed, so the instance count is the live count.
 */
import * as THREE from 'three'
import { textures } from '@/world/materials'

function quadGeometry(max: number, attrs: Array<[string, number]>): { geo: THREE.InstancedBufferGeometry; buffers: Record<string, THREE.InstancedBufferAttribute> } {
  const base = new THREE.PlaneGeometry(1, 1)
  const geo = new THREE.InstancedBufferGeometry()
  geo.index = base.index
  geo.setAttribute('position', base.getAttribute('position'))
  geo.setAttribute('uv', base.getAttribute('uv'))
  const buffers: Record<string, THREE.InstancedBufferAttribute> = {}
  for (const [name, size] of attrs) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(max * size), size)
    a.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute(name, a)
    buffers[name] = a
  }
  geo.instanceCount = 0
  return { geo, buffers }
}

const SPARK_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iData; // size, alpha, stretch, -
attribute vec3 iColor;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
  float sp = length(vv.xy);
  vec2 dir = sp > 1e-4 ? vv.xy / sp : vec2(0.0, 1.0);
  vec2 side = vec2(-dir.y, dir.x);
  float w = iData.x;
  float len = w + sp * iData.z;
  mvPosition.xy += side * position.x * w + dir * position.y * len;
  vColor = iColor;
  vAlpha = iData.y;
  gl_Position = projectionMatrix * mvPosition;
}
`

const SPARK_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
#include <common>
void main() {
  float a = texture2D(uMap, vUv).a * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

const PUFF_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iData; // size, alpha, rotation, -
attribute vec3 iColor;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iData.z);
  float s = sin(iData.z);
  vec2 p = position.xy * iData.x;
  mvPosition.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  vColor = iColor;
  vAlpha = iData.y;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const PUFF_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uLight;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vAlpha;
  if (a < 0.004) discard;
  vec3 col = vColor * (0.62 + 0.55 * t.r) * uLight;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

export class SparkPool {
  readonly mesh: THREE.Mesh
  readonly max: number
  /** Live particle count (excluding one-frame glows). */
  count = 0
  private glows = 0
  private readonly px: Float32Array
  private readonly py: Float32Array
  private readonly pz: Float32Array
  private readonly vx: Float32Array
  private readonly vy: Float32Array
  private readonly vz: Float32Array
  private readonly age: Float32Array
  private readonly life: Float32Array
  private readonly size: Float32Array
  private readonly stretch: Float32Array
  private readonly grav: Float32Array
  private readonly cr: Float32Array
  private readonly cg: Float32Array
  private readonly cb: Float32Array
  private readonly buf: Record<string, THREE.InstancedBufferAttribute>
  private readonly bufList: THREE.InstancedBufferAttribute[]
  private readonly geo: THREE.InstancedBufferGeometry
  private readonly mat: THREE.ShaderMaterial
  /** Live cap (quality may lower it at runtime). */
  cap: number

  constructor(max: number) {
    this.max = max
    this.cap = max
    const n = max + 16
    const f = () => new Float32Array(n)
    this.px = f()
    this.py = f()
    this.pz = f()
    this.vx = f()
    this.vy = f()
    this.vz = f()
    this.age = f()
    this.life = f()
    this.size = f()
    this.stretch = f()
    this.grav = f()
    this.cr = f()
    this.cg = f()
    this.cb = f()
    const { geo, buffers } = quadGeometry(n, [
      ['iPos', 3],
      ['iVel', 3],
      ['iData', 4],
      ['iColor', 3],
    ])
    this.geo = geo
    this.buf = buffers
    this.bufList = Object.values(buffers)
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      uniforms: { uMap: { value: textures.glowDot() } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 3
    this.mesh.name = 'lines:sparks'
  }

  /** Spawn a spark/ember. Silently dropped when the pool is full. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, r: number, g: number, b: number, stretch = 0.035, gravity = 9.8): void {
    if (this.count >= this.cap) return
    const i = this.count++
    this.px[i] = x
    this.py[i] = y
    this.pz[i] = z
    this.vx[i] = vx
    this.vy[i] = vy
    this.vz[i] = vz
    this.age[i] = 0
    this.life[i] = Math.max(0.02, life)
    this.size[i] = size
    this.stretch[i] = stretch
    this.grav[i] = gravity
    this.cr[i] = r
    this.cg[i] = g
    this.cb[i] = b
  }

  /** A one-frame glow halo (flash, furnace mouth). Call every frame it should show. */
  glow(x: number, y: number, z: number, size: number, r: number, g: number, b: number, alpha = 1): void {
    if (alpha <= 0.002 || this.glows >= 16) return
    const o = this.max + this.glows++
    const P = this.buf.iPos.array as Float32Array
    const V = this.buf.iVel.array as Float32Array
    const D = this.buf.iData.array as Float32Array
    const C = this.buf.iColor.array as Float32Array
    P[o * 3] = x
    P[o * 3 + 1] = y
    P[o * 3 + 2] = z
    V[o * 3] = V[o * 3 + 1] = V[o * 3 + 2] = 0
    D[o * 4] = size
    D[o * 4 + 1] = alpha
    D[o * 4 + 2] = 0
    C[o * 3] = r
    C[o * 3 + 1] = g
    C[o * 3 + 2] = b
  }

  update(dt: number): void {
    const P = this.buf.iPos.array as Float32Array
    const V = this.buf.iVel.array as Float32Array
    const D = this.buf.iData.array as Float32Array
    const C = this.buf.iColor.array as Float32Array
    let i = 0
    while (i < this.count) {
      this.age[i] += dt
      if (this.age[i] >= this.life[i]) {
        this.kill(i)
        continue
      }
      this.vy[i] -= this.grav[i] * dt
      const drag = 1 - Math.min(0.9, 1.2 * dt)
      this.vx[i] *= drag
      this.vz[i] *= drag
      this.px[i] += this.vx[i] * dt
      this.py[i] += this.vy[i] * dt
      this.pz[i] += this.vz[i] * dt
      if (this.py[i] < 0.02 && this.vy[i] < 0) {
        this.py[i] = 0.02
        this.vy[i] *= -0.3
        this.vx[i] *= 0.5
        this.vz[i] *= 0.5
      }
      i++
    }
    // write live particles first, then pack this frame's glows right after them
    const n = this.count
    for (let k = 0; k < n; k++) {
      const fade = 1 - this.age[k] / this.life[k]
      P[k * 3] = this.px[k]
      P[k * 3 + 1] = this.py[k]
      P[k * 3 + 2] = this.pz[k]
      V[k * 3] = this.vx[k]
      V[k * 3 + 1] = this.vy[k]
      V[k * 3 + 2] = this.vz[k]
      D[k * 4] = this.size[k] * (0.6 + 0.4 * fade)
      D[k * 4 + 1] = fade * fade
      D[k * 4 + 2] = this.stretch[k]
      C[k * 3] = this.cr[k]
      C[k * 3 + 1] = this.cg[k]
      C[k * 3 + 2] = this.cb[k]
    }
    for (let g = 0; g < this.glows; g++) {
      const from = this.max + g
      const to = n + g
      if (from === to) continue
      for (let c = 0; c < 3; c++) {
        P[to * 3 + c] = P[from * 3 + c]
        V[to * 3 + c] = V[from * 3 + c]
        C[to * 3 + c] = C[from * 3 + c]
      }
      for (let c = 0; c < 4; c++) D[to * 4 + c] = D[from * 4 + c]
    }
    const total = n + this.glows
    this.glows = 0
    this.geo.instanceCount = total
    if (total > 0) {
      for (const a of this.bufList) {
        a.clearUpdateRanges()
        a.addUpdateRange(0, total * a.itemSize)
        a.needsUpdate = true
      }
    }
  }

  private kill(i: number): void {
    const j = --this.count
    if (i === j) return
    this.px[i] = this.px[j]
    this.py[i] = this.py[j]
    this.pz[i] = this.pz[j]
    this.vx[i] = this.vx[j]
    this.vy[i] = this.vy[j]
    this.vz[i] = this.vz[j]
    this.age[i] = this.age[j]
    this.life[i] = this.life[j]
    this.size[i] = this.size[j]
    this.stretch[i] = this.stretch[j]
    this.grav[i] = this.grav[j]
    this.cr[i] = this.cr[j]
    this.cg[i] = this.cg[j]
    this.cb[i] = this.cb[j]
  }

  clear(): void {
    this.count = 0
    this.glows = 0
    this.geo.instanceCount = 0
  }

  dispose(): void {
    this.geo.dispose()
    this.mat.dispose()
  }
}

export class PuffPool {
  readonly mesh: THREE.Mesh
  readonly max: number
  count = 0
  cap: number
  private readonly px: Float32Array
  private readonly py: Float32Array
  private readonly pz: Float32Array
  private readonly vx: Float32Array
  private readonly vy: Float32Array
  private readonly vz: Float32Array
  private readonly age: Float32Array
  private readonly life: Float32Array
  private readonly s0: Float32Array
  private readonly s1: Float32Array
  private readonly alpha: Float32Array
  private readonly rot: Float32Array
  private readonly spin: Float32Array
  private readonly buoy: Float32Array
  private readonly cr: Float32Array
  private readonly cg: Float32Array
  private readonly cb: Float32Array
  private readonly buf: Record<string, THREE.InstancedBufferAttribute>
  private readonly bufList: THREE.InstancedBufferAttribute[]
  private readonly geo: THREE.InstancedBufferGeometry
  readonly mat: THREE.ShaderMaterial
  /** Wind (m/s) applied to every puff. */
  readonly wind = new THREE.Vector3(0.55, 0, -0.22)
  private seed = 1

  constructor(max: number) {
    this.max = max
    this.cap = max
    const f = () => new Float32Array(max)
    this.px = f()
    this.py = f()
    this.pz = f()
    this.vx = f()
    this.vy = f()
    this.vz = f()
    this.age = f()
    this.life = f()
    this.s0 = f()
    this.s1 = f()
    this.alpha = f()
    this.rot = f()
    this.spin = f()
    this.buoy = f()
    this.cr = f()
    this.cg = f()
    this.cb = f()
    const { geo, buffers } = quadGeometry(max, [
      ['iPos', 3],
      ['iData', 4],
      ['iColor', 3],
    ])
    this.geo = geo
    this.buf = buffers
    this.bufList = Object.values(buffers)
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PUFF_VERT,
      fragmentShader: PUFF_FRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null }, uLight: { value: 1 } }]),
      transparent: true,
      depthWrite: false,
      fog: true,
    })
    this.mat.uniforms.uMap.value = textures.smokePuff()
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 2
    this.mesh.name = 'lines:puffs'
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647
    return (this.seed - 1) / 2147483646
  }

  /** Spawn a puff: size grows s0 → s1 over life, alpha fades in quickly then out. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, alpha: number, r: number, g: number, b: number, buoyancy = 0.4): void {
    if (this.count >= this.cap) return
    const i = this.count++
    this.px[i] = x
    this.py[i] = y
    this.pz[i] = z
    this.vx[i] = vx
    this.vy[i] = vy
    this.vz[i] = vz
    this.age[i] = 0
    this.life[i] = Math.max(0.05, life)
    this.s0[i] = s0
    this.s1[i] = s1
    this.alpha[i] = alpha
    this.rot[i] = this.rand() * Math.PI * 2
    this.spin[i] = (this.rand() - 0.5) * 0.8
    this.buoy[i] = buoyancy
    this.cr[i] = r
    this.cg[i] = g
    this.cb[i] = b
  }

  update(dt: number, light: number): void {
    const P = this.buf.iPos.array as Float32Array
    const D = this.buf.iData.array as Float32Array
    const C = this.buf.iColor.array as Float32Array
    const w = this.wind
    let i = 0
    while (i < this.count) {
      this.age[i] += dt
      if (this.age[i] >= this.life[i]) {
        this.kill(i)
        continue
      }
      const drag = 1 - Math.min(0.95, 1.6 * dt)
      this.vx[i] = (this.vx[i] - w.x) * drag + w.x
      this.vz[i] = (this.vz[i] - w.z) * drag + w.z
      this.vy[i] = this.vy[i] * drag + this.buoy[i] * dt
      this.px[i] += this.vx[i] * dt
      this.py[i] += this.vy[i] * dt
      this.pz[i] += this.vz[i] * dt
      this.rot[i] += this.spin[i] * dt
      i++
    }
    const n = this.count
    for (let k = 0; k < n; k++) {
      const t = this.age[k] / this.life[k]
      const fadeIn = Math.min(1, t / 0.12)
      const fadeOut = 1 - t
      P[k * 3] = this.px[k]
      P[k * 3 + 1] = this.py[k]
      P[k * 3 + 2] = this.pz[k]
      D[k * 4] = this.s0[k] + (this.s1[k] - this.s0[k]) * Math.sqrt(t)
      D[k * 4 + 1] = this.alpha[k] * fadeIn * fadeOut * fadeOut
      D[k * 4 + 2] = this.rot[k]
      C[k * 3] = this.cr[k]
      C[k * 3 + 1] = this.cg[k]
      C[k * 3 + 2] = this.cb[k]
    }
    this.mat.uniforms.uLight.value = light
    this.geo.instanceCount = n
    if (n > 0) {
      for (const a of this.bufList) {
        a.clearUpdateRanges()
        a.addUpdateRange(0, n * a.itemSize)
        a.needsUpdate = true
      }
    }
  }

  private kill(i: number): void {
    const j = --this.count
    if (i === j) return
    this.px[i] = this.px[j]
    this.py[i] = this.py[j]
    this.pz[i] = this.pz[j]
    this.vx[i] = this.vx[j]
    this.vy[i] = this.vy[j]
    this.vz[i] = this.vz[j]
    this.age[i] = this.age[j]
    this.life[i] = this.life[j]
    this.s0[i] = this.s0[j]
    this.s1[i] = this.s1[j]
    this.alpha[i] = this.alpha[j]
    this.rot[i] = this.rot[j]
    this.spin[i] = this.spin[j]
    this.buoy[i] = this.buoy[j]
    this.cr[i] = this.cr[j]
    this.cg[i] = this.cg[j]
    this.cb[i] = this.cb[j]
  }

  clear(): void {
    this.count = 0
    this.geo.instanceCount = 0
  }

  dispose(): void {
    this.geo.dispose()
    this.mat.dispose()
  }
}
