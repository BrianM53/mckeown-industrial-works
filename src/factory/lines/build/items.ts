/**
 * Item models for the belts, elevators, collector and monorail. Each kind is
 * one merged geometry rendered as an InstancedMesh. Local frame: origin at the
 * belt surface (bottom center), long axis along Z (direction of travel = -Z).
 * Payload pods hang from their trolley: origin at the rail underside, body
 * below (negative Y).
 */
import * as THREE from 'three'
import type { ItemKind } from '../config'
import { POD } from '../config'
import { buildGeometry, type GeoBatch } from './builder'
import { COL, st } from './parts'
import { valveWheel } from './pipe'

/** Height of the item's center above the belt (used for transit paths). */
export const ITEM_LIFT: Record<ItemKind, number> = {
  ingot: 0.08,
  sheet: 0.02,
  panel: 0.08,
  fin: 0.05,
  pipeStraight: 0.12,
  pipeElbow: 0.12,
  pipeValve: 0.12,
  pipeBundle: 0.2,
  boardBlank: 0.04,
  boardPopulated: 0.05,
  tankShell: 0.5,
  tankFuel: 0.5,
  podCapsule: 0,
  podCrate: 0,
}

function saddles(b: GeoBatch, r: number, zs: number[]): void {
  for (const z of zs) {
    b.box([0, 0.05, z], [r * 1.5, 0.1, 0.12], st.paint(COL.charcoal))
    for (const s of [-1, 1]) b.box([s * r * 0.55, 0.13, z], [0.12, 0.12, 0.12], st.paint(COL.charcoal))
  }
}

function chocks(b: GeoBatch, zs: number[]): void {
  for (const z of zs) b.box([0, 0.025, z], [0.34, 0.05, 0.1], st.rough(COL.wood))
}

function trolley(b: GeoBatch): void {
  const dark = st.paint(COL.charcoal, 0.5, 0.4)
  b.box([0, -0.07, 0], [0.24, 0.12, 0.44], st.paint(COL.hazard, 0.5, 0.25))
  for (const sx of [-1, 1]) {
    b.box([sx * 0.13, 0.02, 0], [0.03, 0.2, 0.4], dark)
    for (const z of [-0.14, 0.14]) b.cylAxis([sx * 0.09, 0.085, z], 'x', 0.05, 0.04, st.metal(COL.steel), 10)
  }
  b.cyl([0, -0.12, 0], [0, -0.42, 0], 0.03, st.metal(COL.steelLight), 6)
  b.torus([0, -0.46, 0], 0.07, 0.022, st.metal(COL.steelLight), 'z', Math.PI * 2, 5, 10)
}

const MAKERS: Record<ItemKind, (b: GeoBatch) => void> = {
  ingot: (b) => {
    b.rbox([0, 0.08, 0], [0.62, 0.16, 0.86], { color: '#ff8c3a', rough: 0.7, metal: 0.2, emis: 1.6 }, 0.04)
    b.box([0.12, 0.161, -0.1], [0.22, 0.01, 0.3], { color: '#7a3a1c', rough: 0.9, metal: 0.1, emis: 0.3 })
  },
  sheet: (b) => {
    b.box([0, 0.022, 0], [0.82, 0.04, 1.12], st.metal('#a1a9a8', 0.36, 0.8))
    b.box([0, 0.043, 0], [0.84, 0.004, 0.06], { color: '#ff7a2a', rough: 0.6, metal: 0.2, emis: 0.6 })
  },
  panel: (b) => {
    for (let i = 0; i < 3; i++) {
      const jx = [0.02, -0.025, 0.012][i]
      const jz = [-0.02, 0.025, 0.0][i]
      b.rbox([jx, 0.024 + i * 0.05, jz], [0.78, 0.04, 1.0], st.metal(i === 1 ? '#8f9897' : '#a5adac', 0.36, 0.8), 0.012)
      b.box([jx, 0.05 + i * 0.05, jz], [0.12, 0.016, 0.82], st.metal('#b9c0bf', 0.3, 0.85))
      for (const sz of [-1, 1]) b.box([jx + 0.26, 0.05 + i * 0.05, jz + sz * 0.38], [0.06, 0.014, 0.06], st.metal('#b9c0bf', 0.3, 0.85))
    }
    b.box([0, 0.004, 0], [0.5, 0.008, 0.9], st.paint(COL.rust))
  },
  fin: (b) => {
    for (let i = 0; i < 2; i++) {
      b.prism(
        [
          [-0.42, -0.45],
          [0.42, -0.45],
          [-0.32, 0.5],
        ],
        0.04,
        [i * 0.04, 0.025 + i * 0.05, i * -0.05],
        st.paint(i ? '#b55a3c' : '#a24e34', 0.6, 0.35),
        [-Math.PI / 2, 0, 0],
      )
    }
    b.box([-0.25, 0.11, 0.0], [0.05, 0.012, 0.7], st.metal(COL.steelLight))
  },
  pipeStraight: (b) => {
    chocks(b, [-0.38, 0.38])
    b.cylAxis([0, 0.13, 0], 'z', 0.1, 1.25, st.metal(COL.copper, 0.32, 0.85), 14)
    for (const z of [-0.61, 0.61]) b.cylAxis([0, 0.13, z], 'z', 0.13, 0.05, st.metal(COL.steel), 14)
  },
  pipeElbow: (b) => {
    chocks(b, [-0.2, 0.35])
    const cop = st.metal(COL.copper, 0.32, 0.85)
    b.cylAxis([-0.15, 0.13, 0.22], 'z', 0.1, 0.7, cop, 14)
    b.torus([0.15, 0.13, -0.13], 0.3, 0.1, cop, 'y', Math.PI / 2, 8, 10, Math.PI / 2)
    b.cylAxis([0.32, 0.13, -0.43], 'x', 0.1, 0.36, cop, 14)
    b.cylAxis([-0.15, 0.13, 0.58], 'z', 0.13, 0.05, st.metal(COL.steel), 14)
  },
  pipeValve: (b) => {
    MAKERS.pipeElbow(b)
    b.cylAxis([0.52, 0.13, -0.43], 'x', 0.14, 0.12, st.metal(COL.brass, 0.3, 0.85), 12)
    b.cylY(0.52, 0.2, -0.43, 0.035, 0.18, st.metal(COL.steel), 8)
    valveWheel(b, [0.52, 0.4, -0.43], 0.13, 'y')
  },
  pipeBundle: (b) => {
    chocks(b, [-0.35, 0.35])
    const cop = st.metal(COL.copper, 0.32, 0.85)
    const galv = st.metal(COL.steelLight, 0.36, 0.8)
    b.cylAxis([-0.11, 0.15, 0.03], 'z', 0.1, 1.15, galv, 12)
    b.cylAxis([0.11, 0.15, 0.03], 'z', 0.1, 1.15, cop, 12)
    b.cylAxis([0, 0.33, 0.03], 'z', 0.1, 1.15, galv, 12)
    for (const z of [-0.28, 0.32]) b.torus([0, 0.21, z], 0.23, 0.018, st.paint(COL.hazard), 'z', Math.PI * 2, 4, 14)
    b.cylAxis([0, 0.33, -0.6], 'z', 0.12, 0.1, st.metal(COL.brass, 0.3, 0.85), 12)
    valveWheel(b, [0, 0.33, -0.7], 0.15, 'z')
  },
  boardBlank: (b) => {
    b.box([0, 0.015, 0], [0.76, 0.03, 0.56], st.paint('#2e3436'))
    b.box([0, 0.042, 0], [0.7, 0.024, 0.5], st.paint(COL.pcb, 0.45, 0.1))
    b.box([0.33, 0.055, 0], [0.03, 0.004, 0.36], st.metal(COL.gold, 0.3, 0.9))
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cylY(sx * 0.3, 0.054, sz * 0.2, 0.018, 0.004, st.metal(COL.gold, 0.3, 0.9), 8)
    for (let i = 0; i < 5; i++) b.box([-0.2 + i * 0.08, 0.0545, 0.05], [0.006, 0.002, 0.3], st.paint('#3f9a5e', 0.4, 0.1))
  },
  boardPopulated: (b) => {
    MAKERS.boardBlank(b)
    const chip = st.paint('#141718', 0.4, 0.2)
    b.box([-0.05, 0.07, 0], [0.17, 0.03, 0.17], chip)
    b.box([-0.05, 0.087, 0], [0.11, 0.006, 0.11], st.metal(COL.chrome, 0.25, 0.9))
    for (let i = 0; i < 6; i++) b.box([0.14 + (i % 2) * 0.1, 0.065, -0.17 + Math.floor(i / 2) * 0.17], [0.07, 0.02, 0.1], chip)
    for (let i = 0; i < 4; i++) b.cylY(-0.26, 0.054, -0.18 + i * 0.12, 0.025, 0.07, st.paint(i % 2 ? '#2f5f9a' : '#20262a', 0.4, 0.3), 8)
    b.box([-0.33, 0.07, 0.15], [0.04, 0.03, 0.14], st.paint(COL.cream))
    b.box([0.02, 0.064, 0.21], [0.03, 0.02, 0.03], { color: '#5dff7a', rough: 0.4, metal: 0, emis: 2.2 })
  },
  tankShell: (b) => {
    saddles(b, 0.45, [-0.4, 0.4])
    b.cylAxis([0, 0.52, 0], 'z', 0.43, 1.25, st.metal('#9da6a5', 0.36, 0.8), 22)
    b.box([0, 0.952, 0], [0.04, 0.012, 1.24], st.paint(COL.charcoal))
    for (const z of [-0.626, 0.626]) b.cylAxis([0, 0.52, z], 'z', 0.36, 0.005, st.paint('#2a3031'), 18)
  },
  tankFuel: (b) => {
    saddles(b, 0.45, [-0.38, 0.38])
    const orange = st.paint(COL.tankOrange, 0.45, 0.3)
    b.cylAxis([0, 0.52, 0], 'z', 0.45, 1.05, orange, 22)
    for (const z of [-0.525, 0.525]) b.sphere([0, 0.52, z], 0.45, orange, 18, 10, [1, 1, 0.5])
    b.cylAxis([0, 0.52, 0.18], 'z', 0.455, 0.12, st.paint(COL.cream, 0.6, 0.1), 22)
    b.cylAxis([0, 0.52, -0.22], 'z', 0.455, 0.05, st.paint(COL.charcoal, 0.6, 0.2), 22)
    b.cylY(0.12, 0.92, -0.3, 0.05, 0.1, st.metal(COL.steel), 8)
    b.cylY(0.12, 1.02, -0.3, 0.06, 0.04, st.paint(COL.red), 8)
  },
  podCapsule: (b) => {
    trolley(b)
    const y = -POD.hang
    const body = st.paint(COL.cream, 0.5, 0.15)
    b.cylY(0, y - 0.35, 0, POD.radius, 0.7, body, 18)
    b.sphere([0, y + 0.35, 0], POD.radius, body, 18, 8, [1, 0.45, 1])
    b.sphere([0, y - 0.35, 0], POD.radius, st.paint(COL.charcoal, 0.6, 0.3), 18, 8, [1, 0.35, 1])
    b.cylY(0, y - 0.05, 0, POD.radius + 0.012, 0.16, st.paint(COL.hazard, 0.5, 0.2), 18)
    for (const sx of [-1, 1]) {
      b.cylAxis([sx * (POD.radius - 0.01), y + 0.15, 0], 'x', 0.11, 0.05, st.paint(COL.charcoal), 12)
      b.cylAxis([sx * (POD.radius + 0.012), y + 0.15, 0], 'x', 0.08, 0.02, { color: '#3f86b8', rough: 0.15, metal: 0.4, emis: 0.35 }, 12)
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5
      b.box([Math.cos(a) * (POD.radius + 0.06), y - 0.48, Math.sin(a) * (POD.radius + 0.06)], [0.03, 0.22, 0.14], st.paint(COL.red), [0, -a, 0])
    }
    b.cyl([0, y + 0.48, 0], [0, -0.46, 0], 0.025, st.metal(COL.steelLight), 6)
  },
  podCrate: (b) => {
    trolley(b)
    const y = -POD.hang - 0.05
    const wood = st.rough(COL.wood)
    b.rbox([0, y, 0], [0.8, 0.72, 0.8], wood, 0.03)
    for (const yy of [y - 0.22, y + 0.22]) b.box([0, yy, 0], [0.82, 0.06, 0.82], st.rough('#8a5f38'))
    for (const sx of [-1, 1]) b.box([sx * 0.41, y, 0], [0.01, 0.16, 0.5], st.paint(COL.red))
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl([sx * 0.36, y + 0.36, sz * 0.36], [0, -0.48, 0], 0.012, st.metal(COL.steelLight), 4)
  },
}

/** Build every item geometry (call once per module instance; dispose with the module). */
export function buildItemGeometries(): Record<ItemKind, THREE.BufferGeometry> {
  const out = {} as Record<ItemKind, THREE.BufferGeometry>
  for (const kind of Object.keys(MAKERS) as ItemKind[]) out[kind] = buildGeometry(MAKERS[kind], 0.6)
  return out
}
