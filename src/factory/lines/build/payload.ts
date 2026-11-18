/**
 * LINE 5 — Payload Packing & QC: an overhead monorail along the main aisle
 * (x = MONORAIL.x, west of the centerline so the aisle keeps a clear view of the
 * rocket on the tower axis and of the pad; rail underside at 6.2 m) from the
 * packing station (south) into the tower's south face, carried by yellow portal
 * frames and the QC scanner arch.
 *
 * The arch (z = 11) scans pods through its ring and sweeps a light band across
 * the aisle. A caught payload defect (defectFlash > 0) drops a pod down the
 * reject chute into the REJECTS bin ('boing'). A visitor walking through the
 * arch gets a big comedic toast (at most once per 60 s) + achievement + beep.
 */
import { events } from '@/core/events'
import { runtime } from '@/core/runtime'
import type { Vec3 } from '@/core/types'
import { director } from '@/systems/director'
import { ARCH, MONORAIL, PACKING, POD, REJECT, TOWER_HATCH, lineDef, zAt } from '../config'
import { QcArchMonitor, REJECT_TIMES, rejectPose, type RejectPose } from '../logic'
import { CH, FX } from '../render/materials'
import { LAMP } from '../render/lamps'
import type { Animator, Frame, Kit } from './kit'
import { COL, signBoard, st } from './parts'

export const QC_TOAST = 'QC SCANNER: REJECTED — TOO MUCH INITIATIVE'

/** Rejected pods (falling + resting in the bin), read by the item renderer. */
export interface RejectState {
  /** Live poses (falling first, then resting), `count` valid entries. */
  poses: RejectPose[]
  /** Item kind seed (cycle) per pose. */
  cycles: number[]
  count: number
}

interface Falling {
  t: number
  slot: number
  cycle: number
  fromZ: number
  boinged: boolean
}

export interface PayloadAnimator extends Animator {
  rejects: RejectState
  /** Debug: trigger the visitor reaction / a reject drop. */
  debugReject(): void
  debugVisitor(): void
  stats(): { triggers: number; toasts: number; rejectsDropped: number }
}

export function buildPayload(k: Kit): PayloadAnimator {
  const b = k.center
  const S = k.skin
  const rig = k.rig
  const line = lineDef('payload')
  const yellow = st.paint(COL.hazard, 0.5, 0.25)
  const dark = st.paint(COL.charcoal, 0.55, 0.35)
  const RY = MONORAIL.y
  const X = MONORAIL.x

  // ---------------------------------------------------------------- rail
  const zS = MONORAIL.zSouth
  const zN = MONORAIL.zNorth
  const rl = zS - zN
  const rz = (zS + zN) / 2
  b.box([X, RY + 0.02, rz], [0.3, 0.04, rl], st.metal(COL.gunmetal, 0.4, 0.7))
  b.box([X, RY + 0.17, rz], [0.05, 0.27, rl], st.metal(COL.gunmetal, 0.4, 0.7))
  b.box([X, RY + 0.32, rz], [0.3, 0.04, rl], st.metal(COL.gunmetal, 0.4, 0.7))
  b.box([X, RY + 0.17, zS + 0.05], [0.34, 0.4, 0.1], yellow)

  // ---------------------------------------------------------------- portals
  const px = MONORAIL.portalX
  const pl = MONORAIL.portalLeg
  const ptop = MONORAIL.portalTop
  for (const z of MONORAIL.portalZ) {
    for (const s of [-1, 1]) {
      b.rbox([s * px, ptop / 2, z], [pl, ptop, pl], yellow, 0.04)
      k.hazard.box([s * px, 0.6, z], [pl + 0.03, 1.2, pl + 0.03], st.white)
      b.box([s * px, 0.03, z], [pl + 0.36, 0.06, pl + 0.36], dark)
      b.cyl([s * px, ptop - 1.1, z], [s * (px - 1.0), MONORAIL.portalBeamY0, z], 0.06, yellow, 8)
    }
    b.rbox([0, (MONORAIL.portalBeamY0 + ptop) / 2, z], [2 * px + pl, ptop - MONORAIL.portalBeamY0, 0.4], yellow, 0.05)
    for (const s of [-1, 1]) b.cyl([X + s * 0.11, RY + 0.34, z], [X + s * 0.11, MONORAIL.portalBeamY0, z], 0.035, st.metal(COL.steel), 6)
    b.box([X, RY + 0.36, z], [0.36, 0.04, 0.22], dark)
  }
  // line board on the first portal (south face, on the side away from the rail and pods)
  const p0 = MONORAIL.portalZ[0]
  const sx0 = -Math.sign(X) * 2.35
  for (const x of [sx0 - 1.1, sx0 + 1.1]) b.cyl([x, MONORAIL.portalBeamY0, p0 + 0.2], [x, 6.35, p0 + 0.2], 0.02, st.metal(COL.steel), 4)
  signBoard(k, b, 'line:payload', [sx0, 6.3, p0 + 0.24], 2.4, Math.PI)

  // ---------------------------------------------------------------- QC arch
  const az = ARCH.z
  const ry = ARCH.ringY
  for (const s of [-1, 1]) {
    const lx = s * ARCH.legX
    k.hazard.box([lx, ARCH.top / 2, az], [ARCH.legW, ARCH.top, ARCH.legW], st.white)
    b.rbox([lx, 0.08, az], [ARCH.legW + 0.3, 0.16, ARCH.legW + 0.3], dark, 0.03)
    b.rbox([lx, ARCH.top - 0.12, az], [ARCH.legW + 0.1, 0.24, ARCH.legW + 0.1], dark, 0.03)
    // light strips on the inner faces
    const ix = s * (ARCH.inner - 0.005)
    for (const dz of [-0.16, 0.16]) b.box([ix, 2.45, az + dz], [0.02, 4.2, 0.05], st.glow('#ffffff', 1.8, CH.ARCH))
    b.box([ix - s * 0.02, 2.45, az], [0.03, 4.3, 0.2], dark)
  }
  // beam halves meet the scanner ring (which sits on the monorail, west of the centerline)
  const by = (ARCH.beamY0 + ARCH.top) / 2
  const ringOut = ARCH.ringR + ARCH.ringTube
  const ringHalf = Math.sqrt(Math.max(0, ringOut * ringOut - (by - ry) * (by - ry))) - 0.04
  const legOut = ARCH.legX + ARCH.legW / 2
  for (const [x0, x1] of [
    [-legOut, X - ringHalf],
    [X + ringHalf, legOut],
  ] as const) {
    if (x1 - x0 < 0.05) continue
    b.rbox([(x0 + x1) / 2, by, az], [x1 - x0, ARCH.top - ARCH.beamY0, 0.56], dark, 0.05)
    b.box([(x0 + x1) / 2, ARCH.beamY0 + 0.02, az], [x1 - x0, 0.04, 0.6], yellow)
  }
  b.torus([X, ry, az], ARCH.ringR, ARCH.ringTube, dark, 'z', Math.PI * 2, 10, 40)
  b.torus([X, ry, az + 0.2], ARCH.ringR - 0.1, 0.035, st.glow('#ffffff', 2.0, CH.ARCH), 'z', Math.PI * 2, 6, 40)
  b.torus([X, ry, az - 0.2], ARCH.ringR - 0.1, 0.035, st.glow('#ffffff', 2.0, CH.ARCH), 'z', Math.PI * 2, 6, 40)
  b.torus([X, ry, az], ARCH.ringR + 0.05, 0.06, yellow, 'z', Math.PI * 2, 6, 40)
  // signs on the long beam half: QUALITY CONTROL over the walkway, REJECTED lightbox beside it
  const sq = X + ringHalf + 0.12 + 1.175
  const sr = sq + 1.175 + 0.1 + 1.075
  signBoard(k, b, 'arch:qc', [sq, by, az + 0.29], 2.35, Math.PI)
  signBoard(k, b, 'arch:rejected', [sr, by, az + 0.29], 2.15, Math.PI, { emis: 1, chan: CH.REJECT })
  signBoard(k, b, 'arch:qc', [sq, by, az - 0.29], 2.35, 0)
  signBoard(k, b, 'arch:rejected', [sr, by, az - 0.29], 2.15, 0, { emis: 1, chan: CH.REJECT })
  const beacons = [k.lamps.add([-ARCH.legX, ARCH.top, az], [0, 1, 0], 0.13, 0.2), k.lamps.add([ARCH.legX, ARCH.top, az], [0, 1, 0], 0.13, 0.2)]
  // rotor: a spinning scanner collar on the ring's north face (heads stay outside the pod path)
  const rz0 = az - 0.24
  const rotor = rig.add('qc:rotor', 0, [X, ry, rz0], 0)
  S.bone(rotor, () => {
    S.torus([X, ry, rz0], ARCH.ringR - 0.02, 0.03, st.metal(COL.steel), 'z', Math.PI * 2, 5, 36)
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2
      const r = ARCH.ringR - 0.04
      S.rbox([X + Math.cos(a) * r, ry + Math.sin(a) * r, rz0], [0.13, 0.13, 0.16], dark, 0.03, [0, 0, a])
      S.sphere([X + Math.cos(a) * (r - 0.08), ry + Math.sin(a) * (r - 0.08), rz0], 0.035, st.glow('#ffffff', 2.4, CH.ARCH), 8, 6)
    }
  })
  // sweeping scan bar + light band (FX shares the bone)
  const scan = rig.add('qc:scan', 0, [0, 0.3, az], 0)
  S.bone(scan, () => {
    S.box([0, 0.3, az], [ARCH.inner * 2 - 0.02, 0.025, 0.025], st.glow('#ffffff', 3, CH.ARCH))
    for (const s of [-1, 1]) S.box([s * (ARCH.inner - 0.04), 0.3, az], [0.08, 0.1, 0.24], dark)
  })
  k.fx.bone(scan, () => {
    k.fx.quad([0, 0.3, az], ARCH.inner * 2, 0.9, 0, { color: '#ffffff', chan: FX.SCAN })
  })
  k.fx.bone(0, () => {
    k.fx.quad([X, ry, az], ARCH.ringR * 2.1, ARCH.ringR * 2.1, 0, { color: '#ffffff', chan: FX.RINGSCAN })
  })

  // ---------------------------------------------------------------- reject chute + bin
  const [ax0, ay0, az0] = REJECT.chuteA
  const [bx0, by0, bz0] = REJECT.chuteB
  const dx = bx0 - ax0
  const dy = by0 - ay0
  const dz = bz0 - az0
  const hlen = Math.hypot(dx, dz)
  const len = Math.hypot(hlen, dy)
  const yaw = Math.atan2(-dx, -dz)
  const pitch = Math.atan2(dy, hlen)
  const cx = (ax0 + bx0) / 2
  const cy = (ay0 + by0) / 2 - 0.42
  const cz = (az0 + bz0) / 2
  b.frame(cx, cy, cz, yaw, () => {
    b.box([0, 0, 0], [0.82, 0.05, len], yellow)
    for (const s of [-1, 1]) b.box([s * 0.42, 0.13, 0], [0.04, 0.3, len], yellow)
    // dark pan + cross ribs underneath: from the aisle it reads as a steel chute, not a plank
    b.box([0, -0.06, 0], [0.88, 0.07, len - 0.04], dark)
    for (let i = 0; i < 4; i++) b.box([0, -0.13, -len / 2 + 0.3 + (i * (len - 0.6)) / 3], [0.92, 0.07, 0.09], dark)
  }, pitch)
  k.hazard.frame(cx, cy, cz, yaw, () => {
    for (const s of [-1, 1]) k.hazard.box([s * 0.445, 0.19, 0], [0.012, 0.13, len - 0.12], st.white)
  }, pitch)
  // strut from the arch leg on the chute's side + hanger from the ring
  const cs = Math.sign(bx0 - ax0) || 1
  b.cyl([cs * (ARCH.legX - 0.2), 3.1, ARCH.z + ARCH.legW / 2 - 0.05], [(ax0 + bx0) / 2 + cs * 0.3, (ay0 + by0) / 2 - 0.5, (az0 + bz0) / 2], 0.05, dark, 6)
  b.cyl([ax0 + cs * 0.1, ay0 - 0.35, az0], [X + cs * 0.4, ry - ARCH.ringR - ARCH.ringTube * 0.5, az], 0.04, dark, 6)
  const B = REJECT.bin
  const bxc = (B.minX + B.maxX) / 2
  const bzc = (B.minZ + B.maxZ) / 2
  const bw = B.maxX - B.minX
  const bd = B.maxZ - B.minZ
  const red = st.paint(COL.red, 0.6, 0.2)
  b.box([bxc, 0.08, bzc], [bw, 0.16, bd], dark)
  for (const sx of [-1, 1]) b.box([bxc + sx * (bw / 2 - 0.03), REJECT.binH / 2, bzc], [0.06, REJECT.binH, bd], red)
  for (const sz of [-1, 1]) b.box([bxc, REJECT.binH / 2, bzc + sz * (bd / 2 - 0.03)], [bw, REJECT.binH, 0.06], red)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box([bxc + sx * (bw / 2), REJECT.binH / 2 + 0.04, bzc + sz * (bd / 2)], [0.09, REJECT.binH + 0.08, 0.09], dark)
  // side sign faces the aisle
  const binAisleX = Math.abs(B.minX) < Math.abs(B.maxX) ? B.minX - 0.035 : B.maxX + 0.035
  signBoard(k, b, 'bin:rejects', [binAisleX, 0.68, bzc], 1.15, (Math.sign(binAisleX) * Math.PI) / 2)
  signBoard(k, b, 'bin:rejects', [bxc, 0.68, B.maxZ + 0.035], 1.0, Math.PI)

  // ---------------------------------------------------------------- packing station (south end)
  const P = PACKING
  const pzc = (P.z0 + P.z1) / 2
  const PX = P.x
  b.rbox([PX, (P.y0 + P.y1) / 2, pzc], [P.halfW * 2, P.y1 - P.y0, P.z1 - P.z0], yellow, 0.08)
  b.box([PX, P.y0 + 0.04, pzc], [P.halfW * 2 + 0.06, 0.08, P.z1 - P.z0 + 0.06], dark)
  b.box([PX, P.y1 - 0.02, pzc], [P.halfW * 2 + 0.06, 0.06, P.z1 - P.z0 + 0.06], dark)
  for (const sx of [-1, 1]) b.box([PX + sx * 0.95, ptop + 0.15, (p0 + P.z1) / 2], [0.16, 0.3, P.z1 - p0 + 0.2], yellow)
  for (const sx of [-1, 1]) b.cyl([PX + sx * 0.95, P.y1 + 0.02, P.z0 + 0.4], [PX + sx * 0.95, ptop - 0.2, p0 + 0.25], 0.05, yellow, 6)
  signBoard(k, b, 'packing', [PX, (P.y0 + P.y1) / 2 + 0.1, P.z1 + 0.04], 2.35, Math.PI)
  // exit hatch (north face) — opens as each pod leaves
  b.box([PX, P.y0 + 0.75, P.z0 - 0.02], [1.1, 1.3, 0.04], st.paint(COL.black, 0.9, 0.1))
  const hatch = rig.add('pack:hatch', 0, [PX, P.y0 + 1.42, P.z0 - 0.06], 0)
  S.bone(hatch, () => {
    S.box([PX, P.y0 + 0.77, P.z0 - 0.06], [1.15, 1.32, 0.05], st.paint(COL.safety, 0.55, 0.2))
    S.box([PX, P.y0 + 0.77, P.z0 - 0.09], [0.9, 0.08, 0.02], dark)
  })
  const packBeacon = k.lamps.add([PX + P.halfW - 0.25, P.y1 + 0.02, P.z1 - 0.3], [0, 1, 0], 0.11, 0.16)
  // pod-arrival light curtain lamps along the south face
  const packLight = k.lamps.add([PX - P.halfW + 0.25, P.y1 + 0.02, P.z1 - 0.3], [0, 1, 0], 0.11, 0.16)

  // ---------------------------------------------------------------- tower intake hatch (north end)
  const T = TOWER_HATCH
  const tzc = (T.z0 + T.z1) / 2
  const TX = T.x
  b.rbox([TX, (T.y0 + T.y1) / 2, tzc], [T.halfW * 2, T.y1 - T.y0, T.z1 - T.z0], dark, 0.06)
  b.box([TX, T.y0 + 1.05, T.z1 + 0.01], [0.86, 1.45, 0.03], st.paint(COL.black, 0.95, 0.05))
  for (let i = 0; i < 4; i++) b.box([TX - 0.3 + i * 0.2, T.y0 + 1.05, T.z1 + 0.025], [0.16, 1.4, 0.01], { color: '#2a2f30', rough: 0.4, metal: 0.1 })
  signBoard(k, b, 'intake', [TX, T.y1 - 0.42, T.z1 + 0.03], 0.95, Math.PI)
  k.hazard.box([TX, T.y0 + 0.05, T.z1 + 0.02], [T.halfW * 2, 0.1, 0.04], st.white)

  // ---------------------------------------------------------------- animation + gameplay
  // Teleports are recognised by runtime.player.teleportSeq; maxStep is only a sanity bound
  // (6 m: a walking/running visitor never moves that far in one frame, even at 2-3 fps).
  const monitor = new QcArchMonitor(ARCH.z, ARCH.detectHalfW, { beepGap: 1.2, toastGap: 60, maxStep: 6 })
  const falling: Falling[] = []
  const resting: Array<{ slot: number; cycle: number }> = []
  let nextSlot = 0
  let prevFlash = 0
  let visitorT = -Infinity
  let triggers = 0
  let toasts = 0
  let dropped = 0
  /** Visitor-facing clock (accumulated frame time): a sim reset / debug advance never re-arms or blocks the toast. */
  let wallT = 0
  const rejects: RejectState = { poses: Array.from({ length: 8 }, () => ({ x: 0, y: 0, z: 0, rx: 0, rz: 0 })), cycles: new Array(8).fill(0), count: 0 }
  const podY = RY - POD.hang
  const tmp: RejectPose = { x: 0, y: 0, z: 0, rx: 0, rz: 0 }
  const beep: Vec3 = [0, 2.2, ARCH.z]

  const startReject = (cycle: number) => {
    if (falling.length >= 3) return
    falling.push({ t: 0, slot: nextSlot++, cycle, fromZ: ARCH.z, boinged: false })
    dropped++
  }

  const visitorPass = (now: number, toast: boolean) => {
    triggers++
    visitorT = now
    if (toast && director.request({ id: 'qc-arch-rejected', kind: 'player', cooldown: 60, duration: 1 })) {
      monitor.commitToast(now)
      toasts++
      events.emit('toast', { text: QC_TOAST, kind: 'warning', duration: 4.5 })
      events.emit('achievement', { id: 'qc-rejected' })
    }
  }

  const anim: PayloadAnimator = {
    rejects,
    debugReject: () => startReject(Math.floor(Math.random() * 1000)),
    debugVisitor: () => {
      visitorPass(wallT, true)
      events.emit('sfx', { name: 'scanner-beep', position: beep })
    },
    stats: () => ({ triggers, toasts, rejectsDropped: dropped }),
    update(f: Frame) {
      const L = f.s.lines.payload
      const fx = f.fx
      const t = f.t
      wallT += f.dt
      // visitor through the arch (feet crossing z = ARCH.z inside the opening)
      const p = runtime.player.position
      const onFoot = runtime.player.mode === 'foot'
      const r = monitor.step(p.x, p.z, onFoot, wallT, runtime.player.teleportSeq)
      if (r.pass) {
        visitorPass(wallT, r.toast)
        if (r.beep) fx.sfx('scanner-beep', beep)
      }
      // caught payload defect → a pod drops into the reject bin
      if (L.defectFlash > 0 && prevFlash <= 0) startReject(L.cycles)
      prevFlash = L.defectFlash
      let n = 0
      for (let i = falling.length - 1; i >= 0; i--) {
        const fp = falling[i]
        fp.t += f.dt
        const done = rejectPose(fp.t, podY, fp.fromZ, fp.slot, tmp)
        if (!fp.boinged && fp.t >= REJECT_TIMES.land) {
          fp.boinged = true
          fx.sfx('boing', [tmp.x, tmp.y + 0.3, tmp.z])
          for (let q = 0; q < Math.round(6 * fx.emit); q++) fx.puffs.emit(tmp.x, 0.9, tmp.z, Math.cos(q) * 0.8, 0.4, Math.sin(q) * 0.8, 0.8, 0.2, 0.7, 0.35, 0.7, 0.66, 0.6, 0.1)
        }
        if (done) {
          falling.splice(i, 1)
          resting.push({ slot: fp.slot, cycle: fp.cycle })
          if (resting.length > REJECT.maxInBin) resting.shift()
        }
      }
      for (const fp of falling) {
        if (n >= rejects.poses.length) break
        rejectPose(fp.t, podY, fp.fromZ, fp.slot, rejects.poses[n])
        rejects.cycles[n++] = fp.cycle
      }
      for (const rs of resting) {
        if (n >= rejects.poses.length) break
        rejectPose(99, podY, ARCH.z, rs.slot, rejects.poses[n])
        rejects.cycles[n++] = rs.cycle
      }
      rejects.count = n

      // arch state colors: green scanning, amber while the line waits, red on a reject
      const visitorHot = wallT - visitorT < 2.5
      const hot = visitorHot || L.defectFlash > 0
      const blink = f.reduced ? 1 : Math.sin(t * 16) > 0 ? 1 : 0.35
      if (hot) fx.chan[CH.ARCH].set(2.6 * blink, 0.25 * blink, 0.2 * blink)
      else if (L.status === 'blocked') fx.chan[CH.ARCH].set(2.2, 1.2, 0.2)
      else fx.chan[CH.ARCH].set(0.18, 1.15, 0.55)
      fx.chan[CH.REJECT].set(hot ? 2.4 * blink : 0.12, hot ? 0.35 * blink : 0.05, hot ? 0.3 * blink : 0.05)
      for (const bi of beacons) fx.lamps.light(bi, hot ? LAMP.red : L.status === 'blocked' ? LAMP.amber : LAMP.green, hot ? blink : 0.8)
      // scanner motion (from sim time → deterministic)
      const sweep = f.reduced ? 0.6 : 1.4
      const sy = 0.25 + 4.0 * (0.5 - 0.5 * Math.cos(t * sweep))
      rig.pose(scan, 0, 0, 0, 0, sy - 0.3, 0)
      rig.pose(rotor, 0, 0, t * (f.reduced ? 0.6 : 1.8))
      if (hot) fx.fxChan[FX.SCAN].set(0.5, 0.06, 0.05)
      else fx.fxChan[FX.SCAN].set(0.1, 0.42, 0.26)
      // ring glow while a pod passes through it
      let near = 9
      for (let i = 0; i < L.items.length; i++) near = Math.min(near, Math.abs(zAt(line, L.items[i]) - ARCH.z))
      const ring = Math.max(0, 1 - near / 0.9)
      fx.fxChan[FX.RINGSCAN].set(hot ? 0.6 * ring : 0.12 * ring, hot ? 0.05 : 0.5 * ring, hot ? 0.05 : 0.32 * ring)
      // packing hatch opens as each pod leaves (sim wrap)
      const ph = L.rate > 0 ? L.phase : 0
      const open = ph > 0.86 ? (ph - 0.86) / 0.14 : ph < 0.14 ? 1 - ph / 0.14 : 0
      rig.pose(hatch, 1.25 * open, 0, 0)
      fx.lamps.light(packBeacon, LAMP.amber, open > 0.05 ? (f.reduced ? 1 : Math.sin(t * 12) > 0 ? 1 : 0.3) : 0.08)
      fx.lamps.light(packLight, L.status === 'blocked' ? LAMP.amber : LAMP.green, L.rate > 0 || L.beltSpeed > 0 ? 0.9 : 0.4)
    },
  }
  return anim
}
