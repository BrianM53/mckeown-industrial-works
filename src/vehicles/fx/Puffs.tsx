import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Pooled cartoon puffs (exhaust smoke, recovery / return "poof", crash dust):
 * chunky faceted blobs that swell and shrink (no transparency sorting), ONE
 * instanced draw call, fixed capacity, nothing allocated per frame.
 */
export interface PuffOpts {
  /** Velocity (m/s). */
  vx?: number
  vy?: number
  vz?: number
  /** Lifetime (s). */
  life?: number
  /** Start / peak size (m). */
  size0?: number
  size1?: number
  color?: THREE.ColorRepresentation
  /** Vertical acceleration (m/s², + rises). */
  lift?: number
  /** Velocity damping per second. */
  drag?: number
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _c = new THREE.Color()
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0)

export class PuffPool {
  readonly mesh: THREE.InstancedMesh
  private readonly n: number
  private readonly pos: Float32Array
  private readonly vel: Float32Array
  private readonly age: Float32Array
  private readonly life: Float32Array
  private readonly size: Float32Array
  private readonly phys: Float32Array
  private readonly rot: THREE.Quaternion[]
  private next = 0
  private alive = 0
  private dirty = false

  constructor(capacity: number, geometry: THREE.BufferGeometry, material: THREE.Material) {
    this.n = capacity
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity)
    this.mesh.name = 'vehicles:puffs'
    this.mesh.frustumCulled = false
    this.mesh.castShadow = false
    this.mesh.receiveShadow = false
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.pos = new Float32Array(capacity * 3)
    this.vel = new Float32Array(capacity * 3)
    this.age = new Float32Array(capacity).fill(1)
    this.life = new Float32Array(capacity).fill(0)
    this.size = new Float32Array(capacity * 2)
    this.phys = new Float32Array(capacity * 2)
    this.rot = []
    for (let i = 0; i < capacity; i++) {
      this.rot.push(new THREE.Quaternion().setFromEuler(new THREE.Euler(i * 1.7, i * 2.3, i * 0.9)))
      this.mesh.setMatrixAt(i, ZERO)
      this.mesh.setColorAt(i, _c.set('#ffffff'))
    }
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  emit(x: number, y: number, z: number, o: PuffOpts = {}): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return
    const i = this.next
    this.next = (this.next + 1) % this.n
    if (this.life[i] <= 0 || this.age[i] >= this.life[i]) this.alive++
    this.pos[i * 3] = x
    this.pos[i * 3 + 1] = y
    this.pos[i * 3 + 2] = z
    this.vel[i * 3] = o.vx ?? 0
    this.vel[i * 3 + 1] = o.vy ?? 0.6
    this.vel[i * 3 + 2] = o.vz ?? 0
    this.age[i] = 0
    this.life[i] = Math.max(0.05, o.life ?? 1)
    this.size[i * 2] = o.size0 ?? 0.1
    this.size[i * 2 + 1] = o.size1 ?? 0.3
    this.phys[i * 2] = o.lift ?? 0.4
    this.phys[i * 2 + 1] = o.drag ?? 1.2
    this.mesh.setColorAt(i, _c.set(o.color ?? '#d9d4c5'))
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    this.dirty = true
  }

  /** A ring of puffs bursting outward on the ground (recovery / return). */
  poof(x: number, y: number, z: number, opts: { radius?: number; count?: number; color?: THREE.ColorRepresentation; gentle?: boolean } = {}): void {
    const count = opts.count ?? 12
    const r = opts.radius ?? 1.2
    const sp = opts.gentle ? 0.9 : 2.2
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + (k % 2) * 0.2
      const c = Math.cos(a)
      const s = Math.sin(a)
      this.emit(x + c * r * 0.35, y + 0.25 + (k % 3) * 0.12, z + s * r * 0.35, {
        vx: c * sp,
        vy: (opts.gentle ? 0.5 : 1.1) + (k % 3) * 0.25,
        vz: s * sp,
        life: opts.gentle ? 1.1 : 0.8,
        size0: 0.18,
        size1: 0.42 + (k % 2) * 0.12,
        color: opts.color ?? '#E8E2D4',
        lift: 0.3,
        drag: 2.6,
      })
    }
  }

  update(dtRaw: number): void {
    if (this.alive <= 0 && !this.dirty) return
    const dt = Math.min(Math.max(dtRaw, 0), 0.1)
    let alive = 0
    for (let i = 0; i < this.n; i++) {
      const life = this.life[i]
      if (life <= 0) continue
      let a = this.age[i]
      if (a >= life) continue
      a += dt
      this.age[i] = a
      if (a >= life) {
        this.mesh.setMatrixAt(i, ZERO)
        continue
      }
      alive++
      const k = 1 / (1 + this.phys[i * 2 + 1] * dt)
      this.vel[i * 3] *= k
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k + this.phys[i * 2] * dt
      this.vel[i * 3 + 2] *= k
      this.pos[i * 3] += this.vel[i * 3] * dt
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt
      const t = a / life
      // swell fast, linger, shrink away
      const grow = Math.min(1, t / 0.25)
      const shrink = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4
      const sz = (this.size[i * 2] + (this.size[i * 2 + 1] - this.size[i * 2]) * grow) * Math.max(0, shrink)
      _p.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2])
      _q.copy(this.rot[i])
      _s.setScalar(Math.max(1e-4, sz))
      _m.compose(_p, _q, _s)
      this.mesh.setMatrixAt(i, _m)
    }
    this.alive = alive
    this.dirty = false
    this.mesh.instanceMatrix.needsUpdate = true
  }

  clear(): void {
    for (let i = 0; i < this.n; i++) {
      this.life[i] = 0
      this.mesh.setMatrixAt(i, ZERO)
    }
    this.alive = 0
    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    this.mesh.dispose()
  }
}

let puffGeo: THREE.BufferGeometry | null = null
let puffMat: THREE.MeshStandardMaterial | null = null

export function usePuffPool(capacity = 64): PuffPool {
  const pool = useMemo(() => {
    if (!puffGeo) puffGeo = new THREE.IcosahedronGeometry(1, 1)
    if (!puffMat) puffMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0, flatShading: true, name: 'vehicles:puffs' })
    return new PuffPool(capacity, puffGeo, puffMat)
  }, [capacity])
  useEffect(
    () => () => {
      pool.clear()
      pool.dispose()
    },
    [pool],
  )
  return pool
}

export function Puffs({ pool }: { pool: PuffPool }) {
  useFrame((_, dt) => pool.update(dt))
  return <primitive object={pool.mesh} />
}
