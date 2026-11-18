/**
 * LINE 2 — Pipe & Valve Machining (x = -16, west of the west walkway).
 * South → north: pipe-stock rack, lathe (spinning workpiece, feeding carriage,
 * spark shower toward the walkway), pipe bender (arm swings 90°; clamp at
 * phase 0.3 = the audio clank), valve-assembly robot (picks red valve wheels
 * from a bin and places them), strapping station, elevator.
 */
import { BELT, PIPE } from '../config'
import { benderSwing, latheFeed, lineU, strapperHead, valveRobot, type ToolPose } from '../logic'
import { CH } from '../render/materials'
import { LAMP } from '../render/lamps'
import type { GeoBatch } from './builder'
import { Emitter, Jitter, type Animator, type Frame, type Kit } from './kit'
import { boltRing, COL, elevator, groundBelt, pipeRun, robotArm, setStackLight, signBoard, st, stackLight } from './parts'

/** Red hand-wheel valve (wheel in the XY plane facing ±Z) centered at c. */
export function valveWheel(b: GeoBatch, c: readonly [number, number, number], r: number, axis: 'x' | 'y' | 'z' = 'z'): void {
  const red = st.paint(COL.red, 0.5, 0.2)
  b.torus([c[0], c[1], c[2]], r, r * 0.14, red, axis, Math.PI * 2, 6, 16)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI
    const dx = Math.cos(a) * r
    const dy = Math.sin(a) * r
    if (axis === 'z') b.cyl([c[0] - dx, c[1] - dy, c[2]], [c[0] + dx, c[1] + dy, c[2]], r * 0.08, red, 5)
    else if (axis === 'y') b.cyl([c[0] - dx, c[1], c[2] - dy], [c[0] + dx, c[1], c[2] + dy], r * 0.08, red, 5)
    else b.cyl([c[0], c[1] - dy, c[2] - dx], [c[0], c[1] + dy, c[2] + dx], r * 0.08, red, 5)
  }
  b.cylAxis([c[0], c[1], c[2]], axis, r * 0.22, r * 0.4, st.metal(COL.steel), 8)
}

export function buildPipe(k: Kit): Animator {
  const b = k.west
  const S = k.skin
  const rig = k.rig
  const X = PIPE.x
  const top = BELT.top
  const beltId = groundBelt(k, b, 'pipe')
  const liftId = elevator(k, b, 'pipe')
  const green = st.paint(COL.machineGreen, 0.55, 0.25)
  const greenDark = st.paint(COL.greenDark, 0.6, 0.25)
  const copper = st.metal(COL.copper, 0.35, 0.85)
  const galv = st.metal(COL.steelLight, 0.4, 0.8)

  // ---------------------------------------------------------------- header frame (south)
  for (const x of [-17.85, -14.15]) {
    b.cylY(x, 0, PIPE.signZ, 0.08, 3.45, st.paint(COL.gunmetal), 10)
    b.cylY(x, 0, PIPE.signZ, 0.16, 0.06, st.paint(COL.charcoal), 10)
  }
  b.box([X, 3.42, PIPE.signZ], [3.9, 0.1, 0.1], st.paint(COL.gunmetal))
  signBoard(k, b, 'line:pipe', [X, 3.0, PIPE.signZ + 0.06], 3.3, Math.PI)

  // ---------------------------------------------------------------- pipe-stock rack
  const R = PIPE.rack
  const rx = (R.x0 + R.x1) / 2
  for (const z of [15.8, 17.3, 18.8]) {
    for (const s of [-1, 1]) b.box([rx + s * 0.45, 0.85, z], [0.08, 1.75, 0.1], st.paint(COL.navy), [0, 0, s * 0.18])
    b.box([rx, 0.3, z], [1.2, 0.08, 0.1], st.paint(COL.navy))
    b.box([rx, 0.03, z], [1.3, 0.06, 0.3], st.paint(COL.charcoal))
    for (const s of [-1, 1]) b.box([rx + s * 0.62, 0.45, z], [0.06, 0.4, 0.08], st.paint(COL.hazard))
  }
  const rows = [4, 3, 2, 1]
  rows.forEach((n, row) => {
    for (let i = 0; i < n; i++) {
      const px = rx + (i - (n - 1) / 2) * 0.27
      const py = 0.42 + row * 0.23
      b.cylAxis([px, py, (R.z0 + R.z1) / 2 + 0.05], 'z', 0.1, R.z1 - R.z0 - 0.15, (i + row) % 2 ? copper : galv, 12)
    }
  })
  // feed table toward the belt start
  b.box([X - 0.9, 0.82, 18.3], [0.6, 0.06, 0.9], st.paint(COL.gunmetal), [0, 0, 0.12])

  // ---------------------------------------------------------------- lathe
  const Lt = PIPE.lathe
  const lx = (Lt.x0 + Lt.x1) / 2
  const ax = Lt.axisX
  const ay = Lt.axisY
  b.rbox([lx, 0.42, (Lt.z0 + Lt.z1) / 2], [Lt.x1 - Lt.x0, 0.84, Lt.z1 - Lt.z0], green, 0.05)
  b.box([lx, 0.04, (Lt.z0 + Lt.z1) / 2], [Lt.x1 - Lt.x0 + 0.1, 0.08, Lt.z1 - Lt.z0 + 0.1], st.paint(COL.charcoal))
  for (const dx of [-0.2, 0.2]) b.box([ax + dx, 0.88, (Lt.z0 + Lt.z1) / 2 - 0.3], [0.08, 0.06, Lt.z1 - Lt.z0 - 0.7], st.metal(COL.chrome, 0.25, 0.9))
  const headZ = Lt.z1 - 0.38
  b.rbox([lx, 1.25, headZ], [Lt.x1 - Lt.x0, 0.82, 0.72], green, 0.06)
  b.box([Lt.x1 + 0.005, 1.25, headZ], [0.02, 0.5, 0.5], st.paint(COL.cream))
  for (let i = 0; i < 3; i++) b.cylAxis([Lt.x1 + 0.02, 1.38 - i * 0.12, headZ - 0.12], 'x', 0.03, 0.03, st.glow(i === 0 ? '#5dff7a' : i === 1 ? '#ffb23f' : '#ff3b2f', 1.6, CH.POWER), 8)
  b.cylAxis([Lt.x1 + 0.03, 1.2, headZ + 0.14], 'x', 0.07, 0.05, st.paint(COL.red), 12)
  const tailZ = Lt.z0 + 0.25
  b.rbox([lx, 1.15, tailZ], [Lt.x1 - Lt.x0 - 0.1, 0.62, 0.42], green, 0.05)
  b.cylAxis([ax, ay, tailZ + 0.3], 'z', 0.06, 0.25, st.metal(COL.chrome), 10)
  // chip guard (glass) on the walkway side + coolant line
  k.glass.box([Lt.x1 + 0.04, 1.35, (headZ + tailZ) / 2], [0.02, 0.6, 1.6], st.white)
  b.box([Lt.x1 + 0.04, 1.66, (headZ + tailZ) / 2], [0.04, 0.03, 1.62], st.paint(COL.charcoal))
  if (k.detail) pipeRun(b, [[lx - 0.4, 1.66, headZ - 0.3], [ax - 0.25, 1.9, headZ - 0.6], [ax - 0.2, 1.62, 13.6]], 0.025, st.paint(COL.blue), 6)
  const spindle = rig.add('pipe:spindle', 0, [ax, ay, headZ - 0.36], 0)
  const workEnd = tailZ + 0.43
  S.bone(spindle, () => {
    const cz = headZ - 0.45
    S.cylAxis([ax, ay, cz], 'z', 0.22, 0.18, st.metal(COL.steel), 16)
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2
      S.box([ax + Math.cos(a) * 0.15, ay + Math.sin(a) * 0.15, cz - 0.12], [0.07, 0.07, 0.12], st.paint(COL.charcoal), [0, 0, a])
    }
    S.cylAxis([ax, ay, (cz + workEnd) / 2 - 0.06], 'z', 0.11, cz - workEnd - 0.1, copper, 14)
    for (let i = 0; i < 4; i++) S.box([ax, ay + 0.112, workEnd + 0.25 + i * 0.4], [0.03, 0.01, 0.12], st.paint(COL.cream), [0, 0, 0])
  })
  const carriage = rig.add('pipe:carriage', 0, [lx, 0.95, headZ - 0.62], 0)
  S.bone(carriage, () => {
    const cz = headZ - 0.62
    S.rbox([lx, 0.98, cz], [Lt.x1 - Lt.x0 - 0.08, 0.14, 0.42], greenDark, 0.03)
    S.rbox([ax + 0.28, 1.12, cz], [0.26, 0.16, 0.3], greenDark, 0.03)
    S.box([ax + 0.2, 1.25, cz], [0.14, 0.12, 0.14], st.paint(COL.charcoal))
    S.box([ax + 0.135, ay, cz], [0.08, 0.035, 0.035], st.metal(COL.gold, 0.3, 0.9))
    S.cylAxis([ax + 0.5, 1.12, cz], 'x', 0.07, 0.04, st.paint(COL.red), 10)
  })
  const feedLen = headZ - 0.62 - (workEnd + 0.2)

  // ---------------------------------------------------------------- bender
  const B = PIPE.bender
  const bx = (B.x0 + B.x1) / 2
  const bz = (B.z0 + B.z1) / 2
  const navy = st.paint(COL.navy, 0.55, 0.3)
  b.rbox([bx, 0.5, bz], [B.x1 - B.x0 - 0.05, 1.0, B.z1 - B.z0 - 0.05], navy, 0.06)
  b.box([bx, 1.02, bz], [B.x1 - B.x0 - 0.15, 0.04, B.z1 - B.z0 - 0.15], st.metal(COL.steel, 0.4, 0.7))
  b.cylY(B.dieX, 1.04, B.dieZ, 0.36, 0.22, st.metal(COL.steelLight, 0.3, 0.85), 20)
  b.torus([B.dieX, 1.15, B.dieZ], 0.36, 0.035, st.paint(COL.charcoal), 'y', Math.PI * 2, 5, 20)
  // clamped straight part of the pipe (south) + a quarter bend around the die
  b.cylAxis([B.dieX + 0.36, 1.15, B.dieZ + 0.65], 'z', 0.09, 1.3, copper, 12)
  b.torus([B.dieX, 1.15, B.dieZ], 0.36, 0.09, copper, 'y', Math.PI / 2, 8, 10, 0)
  b.rbox([B.dieX + 0.55, 1.2, B.dieZ + 0.3], [0.22, 0.24, 0.5], st.paint(COL.hazard), 0.03)
  // hydraulic ram on the side
  b.cylAxis([bx - 0.2, 1.25, B.z1 - 0.35], 'x', 0.11, 0.8, st.paint(COL.gunmetal), 12)
  if (k.detail) {
    b.cylY(B.x0 + 0.12, 1.0, B.z0 + 0.15, 0.03, 0.7, st.paint(COL.charcoal), 6)
    b.rbox([B.x0 + 0.12, 1.75, B.z0 + 0.15], [0.14, 0.24, 0.1], st.paint(COL.hazard), 0.02)
  }
  const bendArm = rig.add('pipe:bendArm', 0, [B.dieX, 1.15, B.dieZ], 0)
  S.bone(bendArm, () => {
    // arm points north at rest and wraps the pipe around the die toward the west
    S.rbox([B.dieX + 0.36, 1.24, B.dieZ - 0.45], [0.24, 0.26, 0.7], st.paint(COL.safety, 0.55, 0.25), 0.04)
    S.cylAxis([B.dieX + 0.36, 1.15, B.dieZ - 0.45], 'z', 0.09, 0.85, copper, 12)
    S.box([B.dieX + 0.18, 1.15, B.dieZ - 0.15], [0.36, 0.12, 0.16], st.paint(COL.charcoal))
  })

  // ---------------------------------------------------------------- valve robot + bin
  const vb = PIPE.valveBin
  b.rbox([vb.x, 0.36, vb.z], [0.8, 0.72, 0.76], st.paint(COL.red, 0.7, 0.15), 0.04)
  b.box([vb.x, 0.74, vb.z], [0.84, 0.05, 0.8], st.paint(COL.charcoal))
  for (let i = 0; i < 4; i++) valveWheel(b, [vb.x - 0.18 + (i % 2) * 0.36, 0.8 + (i > 1 ? 0.05 : 0), vb.z - 0.15 + Math.floor(i / 2) * 0.3], 0.13, 'y')
  b.cylY(vb.x + 0.47, 0, vb.z + 0.3, 0.035, 1.55, st.paint(COL.charcoal), 6)
  signBoard(k, b, 'warn:robot', [vb.x + 0.5, 1.3, vb.z + 0.3], 0.62, -Math.PI / 2)
  const robot = robotArm(k, b, { name: 'pipe:robot', x: PIPE.robot.x, z: PIPE.robot.z, yaw: Math.PI / 2, color: COL.safety, tool: 'gripper' }, (sb) => {
    valveWheel(sb, [PIPE.robot.x, 0.98 + 1.05 + 0.95 + 0.26 + 0.05, PIPE.robot.z], 0.14, 'y')
  })
  if (k.detail) b.box([PIPE.robot.x + 0.36, 0.02, PIPE.robot.z], [0.06, 0.04, 1.2], st.paint(COL.hazard))

  // ---------------------------------------------------------------- strapping station
  const sz = PIPE.strapperZ
  for (const s of [-1, 1]) {
    b.rbox([X + s * 0.88, 1.2, sz], [0.18, 2.4, 0.36], st.paint(COL.machineGreen), 0.03)
    b.box([X + s * 0.88, 0.03, sz], [0.4, 0.06, 0.5], st.paint(COL.charcoal))
  }
  b.rbox([X, 2.42, sz], [2.0, 0.24, 0.42], st.paint(COL.machineGreen), 0.04)
  b.cylAxis([X + 1.1, 1.75, sz], 'x', 0.22, 0.1, st.paint(COL.hazard, 0.5, 0.2), 16)
  b.cylAxis([X + 1.1, 1.75, sz], 'x', 0.08, 0.16, st.metal(COL.steel), 8)
  const strapHead = rig.add('pipe:strapHead', 0, [X, 2.1, sz], 0)
  S.bone(strapHead, () => {
    S.rbox([X, 2.05, sz], [0.9, 0.3, 0.3], st.paint(COL.greenDark), 0.03)
    S.box([X, 1.84, sz], [0.82, 0.12, 0.2], st.paint(COL.hazard))
    S.cylY(X, 2.2, sz, 0.06, 0.4, st.metal(COL.chrome), 8)
  })
  const light = stackLight(k, b, X - 0.88, 2.54, sz)
  const qcLamp = k.lamps.add([X + 0.6, 2.54, sz], [0, 1, 0], 0.07, 0.09)
  if (k.detail) boltRing(b, [X, 2.42, sz + 0.21], 0.15, 6, 'z', st.metal(COL.steel), 0.02, 0.02)

  // ---------------------------------------------------------------- animation
  const sparks = new Emitter()
  const jit = new Jitter(2023)
  const tp: ToolPose = { f: 0, u: 0, r: 0, holding: false }
  const fw = { x: -1, z: 0 } // robot faces west (toward the belt)
  const rt = { x: 0, z: -1 } // its right is north (toward the valve bin)

  return {
    update(f: Frame) {
      const L = f.s.lines.pipe
      const fx = f.fx
      const u = lineU(L)
      const ph = L.rate > 0 ? L.phase : 0
      const running = L.rate > 0
      fx.belts.setSpeed(beltId, L.beltSpeed * 16)
      fx.belts.setSpeed(liftId, -0.8)
      // lathe
      rig.pose(spindle, 0, 0, u * Math.PI * 2 * 5)
      const lf = latheFeed(ph)
      rig.pose(carriage, 0, 0, 0, 0, 0, -feedLen * lf.feed)
      if (running && lf.cutting) {
        const n = sparks.take((f.reduced ? 14 : 34) * fx.emit, f.dt)
        const tz = headZ - 0.62 - feedLen * lf.feed
        for (let i = 0; i < n; i++)
          fx.sparks.emit(ax + 0.12, ay + 0.02, tz, 1.8 + jit.next() * 2.6, 0.4 + jit.sym() * 1.8, jit.sym() * 1.4, 0.3 + jit.next() * 0.45, 0.03, 3.4, 1.9, 0.6, 0.035)
        fx.sparks.glow(ax + 0.13, ay + 0.02, tz, 0.35, 2.2, 1.3, 0.5, f.reduced ? 0.35 : 0.6 + 0.4 * jit.next())
      }
      // bender (clamp at 0.3, swing after)
      rig.pose(bendArm, 0, (Math.PI / 2) * benderSwing(ph), 0)
      // valve robot
      valveRobot(ph, tp)
      const tx = PIPE.robot.x + tp.f * fw.x + tp.r * rt.x
      const tz = PIPE.robot.z + tp.f * fw.z + tp.r * rt.z
      robot.reach(rig, tx, tp.u, tz, Math.PI)
      rig.pose(robot.carry, 0, 0, 0, 0, 0, 0, tp.holding ? 1 : 0)
      // strapper
      rig.pose(strapHead, 0, 0, 0, 0, -0.62 * strapperHead(ph), 0)
      // lights
      setStackLight(fx, light, L.status, L.rate, L.defectFlash, f.t, f.reduced)
      fx.lamps.light(qcLamp, L.defectFlash > 0 ? LAMP.red : LAMP.green, L.defectFlash > 0 ? (f.reduced ? 1 : Math.sin(f.t * 20) > 0 ? 1 : 0.25) : 0.85)
    },
  }
}
