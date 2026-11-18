/**
 * LINE 3 — Electronics & Guidance (x = 9, beside the main aisle).
 * South → north: board magazine loader, glass clean-room booth (cool white-blue
 * light) with a zipping pick-and-place XY gantry, wave-solder oven glowing
 * orange, bed-of-nails tester + a rack of blinking LEDs facing the aisle,
 * elevator.
 */
import { BELT, CIRCUIT } from '../config'
import { gantryTarget, hash01, lineU, testHead } from '../logic'
import { CH, FX } from '../render/materials'
import { LAMP } from '../render/lamps'
import { Emitter, Jitter, type Animator, type Frame, type Kit } from './kit'
import { COL, elevator, groundBelt, setStackLight, signBoard, st, stackLight } from './parts'

export function buildCircuit(k: Kit): Animator {
  const b = k.east
  const S = k.skin
  const rig = k.rig
  const X = CIRCUIT.x
  const top = BELT.top
  const beltId = groundBelt(k, b, 'circuit')
  const liftId = elevator(k, b, 'circuit')
  const white = st.paint(COL.white, 0.5, 0.15)
  const teal = st.paint(COL.teal, 0.5, 0.2)
  const stainless = st.metal('#b7c0bf', 0.3, 0.85)
  const navy = st.paint(COL.navy, 0.55, 0.3)

  // ---------------------------------------------------------------- loader (south)
  const Ld = CIRCUIT.loader
  const lz = (Ld.z0 + Ld.z1) / 2
  b.rbox([X, 0.45, lz], [2.2, 0.9, Ld.z1 - Ld.z0 - 0.2], white, 0.05)
  b.box([X, 0.04, lz], [2.3, 0.08, Ld.z1 - Ld.z0 - 0.1], st.paint(COL.charcoal))
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box([X + sx * 0.5, 1.45, lz + sz * 0.42], [0.06, 1.1, 0.06], stainless)
  for (let i = 0; i < 12; i++) {
    b.box([X, 0.98 + i * 0.075, lz], [0.82, 0.03, 0.62], st.paint(COL.pcb, 0.45, 0.1))
    if (k.detail && i % 2 === 0) b.box([X + 0.36, 0.995 + i * 0.075, lz], [0.06, 0.01, 0.5], st.metal(COL.gold, 0.3, 0.9))
  }
  b.box([X, 2.03, lz], [1.1, 0.06, 0.95], teal)
  const pusher = rig.add('circuit:pusher', 0, [X, top + 0.1, Ld.z1 - 0.25], 0)
  S.bone(pusher, () => {
    S.box([X, top + 0.12, Ld.z1 - 0.25], [0.7, 0.14, 0.08], st.paint(COL.hazard))
    S.cylAxis([X, top + 0.12, Ld.z1 - 0.05], 'z', 0.04, 0.36, st.metal(COL.chrome), 8)
  })
  // header board on posts above the loader
  for (const sx of [-1, 1]) b.cylY(X + sx * 1.35, 0, Ld.z1 - 0.1, 0.06, 3.5, st.paint(COL.gunmetal), 8)
  b.box([X, 3.45, Ld.z1 - 0.1], [2.9, 0.08, 0.08], st.paint(COL.gunmetal))
  signBoard(k, b, 'line:circuit', [X, 3.05, Ld.z1 - 0.04], 2.75, Math.PI)
  const loaderLight = stackLight(k, b, X - 0.95, 0.92, Ld.z1 - 0.45)

  // ---------------------------------------------------------------- clean-room booth
  const B = CIRCUIT.booth
  const bz = (B.z0 + B.z1) / 2
  const bl = B.z1 - B.z0
  const post = st.paint('#e8e6df', 0.45, 0.2)
  const zs = [B.z0, B.z0 + bl / 3, B.z0 + (2 * bl) / 3, B.z1]
  for (const x of [B.x0, B.x1]) for (const z of zs) b.box([x, B.h / 2, z], [0.1, B.h, 0.1], post)
  for (const x of [B.x0, B.x1]) {
    b.box([x, B.h, bz], [0.12, 0.12, bl + 0.1], post)
    b.box([x, 0.14, bz], [0.06, 0.28, bl], white)
    k.glass.box([x, (0.28 + B.h - 0.06) / 2, bz], [0.03, B.h - 0.34, bl - 0.1], st.white)
  }
  for (const z of [B.z0, B.z1]) {
    b.box([X, B.h, z], [B.x1 - B.x0 + 0.1, 0.12, 0.12], post)
    // panes around the belt mouth
    const mx0 = X - 0.7
    const mx1 = X + 0.7
    k.glass.box([(B.x0 + mx0) / 2, B.h / 2, z], [mx0 - B.x0 - 0.06, B.h - 0.1, 0.03], st.white)
    k.glass.box([(mx1 + B.x1) / 2, B.h / 2, z], [B.x1 - mx1 - 0.06, B.h - 0.1, 0.03], st.white)
    k.glass.box([X, (1.45 + B.h) / 2, z], [mx1 - mx0, B.h - 1.45, 0.03], st.white)
    for (const x of [mx0, mx1]) b.box([x, B.h / 2, z], [0.06, B.h, 0.08], post)
    b.box([X, 1.45, z], [mx1 - mx0, 0.06, 0.08], post)
    // strip curtain
    for (let i = 0; i < 7; i++) b.box([mx0 + 0.1 + i * 0.2, 1.17, z], [0.15, 0.5, 0.01], { color: '#6c8b8f', rough: 0.3, metal: 0 })
  }
  // roof + HEPA units + duct
  b.box([X, B.h + 0.08, bz], [B.x1 - B.x0 + 0.1, 0.1, bl + 0.1], white)
  for (let i = 0; i < 3; i++) {
    const z = B.z0 + 1.0 + i * ((bl - 2.0) / 2)
    b.rbox([X, B.h + 0.32, z], [1.4, 0.38, 1.15], st.paint('#d6dbd8', 0.5, 0.2), 0.04)
    if (k.detail) for (let g = 0; g < 5; g++) b.box([X - 0.71, B.h + 0.32, z - 0.4 + g * 0.2], [0.01, 0.26, 0.05], st.paint(COL.gunmetal))
  }
  b.rbox([X + 1.25, B.h + 0.42, bz], [0.5, 0.5, bl - 0.4], st.metal(COL.steelLight, 0.45, 0.6), 0.05)
  // ceiling light panels (cool white) + soft glow volumes
  for (const dx of [-0.85, 0.85]) b.box([X + dx, B.h - 0.06, bz], [0.42, 0.04, bl - 0.6], st.glow(COL.coolWhite, 2.4, CH.CLEANROOM))
  k.fx.bone(0, () => {
    for (const x of [B.x0 + 0.06, B.x1 - 0.06]) k.fx.quad([x, B.h * 0.55, bz], bl * 1.1, B.h * 1.25, x < X ? -Math.PI / 2 : Math.PI / 2, { color: '#8fc8ff', chan: FX.CLEANROOM })
    k.fx.quad([X, B.h * 0.55, B.z1 - 0.06], (B.x1 - B.x0) * 1.2, B.h * 1.2, 0, { color: '#8fc8ff', chan: FX.CLEANROOM })
  })
  // west-facing signs (main aisle side)
  b.box([B.x0 - 0.02, B.h + 0.62, bz], [0.06, 0.62, 3.0], st.paint(COL.charcoal))
  signBoard(k, b, 'line:circuit', [B.x0 - 0.06, B.h + 0.62, bz], 2.6, Math.PI / 2)
  signBoard(k, b, 'warn:clean', [B.x0 - 0.04, 1.75, B.z0 + 0.55], 0.62, Math.PI / 2)
  const boothLight = stackLight(k, b, B.x1 - 0.2, B.h + 0.13, B.z1 - 0.2)

  // feeders (tape reels) inside along the west wall
  b.box([B.x0 + 0.35, 0.55, bz], [0.36, 1.1, bl - 1.4], st.paint(COL.navy))
  for (let i = 0; i < 6; i++) {
    const z = B.z0 + 1.0 + i * ((bl - 2.0) / 5)
    b.cylAxis([B.x0 + 0.35, 1.32, z], 'x', 0.22, 0.06, st.paint(i % 2 ? '#3a3f44' : '#20262a'), 16)
    b.cylAxis([B.x0 + 0.35, 1.32, z], 'x', 0.07, 0.08, st.paint(COL.cream), 8)
  }
  // gantry rails
  const gy = 2.32
  const gz0 = B.z0 + 0.5
  const gz1 = B.z1 - 0.5
  for (const x of [B.x0 + 0.45, B.x1 - 0.45]) {
    b.box([x, gy, bz], [0.12, 0.14, gz1 - gz0 + 0.3], stainless)
    for (const z of [gz0, gz1]) b.box([x, gy / 2, z], [0.1, gy, 0.1], post)
  }
  const gzc = (gz0 + gz1) / 2
  const beam = rig.add('circuit:gantryZ', 0, [X, gy + 0.14, gzc], 0)
  const head = rig.add('circuit:gantryX', beam, [X, gy + 0.05, gzc], 0)
  const nozzle = rig.add('circuit:nozzle', head, [X, gy - 0.25, gzc], 0)
  S.bone(beam, () => {
    S.rbox([X, gy + 0.17, gzc], [B.x1 - B.x0 - 0.7, 0.16, 0.22], teal, 0.03)
    for (const x of [B.x0 + 0.45, B.x1 - 0.45]) S.box([x, gy + 0.11, gzc], [0.2, 0.12, 0.3], st.paint(COL.charcoal))
  })
  S.bone(head, () => {
    S.rbox([X, gy - 0.03, gzc], [0.26, 0.36, 0.3], white, 0.03)
    S.box([X + 0.14, gy + 0.02, gzc], [0.02, 0.1, 0.14], st.glow('#6fe0ff', 1.6, CH.POWER))
  })
  S.bone(nozzle, () => {
    S.cylY(X, gy - 0.48, gzc, 0.03, 0.3, st.metal(COL.chrome), 8)
    S.cylY(X, gy - 0.52, gzc, 0.015, 0.05, st.paint(COL.charcoal), 6)
  })

  // ---------------------------------------------------------------- wave-solder oven
  const O = CIRCUIT.oven
  const oz = (O.z0 + O.z1) / 2
  const ol = O.z1 - O.z0
  b.rbox([X, (O.y0 + O.y1) / 2, oz], [O.x1 - O.x0, O.y1 - O.y0, ol], stainless, 0.08)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box([X + sx * 1.3, O.y0 / 2, oz + sz * (ol / 2 - 0.25)], [0.12, O.y0, 0.12], navy)
  b.box([X, O.y0 + 0.04, oz], [O.x1 - O.x0 + 0.06, 0.08, ol + 0.06], navy)
  // glowing windows (both sides)
  for (const sx of [-1, 1]) {
    const wx = X + sx * ((O.x1 - O.x0) / 2 + 0.005)
    for (let i = 0; i < 4; i++) {
      const z = O.z0 + 0.55 + i * ((ol - 1.1) / 3)
      b.box([wx, 1.18, z], [0.03, 0.5, 0.62], st.paint(COL.charcoal))
      b.box([wx + sx * 0.012, 1.18, z], [0.02, 0.38, 0.5], st.glow('#ff8c3a', 2.6, CH.OVEN))
    }
    b.box([wx + sx * 0.01, 1.62, oz], [0.02, 0.06, ol - 0.3], st.paint(COL.teal))
  }
  // tunnel mouths
  for (const z of [O.z0, O.z1]) {
    b.box([X, 1.1, z], [1.25, 0.45, 0.05], st.paint(COL.black, 0.9, 0.1))
    b.box([X, 1.0, z], [1.1, 0.06, 0.06], st.glow('#ff7a2a', 1.8, CH.OVEN))
  }
  // hood + stacks
  b.rbox([X, O.y1 + 0.18, oz], [1.9, 0.36, ol - 0.6], st.metal(COL.steelLight, 0.4, 0.7), 0.05)
  const stacks: Array<[number, number]> = [
    [X + 0.45, O.z0 + 0.9],
    [X + 0.45, O.z1 - 0.9],
  ]
  for (const [sx, sz] of stacks) {
    b.cylY(sx, O.y1 + 0.36, sz, 0.16, 1.0, st.metal(COL.steel, 0.4, 0.7), 12)
    b.cylY(sx, O.y1 + 1.36, sz, 0.22, 0.06, st.paint(COL.charcoal), 12)
  }
  // control panel facing the aisle
  b.rbox([O.x0 - 0.08, 1.35, O.z1 - 0.6], [0.16, 0.6, 0.55], navy, 0.03)
  b.box([O.x0 - 0.165, 1.45, O.z1 - 0.6], [0.01, 0.24, 0.38], st.glow('#38d6b0', 1.5, CH.POWER))
  k.fx.bone(0, () => {
    for (const sx of [-1, 1]) k.fx.quad([X + sx * ((O.x1 - O.x0) / 2 + 0.25), 1.2, oz], ol * 1.05, 1.0, sx < 0 ? -Math.PI / 2 : Math.PI / 2, { color: '#ff7a2a', chan: FX.OVEN })
  })

  // ---------------------------------------------------------------- test rack + bed-of-nails head
  const Rk = CIRCUIT.rack
  const rkx = (Rk.x0 + Rk.x1) / 2
  const rkz = (Rk.z0 + Rk.z1) / 2
  b.rbox([rkx, Rk.h / 2, rkz], [Rk.x1 - Rk.x0, Rk.h, Rk.z1 - Rk.z0], st.paint('#24313a', 0.55, 0.3), 0.04)
  b.box([Rk.x0 - 0.005, Rk.h / 2 + 0.1, rkz], [0.02, Rk.h - 0.5, Rk.z1 - Rk.z0 - 0.25], st.paint('#121a1f', 0.6, 0.2))
  const leds: number[] = []
  const cols = 6
  const rows = 9
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const z = Rk.z0 + 0.32 + c * ((Rk.z1 - Rk.z0 - 0.64) / (cols - 1))
      const y = 0.55 + r * 0.16
      leds.push(k.lamps.add([Rk.x0 - 0.01, y, z], [-1, 0, 0], 0.035, 0.03))
    }
  b.box([Rk.x0 - 0.01, 2.02, rkz], [0.02, 0.18, 1.4], st.glow('#38d6b0', 1.2, CH.POWER))
  const pass = k.lamps.add([rkx, Rk.h, Rk.z0 + 0.4], [0, 1, 0], 0.1, 0.12)
  const fail = k.lamps.add([rkx, Rk.h, Rk.z1 - 0.4], [0, 1, 0], 0.1, 0.12)
  // cable bundle from the rack to the test head
  b.cyl([Rk.x1, 2.1, CIRCUIT.testHeadZ], [X - 0.9, 2.15, CIRCUIT.testHeadZ], 0.06, st.rubber, 8)
  const tz = CIRCUIT.testHeadZ
  for (const sx of [-1, 1]) b.box([X + sx * 0.9, 1.1, tz], [0.1, 2.2, 0.16], st.paint(COL.teal))
  b.rbox([X, 2.25, tz], [1.95, 0.16, 0.3], st.paint(COL.teal), 0.03)
  b.cylY(X, 2.0, tz, 0.07, 0.3, st.metal(COL.chrome), 8)
  const tester = rig.add('circuit:tester', 0, [X, 1.75, tz], 0)
  S.bone(tester, () => {
    S.rbox([X, 1.75, tz], [0.9, 0.18, 0.62], st.paint('#24313a'), 0.03)
    S.box([X, 1.64, tz], [0.8, 0.04, 0.52], st.metal(COL.gold, 0.3, 0.9))
    S.cylY(X, 1.84, tz, 0.05, 0.25, st.metal(COL.chrome), 8)
  })

  // ---------------------------------------------------------------- animation
  const fumes = new Emitter()
  const jit = new Jitter(909)
  const g = { x: 0, z: 0, dip: 0 }
  const gxRange: [number, number] = [B.x0 + 0.9, B.x1 - 0.9]
  const gzRange: [number, number] = [gz0 + 0.3, gz1 - 0.3]
  return {
    update(f: Frame) {
      const L = f.s.lines.circuit
      const fx = f.fx
      const u = lineU(L)
      const ph = L.rate > 0 ? L.phase : 0
      const t = f.t
      fx.belts.setSpeed(beltId, L.beltSpeed * 16)
      fx.belts.setSpeed(liftId, -0.8)
      // pick-and-place gantry zips between feeders and the board
      gantryTarget(u, g)
      const gx = gxRange[0] + (gxRange[1] - gxRange[0]) * g.x
      const gzz = gzRange[0] + (gzRange[1] - gzRange[0]) * g.z
      rig.pose(beam, 0, 0, 0, 0, 0, gzz - gzc)
      rig.pose(head, 0, 0, 0, gx - X, 0, 0)
      rig.pose(nozzle, 0, 0, 0, 0, -0.32 * g.dip, 0)
      // loader pusher shoves a board out at the end of each cycle
      const push = ph > 0.84 ? (ph - 0.84) / 0.16 : ph < 0.12 ? 1 - ph / 0.12 : 0
      rig.pose(pusher, 0, 0, 0, 0, 0, -0.55 * push)
      rig.pose(tester, 0, 0, 0, 0, -0.55 * testHead(ph), 0)
      // glows
      const ov = 1 + 0.06 * Math.sin(t * 2.3)
      fx.chan[CH.OVEN].set(ov, ov, ov)
      fx.fxChan[FX.OVEN].set(0.42 * ov, 0.2 * ov, 0.05 * ov)
      const cr = 0.25 + 0.75 * f.power
      fx.chan[CH.CLEANROOM].set(cr, cr, cr)
      fx.fxChan[FX.CLEANROOM].set(0.1 * cr, 0.16 * cr, 0.24 * cr)
      const nf = fumes.take(1.4 * fx.emit, f.dt)
      for (let i = 0; i < nf; i++) {
        const s = stacks[i % 2]
        fx.puffs.emit(s[0] + jit.sym() * 0.05, CIRCUIT.oven.y1 + 1.45, s[1] + jit.sym() * 0.05, jit.sym() * 0.1, 0.5, jit.sym() * 0.1, 3.5, 0.25, 1.3, 0.28, 0.8, 0.8, 0.82, 0.15)
      }
      // LED test rack: deterministic chatter; everything red on a caught defect
      const defect = L.defectFlash > 0
      const rate = f.reduced ? 0.6 : 2.2
      for (let i = 0; i < leds.length; i++) {
        if (defect) {
          fx.lamps.light(leds[i], LAMP.red, f.reduced ? 1 : Math.sin(t * 18 + i) > 0 ? 1 : 0.15)
          continue
        }
        const step = Math.floor(t * rate * (0.6 + hash01(i, 1) * 1.4) + hash01(i, 2) * 10)
        const h = hash01(i, step)
        const c = h < 0.06 ? LAMP.amber : i % 7 === 3 ? LAMP.blue : LAMP.green
        fx.lamps.light(leds[i], c, h > 0.3 ? 0.9 * f.power + 0.1 : 0)
      }
      fx.lamps.light(pass, LAMP.green, !defect && L.rate > 0 ? 1 : 0.1)
      fx.lamps.light(fail, LAMP.red, defect ? (f.reduced ? 1 : Math.sin(t * 20) > 0 ? 1 : 0.2) : 0)
      setStackLight(fx, loaderLight, L.status, L.rate, L.defectFlash, t, f.reduced)
      setStackLight(fx, boothLight, L.status, L.rate, L.defectFlash, t, f.reduced)
    },
  }
}
