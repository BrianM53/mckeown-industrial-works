/**
 * LINE 1 — Smelting & Sheet Stamping (x = -9, beside the main aisle).
 * South → north: ore skip hoist + hopper, smelter furnace (glowing mouth facing
 * the aisle, molten pour, tall smokestack), rolling mill, hydraulic stamping
 * press (ram hits bottom exactly at phase 0.5 → dust puff), QC camera, elevator.
 */
import { BELT, SMELT } from '../config'
import { lineU, phaseCrossed, pourFlow, pressRam, skipHoist } from '../logic'
import { CH, FX } from '../render/materials'
import { LAMP } from '../render/lamps'
import type { V3 } from './builder'
import { Emitter, Jitter, type Animator, type Frame, type Kit } from './kit'
import { boltRing, cabinet, COL, elevator, groundBelt, ladder, pipeRun, setStackLight, signBoard, st, stackLight } from './parts'

export function buildSmelt(k: Kit): Animator {
  const b = k.west
  const S = k.skin
  const rig = k.rig
  const X = SMELT.x
  const top = BELT.top
  const beltId = groundBelt(k, b, 'smelt')
  const liftId = elevator(k, b, 'smelt')

  // ---------------------------------------------------------------- hopper + skip
  const H = SMELT.hopper
  const hz = (H.z0 + H.z1) / 2 - 0.05
  const iron = st.paint(COL.iron, 0.7, 0.35)
  const rust = st.paint(COL.rust, 0.85, 0.3)
  for (const sx of [-1, 1])
    for (const z of [H.z0 + 0.25, H.z1 - 0.25]) {
      b.box([X + sx * 0.95, 1.75, z], [0.16, 3.5, 0.16], iron)
      b.box([X + sx * 0.95, 0.03, z], [0.3, 0.06, 0.3], st.paint(COL.charcoal))
    }
  for (const y of [1.2, 2.6]) {
    for (const sx of [-1, 1]) b.box([X + sx * 0.95, y, hz], [0.08, 0.08, H.z1 - H.z0 - 0.4], iron)
    b.box([X, y, H.z1 - 0.25], [1.9, 0.08, 0.08], iron)
  }
  // inverted pyramid body (4-sided lathe) + rim + ore heap
  b.lathe(
    [
      [0.38, 2.9],
      [0.5, 3.15],
      [1.46, 4.55],
      [1.46, 5.0],
    ],
    [X, 0, hz],
    rust,
    4,
    [0, Math.PI / 4, 0],
  )
  b.rbox([X, 5.02, hz], [2.18, 0.12, 2.18], st.paint(COL.charcoal), 0.03)
  b.sphere([X, 4.95, hz], 0.95, st.rough('#3b322c'), 10, 6, [1, 0.32, 1])
  if (k.detail) {
    const j = new Jitter(41)
    for (let i = 0; i < 10; i++) b.sphere([X + j.sym() * 0.7, 5.02 + j.next() * 0.12, hz + j.sym() * 0.7], 0.08 + j.next() * 0.08, st.rough(i % 3 ? '#4a3e35' : '#6b5643'), 6, 4)
  }
  // charging chute into the furnace
  b.box([X, 2.72, H.z0 - 0.15], [0.6, 0.36, 1.0], iron, [0.45, 0, 0])
  // skip hoist track on the south face
  const trackZ = SMELT.skipZ + 0.08
  for (const sx of [-1, 1]) b.box([X + sx * 0.36, 2.85, trackZ], [0.1, 5.7, 0.12], st.paint(COL.hazard, 0.55, 0.3))
  b.box([X, 5.66, trackZ], [0.9, 0.14, 0.16], iron)
  b.cylAxis([X, 5.82, trackZ - 0.05], 'x', 0.2, 0.12, st.metal(COL.steel), 16)
  b.cyl([X, 5.82, trackZ - 0.05], [X, 0.8, trackZ + 0.02], 0.012, st.metal(COL.steelLight), 4)
  const skip = rig.add('smelt:skip', 0, [X, 0.35, SMELT.skipZ], 0)
  const skipTip = rig.add('smelt:skipTip', skip, [X, 0.62, SMELT.skipZ - 0.24], 0)
  S.bone(skip, () => {
    S.box([X, 0.35, SMELT.skipZ + 0.1], [0.62, 0.08, 0.1], iron)
    for (const sx of [-1, 1]) S.box([X + sx * 0.3, 0.35, SMELT.skipZ + 0.1], [0.06, 0.26, 0.12], st.metal(COL.steel))
  })
  S.bone(skipTip, () => {
    S.rbox([X, 0.62, SMELT.skipZ], [0.58, 0.46, 0.5], st.paint(COL.safety, 0.6, 0.25), 0.03)
    S.box([X, 0.86, SMELT.skipZ], [0.5, 0.04, 0.42], st.rough('#3b322c'))
    S.sphere([X, 0.86, SMELT.skipZ], 0.2, st.rough('#4a3e35'), 8, 5, [1.2, 0.45, 1])
  })

  // ---------------------------------------------------------------- furnace
  const F = SMELT.furnace
  const fz = F.zc
  const plinth = st.paint('#3a3f40', 0.8, 0.2)
  // plinth with a belt tunnel through it
  b.rbox([X - 1.22, 0.8, fz], [1.06, 1.6, F.z1 - F.z0], plinth, 0.05)
  b.rbox([X + 1.22, 0.8, fz], [1.06, 1.6, F.z1 - F.z0], plinth, 0.05)
  b.box([X, 1.5, fz], [3.5, 0.2, F.z1 - F.z0], plinth)
  b.box([X, 1.38, fz], [1.4, 0.04, F.z1 - F.z0 - 0.02], st.glow(COL.molten, 0.5, CH.FURNACE))
  // shell + bands + ribs
  b.cylY(X, 1.6, fz, F.r, 3.0, st.paint('#4b3a31', 0.75, 0.4), 28)
  for (const y of [1.75, 2.9, 3.95, 4.5]) b.torus([X, y, fz], F.r + 0.02, 0.05, st.metal(COL.steel, 0.45, 0.7), 'y', Math.PI * 2, 6, 32)
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.13
    b.box([X + Math.cos(a) * (F.r + 0.03), 3.1, fz + Math.sin(a) * (F.r + 0.03)], [0.08, 2.9, 0.08], st.paint(COL.iron), [0, -a, 0])
  }
  // cone roof + collar
  b.lathe(
    [
      [F.r + 0.08, 4.6],
      [F.r + 0.08, 4.72],
      [0.82, 5.55],
      [0.82, 5.75],
    ],
    [X, 0, fz],
    st.paint('#4b3a31', 0.75, 0.4),
    24,
  )
  b.torus([X, 4.66, fz], F.r + 0.1, 0.07, st.metal(COL.steel), 'y', Math.PI * 2, 6, 32)
  // smokestack
  const SK = SMELT.stack
  b.cylY(SK.x, 4.95, SK.z, SK.r + 0.08, 0.6, st.paint(COL.iron), 16)
  b.cylY(SK.x, 5.5, SK.z, SK.r, SK.top - 5.5 - 0.5, st.paint('#5a4a40', 0.85, 0.35), 18, SK.r * 0.85)
  for (const y of [7.5, 10.0, 12.5]) b.torus([SK.x, y, SK.z], SK.r * (1 - ((y - 5.5) / (SK.top - 5.5)) * 0.15) + 0.03, 0.05, st.metal(COL.steel), 'y', Math.PI * 2, 6, 20)
  b.cylY(SK.x, SK.top - 0.5, SK.z, SK.r * 0.95, 0.5, st.paint(COL.red, 0.7, 0.2), 18)
  b.cylY(SK.x, SK.top - 0.5, SK.z, SK.r * 0.97, 0.12, st.paint(COL.cream, 0.7, 0.1), 18)
  b.cylY(SK.x, SK.top, SK.z, SK.r * 0.62, 0.02, st.paint(COL.black, 1, 0), 14)
  if (k.detail) ladder(b, SK.x + SK.r + 0.12, SK.z, 5.6, SK.top - 0.6, 'z', st.metal(COL.steel))
  // mouth on the east face (toward the main aisle)
  const mx = X + F.r - 0.02
  const mz = fz
  b.box([mx + 0.01, 2.32, mz], [0.1, 1.42, 1.42], st.paint('#2a2523', 0.9, 0.3))
  b.box([mx + 0.08, 2.3, mz], [0.04, 1.08, 1.14], st.glow(COL.furnace, 3.2, CH.FURNACE))
  for (const s of [-1, 1]) b.box([mx + 0.17, 2.32, mz + s * 0.64], [0.2, 1.42, 0.16], st.rough(COL.brickDark))
  b.box([mx + 0.17, 3.0, mz], [0.2, 0.18, 1.44], st.rough(COL.brickDark))
  b.box([mx + 0.17, 1.66, mz], [0.2, 0.14, 1.44], st.rough(COL.brickDark))
  b.box([mx + 0.12, 1.79, mz], [0.06, 0.08, 1.1], st.glow(COL.molten, 2.2, CH.FURNACE))
  // hood over the mouth
  b.box([mx + 0.42, 3.32, mz], [0.6, 0.12, 1.8], iron, [0, 0, -0.35])
  b.box([mx + 0.3, 3.12, mz], [0.12, 0.4, 1.7], iron)
  // peep ports
  for (const a of [0.9, 2.2, 3.6, 4.6]) {
    const px = X + Math.cos(a) * (F.r + 0.02)
    const pz = fz + Math.sin(a) * (F.r + 0.02)
    b.cylAxis([px, 3.45, pz], Math.abs(Math.cos(a)) > 0.7 ? 'x' : 'z', 0.12, 0.12, st.metal(COL.steel), 10)
    b.sphere([px + Math.cos(a) * 0.05, 3.45, pz + Math.sin(a) * 0.05], 0.07, st.glow(COL.furnace, 2.4, CH.FURNACE), 8, 6)
  }
  // cooling water: bustle ring + risers
  b.torus([X, 4.35, fz], F.r + 0.28, 0.07, st.paint(COL.blue, 0.5, 0.4), 'y', Math.PI * 2, 6, 28)
  for (const a of [0.6, 2.4, 4.2]) {
    const px = X + Math.cos(a) * (F.r + 0.28)
    const pz = fz + Math.sin(a) * (F.r + 0.28)
    b.cyl([px, 1.6, pz], [px, 4.35, pz], 0.06, st.paint(COL.blue, 0.5, 0.4), 8)
  }
  // tap spout (north face) + glowing trough
  const spoutZ0 = F.z0 + 0.1
  const sy = 2.42
  b.box([X, sy, spoutZ0 - 0.25], [0.42, 0.18, 0.7], st.paint(COL.iron), [0.18, 0, 0])
  b.box([X, sy + 0.06, spoutZ0 - 0.25], [0.24, 0.05, 0.66], st.glow(COL.molten, 2.6, CH.POUR), [0.18, 0, 0])
  const pourTop = sy - 0.05
  const pour = rig.add('smelt:pour', 0, [X, pourTop, SMELT.pourZ], 0)
  S.bone(pour, () => {
    S.cyl([X, pourTop, SMELT.pourZ], [X, top + 0.08, SMELT.pourZ], 0.075, st.glow('#ffb347', 4, CH.POUR), 10, 0.055)
  })
  k.fx.bone(0, () => {
    k.fx.quad([X, top + 0.25, SMELT.pourZ], 0.9, 0.7, Math.PI / 2, { color: '#ff9b3d', chan: FX.POUR }, undefined, 0)
    k.fx.quad([X, top + 0.25, SMELT.pourZ], 0.9, 0.7, 0, { color: '#ff9b3d', chan: FX.POUR }, undefined, 0)
    k.fx.quad([mx + 0.5, 2.3, mz], 2.4, 2.0, -Math.PI / 2, { color: '#ff8a3a', chan: FX.FURNACE })
  })
  // furnace warning sign facing the aisle, and the line name board above the mouth
  signBoard(k, b, 'warn:hot', [X + 1.8, 1.0, F.z1 - 0.6], 0.8, -Math.PI / 2)
  b.box([X + F.r + 0.06, 4.15, fz], [0.08, 0.5, 2.0], iron)
  signBoard(k, b, 'line:smelt', [X + F.r + 0.12, 4.15, fz], 2.3, -Math.PI / 2)

  // ---------------------------------------------------------------- rolling mill
  const M = SMELT.mill
  const housing = st.paint(COL.gunmetal, 0.55, 0.4)
  for (const sx of [-1, 1]) {
    b.rbox([X + sx * 0.98, 1.2, M.zc], [0.36, 2.4, 1.3], housing, 0.05)
    b.box([X + sx * 0.98, 0.04, M.zc], [0.6, 0.08, 1.5], st.paint(COL.charcoal))
  }
  b.rbox([X, 2.48, M.zc], [2.4, 0.3, 1.1], housing, 0.05)
  for (const sx of [-1, 1]) {
    b.cylY(X + sx * 0.98, 2.63, M.zc, 0.08, 0.35, st.metal(COL.chrome), 8)
    b.torus([X + sx * 0.98, 2.98, M.zc], 0.22, 0.03, st.paint(COL.red), 'y', Math.PI * 2, 5, 16)
  }
  // drive motor (west) + coupling
  b.rbox([X - 1.62, 0.55, M.zc], [0.6, 0.8, 0.9], st.paint(COL.navy, 0.5, 0.3), 0.05)
  b.cylAxis([X - 1.25, 0.6, M.zc], 'x', 0.1, 0.35, st.metal(COL.steel), 10)
  const rollTop = rig.add('smelt:rollTop', 0, [X, top + 0.47, M.zc], 0)
  const rollBot = rig.add('smelt:rollBot', 0, [X, top - 0.3, M.zc], 0)
  for (const [bone, y, r] of [
    [rollTop, top + 0.47, 0.3],
    [rollBot, top - 0.3, 0.3],
  ] as const) {
    S.bone(bone, () => {
      S.cylAxis([X, y, M.zc], 'x', r, 1.62, st.metal('#8e9897', 0.3, 0.85), 20)
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2
        S.box([X, y + Math.sin(a) * r, M.zc + Math.cos(a) * r], [1.5, 0.03, 0.05], st.paint(COL.charcoal), [a, 0, 0])
      }
      // drive gear on the east end
      S.cylAxis([X + 1.28, y, M.zc], 'x', r * 1.15, 0.12, st.paint(COL.hazard, 0.5, 0.3), 16)
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2
        S.box([X + 1.28, y + Math.sin(a) * r * 1.2, M.zc + Math.cos(a) * r * 1.2], [0.12, 0.1, 0.1], st.paint(COL.hazard, 0.5, 0.3), [a, 0, 0])
      }
      S.cylAxis([X + 1.28, y, M.zc], 'x', 0.08, 0.18, st.metal(COL.chrome), 8)
    })
  }

  // ---------------------------------------------------------------- stamping press
  const P = SMELT.press
  const orange = st.paint(COL.safety, 0.55, 0.25)
  const pz = P.zc
  b.rbox([X, 0.42, pz], [2.9, 0.84, 1.9], st.paint(COL.iron), 0.05)
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      b.rbox([X + sx * 1.28, 2.35, pz + sz * 0.72], [0.42, 4.7, 0.42], orange, 0.05)
      b.box([X + sx * 1.04, 2.4, pz + sz * 0.72], [0.06, 3.0, 0.16], st.metal(COL.chrome))
    }
  for (const sx of [-1, 1]) b.box([X + sx * 1.28, 1.0, pz], [0.3, 0.3, 1.1], orange)
  b.rbox([X, 5.2, pz], [3.1, 1.2, 2.0], orange, 0.08)
  b.box([X, 4.58, pz], [2.7, 0.08, 1.7], st.paint(COL.charcoal))
  b.box([X + 1.56, 5.2, pz], [0.02, 0.5, 1.2], st.paint(COL.charcoal))
  for (const sx of [-1, 1]) {
    b.cylY(X + sx * 0.55, 5.8, pz, 0.3, 0.85, st.paint(COL.gunmetal, 0.45, 0.5), 16)
    b.cylY(X + sx * 0.55, 6.62, pz, 0.34, 0.1, st.paint(COL.charcoal), 16)
    if (k.detail) pipeRun(b, [[X + sx * 0.55 + 0.25, 6.4, pz + 0.2], [X + sx * 0.55 + 0.45, 6.4, pz + 0.6], [X + sx * 0.6 + 0.45, 5.85, pz + 0.95]], 0.04, st.rubber, 6)
  }
  const ram = rig.add('smelt:ram', 0, [X, P.ramRestBottom, pz], 0)
  S.bone(ram, () => {
    const y0 = P.ramRestBottom
    S.rbox([X, y0 + 0.42, pz], [1.95, 0.72, 1.45], st.paint(COL.charcoal, 0.55, 0.45), 0.05)
    S.box([X, y0 + 0.05, pz], [1.7, 0.1, 1.25], st.metal(COL.steel, 0.35, 0.8))
    for (let i = -2; i <= 2; i++) S.box([X + i * 0.3, y0 + 0.0, pz], [0.08, 0.05, 1.1], st.metal(COL.steelLight))
    for (const sx of [-1, 1]) S.cyl([X + sx * 0.55, y0 + 0.75, pz], [X + sx * 0.55, 6.55, pz], 0.1, st.metal(COL.chrome, 0.2, 0.9), 12)
    S.box([X + 0.99, y0 + 0.42, pz], [0.03, 0.2, 1.1], st.paint(COL.hazard))
  })
  // light curtains (east front) + warning sign
  for (const sz of [-1, 1]) {
    const cz = pz + sz * 1.0
    b.box([X + 1.7, 1.0, cz], [0.1, 2.0, 0.1], st.paint(COL.hazard))
    b.box([X + 1.64, 1.05, cz], [0.02, 1.7, 0.03], st.glow('#ff3a2a', 1.6, CH.POWER))
  }
  signBoard(k, b, 'warn:press', [X + 1.52, 3.3, pz], 0.82, -Math.PI / 2)
  const pressLight = stackLight(k, b, X + 1.2, 5.84, pz - 0.75)
  cabinet(k, b, X - 1.75, pz + 1.35, Math.PI / 2, 0.5, 1.4, 0.4, COL.gunmetal)

  // ---------------------------------------------------------------- QC camera gantry
  const qz = SMELT.qcZ
  for (const sx of [-1, 1]) b.box([X + sx * 0.85, 1.1, qz], [0.08, 2.2, 0.08], st.paint(COL.gunmetal))
  b.box([X, 2.2, qz], [1.8, 0.1, 0.12], st.paint(COL.gunmetal))
  b.rbox([X, 1.98, qz], [0.32, 0.26, 0.26], st.paint(COL.charcoal), 0.03)
  b.cylY(X, 1.78, qz, 0.07, 0.08, st.glow('#7fd8ff', 1.2, CH.POWER), 10)
  const qcLamp = k.lamps.add([X + 0.55, 2.25, qz], [0, 1, 0], 0.08, 0.1)

  // ---------------------------------------------------------------- header board (south)
  for (const sx of [-1, 1]) b.box([X + sx * 1.05, 5.55, H.z1 - 0.2], [0.08, 1.2, 0.08], iron)
  signBoard(k, b, 'line:smelt', [X, 5.95, H.z1 - 0.12], 2.6, Math.PI)
  cabinet(k, b, X - 1.55, H.z0 + 0.6, -Math.PI / 2, 0.45, 1.3, 0.4, COL.gunmetal)
  if (k.detail) boltRing(b, [X, 1.6, fz], F.r - 0.05, 18, 'y', st.metal(COL.steel), 0.03, 0.04)

  // ---------------------------------------------------------------- animation
  const smoke = new Emitter()
  const embers = new Emitter()
  const jit = new Jitter(1777)
  let prevPhase = Number.NaN
  const ramTravel = P.ramRestBottom - P.ramSlamBottom
  const mouth: V3 = [mx + 0.35, 2.3, mz]
  const stackTop: V3 = [SK.x, SK.top + 0.1, SK.z]

  return {
    update(f: Frame) {
      const L = f.s.lines.smelt
      const fx = f.fx
      const u = lineU(L)
      const ph = L.rate > 0 ? L.phase : 0
      const running = L.rate > 0
      // belt + elevator chain
      fx.belts.setSpeed(beltId, L.beltSpeed * 16)
      fx.belts.setSpeed(liftId, -0.8)
      // press
      const ramK = pressRam(ph)
      rig.pose(ram, 0, 0, 0, 0, -ramTravel * ramK, 0)
      if (running && phaseCrossed(prevPhase, ph, 0.5)) {
        const n = Math.round(10 * fx.emit)
        for (let i = 0; i < n; i++) {
          const a = jit.next() * Math.PI * 2
          const sp = 0.8 + jit.next() * 0.9
          fx.puffs.emit(X + Math.cos(a) * 0.9, top + 0.15, pz + Math.sin(a) * 0.65, Math.cos(a) * sp, 0.25 + jit.next() * 0.3, Math.sin(a) * sp, 1.1 + jit.next() * 0.5, 0.25, 0.95, f.reduced ? 0.35 : 0.55, 0.62, 0.56, 0.48, 0.15)
        }
        const ns = Math.round((f.reduced ? 4 : 10) * fx.emit)
        for (let i = 0; i < ns; i++) fx.sparks.emit(X + jit.sym() * 0.8, top + 0.12, pz + jit.sym() * 0.6, jit.sym() * 2.5, 1 + jit.next() * 2, jit.sym() * 2.5, 0.35 + jit.next() * 0.3, 0.035, 3.2, 1.6, 0.5, 0.03)
      }
      prevPhase = ph
      // rolling mill + skip + pour
      const ang = u * Math.PI * 2 * 0.85
      rig.pose(rollTop, ang, 0, 0)
      rig.pose(rollBot, -ang, 0, 0)
      const sk = skipHoist(u)
      rig.pose(skip, 0, 0, 0, 0, sk.lift * 4.45, 0)
      rig.pose(skipTip, -1.9 * sk.tip, 0, 0)
      const flow = running ? pourFlow(ph) : 0
      rig.pose(pour)
      rig.scale(pour, 0.35 + 0.65 * flow, Math.max(0.001, flow), 0.35 + 0.65 * flow)
      const pourGlow = 0.35 + 1.4 * flow
      fx.chan[CH.POUR].set(pourGlow, pourGlow * 0.9, pourGlow * 0.8)
      fx.fxChan[FX.POUR].set(0.9 * flow, 0.55 * flow, 0.25 * flow)
      // furnace flicker (thermal: unaffected by the night shift)
      const t = f.t
      const fl = f.reduced ? 1 : 0.86 + 0.08 * Math.sin(t * 7.3) + 0.06 * Math.sin(t * 17.9 + 1.3)
      fx.chan[CH.FURNACE].set(fl, fl * 0.96, fl * 0.92)
      fx.fxChan[FX.FURNACE].set(0.55 * fl, 0.3 * fl, 0.12 * fl)
      if (fx.furnaceLight) fx.furnaceLight.intensity = (14 + 5 * flow) * fl
      fx.sparks.glow(mouth[0] + 0.1, mouth[1], mouth[2], 1.6, 1.4 * fl, 0.65 * fl, 0.2 * fl, 0.55)
      // embers from the mouth, smoke from the stack
      const ne = embers.take(4 * fx.emit, f.dt)
      for (let i = 0; i < ne; i++) fx.sparks.emit(mouth[0] + 0.1, mouth[1] - 0.2 + jit.next() * 0.6, mouth[2] + jit.sym() * 0.45, 0.5 + jit.next() * 0.8, 0.6 + jit.next() * 1.2, jit.sym() * 0.4, 1.2 + jit.next(), 0.025, 2.6, 1.0, 0.25, 0.02, -0.6)
      const ns = smoke.take(3.2 * fx.emit, f.dt)
      for (let i = 0; i < ns; i++) {
        const g = 0.36 + jit.next() * 0.1
        fx.puffs.emit(stackTop[0] + jit.sym() * 0.15, stackTop[1], stackTop[2] + jit.sym() * 0.15, jit.sym() * 0.15, 1.3 + jit.next() * 0.4, jit.sym() * 0.15, 7 + jit.next() * 2.5, 0.7, 3.8, 0.55, g, g * 0.95, g * 0.9, 0.12)
      }
      // status lights
      setStackLight(fx, pressLight, L.status, L.rate, L.defectFlash, t, f.reduced)
      fx.lamps.light(qcLamp, L.defectFlash > 0 ? LAMP.red : LAMP.green, L.defectFlash > 0 ? (f.reduced ? 1 : Math.sin(t * 20) > 0 ? 1 : 0.25) : 0.85)
    },
  }
}
