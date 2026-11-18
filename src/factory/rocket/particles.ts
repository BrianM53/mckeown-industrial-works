/**
 * Pooled billboard particles: one instanced draw for alpha-blended smoke
 * (depth sorted) and one for additive glow (fire, sparks, lamp halos).
 * Capacity is fixed at creation (quality-scaled); push() simply refuses
 * particles beyond it, so nothing can ever overload a frame. No per-frame
 * allocation.
 */
import * as THREE from 'three'
import { textures } from '@/world/materials'

const SMOKE_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iData;
attribute vec3 iColor;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
#include <fog_pars_vertex>
void main() {
  vUv = position.xy + 0.5;
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iData.z);
  float s = sin(iData.z);
  mvPosition.xy += vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iData.x;
  gl_Position = projectionMatrix * mvPosition;
  vAlpha = iData.y;
  vColor = iColor;
  #include <fog_vertex>
}
`

const SMOKE_FRAG = /* glsl */ `
uniform sampler2D uTex;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uTex, vUv);
  float a = t.a * vAlpha;
  if (a < 0.004) discard;
  vec3 col = vColor * mix(0.62, 1.08, t.r);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

const GLOW_FRAG = /* glsl */ `
uniform sampler2D uTex;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
#include <fog_pars_fragment>
void main() {
  float a = texture2D(uTex, vUv).a * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

/** Upload only the live part of an instance attribute. */
function flush(attr: THREE.InstancedBufferAttribute, n: number, size: number): void {
  attr.clearUpdateRanges()
  attr.addUpdateRange(0, Math.max(1, n) * size)
  attr.needsUpdate = true
}

export class ParticleBuffer {
  readonly capacity: number
  readonly mesh: THREE.Mesh
  readonly geometry: THREE.InstancedBufferGeometry
  readonly material: THREE.ShaderMaterial
  private readonly sorted: boolean
  private readonly P: Float32Array
  private readonly D: Float32Array
  private readonly C: Float32Array
  private readonly iPos: THREE.InstancedBufferAttribute
  private readonly iData: THREE.InstancedBufferAttribute
  private readonly iColor: THREE.InstancedBufferAttribute
  // staging (unsorted) arrays
  private readonly sx: Float32Array
  private readonly sy: Float32Array
  private readonly sz: Float32Array
  private readonly ss: Float32Array
  private readonly sa: Float32Array
  private readonly sr: Float32Array
  private readonly cr: Float32Array
  private readonly cg: Float32Array
  private readonly cb: Float32Array
  private readonly depth: Float32Array
  private readonly order: Int32Array
  count = 0
  /** Particles refused this frame because the pool was full (debug stats). */
  dropped = 0

  constructor(capacity: number, kind: 'smoke' | 'glow', name: string) {
    const n = Math.max(1, Math.floor(capacity))
    this.capacity = n
    this.sorted = kind === 'smoke'
    const g = new THREE.InstancedBufferGeometry()
    const quad = new THREE.PlaneGeometry(1, 1)
    g.index = quad.index
    g.setAttribute('position', quad.getAttribute('position'))
    this.P = new Float32Array(n * 3)
    this.D = new Float32Array(n * 4)
    this.C = new Float32Array(n * 3)
    this.iPos = new THREE.InstancedBufferAttribute(this.P, 3)
    this.iData = new THREE.InstancedBufferAttribute(this.D, 4)
    this.iColor = new THREE.InstancedBufferAttribute(this.C, 3)
    for (const a of [this.iPos, this.iData, this.iColor]) a.setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('iPos', this.iPos)
    g.setAttribute('iData', this.iData)
    g.setAttribute('iColor', this.iColor)
    g.instanceCount = 0
    this.geometry = g
    this.material = new THREE.ShaderMaterial({
      vertexShader: SMOKE_VERT,
      fragmentShader: kind === 'smoke' ? SMOKE_FRAG : GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: kind === 'smoke' ? THREE.NormalBlending : THREE.AdditiveBlending,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTex: { value: null } }]),
    })
    this.material.uniforms.uTex.value = kind === 'smoke' ? textures.smokePuff() : textures.glowDot()
    this.material.name = `rocket:${name}`
    const mesh = new THREE.Mesh(g, this.material)
    mesh.frustumCulled = false
    mesh.renderOrder = kind === 'smoke' ? 4 : 5
    mesh.name = `rocket-${name}`
    this.mesh = mesh
    this.sx = new Float32Array(n)
    this.sy = new Float32Array(n)
    this.sz = new Float32Array(n)
    this.ss = new Float32Array(n)
    this.sa = new Float32Array(n)
    this.sr = new Float32Array(n)
    this.cr = new Float32Array(n)
    this.cg = new Float32Array(n)
    this.cb = new Float32Array(n)
    this.depth = new Float32Array(n)
    this.order = new Int32Array(n)
  }

  begin(): void {
    this.count = 0
    this.dropped = 0
  }

  get full(): boolean {
    return this.count >= this.capacity
  }

  /** Queue one particle. Returns false (and counts a drop) when the pool is full. */
  push(x: number, y: number, z: number, size: number, alpha: number, rot: number, r: number, g: number, b: number): boolean {
    if (!(alpha > 0.003) || !(size > 0.001)) return true
    if (!Number.isFinite(x + y + z + size + alpha)) return true
    if (this.count >= this.capacity) {
      this.dropped++
      return false
    }
    const i = this.count++
    this.sx[i] = x
    this.sy[i] = y
    this.sz[i] = z
    this.ss[i] = size
    this.sa[i] = alpha
    this.sr[i] = rot
    this.cr[i] = r
    this.cg[i] = g
    this.cb[i] = b
    return true
  }

  /**
   * Write the queued particles to the GPU buffers. Smoke is sorted back to
   * front and faded when it gets close to the camera, so a plume can never
   * swallow the screen.
   */
  end(camera: THREE.Vector3, nearFade: number): void {
    const n = this.count
    const cx = camera.x
    const cy = camera.y
    const cz = camera.z
    for (let i = 0; i < n; i++) {
      const dx = this.sx[i] - cx
      const dy = this.sy[i] - cy
      const dz = this.sz[i] - cz
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      this.depth[i] = d
      this.order[i] = i
      if (nearFade > 0) {
        // the puff's near edge must stay well away from the lens
        const edge = d - this.ss[i] * 0.5
        const k = Math.min(1, Math.max(0, (edge - 0.4) / nearFade))
        this.sa[i] *= k * k * (3 - 2 * k)
      }
    }
    if (this.sorted) {
      const ord = this.order
      const dep = this.depth
      for (let a = 1; a < n; a++) {
        const v = ord[a]
        const dv = dep[v]
        let b = a - 1
        while (b >= 0 && dep[ord[b]] < dv) {
          ord[b + 1] = ord[b]
          b--
        }
        ord[b + 1] = v
      }
    }
    const P = this.P
    const D = this.D
    const C = this.C
    for (let j = 0; j < n; j++) {
      const i = this.order[j]
      P[j * 3] = this.sx[i]
      P[j * 3 + 1] = this.sy[i]
      P[j * 3 + 2] = this.sz[i]
      D[j * 4] = this.ss[i]
      D[j * 4 + 1] = this.sa[i]
      D[j * 4 + 2] = this.sr[i]
      D[j * 4 + 3] = 0
      C[j * 3] = this.cr[i]
      C[j * 3 + 1] = this.cg[i]
      C[j * 3 + 2] = this.cb[i]
    }
    this.geometry.instanceCount = n
    flush(this.iPos, n, 3)
    flush(this.iData, n, 4)
    flush(this.iColor, n, 3)
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}

/** Stateless 0..1 hash of (a, b, salt) — per-particle randomness that survives time jumps. */
export function hash01(a: number, b: number, salt: number): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(salt | 0, 0x27d4eb2f)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  h = Math.imul(h, 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}
