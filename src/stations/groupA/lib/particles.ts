import * as THREE from 'three'
import { textures } from '@/world/materials'

/**
 * Pooled, allocation-free particle helpers.
 *
 *  PuffPool     — camera-facing soft smoke puffs (chimney, stamp dust). One
 *                 InstancedMesh, per-instance alpha in a tiny shader.
 *  ConfettiPool — tumbling paper shreds (InstancedMesh with instance colors).
 *
 * Both are capped (spawns beyond the cap recycle the oldest particle) and do
 * nothing while idle, so they are safe to leave mounted.
 */

const puffVert = /* glsl */ `
attribute float aAlpha;
attribute float aShade;
varying float vAlpha;
varying float vShade;
varying vec2 vUv;
void main() {
  vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(instanceMatrix[0].xyz);
  c.xy += position.xy * s;
  gl_Position = projectionMatrix * c;
  vUv = uv;
  vAlpha = aAlpha;
  vShade = aShade;
}`

const puffFrag = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uDark;
uniform vec3 uLight;
uniform float uLevel;
varying float vAlpha;
varying float vShade;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vAlpha;
  if (a < 0.01) discard;
  vec3 col = mix(uDark, uLight, clamp(t.r * vShade, 0.0, 1.0)) * uLevel;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`

interface Puff {
  alive: boolean
  age: number
  life: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  size0: number
  size1: number
  alpha: number
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _qi = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()

export class PuffPool {
  readonly mesh: THREE.InstancedMesh
  private readonly items: Puff[]
  private readonly alpha: THREE.InstancedBufferAttribute
  private readonly shade: THREE.InstancedBufferAttribute
  private readonly material: THREE.ShaderMaterial
  private next = 0
  private active = 0

  constructor(
    readonly cap: number,
    dark = '#5b5752',
    light = '#efe9df',
  ) {
    const geo = new THREE.PlaneGeometry(1, 1)
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1)
    this.shade = new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(1), 1)
    this.alpha.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('aAlpha', this.alpha)
    geo.setAttribute('aShade', this.shade)
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: textures.smokePuff() },
        uDark: { value: new THREE.Color(dark) },
        uLight: { value: new THREE.Color(light) },
        uLevel: { value: 1 },
      },
      vertexShader: puffVert,
      fragmentShader: puffFrag,
      transparent: true,
      depthWrite: false,
    })
    this.mesh = new THREE.InstancedMesh(geo, this.material, cap)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.mesh.renderOrder = 4
    this.items = Array.from({ length: cap }, () => ({ alive: false, age: 0, life: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size0: 0.2, size1: 0.6, alpha: 0.6 }))
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size0: number, size1: number, life: number, alpha = 0.6, shade = 1): void {
    const i = this.next
    this.next = (this.next + 1) % this.cap
    const p = this.items[i]
    if (!p.alive) this.active++
    p.alive = true
    p.age = 0
    p.life = Math.max(0.05, life)
    p.x = x
    p.y = y
    p.z = z
    p.vx = vx
    p.vy = vy
    p.vz = vz
    p.size0 = size0
    p.size1 = size1
    p.alpha = alpha
    this.shade.setX(i, shade)
    this.shade.needsUpdate = true
  }

  /** Advance and upload. `level` dims the puffs with the factory lighting (night shift). */
  update(dt: number, level = 1): void {
    this.material.uniforms.uLevel.value = 0.25 + 0.75 * level
    if (this.active === 0) {
      if (this.mesh.count !== 0) this.mesh.count = 0
      return
    }
    let maxIdx = -1
    for (let i = 0; i < this.cap; i++) {
      const p = this.items[i]
      if (!p.alive) {
        this.alpha.setX(i, 0)
        _m.makeScale(0, 0, 0)
        this.mesh.setMatrixAt(i, _m)
        continue
      }
      p.age += dt
      if (p.age >= p.life) {
        p.alive = false
        this.active--
        this.alpha.setX(i, 0)
        _m.makeScale(0, 0, 0)
        this.mesh.setMatrixAt(i, _m)
        continue
      }
      const k = p.age / p.life
      p.vx *= 1 - 0.9 * dt
      p.vz *= 1 - 0.9 * dt
      p.vy *= 1 - 0.5 * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      const size = p.size0 + (p.size1 - p.size0) * (1 - (1 - k) * (1 - k))
      const a = p.alpha * Math.min(1, k * 6) * (1 - k) * (1 - k * 0.3)
      _m.compose(_p.set(p.x, p.y, p.z), _qi, _s.setScalar(size))
      this.mesh.setMatrixAt(i, _m)
      this.alpha.setX(i, a)
      maxIdx = i
    }
    this.mesh.count = maxIdx + 1
    this.mesh.instanceMatrix.needsUpdate = true
    this.alpha.needsUpdate = true
  }

  clear(): void {
    for (const p of this.items) p.alive = false
    this.active = 0
    this.mesh.count = 0
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.material.dispose()
    this.mesh.dispose()
  }
}

interface Shred {
  alive: boolean
  age: number
  life: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  rx: number
  ry: number
  rz: number
  wx: number
  wy: number
  wz: number
  floor: number
}

const _e = new THREE.Euler()
const PAPER_COLORS = ['#f4efe2', '#ffffff', '#e9e1cc', '#f6e7b8', '#dfe8ee']

export class ConfettiPool {
  readonly mesh: THREE.InstancedMesh
  private readonly items: Shred[]
  private next = 0
  private active = 0
  private seed = 1

  constructor(readonly cap: number) {
    const geo = new THREE.PlaneGeometry(0.035, 0.11)
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, metalness: 0, side: THREE.DoubleSide })
    this.mesh = new THREE.InstancedMesh(geo, mat, cap)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    const c = new THREE.Color()
    for (let i = 0; i < cap; i++) this.mesh.setColorAt(i, c.set(PAPER_COLORS[i % PAPER_COLORS.length]))
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    this.items = Array.from({ length: cap }, () => ({ alive: false, age: 0, life: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0, floor: 0 }))
  }

  private rnd(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0
    return this.seed / 4294967296
  }

  /** Burst `n` shreds from (x, y, z) that settle at y = floor. */
  burst(n: number, x: number, y: number, z: number, spread: number, up: number, floor: number): void {
    for (let k = 0; k < n; k++) {
      const i = this.next
      this.next = (this.next + 1) % this.cap
      const p = this.items[i]
      if (!p.alive) this.active++
      p.alive = true
      p.age = 0
      p.life = 1.6 + this.rnd() * 0.8
      p.x = x + (this.rnd() - 0.5) * 0.15
      p.y = y
      p.z = z + (this.rnd() - 0.5) * 0.15
      p.vx = (this.rnd() - 0.5) * spread
      p.vy = up * (0.6 + this.rnd() * 0.6)
      p.vz = (this.rnd() - 0.5) * spread
      p.rx = this.rnd() * 6
      p.ry = this.rnd() * 6
      p.rz = this.rnd() * 6
      p.wx = (this.rnd() - 0.5) * 16
      p.wy = (this.rnd() - 0.5) * 16
      p.wz = (this.rnd() - 0.5) * 16
      p.floor = floor
    }
  }

  update(dt: number): void {
    if (this.active === 0) {
      if (this.mesh.count !== 0) this.mesh.count = 0
      return
    }
    let maxIdx = -1
    for (let i = 0; i < this.cap; i++) {
      const p = this.items[i]
      if (!p.alive) {
        _m.makeScale(0, 0, 0)
        this.mesh.setMatrixAt(i, _m)
        continue
      }
      p.age += dt
      if (p.age >= p.life) {
        p.alive = false
        this.active--
        _m.makeScale(0, 0, 0)
        this.mesh.setMatrixAt(i, _m)
        continue
      }
      // fluttering fall: gravity with heavy drag, sideways wobble
      p.vy -= 6 * dt
      p.vy = Math.max(p.vy, -1.1)
      p.vx *= 1 - 1.8 * dt
      p.vz *= 1 - 1.8 * dt
      p.x += (p.vx + Math.sin(p.age * 9 + i) * 0.25) * dt
      p.y = Math.max(p.floor, p.y + p.vy * dt)
      p.z += (p.vz + Math.cos(p.age * 8 + i) * 0.25) * dt
      p.rx += p.wx * dt
      p.ry += p.wy * dt
      p.rz += p.wz * dt
      const fade = p.age > p.life - 0.3 ? (p.life - p.age) / 0.3 : 1
      _q.setFromEuler(_e.set(p.rx, p.ry, p.rz))
      _m.compose(_p.set(p.x, p.y, p.z), _q, _s.setScalar(Math.max(0.001, fade)))
      this.mesh.setMatrixAt(i, _m)
      maxIdx = i
    }
    this.mesh.count = maxIdx + 1
    this.mesh.instanceMatrix.needsUpdate = true
  }

  clear(): void {
    for (const p of this.items) p.alive = false
    this.active = 0
    this.mesh.count = 0
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh.dispose()
  }
}
