/**
 * Elevated collector (z = 0, belt top 4.8 m): two halves carry every ground
 * line's output toward the middle, where transfer belts at x = ±1.5 turn north
 * into the tower's south face (flanking the payload monorail). Supports stand
 * only at x = ±9 and ±16 (north of the belt, clear of the crosswalk, the
 * walkways and the main aisle); the transfers hang from the last monorail portal.
 */
import { yawFromDirection } from '@/core/math'
import { COLLECTOR_CFG, MONORAIL } from '../config'
import type { Animator, Frame, Kit } from './kit'
import { COL, st } from './parts'

export function buildCollector(k: Kit): Animator {
  const b = k.center
  const C = COLLECTOR_CFG
  const y = C.y
  const hw = C.halfW
  const frame = st.paint(COL.gunmetal, 0.55, 0.35)
  const trim = st.paint(COL.hazard, 0.5, 0.25)
  const tile = 0.8
  const ids: number[] = []

  /** Straight belt section with frame + truss from (x0, z0) to (x1, z1); items move toward (x1, z1). */
  const section = (x0: number, z0: number, x1: number, z1: number, dy = 0) => {
    const dx = x1 - x0
    const dz = z1 - z0
    const len = Math.hypot(dx, dz)
    const yaw = yawFromDirection(dx / len, dz / len)
    const cx = (x0 + x1) / 2
    const cz = (z0 + z1) / 2
    const id = k.belts.add(tile)
    ids.push(id)
    k.belt.belt(id, () => k.belt.quad([cx, y + dy, cz], hw * 2, len, yaw, st.white, [0, 0, 1, len / tile], -Math.PI / 2))
    b.frame(cx, y + dy, cz, yaw, () => {
      b.box([0, -0.04, 0], [hw * 2 + 0.02, 0.06, len], st.paint(COL.iron))
      b.box([0, -0.3, 0], [hw * 2 - 0.1, 0.02, len - 0.1], st.rubber)
      for (const s of [-1, 1]) {
        b.rbox([s * (hw + 0.06), -0.08, 0], [0.1, 0.28, len + 0.1], frame, 0.02)
        b.box([s * (hw + 0.06), 0.07, 0], [0.11, 0.03, len + 0.1], trim)
        // truss under the gallery
        b.box([s * (hw - 0.05), -0.78, 0], [0.08, 0.08, len], frame)
      }
      const n = Math.max(2, Math.round(len / 1.5))
      for (let i = 0; i <= n; i++) {
        const z = -len / 2 + (len * i) / n
        for (const s of [-1, 1]) {
          b.box([s * (hw - 0.05), -0.48, z], [0.07, 0.6, 0.07], frame)
          if (i < n) b.cyl([s * (hw - 0.05), -0.78, z], [s * (hw - 0.05), -0.2, z + len / n], 0.03, frame, 4)
        }
        b.box([0, -0.78, z], [hw * 2 - 0.1, 0.06, 0.06], frame)
      }
      for (const z of [-len / 2 + 0.1, len / 2 - 0.1]) b.cylAxis([0, -0.13, z], 'x', 0.12, hw * 2, st.metal(COL.steel), 12)
    })
  }

  for (const side of [-1, 1]) {
    section(side * C.outerX, C.z, side * (C.innerX - hw + 0.05), C.z)
    section(side * C.innerX, C.z + hw, side * C.innerX, C.transferZEnd, -0.03)
    // tower intake mouth at the transfer end
    const mx = side * C.innerX
    b.rbox([mx, y + 0.2, C.transferZEnd - 0.2], [1.25, 1.3, 0.62], st.paint(COL.charcoal, 0.6, 0.3), 0.05)
    b.box([mx, y + 0.18, C.transferZEnd + 0.12], [0.98, 0.7, 0.02], st.paint(COL.black, 0.95, 0.05))
    b.box([mx, y + 0.86, C.transferZEnd + 0.12], [1.25, 0.08, 0.04], trim)
    // hangers from the last monorail portal
    const pz = MONORAIL.portalZ[MONORAIL.portalZ.length - 1]
    for (const dx of [-0.38, 0.38]) b.cyl([mx + dx, MONORAIL.portalBeamY0, pz], [mx + dx, y + 0.12, pz], 0.025, st.metal(COL.steel), 5)
  }
  // support columns (x = ±9, ±16) north of the belt with T-heads
  for (const x of C.supportX) {
    const z = C.supportZ
    const top = y - 0.82
    b.rbox([x, top / 2, z], [0.32, top, 0.32], frame, 0.03)
    k.hazard.box([x, 0.6, z], [0.35, 1.2, 0.35], st.white)
    b.box([x, 0.03, z], [0.62, 0.06, 0.62], st.paint(COL.charcoal))
    b.box([x, top + 0.06, (z + hw + 0.2) / 2], [0.36, 0.14, hw + 0.2 - z + 0.2], frame)
    b.cyl([x, top - 1.1, z], [x, top, z + 0.75], 0.05, frame, 6)
  }

  return {
    update(f: Frame) {
      const speed = 1.1 * (Number.isFinite(f.s.params.conveyorSpeed) ? f.s.params.conveyorSpeed : 1)
      for (const id of ids) f.fx.belts.setSpeed(id, speed)
    },
  }
}
