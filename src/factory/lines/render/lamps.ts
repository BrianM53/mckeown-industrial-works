/**
 * Indicator lamps (stack lights, LED grids, console lamps, QC lamps): one
 * InstancedMesh of small domed lenses with per-instance colors. Housings are
 * part of the static machinery; only the lenses live here so every lamp in the
 * module costs one draw call and colors can change every frame for free.
 */
import * as THREE from 'three'
import type { V3 } from '../build/builder'

/** Unit lens: radius 1, height 1 along +Y (flat base at y = 0, domed top). */
function lensGeometry(): THREE.BufferGeometry {
  const pts = [
    [0, 0],
    [1, 0],
    [1, 0.5],
    [0.88, 0.78],
    [0.55, 0.95],
    [0, 1],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  const g = new THREE.LatheGeometry(pts, 10)
  return g
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _d = new THREE.Vector3()
const _c = new THREE.Color()

export class LampSet {
  private specs: { pos: V3; dir: V3; r: number; h: number }[] = []
  mesh: THREE.InstancedMesh | null = null
  private colors: Float32Array | null = null
  private dirty = false
  /** Electric power multiplier (Night Shift dims every lens). */
  power = 1

  /** Add a lens at `pos` (base center) pointing along `dir`. Returns its index. */
  add(pos: V3, dir: V3, r: number, h = r * 0.6): number {
    this.specs.push({ pos, dir, r, h })
    return this.specs.length - 1
  }

  get count(): number {
    return this.specs.length
  }

  build(material: THREE.Material): THREE.InstancedMesh {
    const geo = lensGeometry()
    const n = Math.max(1, this.specs.length)
    const mesh = new THREE.InstancedMesh(geo, material, n)
    mesh.count = this.specs.length
    this.specs.forEach((s, i) => {
      _d.set(s.dir[0], s.dir[1], s.dir[2]).normalize()
      _q.setFromUnitVectors(_up, _d)
      _m.compose(_p.set(s.pos[0], s.pos[1], s.pos[2]), _q, _s.set(s.r, s.h, s.r))
      mesh.setMatrixAt(i, _m)
      mesh.setColorAt(i, _c.setRGB(0.05, 0.05, 0.05))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) {
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
      this.colors = mesh.instanceColor.array as Float32Array
    }
    mesh.computeBoundingSphere()
    mesh.name = 'lines:lamps'
    this.mesh = mesh
    return mesh
  }

  /** Set a lamp color (linear RGB, may exceed 1 for a hot glow). */
  set(i: number, r: number, g: number, b: number): void {
    const c = this.colors
    if (!c || i < 0 || i * 3 + 2 >= c.length) return
    if (c[i * 3] === r && c[i * 3 + 1] === g && c[i * 3 + 2] === b) return
    c[i * 3] = r
    c[i * 3 + 1] = g
    c[i * 3 + 2] = b
    this.dirty = true
  }

  /** Set lamp i to `on` color or a dim "off" version of it. */
  light(i: number, color: readonly [number, number, number], on: boolean | number): void {
    const k = typeof on === 'number' ? on : on ? 1 : 0
    const off = 0.07
    const m = (off + (1 - off) * k) * this.power
    this.set(i, color[0] * m, color[1] * m, color[2] * m)
  }

  flush(): void {
    if (this.dirty && this.mesh?.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true
      this.dirty = false
    }
  }

  dispose(): void {
    this.mesh?.geometry.dispose()
    this.mesh?.dispose()
    this.mesh = null
    this.colors = null
  }
}

/** Lamp colors (linear, HDR-ish so they read as lit). */
export const LAMP = {
  green: [0.35, 2.2, 0.55] as const,
  amber: [2.4, 1.25, 0.18] as const,
  red: [2.6, 0.22, 0.16] as const,
  white: [2.0, 2.0, 1.9] as const,
  cyan: [0.3, 1.6, 2.2] as const,
  orange: [2.6, 0.9, 0.25] as const,
  blue: [0.35, 0.75, 2.6] as const,
}
