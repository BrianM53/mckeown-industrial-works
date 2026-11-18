/**
 * LINE 4 — Fuel Tank Fabrication (x = 16, east of the east walkway).
 * South → north: plate roller (a steel sheet visibly curls into a shell each
 * cycle), seam-welding robot (sparks + bright arc flash; reduced motion → dim,
 * no strobe), cap-welding robot, pressure-test chamber with a big gauge whose
 * needle follows the cycle — and a comedic steam leak whenever QC catches a
 * defect (defectFlash > 0) — then the elevator.
 */
import { BELT, TANK } from '../config'
import { gaugePressure, hash01, lineU, sheetCurl, weldCap, weldSeam } from '../logic'
import { CH } from '../render/materials'
import { LAMP } from '../render/lamps'
import { Emitter, Jitter, type Animator, type Frame, type Kit } from './kit'
import { boltRing, cabinet, COL, elevator, groundBelt, pipeRun, robotArm, setStackLight, signBoard, st, stackLight } from './parts'

const SEGMENTS = 9
const SEG_LEN = 0.27

export function buildTank(k: Kit): Animator {
  const b = k.east
  const S = k.skin
  const rig = k.rig
  const X = TANK.x
  const top = BELT.top
  const beltId = groundBelt(k, b, 'tank')
  const liftId = elevator(k, b, 'tank')
  const blue = st.paint(COL.blueGrey, 0.55, 0.3)
  const blueDark = st.paint(COL.navy, 0.6, 0.3)
  const steel = st.metal(COL.steel, 0.38, 0.8)

  // ---------------------------------------------------------------- plate roller
  const R = TANK.roller
  const rz = R.zc
  const rlen = R.z1 - R.z0 - 0.9
  for (const z of [R.z0 + 0.22, R.z1 - 0.22]) {
    b.rbox([X, 1.15, z], [R.x1 - R.x0, 2.3, 0.42], blue, 0.06)
    b.box([X, 0.04, z], [R.x1 - R.x0 + 0.2, 0.08, 0.6], st.paint(COL.charcoal))
  }
  b.rbox([X, 0.35, rz], [R.x1 - R.x0 - 0.3, 0.7, rlen], blueDark, 0.05)
  b.box([X, 2.36, rz], [R.x1 - R.x0 - 0.2, 0.16, R.z1 - R.z0 - 0.3], blue)
  // header board on top of the roller frame
  signBoard(k, b, 'line:tank', [X, 2.82, R.z1 - 0.18], 2.7, Math.PI)
  for (const sx of [-1, 1]) b.box([X + sx * 1.1, 2.58, R.z1 - 0.22], [0.08, 0.5, 0.08], blue)
  // rollers (axis along z): two lower, one upper (drive)
  const rollY = 1.42
  const rollers: Array<{ bone: number; x: number; y: number; r: number; dir: number }> = [
    { bone: 0, x: X - 0.36, y: rollY - 0.32, r: 0.17, dir: 1 },
    { bone: 0, x: X + 0.36, y: rollY - 0.32, r: 0.17, dir: 1 },
    { bone: 0, x: X, y: rollY + 0.16, r: 0.2, dir: -1 },
  ]
  rollers.forEach((ro, i) => {
    ro.bone = rig.add(`tank:roll${i}`, 0, [ro.x, ro.y, rz], 0)
    S.bone(ro.bone, () => {
      S.cylAxis([ro.x, ro.y, rz], 'z', ro.r, rlen + 0.5, st.metal('#9aa4a3', 0.28, 0.85), 18)
      for (let q = 0; q < 3; q++) {
        const a = (q / 3) * Math.PI * 2
        S.box([ro.x + Math.cos(a) * ro.r, ro.y + Math.sin(a) * ro.r, rz], [0.04, 0.04, rlen + 0.4], st.paint(COL.charcoal), [0, 0, a])
      }
    })
  })
  b.rbox([X + 1.5, 0.95, R.z0 + 0.5], [0.4, 0.8, 0.7], st.paint(COL.navy), 0.04)
  // the curling sheet: a hinged plate chain rooted at its middle segment; both
  // halves curl up and close around the top roller into a shell each cycle
  const sy0 = rollY - 0.12
  const half = (SEGMENTS - 1) / 2
  const sheetStyle = st.metal('#a9b2b1', 0.32, 0.85)
  const root = rig.add('tank:sheet0', 0, [X, sy0, rz], 0)
  S.bone(root, () => S.box([X, sy0, rz], [SEG_LEN + 0.004, 0.035, rlen - 0.1], sheetStyle))
  const curlR: number[] = []
  const curlL: number[] = []
  for (const side of [1, -1]) {
    let parent = root
    for (let i = 1; i <= half; i++) {
      const px = X + side * (SEG_LEN / 2 + (i - 1) * SEG_LEN)
      const bone = rig.add(`tank:sheet${side > 0 ? 'R' : 'L'}${i}`, parent, [px, sy0, rz], 0)
      ;(side > 0 ? curlR : curlL).push(bone)
      S.bone(bone, () => S.box([px + (side * SEG_LEN) / 2, sy0, rz], [SEG_LEN + 0.004, 0.035, rlen - 0.1], sheetStyle))
      parent = bone
    }
  }
  // feed table
  b.box([X - 1.5, sy0 - 0.08, rz], [0.4, 0.05, rlen], steel)
  b.box([X - 1.5, (sy0 - 0.1) / 2, rz], [0.08, sy0 - 0.1, 0.08], st.paint(COL.charcoal))
  const rollerLight = stackLight(k, b, X + 1.25, 2.45, R.z0 + 0.25)

  // ---------------------------------------------------------------- seam welder (west side)
  const W = TANK.welder
  const welder = robotArm(k, b, { name: 'tank:welder', x: W.x, z: W.z, yaw: -Math.PI / 2, color: COL.hazard, tool: 'torch', tipChan: CH.WELD })
  // welding curtain posts + fume extractor arm
  if (k.detail) {
    pipeRun(b, [[W.x - 0.2, 0.2, W.z + 0.6], [W.x - 0.2, 2.6, W.z + 0.6], [X - 0.2, 2.75, W.z + 0.2]], 0.09, st.paint(COL.hazard, 0.6, 0.2), 10)
    b.cylY(X - 0.2, 2.35, W.z + 0.2, 0.2, 0.3, st.paint(COL.hazard, 0.6, 0.2), 12, 0.12)
  }
  signBoard(k, b, 'warn:robot', [W.x - 0.42, 1.25, W.z - 0.65], 0.58, Math.PI / 2)
  b.cylY(W.x - 0.42, 0, W.z - 0.65, 0.03, 1.0, st.paint(COL.charcoal), 6)

  // ---------------------------------------------------------------- cap welder (east side)
  const C = TANK.capWelder
  const capper = robotArm(k, b, { name: 'tank:capper', x: C.x, z: C.z, yaw: Math.PI / 2, color: COL.hazard, tool: 'torch', scale: 0.95, tipChan: CH.CAPWELD })
  cabinet(k, b, C.x + 0.05, C.z + 1.2, Math.PI / 2, 0.55, 1.5, 0.45, COL.navy)

  // ---------------------------------------------------------------- pressure-test chamber
  const P = TANK.chamber
  const pz = (P.z0 + P.z1) / 2
  const plen = P.z1 - P.z0
  b.cylAxis([X, P.y, pz], 'z', P.r, plen - 0.3, st.paint(COL.blueGrey, 0.45, 0.4), 28)
  for (const z of [P.z0 + 0.15, P.z1 - 0.15]) {
    b.torus([X, P.y, z], P.r + 0.02, 0.09, st.paint(COL.navy, 0.45, 0.45), 'z', Math.PI * 2, 8, 28)
    if (k.detail) boltRing(b, [X, P.y, z], P.r + 0.05, 16, 'z', st.metal(COL.steel), 0.025, 0.06)
  }
  for (const z of [P.z0 + 0.6, P.z1 - 0.6]) {
    for (const sx of [-1, 1]) b.box([X + sx * 0.55, (P.y - P.r + 0.1) / 2, z], [0.14, P.y - P.r + 0.1, 0.3], st.paint(COL.charcoal))
    b.box([X, 0.15, z], [1.4, 0.3, 0.4], st.paint(COL.charcoal))
  }
  // tunnel mouths (dark) so the belt visibly passes through
  for (const z of [P.z0 + 0.02, P.z1 - 0.02]) b.cylAxis([X, P.y, z], 'z', P.r - 0.12, 0.03, st.paint(COL.black, 0.9, 0.1), 24)
  // top valve + leaky flange (the comedic one) pointing up-west toward the walkway
  const flange: [number, number, number] = [X - 0.38, P.y + P.r - 0.05, pz - 0.5]
  b.cylY(X, P.y + P.r - 0.1, pz + 0.55, 0.1, 0.45, steel, 10)
  b.cylAxis([X, P.y + P.r + 0.38, pz + 0.55], 'z', 0.12, 0.08, st.paint(COL.red), 12)
  b.cyl([flange[0] + 0.18, flange[1] - 0.12, flange[2]], [flange[0] - 0.05, flange[1] + 0.2, flange[2]], 0.08, steel, 10)
  b.cylAxis([flange[0] - 0.02, flange[1] + 0.16, flange[2]], 'x', 0.13, 0.06, st.paint(COL.rust), 12)
  const leakLamp = k.lamps.add([X + 0.55, P.y + P.r - 0.05, P.z0 + 0.45], [0, 1, 0], 0.09, 0.11)
  // gauge stand (east), dial facing the west walkway
  const G = TANK.gauge
  pipeRun(b, [[X + 0.6, P.y, G.z], [G.x, P.y, G.z], [G.x, G.y - 0.5, G.z]], 0.07, steel, 10)
  b.cylY(G.x, 0, G.z, 0.09, G.y - 0.45, st.paint(COL.gunmetal), 10)
  b.cylAxis([G.x, G.y, G.z], 'x', 0.5, 0.14, st.paint(COL.charcoal), 28)
  b.torus([G.x - 0.075, G.y, G.z], 0.5, 0.045, st.metal(COL.brass, 0.3, 0.85), 'x', Math.PI * 2, 6, 28)
  b.cylAxis([G.x - 0.072, G.y, G.z], 'x', 0.46, 0.01, st.paint(COL.cream, 0.6, 0.05), 28)
  // dial ticks + red zone (on the face, x = G.x - 0.08)
  for (let i = 0; i <= 10; i++) {
    const a = -2.35 + (i / 10) * 4.7
    const red = i >= 8
    b.box([G.x - 0.08, G.y + Math.cos(a) * 0.38, G.z + Math.sin(a) * 0.38], [0.012, 0.11, 0.025], st.paint(red ? COL.red : COL.black), [a, 0, 0])
  }
  b.box([G.x - 0.079, G.y + Math.cos(1.6) * 0.3, G.z + Math.sin(1.6) * 0.3], [0.006, 0.2, 0.06], st.paint(COL.red), [1.6, 0, 0])
  const needle = rig.add('tank:needle', 0, [G.x - 0.09, G.y, G.z], 0)
  S.bone(needle, () => {
    S.box([G.x - 0.09, G.y + 0.17, G.z], [0.012, 0.36, 0.028], st.paint(COL.red, 0.5, 0.1))
    S.cylAxis([G.x - 0.095, G.y, G.z], 'x', 0.04, 0.02, st.paint(COL.black), 10)
  })
  signBoard(k, b, 'warn:pressure', [G.x, G.y + 0.85, G.z], 0.82, Math.PI / 2)
  const testLight = stackLight(k, b, X - 0.65, P.y + P.r + 0.02, P.z1 - 0.35)

  // ---------------------------------------------------------------- animation
  const sparks = new Emitter()
  const capSparks = new Emitter()
  const steam = new Emitter()
  const jit = new Jitter(4242)
  let lastHiss = -Infinity
  let needleK = 0
  const seamZ0 = W.z + 0.75
  const seamZ1 = W.z - 0.75
  const shellTop = top + 0.92
  const capZ = C.z
  return {
    update(f: Frame) {
      const L = f.s.lines.tank
      const fx = f.fx
      const u = lineU(L)
      const ph = L.rate > 0 ? L.phase : 0
      const running = L.rate > 0
      const t = f.t
      fx.belts.setSpeed(beltId, L.beltSpeed * 16)
      fx.belts.setSpeed(liftId, -0.8)
      // plate roller: rollers spin, the sheet curls into a shell
      for (const ro of rollers) rig.pose(ro.bone, 0, 0, ro.dir * u * Math.PI * 2 * 1.6)
      const step = (sheetCurl(ph) * Math.PI * 2 * 0.95) / SEGMENTS
      rig.pose(root)
      for (const bone of curlR) rig.pose(bone, 0, 0, step)
      for (const bone of curlL) rig.pose(bone, 0, 0, -step)
      // seam welder
      const ws = weldSeam(ph)
      const wz = seamZ0 + (seamZ1 - seamZ0) * ws.s
      welder.reach(rig, X - 0.05, shellTop + 0.04 + ws.lift * 0.45, wz, Math.PI * 0.82)
      const arc = running && ws.arc
      let flash = 0
      if (arc) {
        flash = f.reduced ? 0.35 : 0.55 + 0.45 * hash01(Math.floor(t * 30), 7)
        const n = sparks.take((f.reduced ? 16 : 44) * fx.emit, f.dt)
        for (let i = 0; i < n; i++) fx.sparks.emit(X - 0.05, shellTop + 0.05, wz, jit.sym() * 2.2, 1.0 + jit.next() * 2.4, jit.sym() * 2.2, 0.3 + jit.next() * 0.5, 0.03, 2.4, 2.2, 1.6, 0.03)
        fx.sparks.glow(X - 0.05, shellTop + 0.08, wz, f.reduced ? 0.5 : 0.9 + 0.5 * flash, 1.6 * flash, 2.0 * flash, 2.6 * flash, f.reduced ? 0.5 : 0.9)
      }
      fx.chan[CH.WELD].set(0.4 + 3 * flash, 0.5 + 3.2 * flash, 0.6 + 3.6 * flash)
      if (fx.weldLight) {
        fx.weldLight.position.set(X - 0.3, shellTop + 0.35, wz)
        fx.weldLight.intensity = arc ? (f.reduced ? 3 : 4 + 16 * flash) : 0
      }
      // cap welder traces the circumference (top half)
      const wc = weldCap(ph)
      const ang = Math.PI * (0.22 + 0.48 * wc.s)
      const rr = 0.5 + wc.lift * 0.35
      capper.reach(rig, X + Math.cos(ang) * rr, top + 0.46 + Math.sin(ang) * rr, capZ, Math.PI * 0.62)
      const capArc = running && wc.arc
      const cflash = capArc ? (f.reduced ? 0.3 : 0.5 + 0.5 * hash01(Math.floor(t * 26), 9)) : 0
      fx.chan[CH.CAPWELD].set(0.4 + 2.6 * cflash, 0.5 + 2.8 * cflash, 0.6 + 3.2 * cflash)
      if (capArc) {
        const px = X + Math.cos(ang) * 0.5
        const py = top + 0.46 + Math.sin(ang) * 0.5
        const n = capSparks.take((f.reduced ? 10 : 26) * fx.emit, f.dt)
        for (let i = 0; i < n; i++) fx.sparks.emit(px, py, capZ, jit.sym() * 2, 0.6 + jit.next() * 2, jit.sym() * 1.6, 0.25 + jit.next() * 0.4, 0.028, 2.4, 2.1, 1.5, 0.03)
        fx.sparks.glow(px, py, capZ, 0.6, 1.4 * cflash, 1.7 * cflash, 2.2 * cflash, f.reduced ? 0.4 : 0.8)
      }
      // pressure test: needle follows the cycle; a caught defect = leak + needle in the red
      const leak = L.defectFlash > 0
      const target = leak ? 0.95 + (f.reduced ? 0 : 0.05 * Math.sin(t * 40)) : running ? gaugePressure(ph) : 0
      needleK += (target - needleK) * Math.min(1, f.dt * (leak ? 14 : 6))
      rig.pose(needle, -2.35 + needleK * 4.7, 0, 0)
      if (leak) {
        const n = steam.take((f.reduced ? 18 : 40) * fx.emit, f.dt)
        for (let i = 0; i < n; i++)
          fx.puffs.emit(flange[0] - 0.08, flange[1] + 0.25, flange[2], -1.6 - jit.next() * 1.6, 1.4 + jit.next() * 1.2, jit.sym() * 0.5, 0.9 + jit.next() * 0.5, 0.15, 1.1, 0.75, 0.93, 0.95, 0.97, 0.6)
        if (t - lastHiss > 4 || t < lastHiss) {
          lastHiss = t
          fx.sfx('steam-hiss', [flange[0], flange[1], flange[2]], 0.8)
        }
      }
      fx.chan[CH.LEAK].set(leak ? 2.5 : 0.1, leak ? 0.3 : 0.05, leak ? 0.2 : 0.05)
      fx.lamps.light(leakLamp, LAMP.red, leak ? (f.reduced ? 1 : Math.sin(t * 16) > 0 ? 1 : 0.2) : 0)
      setStackLight(fx, rollerLight, L.status, L.rate, L.defectFlash, t, f.reduced)
      setStackLight(fx, testLight, L.status, L.rate, L.defectFlash, t, f.reduced)
    },
  }
}
