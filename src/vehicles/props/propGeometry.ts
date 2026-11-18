import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { GeoBuilder, lin } from '../lib/GeoBuilder'
import type { PropKind } from './propData'

/**
 * Prop meshes: one merged, vertex-colored geometry per kind (bottom centre at
 * the origin, front = -Z), shared by an instanced mesh per kind. Built once.
 */

const KRAFT = lin('#B88A55')
const KRAFT_LIGHT = lin('#C99D66')
const TAPE = lin('#D7B57C')
const INK = lin('#4A3320')
const LABEL = lin('#E9E4D6')
const WOOD = lin('#A8784A')
const WOOD_DARK = lin('#6E4B2E')
const WOOD_PALE = lin('#BF9663')
const CONE = lin('#EC6A22')
const REFLECT = lin('#F1F0EA')
const RUBBER = lin('#1E2122')
const DRUM = lin('#2F6EA5')
const DRUM_DARK = lin('#265B88')
const STENCIL = lin('#E9B63F')

function rounded(b: GeoBuilder, size: [number, number, number], center: [number, number, number], color: THREE.Color, r: number) {
  const g = new RoundedBoxGeometry(size[0], size[1], size[2], 1, r)
  b.add(g, color, center)
  g.dispose()
}

function cardboard(w: number, h: number, d: number, body: THREE.Color): THREE.BufferGeometry {
  const b = new GeoBuilder()
  rounded(b, [w, h, d], [0, h / 2, 0], body, 0.012)
  // packing tape over the top seam and down both ends
  b.box([0, h + 0.002, 0], [w + 0.006, 0.004, 0.085], TAPE)
  for (const s of [-1, 1]) b.box([s * (w / 2 + 0.002), h - 0.065, 0], [0.004, 0.13, 0.085], TAPE)
  // "THIS SIDE UP" arrows + shipping label (front and back)
  for (const s of [-1, 1]) {
    const z = s * (d / 2 + 0.002)
    b.box([-w * 0.22, h * 0.62, z], [0.03, 0.12, 0.003], INK)
    b.box([-w * 0.22 - 0.035, h * 0.72, z], [0.03, 0.03, 0.003], INK, [0, 0, Math.PI / 4])
    b.box([-w * 0.22 + 0.035, h * 0.72, z], [0.03, 0.03, 0.003], INK, [0, 0, -Math.PI / 4])
    b.box([w * 0.18, h * 0.45, z], [w * 0.28, h * 0.3, 0.003], LABEL)
    b.box([w * 0.18, h * 0.5, z + s * 0.001], [w * 0.2, 0.012, 0.003], INK)
    b.box([w * 0.18, h * 0.42, z + s * 0.001], [w * 0.14, 0.012, 0.003], INK)
  }
  return b.build()
}

function crate(): THREE.BufferGeometry {
  const b = new GeoBuilder()
  const s = 0.8
  const t = 0.075
  b.box([0, s / 2, 0], [s - 0.03, s - 0.03, s - 0.03], WOOD_DARK)
  // frame edges
  const h = s / 2
  for (const x of [-1, 1])
    for (const z of [-1, 1]) {
      b.box([x * (h - t / 2), h, z * (h - t / 2)], [t, s, t], WOOD)
    }
  for (const y of [t / 2, s - t / 2]) {
    for (const z of [-1, 1]) b.box([0, y, z * (h - t / 2)], [s, t, t], WOOD)
    for (const x of [-1, 1]) b.box([x * (h - t / 2), y, 0], [t, t, s], WOOD)
  }
  // planks on each side + diagonal braces
  for (const side of [0, 1, 2, 3]) {
    const yaw = (side * Math.PI) / 2
    const nx = Math.sin(yaw)
    const nz = Math.cos(yaw)
    for (const y of [0.27, 0.53]) b.box([nx * (h - 0.006), y, nz * (h - 0.006)], side % 2 ? [0.012, 0.13, s - 2 * t] : [s - 2 * t, 0.13, 0.012], WOOD_PALE)
    const len = Math.hypot(s - 2 * t, s - 2 * t) * 0.98
    b.box([nx * (h - 0.012), h, nz * (h - 0.012)], [0.08, len, 0.014], WOOD, [0, yaw, Math.PI / 4])
  }
  // top boards + a stencilled mark
  for (const x of [-0.24, 0, 0.24]) b.box([x, s + 0.004, 0], [0.2, 0.01, s - 0.02], WOOD_PALE)
  b.box([0, s * 0.5, -(h + 0.016)], [0.22, 0.08, 0.004], STENCIL)
  return b.build()
}

function cone(): THREE.BufferGeometry {
  const b = new GeoBuilder()
  rounded(b, [0.42, 0.05, 0.42], [0, 0.025, 0], RUBBER, 0.015)
  b.add(new THREE.CylinderGeometry(0.03, 0.17, 0.64, 12), CONE, [0, 0.05 + 0.32, 0])
  b.add(new THREE.CylinderGeometry(0.098, 0.122, 0.11, 12, 1, true), REFLECT, [0, 0.4, 0])
  b.add(new THREE.CylinderGeometry(0.066, 0.083, 0.06, 12, 1, true), REFLECT, [0, 0.55, 0])
  b.add(new THREE.CylinderGeometry(0.034, 0.034, 0.012, 10), CONE, [0, 0.695, 0])
  return b.build()
}

function barrel(): THREE.BufferGeometry {
  const b = new GeoBuilder()
  b.add(new THREE.CylinderGeometry(0.275, 0.275, 0.86, 16), DRUM, [0, 0.43, 0])
  // rolling hoops: open bands (their caps were hidden inside the drum anyway)
  for (const y of [0.3, 0.6]) b.add(new THREE.CylinderGeometry(0.29, 0.29, 0.035, 16, 1, true), DRUM_DARK, [0, y, 0])
  b.add(new THREE.CylinderGeometry(0.285, 0.285, 0.03, 16), DRUM_DARK, [0, 0.865, 0])
  b.add(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 8), DRUM_DARK, [0.15, 0.885, 0.05])
  b.add(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 8), DRUM_DARK, [-0.16, 0.885, -0.04])
  // a curved-ish label patch (two facets)
  for (const a of [-0.22, 0.22]) b.box([Math.sin(a) * 0.278, 0.46, -Math.cos(a) * 0.278], [0.13, 0.18, 0.004], LABEL, [0, -a, 0])
  b.box([0, 0.5, -0.282], [0.16, 0.02, 0.004], INK)
  return b.build()
}

function pallet(): THREE.BufferGeometry {
  const b = new GeoBuilder()
  const tones = [WOOD_PALE, WOOD, lin('#B48857'), WOOD_PALE, lin('#9E7246')]
  // bottom boards
  for (const [i, z] of [-0.44, 0, 0.44].entries()) b.box([0, 0.011, z], [1.2, 0.022, 0.12], tones[(i + 2) % tones.length])
  // blocks / stringers
  for (const x of [-0.55, 0, 0.55]) for (const z of [-0.44, 0, 0.44]) b.box([x, 0.07, z], [0.1, 0.096, 0.12], WOOD_DARK)
  for (const x of [-0.55, 0, 0.55]) b.box([x, 0.13 - 0.011, 0], [0.1, 0.02, 1.0], WOOD)
  // top deck
  for (const [i, z] of [-0.44, -0.22, 0, 0.22, 0.44].entries()) b.box([0, 0.13, z], [1.2, 0.02, 0.11], tones[i])
  return b.build()
}

let cache: Record<PropKind, THREE.BufferGeometry> | null = null
let material: THREE.MeshStandardMaterial | null = null

export function propGeometry(kind: PropKind): THREE.BufferGeometry {
  if (!cache)
    cache = {
      box: cardboard(0.62, 0.44, 0.5, KRAFT),
      boxSmall: cardboard(0.44, 0.34, 0.4, KRAFT_LIGHT),
      crate: crate(),
      cone: cone(),
      barrel: barrel(),
      pallet: pallet(),
    }
  return cache[kind]
}

export function propMaterial(): THREE.MeshStandardMaterial {
  if (!material) material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02, name: 'vehicles:props' })
  return material
}
