/**
 * Transporter track: the TRACK polyline from world/layout.ts with every
 * interior corner replaced by a tangent arc of `cornerRadius`. Arc-length
 * parametrized; pure math (no three.js), allocation-free sampling.
 */
import { yawFromDirection } from '@/core/math'
import type { Vec2 } from '@/core/types'
import { TRACK } from '@/world/layout'

interface LineSeg {
  kind: 'line'
  s0: number
  len: number
  ax: number
  az: number
  dx: number
  dz: number
}

interface ArcSeg {
  kind: 'arc'
  s0: number
  len: number
  cx: number
  cz: number
  r: number
  a0: number
  /** Signed sweep (radians). */
  sweep: number
}

type Seg = LineSeg | ArcSeg

export interface TrackPoint {
  x: number
  z: number
  /** Heading yaw (forward along increasing s). */
  yaw: number
  /** Unit tangent. */
  tx: number
  tz: number
}

export interface TrackProjection {
  s: number
  /** Signed lateral offset: + = right of the travel direction. */
  lateral: number
  distance: number
}

export class TrackPath {
  readonly segs: Seg[] = []
  readonly length: number

  constructor(points: readonly Vec2[], cornerRadius: number) {
    const pts = points.map((p) => [p[0], p[1]] as Vec2)
    let s = 0
    let cur: Vec2 = pts[0]
    for (let i = 1; i < pts.length; i++) {
      const b = pts[i]
      const a = pts[i - 1]
      const dx = b[0] - a[0]
      const dz = b[1] - a[1]
      const segLen = Math.hypot(dx, dz)
      if (segLen < 1e-6) continue
      const ux = dx / segLen
      const uz = dz / segLen
      let endTrim = 0
      let arc: ArcSeg | null = null
      if (i < pts.length - 1) {
        const c = pts[i + 1]
        const ex = c[0] - b[0]
        const ez = c[1] - b[1]
        const nextLen = Math.hypot(ex, ez)
        if (nextLen > 1e-6) {
          const vx = ex / nextLen
          const vz = ez / nextLen
          const cross = ux * vz - uz * vx
          const dot = Math.max(-1, Math.min(1, ux * vx + uz * vz))
          const turn = Math.acos(dot)
          if (turn > 1e-4 && cornerRadius > 0) {
            const trim = Math.min(cornerRadius * Math.tan(turn / 2), segLen * 0.5, nextLen * 0.5)
            const r = trim / Math.tan(turn / 2)
            endTrim = trim
            // left normal (relative to travel) for a left turn (cross < 0 in x-right / z-down plane)
            const side = cross < 0 ? -1 : 1
            const nx = -uz * side
            const nz = ux * side
            // nx,nz points toward the arc centre
            const tx0 = b[0] - ux * trim
            const tz0 = b[1] - uz * trim
            const cx = tx0 + nx * r
            const cz = tz0 + nz * r
            const a0 = Math.atan2(tz0 - cz, tx0 - cx)
            arc = { kind: 'arc', s0: 0, len: r * turn, cx, cz, r, a0, sweep: turn * side }
          }
        }
      }
      const startX = cur[0]
      const startZ = cur[1]
      const endX = b[0] - ux * endTrim
      const endZ = b[1] - uz * endTrim
      const lineLen = Math.hypot(endX - startX, endZ - startZ)
      if (lineLen > 1e-6) {
        this.segs.push({ kind: 'line', s0: s, len: lineLen, ax: startX, az: startZ, dx: ux, dz: uz })
        s += lineLen
      }
      if (arc) {
        arc.s0 = s
        this.segs.push(arc)
        s += arc.len
        const a1 = arc.a0 + arc.sweep
        cur = [arc.cx + Math.cos(a1) * arc.r, arc.cz + Math.sin(a1) * arc.r]
      } else cur = [endX, endZ]
    }
    this.length = s
  }

  /** Sample the track at arc length `s` (clamped to [0, length]) into `out`. */
  sample(s: number, out: TrackPoint): TrackPoint {
    const segs = this.segs
    const ss = Number.isFinite(s) ? Math.min(this.length, Math.max(0, s)) : 0
    let seg = segs[segs.length - 1]
    for (let i = 0; i < segs.length; i++) {
      if (ss <= segs[i].s0 + segs[i].len) {
        seg = segs[i]
        break
      }
    }
    const t = Math.min(seg.len, Math.max(0, ss - seg.s0))
    if (seg.kind === 'line') {
      out.x = seg.ax + seg.dx * t
      out.z = seg.az + seg.dz * t
      out.tx = seg.dx
      out.tz = seg.dz
    } else {
      const a = seg.a0 + (seg.sweep * t) / seg.len
      out.x = seg.cx + Math.cos(a) * seg.r
      out.z = seg.cz + Math.sin(a) * seg.r
      const sgn = seg.sweep >= 0 ? 1 : -1
      out.tx = -Math.sin(a) * sgn
      out.tz = Math.cos(a) * sgn
    }
    out.yaw = yawFromDirection(out.tx, out.tz)
    return out
  }

  /** Nearest point on the track to (x, z). */
  project(x: number, z: number, out: TrackProjection): TrackProjection {
    let bestD = Infinity
    let bestS = 0
    let bestLat = 0
    for (const seg of this.segs) {
      let s: number
      let px: number
      let pz: number
      let tx: number
      let tz: number
      if (seg.kind === 'line') {
        const t = Math.min(seg.len, Math.max(0, (x - seg.ax) * seg.dx + (z - seg.az) * seg.dz))
        px = seg.ax + seg.dx * t
        pz = seg.az + seg.dz * t
        tx = seg.dx
        tz = seg.dz
        s = seg.s0 + t
      } else {
        let a = Math.atan2(z - seg.cz, x - seg.cx)
        // clamp the angle into the arc's sweep
        let rel = a - seg.a0
        if (seg.sweep >= 0) {
          while (rel < -Math.PI) rel += Math.PI * 2
          while (rel > Math.PI) rel -= Math.PI * 2
          rel = Math.min(seg.sweep, Math.max(0, rel))
        } else {
          while (rel > Math.PI) rel -= Math.PI * 2
          while (rel < -Math.PI) rel += Math.PI * 2
          rel = Math.max(seg.sweep, Math.min(0, rel))
        }
        a = seg.a0 + rel
        px = seg.cx + Math.cos(a) * seg.r
        pz = seg.cz + Math.sin(a) * seg.r
        const sgn = seg.sweep >= 0 ? 1 : -1
        tx = -Math.sin(a) * sgn
        tz = Math.cos(a) * sgn
        s = seg.s0 + (Math.abs(rel) / Math.abs(seg.sweep)) * seg.len
      }
      const d = Math.hypot(x - px, z - pz)
      if (d < bestD) {
        bestD = d
        bestS = s
        // right of travel = (-tz, tx) in this x-east / z-south frame
        bestLat = (x - px) * -tz + (z - pz) * tx
      }
    }
    out.s = bestS
    out.lateral = bestLat
    out.distance = bestD
    return out
  }
}

/** The world's transporter track. */
export const TRACK_PATH = new TrackPath(TRACK.points, TRACK.cornerRadius)
