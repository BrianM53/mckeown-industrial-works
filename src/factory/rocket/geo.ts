/**
 * Geometry batching + the module's single shared surface material.
 *
 * Parts (unit primitives or custom geometries + a transform + color + surface)
 * are merged into ONE indexed BufferGeometry per build call with attributes:
 *   position, normal, color (linear), uv (atlas; plain parts sample a white
 *   texel), aSurf = (roughness, metalness, emissive, blink channel).
 * One material renders every merged mesh of the module (tower, pad, rocket,
 * transporter, crane, signs...), so the whole module costs a few dozen draws.
 */
import * as THREE from 'three'
import { textures } from '@/world/materials'

export type V3 = [number, number, number]

export interface Surf {
  rough: number
  metal: number
  emis: number
  /** Blink channel (see BLINK). 0 = always on. */
  chan: number
}

export const SURF = {
  paint: { rough: 0.62, metal: 0.22, emis: 0, chan: 0 } as Surf,
  gloss: { rough: 0.38, metal: 0.18, emis: 0, chan: 0 } as Surf,
  metal: { rough: 0.4, metal: 0.68, emis: 0, chan: 0 } as Surf,
  dark: { rough: 0.7, metal: 0.45, emis: 0, chan: 0 } as Surf,
  rubber: { rough: 0.95, metal: 0, emis: 0, chan: 0 } as Surf,
  concrete: { rough: 0.96, metal: 0, emis: 0, chan: 0 } as Surf,
  fabric: { rough: 0.85, metal: 0, emis: 0, chan: 0 } as Surf,
  glass: { rough: 0.12, metal: 0.4, emis: 0.18, chan: 0 } as Surf,
}

export function glow(chan: number, emis = 2.2): Surf {
  return { rough: 0.45, metal: 0, emis, chan }
}

/** Flag added to a surface's channel: skip the ground-occlusion darkening (parts built away from y = 0). */
export const NO_AO = 16

/** Same surface without ground occlusion (crane, hook, anything whose local y is not height above ground). */
export function noAO(s: Surf): Surf {
  return s.chan >= NO_AO ? s : { ...s, chan: s.chan + NO_AO }
}

/** Blink channels driven every frame by the module (uniform array). */
export const BLINK = {
  steady: 0,
  aviation: 1,
  /** 2..5: guidance ring chase lights. */
  guidance0: 2,
  transporter: 6,
  padBeacon: 7,
} as const

/** Atlas rect [u0, v0, u1, v1] in texture UV space. */
export type UvRect = [number, number, number, number]

/** UV of a pure white texel block in the atlas (see atlas.ts). */
export const WHITE_UV: [number, number] = [2 / 1024, 1 - 2 / 1024]

interface Part {
  geo: THREE.BufferGeometry
  matrix: THREE.Matrix4
  color: THREE.Color
  surf: Surf
  uv: UvRect | null
  tag: number
}

const unitCache = new Map<string, THREE.BufferGeometry>()
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = unitCache.get(key)
  if (!g) {
    g = make()
    unitCache.set(key, g)
  }
  return g
}

export const unit = {
  box: () => cached('box', () => new THREE.BoxGeometry(1, 1, 1)),
  /** Unit cylinder along +Y, centered, bottom radius 1, top radius `ratio`. */
  cyl: (segs = 12, ratio = 1, open = false) => cached(`cyl:${segs}:${ratio}:${open}`, () => new THREE.CylinderGeometry(ratio, 1, 1, segs, 1, open)),
  sphere: (w = 12, h = 8) => cached(`sph:${w}:${h}`, () => new THREE.SphereGeometry(1, w, h)),
  hemi: (w = 12, h = 5) => cached(`hemi:${w}:${h}`, () => new THREE.SphereGeometry(1, w, h, 0, Math.PI * 2, 0, Math.PI / 2)),
  torus: (tube: number, rs = 6, ts = 18, arc = Math.PI * 2) => cached(`tor:${tube}:${rs}:${ts}:${arc}`, () => new THREE.TorusGeometry(1, tube, rs, ts, arc)),
  plane: () => cached('plane', () => new THREE.PlaneGeometry(1, 1)),
}

const _m = new THREE.Matrix4()
const _m2 = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _d = new THREE.Vector3()
const _v = new THREE.Vector3()
const _n = new THREE.Vector3()
const _nm = new THREE.Matrix3()

function toColor(c: THREE.ColorRepresentation): THREE.Color {
  return c instanceof THREE.Color ? c.clone() : new THREE.Color(c)
}

export interface PrimOpts {
  surf?: Surf
  rot?: V3
  uv?: UvRect | null
}

export class GeoBuilder {
  readonly parts: Part[] = []
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()]
  /** Tag applied to parts added from now on (filters in build()). */
  tag = 0
  /** Default surface for parts added without an explicit one. */
  surf: Surf = SURF.paint
  /** Geometries created by this builder (disposed by dispose()). */
  private owned: THREE.BufferGeometry[] = []

  get top(): THREE.Matrix4 {
    return this.stack[this.stack.length - 1]
  }

  /** Run `fn` inside a local frame (position + YXZ euler rotation + scale). */
  frame(pos: V3, rot: V3, fn: () => void, scale: V3 = [1, 1, 1]): void {
    _e.set(rot[0], rot[1], rot[2], 'YXZ')
    _q.setFromEuler(_e)
    const local = new THREE.Matrix4().compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(scale[0], scale[1], scale[2]))
    this.stack.push(this.top.clone().multiply(local))
    try {
      fn()
    } finally {
      this.stack.pop()
    }
  }

  /** Run `fn` inside an arbitrary local matrix. */
  matrix(m: THREE.Matrix4, fn: () => void): void {
    this.stack.push(this.top.clone().multiply(m))
    try {
      fn()
    } finally {
      this.stack.pop()
    }
  }

  /** Register a geometry this builder should dispose with itself. */
  own<T extends THREE.BufferGeometry>(g: T): T {
    this.owned.push(g)
    return g
  }

  add(geo: THREE.BufferGeometry, local: THREE.Matrix4, color: THREE.ColorRepresentation, surf?: Surf, uv: UvRect | null = null): void {
    this.parts.push({ geo, matrix: this.top.clone().multiply(local), color: toColor(color), surf: surf ?? this.surf, uv, tag: this.tag })
  }

  /** Box by centre and full size (YXZ euler rotation). */
  box(cx: number, cy: number, cz: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, o: PrimOpts = {}): void {
    if (!(w > 0 && h > 0 && d > 0)) return
    const r = o.rot ?? [0, 0, 0]
    _e.set(r[0], r[1], r[2], 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_p.set(cx, cy, cz), _q, _s.set(w, h, d))
    this.add(unit.box(), _m, color, o.surf, o.uv ?? null)
  }

  /** Square-section beam between two points (w = width, h = height of the section). */
  beam(a: V3, b: V3, w: number, h: number, color: THREE.ColorRepresentation, surf?: Surf): void {
    _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const len = _d.length()
    if (len < 1e-4) return
    _d.divideScalar(len)
    // orient local +Y along the beam
    _q.setFromUnitVectors(_up, _d)
    _m.compose(_p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(w, len, h))
    this.add(unit.box(), _m, color, surf)
  }

  /** Vertical cylinder from base y0 with height h. */
  cyl(x: number, y0: number, z: number, r: number, h: number, color: THREE.ColorRepresentation, o: PrimOpts & { segs?: number; rTop?: number; open?: boolean } = {}): void {
    if (!(r > 0 && h > 0)) return
    const ratio = o.rTop === undefined ? 1 : Math.round((o.rTop / r) * 1000) / 1000
    const rot = o.rot ?? [0, 0, 0]
    _e.set(rot[0], rot[1], rot[2], 'YXZ')
    _q.setFromEuler(_e)
    // rotate about the base point so tilted cylinders stay attached at y0
    _m.compose(_p.set(0, h / 2, 0), new THREE.Quaternion(), _s.set(r, h, r))
    _m2.compose(_v.set(x, y0, z), _q, _s.set(1, 1, 1))
    _m2.multiply(_m)
    this.add(unit.cyl(o.segs ?? 12, ratio, o.open ?? false), _m2, color, o.surf, o.uv ?? null)
  }

  /** Cylinder (pipe) between two points. */
  tube(a: V3, b: V3, r: number, color: THREE.ColorRepresentation, segs = 8, surf?: Surf, rTopRatio = 1): void {
    _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const len = _d.length()
    if (len < 1e-4 || !(r > 0)) return
    _d.divideScalar(len)
    _q.setFromUnitVectors(_up, _d)
    _m.compose(_p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(r, len, r))
    this.add(unit.cyl(segs, rTopRatio, false), _m, color, surf)
  }

  sphere(x: number, y: number, z: number, r: number, color: THREE.ColorRepresentation, o: PrimOpts & { w?: number; h?: number; scale?: V3 } = {}): void {
    const sc = o.scale ?? [1, 1, 1]
    const rot = o.rot ?? [0, 0, 0]
    _e.set(rot[0], rot[1], rot[2], 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_p.set(x, y, z), _q, _s.set(r * sc[0], r * sc[1], r * sc[2]))
    this.add(unit.sphere(o.w ?? 12, o.h ?? 8), _m, color, o.surf)
  }

  hemi(x: number, y: number, z: number, r: number, color: THREE.ColorRepresentation, o: PrimOpts & { scale?: V3 } = {}): void {
    const sc = o.scale ?? [1, 1, 1]
    const rot = o.rot ?? [0, 0, 0]
    _e.set(rot[0], rot[1], rot[2], 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_p.set(x, y, z), _q, _s.set(r * sc[0], r * sc[1], r * sc[2]))
    this.add(unit.hemi(), _m, color, o.surf)
  }

  /** Torus of major radius R (in the XY plane by default; rot [PI/2,0,0] lays it flat). */
  torus(x: number, y: number, z: number, R: number, tube: number, color: THREE.ColorRepresentation, o: PrimOpts & { arc?: number; rs?: number; ts?: number } = {}): void {
    const rot = o.rot ?? [Math.PI / 2, 0, 0]
    _e.set(rot[0], rot[1], rot[2], 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_p.set(x, y, z), _q, _s.set(R, R, R))
    this.add(unit.torus(Math.round((tube / R) * 1000) / 1000, o.rs ?? 6, o.ts ?? 18, o.arc ?? Math.PI * 2), _m, color, o.surf)
  }

  /** A flat quad (decal) centred at a point, facing local +Z rotated by `rot`. */
  quad(cx: number, cy: number, cz: number, w: number, h: number, color: THREE.ColorRepresentation, uv: UvRect | null, o: PrimOpts = {}): void {
    const rot = o.rot ?? [0, 0, 0]
    _e.set(rot[0], rot[1], rot[2], 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_p.set(cx, cy, cz), _q, _s.set(w, h, 1))
    this.add(unit.plane(), _m, color, o.surf, uv)
  }

  /** A custom geometry placed with an optional local matrix. */
  geo(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, local?: THREE.Matrix4, surf?: Surf, uv: UvRect | null = null): void {
    this.add(g, local ?? new THREE.Matrix4(), color, surf, uv)
  }

  /** Number of parts (debug/tests). */
  get count(): number {
    return this.parts.length
  }

  /** Merge every part (optionally filtered by tag) into one geometry; null when empty. */
  build(filter?: (tag: number) => boolean): THREE.BufferGeometry | null {
    const parts = filter ? this.parts.filter((p) => filter(p.tag)) : this.parts
    if (!parts.length) return null
    let nv = 0
    let ni = 0
    for (const p of parts) {
      const pos = p.geo.getAttribute('position')
      nv += pos.count
      ni += p.geo.index ? p.geo.index.count : pos.count
    }
    const P = new Float32Array(nv * 3)
    const N = new Float32Array(nv * 3)
    const C = new Float32Array(nv * 3)
    const U = new Float32Array(nv * 2)
    const S = new Float32Array(nv * 4)
    const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni)
    let vo = 0
    let io = 0
    for (const p of parts) {
      const pos = p.geo.getAttribute('position')
      const nor = p.geo.getAttribute('normal')
      const uv = p.geo.getAttribute('uv')
      const m = p.matrix
      _nm.getNormalMatrix(m)
      const flip = m.determinant() < 0
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(m)
        P[(vo + i) * 3] = _v.x
        P[(vo + i) * 3 + 1] = _v.y
        P[(vo + i) * 3 + 2] = _v.z
        if (nor) _n.fromBufferAttribute(nor, i).applyMatrix3(_nm).normalize()
        else _n.set(0, 1, 0)
        N[(vo + i) * 3] = _n.x
        N[(vo + i) * 3 + 1] = _n.y
        N[(vo + i) * 3 + 2] = _n.z
        C[(vo + i) * 3] = p.color.r
        C[(vo + i) * 3 + 1] = p.color.g
        C[(vo + i) * 3 + 2] = p.color.b
        if (p.uv && uv) {
          U[(vo + i) * 2] = p.uv[0] + uv.getX(i) * (p.uv[2] - p.uv[0])
          U[(vo + i) * 2 + 1] = p.uv[1] + uv.getY(i) * (p.uv[3] - p.uv[1])
        } else {
          U[(vo + i) * 2] = WHITE_UV[0]
          U[(vo + i) * 2 + 1] = WHITE_UV[1]
        }
        S[(vo + i) * 4] = p.surf.rough
        S[(vo + i) * 4 + 1] = p.surf.metal
        S[(vo + i) * 4 + 2] = p.surf.emis
        S[(vo + i) * 4 + 3] = p.surf.chan
      }
      if (p.geo.index) {
        const idx = p.geo.index
        for (let k = 0; k < idx.count; k += 3) {
          const a = idx.getX(k) + vo
          const b = idx.getX(k + 1) + vo
          const c = idx.getX(k + 2) + vo
          I[io++] = a
          I[io++] = flip ? c : b
          I[io++] = flip ? b : c
        }
      } else {
        for (let k = 0; k < pos.count; k += 3) {
          I[io++] = vo + k
          I[io++] = vo + (flip ? k + 2 : k + 1)
          I[io++] = vo + (flip ? k + 1 : k + 2)
        }
      }
      vo += pos.count
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(P, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3))
    g.setAttribute('color', new THREE.BufferAttribute(C, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(U, 2))
    g.setAttribute('aSurf', new THREE.BufferAttribute(S, 4))
    g.setIndex(new THREE.BufferAttribute(I, 1))
    g.computeBoundingSphere()
    g.computeBoundingBox()
    return g
  }

  dispose(): void {
    for (const g of this.owned) g.dispose()
    this.owned.length = 0
  }
}

/** Triangle count of an indexed or non-indexed geometry. */
export function triangles(g: THREE.BufferGeometry | null | undefined): number {
  if (!g) return 0
  return g.index ? g.index.count / 3 : g.getAttribute('position').count / 3
}

// ---------------------------------------------------------------------------
// Shared material
// ---------------------------------------------------------------------------

/** Per-frame blink levels by channel (written by the module, read by the shader). */
export const blinkLevels = new Float32Array(8).fill(1)
const blinkUniform = { value: blinkLevels }

let atlasTexture: THREE.Texture | null = null
let material: THREE.MeshStandardMaterial | null = null

/** Bind the decal atlas used by the shared material (called once by atlas.ts). */
export function setAtlasTexture(t: THREE.Texture): void {
  atlasTexture = t
  if (material) {
    material.map = t
    material.needsUpdate = true
  }
}

/**
 * The module's shared surface material: vertex colors x atlas, per-vertex
 * roughness/metalness/emissive (+ blink channel), object-space paint wear
 * (triplanar), macro variation and ground occlusion. Created once, never
 * disposed (module lifetime), like world/materials.ts.
 */
export function rocketMaterial(): THREE.MeshStandardMaterial {
  if (material) return material
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, map: atlasTexture })
  m.name = 'rocket:surface'
  const wear = textures.paintWear()
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBlink = blinkUniform
    shader.uniforms.uWear = { value: wear }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aSurf;
varying vec4 vSurf;
varying vec3 vObj;
varying vec3 vObjN;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vSurf = aSurf;
vObj = transformed;
vObjN = normal;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uBlink[8];
uniform sampler2D uWear;
varying vec4 vSurf;
varying vec3 vObj;
varying vec3 vObjN;
float rkHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float rkNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(rkHash(i), rkHash(i + vec2(1.0, 0.0)), u.x), mix(rkHash(i + vec2(0.0, 1.0)), rkHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 an = abs(normalize(vObjN));
  an /= max(an.x + an.y + an.z, 1e-4);
  vec3 wp = vObj * 0.42;
  vec3 wx = texture2D(uWear, wp.zy).rgb;
  vec3 wy = texture2D(uWear, wp.xz).rgb;
  vec3 wz = texture2D(uWear, wp.xy).rgb;
  vec3 wear = wx * an.x + wy * an.y + wz * an.z;
  float glowing = step(0.01, vSurf.z);
  float aoOn = (1.0 - step(15.5, vSurf.w)) * (1.0 - glowing);
  diffuseColor.rgb *= mix(wear, vec3(1.0), glowing * 0.85);
  float macro = rkNoise(vObj.xz * 0.21 + vObj.y * 0.11) * 0.6 + rkNoise(vObj.xy * 0.9 + 7.1) * 0.4;
  diffuseColor.rgb *= 0.9 + 0.2 * macro;
  float streak = smoothstep(0.62, 0.95, rkNoise(vec2((vObj.x + vObj.z) * 2.3, vObj.y * 0.28)));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.72, 0.6, 0.5), streak * 0.35 * (1.0 - glowing));
  diffuseColor.rgb *= mix(1.0, mix(0.62, 1.0, smoothstep(0.0, 1.3, vObj.y + 0.15)), aoOn);
}`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vSurf.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSurf.y;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * vSurf.z * uBlink[int(mod(vSurf.w + 0.5, 16.0))];`,
      )
  }
  m.customProgramCacheKey = () => 'miw-rocket-surface-v1'
  material = m
  return m
}
