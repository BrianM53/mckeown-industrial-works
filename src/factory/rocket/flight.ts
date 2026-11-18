/**
 * Deterministic flight choreography, decided once per launch from
 * (rocket seed, outcome). The rocket's flight is integrated once into a 30 Hz
 * pose table (simple thrust-along-axis + gravity + scripted wobble), and every
 * piece that leaves the rocket (taped fin, breakup chunks, explosion debris,
 * the stowaway) follows an analytic ballistic track solved to land INSIDE the
 * blast zone (or, for the stowaway, on the inflatable cushion). Everything is
 * a pure function of flight time τ, so time jumps render correctly.
 */
import * as THREE from 'three'
import { clamp, smoothstep } from '@/core/math'
import { createRng, mixSeed, randRange, type Rng } from '@/core/rng'
import type { LaunchOutcome } from '@/core/types'
import { OUTCOME_REVEAL_AT, PHASE_SECONDS } from '@/systems/factory'
import { BLAST_RADIUS, CUSHION, CUSHION_SIZE, DECK_Y, PAD_X, PAD_Z, T_LIFTOFF, T_RESET } from './config'
import type { V3 } from './geo'

export const FLIGHT_DT = 1 / 30
export const FLIGHT_SECONDS = PHASE_SECONDS.flight
const G = 9.8
const THRUST = 13.6
/** The rocket base at liftoff (pad centre, on the transporter deck). */
export const LAUNCH_POINT: V3 = [PAD_X, DECK_Y, PAD_Z]

/** Flight time (s since liftoff) at which the pad gets cleaned (debris poofs). */
export const TAU_CLEANUP = T_RESET - T_LIFTOFF
/** Stowaway timeline (flight time). */
export const STOWAWAY = {
  detach: 1.75,
  flight: 2.6,
  bounce: 0.7,
  lie: 1.4,
  hopOff: 0.6,
  dust: 1.4,
  wave: 1.0,
} as const

export interface Hop {
  t0: number
  t1: number
  a: V3
  b: V3
  h: number
}

export interface PieceTrack {
  /** Release flight time τ. */
  t0: number
  /** Pivot position and velocity at release. */
  p0: V3
  v0: V3
  g: number
  /** Time (since release) of the first ground contact. */
  tLand: number
  hops: Hop[]
  /** Time (since release) when it comes to rest, and where. */
  tRest: number
  rest: V3
  q0: THREE.Quaternion
  axis: THREE.Vector3
  spin: number
  qLand: THREE.Quaternion
  qRest: THREE.Quaternion
  /** Time since release when it vanishes in a puff (null = stays). */
  poofAt: number | null
  /** Side-to-side flutter amplitude while falling (falling-leaf fin). */
  flutter: number
}

export interface FlightPlan {
  key: string
  outcome: LaunchOutcome
  seed: number
  /** Centre-of-mass height in the rocket frame (the rocket tilts about it). */
  cm: number
  n: number
  /** CM positions relative to LAUNCH_POINT + (0, cm, 0) at τ = 0. */
  px: Float32Array
  py: Float32Array
  pz: Float32Array
  qx: Float32Array
  qy: Float32Array
  qz: Float32Array
  qw: Float32Array
  thrust: Float32Array
  /** τ at which the outcome becomes visible. */
  revealAt: number
  /** The intact rocket is drawn until this τ (Infinity = flies out of sight). */
  intactUntil: number
  fin: PieceTrack | null
  chunks: PieceTrack[]
  debris: PieceTrack[]
  /** The nose section thrown clear by an explosion. */
  hero: PieceTrack | null
  fireball: { at: number; center: V3; radius: number } | null
  stowaway: PieceTrack | null
}

export interface PlanInput {
  height: number
  tapedFinPivot: V3
  chunkPivots: { pivot: V3; radius: number }[]
  stowawayAnchor: V3
  debrisCount: number
  reduced: boolean
  stowaway: boolean
}

const _q = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _v = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const Y = new THREE.Vector3(0, 1, 0)

function tiltQuat(rx: number, rz: number, roll: number, out: THREE.Quaternion): THREE.Quaternion {
  const ang = Math.hypot(rx, rz)
  if (ang < 1e-7) out.identity()
  else out.setFromAxisAngle(_v.set(rx / ang, 0, rz / ang), ang)
  _q2.setFromAxisAngle(Y, roll)
  return out.multiply(_q2)
}

/** Lean of `amount` radians toward world direction (dx, dz) → rotation about X / Z. */
function lean(dx: number, dz: number, amount: number): [number, number] {
  return [amount * dz, -amount * dx]
}

/** Initial velocity so a body at p0 lands at `land` after T seconds under gravity g. */
function solveVelocity(p0: V3, land: V3, T: number, g: number): V3 {
  return [(land[0] - p0[0]) / T, (land[1] - p0[1] + 0.5 * g * T * T) / T, (land[2] - p0[2]) / T]
}

/** Flight time to fall from y0 (moving up at vy) to y1 under gravity g. */
function fallTime(y0: number, vy: number, y1: number, g: number): number {
  const a = 0.5 * g
  const b = -vy
  const c = y1 - y0
  const disc = b * b - 4 * a * c
  return disc > 0 ? (-b + Math.sqrt(disc)) / (2 * a) : 1
}

/** A landing point on the pad apron between rMin and rMax from the pad centre, roughly along `dir`. */
function landingPoint(rng: Rng, dirx: number, dirz: number, rMin: number, rMax: number, y: number): V3 {
  let a = Math.atan2(dirz, dirx)
  if (!Number.isFinite(a)) a = rng() * Math.PI * 2
  a += randRange(rng, -0.55, 0.55)
  const r = randRange(rng, rMin, rMax)
  return [PAD_X + Math.cos(a) * r, y, PAD_Z + Math.sin(a) * r]
}

function makeTrack(rng: Rng, t0: number, p0: V3, vHint: V3, q0: THREE.Quaternion, restY: number, opts: { rMin: number; rMax: number; hops: number; g?: number; spin?: number; poofAfterRest?: number | null; flutter?: number; fallMin?: number }): PieceTrack {
  const g = opts.g ?? G
  const vy = clamp(vHint[1], -4, 16)
  const T = Math.max(opts.fallMin ?? 1.2, fallTime(p0[1], vy, restY, g))
  // aim along the hinted horizontal direction, but land on the apron
  const dx = p0[0] - PAD_X + vHint[0] * T * 0.4
  const dz = p0[2] - PAD_Z + vHint[2] * T * 0.4
  const land = landingPoint(rng, dx, dz, opts.rMin, opts.rMax, restY)
  const v0 = solveVelocity(p0, land, T, g)
  const hops: Hop[] = []
  let cur: V3 = land
  let t = T
  const outx = land[0] - PAD_X
  const outz = land[2] - PAD_Z
  const ol = Math.hypot(outx, outz) || 1
  for (let i = 0; i < opts.hops; i++) {
    const dist = i === 0 ? randRange(rng, 0.35, 0.8) : randRange(rng, 0.12, 0.35)
    const h = i === 0 ? randRange(rng, 0.45, 0.9) : randRange(rng, 0.12, 0.3)
    const dur = i === 0 ? randRange(rng, 0.45, 0.6) : randRange(rng, 0.25, 0.35)
    const b: V3 = [cur[0] + (outx / ol) * dist + randRange(rng, -0.15, 0.15), restY, cur[2] + (outz / ol) * dist + randRange(rng, -0.15, 0.15)]
    // keep hops inside the blast zone
    const rx = b[0] - PAD_X
    const rz = b[2] - PAD_Z
    const rr = Math.hypot(rx, rz)
    const lim = BLAST_RADIUS - 0.5
    if (rr > lim) {
      b[0] = PAD_X + (rx / rr) * lim
      b[2] = PAD_Z + (rz / rr) * lim
    }
    hops.push({ t0: t, t1: t + dur, a: cur, b, h })
    cur = b
    t += dur
  }
  const axis = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5)
  if (axis.lengthSq() < 1e-4) axis.set(1, 0, 0)
  axis.normalize()
  const spin = (opts.spin ?? 6) * randRange(rng, 0.6, 1.2) * (rng() < 0.5 ? -1 : 1)
  const qLand = q0.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axis, spin * T))
  // resting pose: keep the landing yaw, lie on a side
  const yaw = randRange(rng, 0, Math.PI * 2)
  const qRest = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 + randRange(rng, -0.2, 0.2), yaw, randRange(rng, -0.25, 0.25), 'YXZ'))
  return {
    t0,
    p0,
    v0,
    g,
    tLand: T,
    hops,
    tRest: t,
    rest: cur,
    q0: q0.clone(),
    axis,
    spin,
    qLand,
    qRest,
    poofAt: opts.poofAfterRest === null || opts.poofAfterRest === undefined ? null : t + opts.poofAfterRest,
    flutter: opts.flutter ?? 0,
  }
}

/**
 * Evaluate a piece track `t` seconds after release into pos/quat.
 * Returns a visibility scale (1 = normal, shrinking during the poof, 0 = gone).
 */
export function evalTrack(tr: PieceTrack, t: number, pos: THREE.Vector3, quat: THREE.Quaternion): number {
  if (t < 0) return 0
  if (t < tr.tLand) {
    pos.set(tr.p0[0] + tr.v0[0] * t, tr.p0[1] + tr.v0[1] * t - 0.5 * tr.g * t * t, tr.p0[2] + tr.v0[2] * t)
    if (tr.flutter > 0) {
      const k = 1 - t / tr.tLand
      pos.x += Math.sin(t * 3.1) * tr.flutter * k
      pos.z += Math.cos(t * 2.3) * tr.flutter * 0.6 * k
    }
    quat.copy(tr.q0).multiply(_q.setFromAxisAngle(tr.axis, tr.spin * t))
  } else if (t < tr.tRest) {
    let hop = tr.hops[tr.hops.length - 1]
    for (const h of tr.hops)
      if (t < h.t1) {
        hop = h
        break
      }
    const u = clamp((t - hop.t0) / Math.max(1e-4, hop.t1 - hop.t0), 0, 1)
    pos.set(hop.a[0] + (hop.b[0] - hop.a[0]) * u, hop.a[1] + 4 * hop.h * u * (1 - u), hop.a[2] + (hop.b[2] - hop.a[2]) * u)
    const k = smoothstep(tr.tLand, tr.tRest, t)
    quat.copy(tr.qLand).slerp(tr.qRest, k)
  } else {
    pos.set(tr.rest[0], tr.rest[1], tr.rest[2])
    quat.copy(tr.qRest)
  }
  if (tr.poofAt !== null && t >= tr.poofAt) {
    const s = 1 - clamp((t - tr.poofAt) / 0.28, 0, 1)
    return s * s
  }
  return 1
}

/** Seconds since release at which a track first touches the ground (for dust/sfx). */
export function trackLandings(tr: PieceTrack): number[] {
  return [tr.tLand, ...tr.hops.map((h) => h.t1)]
}

function sampleIndex(plan: FlightPlan, tau: number): [number, number] {
  const f = clamp(tau / FLIGHT_DT, 0, plan.n - 1)
  const i = Math.min(plan.n - 2, Math.floor(f))
  return [Math.max(0, i), f - Math.max(0, i)]
}

/** Rocket base position (world) and orientation at flight time τ (clamped to the table). */
export function rocketPose(plan: FlightPlan, tau: number, pos: THREE.Vector3, quat: THREE.Quaternion): void {
  const [i, f] = sampleIndex(plan, tau)
  const j = i + 1
  const cx = plan.px[i] + (plan.px[j] - plan.px[i]) * f
  const cy = plan.py[i] + (plan.py[j] - plan.py[i]) * f
  const cz = plan.pz[i] + (plan.pz[j] - plan.pz[i]) * f
  quat.set(plan.qx[i], plan.qy[i], plan.qz[i], plan.qw[i])
  _q.set(plan.qx[j], plan.qy[j], plan.qz[j], plan.qw[j])
  quat.slerp(_q, f)
  // base = cm - q·(0, cm, 0)
  _v2.set(0, plan.cm, 0).applyQuaternion(quat)
  pos.set(LAUNCH_POINT[0] + cx - _v2.x, LAUNCH_POINT[1] + plan.cm + cy - _v2.y, LAUNCH_POINT[2] + cz - _v2.z)
}

export function thrustAt(plan: FlightPlan, tau: number): number {
  if (tau < 0) return 0
  const [i, f] = sampleIndex(plan, tau)
  return plan.thrust[i] + (plan.thrust[i + 1] - plan.thrust[i]) * f
}

function localToWorld(plan: FlightPlan, tau: number, local: V3): { p: V3; q: THREE.Quaternion; v: V3 } {
  const pos = new THREE.Vector3()
  const q = new THREE.Quaternion()
  rocketPose(plan, tau, pos, q)
  const p = new THREE.Vector3(local[0], local[1], local[2]).applyQuaternion(q).add(pos)
  const pos2 = new THREE.Vector3()
  const q2 = new THREE.Quaternion()
  rocketPose(plan, tau + 0.05, pos2, q2)
  const p2 = new THREE.Vector3(local[0], local[1], local[2]).applyQuaternion(q2).add(pos2)
  return { p: [p.x, p.y, p.z], q, v: [(p2.x - p.x) / 0.05, (p2.y - p.y) / 0.05, (p2.z - p.z) / 0.05] }
}

/** Build the whole launch choreography (allocates; call once per launch). */
export function buildFlightPlan(seed: number, outcome: LaunchOutcome, input: PlanInput): FlightPlan {
  const rng = createRng(mixSeed(seed, 0x0f119e7, outcome.length * 7919))
  const n = Math.ceil(FLIGHT_SECONDS / FLIGHT_DT) + 2
  const cm = clamp(input.height * 0.42, 3, 7)
  const reveal = OUTCOME_REVEAL_AT[outcome]
  const wob = input.reduced ? 0.6 : 1
  // pitch-over azimuth: away from the visitors (north / north-east), seeded
  const az = randRange(rng, -1.25, -0.35) // angle from +X toward -Z
  const ldx = Math.cos(az)
  const ldz = Math.sin(az)
  const ph1 = rng() * 6.28
  const ph2 = rng() * 6.28
  const driftA = randRange(rng, 0, Math.PI * 2)

  const plan: FlightPlan = {
    key: '',
    outcome,
    seed,
    cm,
    n,
    px: new Float32Array(n),
    py: new Float32Array(n),
    pz: new Float32Array(n),
    qx: new Float32Array(n),
    qy: new Float32Array(n),
    qz: new Float32Array(n),
    qw: new Float32Array(n),
    thrust: new Float32Array(n),
    revealAt: reveal,
    intactUntil: outcome === 'breakup' || outcome === 'explosion' ? reveal : Infinity,
    fin: null,
    chunks: [],
    debris: [],
    hero: null,
    fireball: null,
    stowaway: null,
  }

  const tilt = (tau: number): [number, number, number] => {
    let rx = 0
    let rz = 0
    let roll = 0.22 * tau
    switch (outcome) {
      case 'success': {
        const [a, b] = lean(ldx, ldz, 0.3 * smoothstep(2.5, 11, tau))
        rx = a + 0.035 * wob * Math.sin(1.3 * tau + ph1) * smoothstep(0, 1.5, tau)
        rz = b + 0.03 * wob * Math.sin(1.05 * tau + ph2) * smoothstep(0, 1.5, tau)
        break
      }
      case 'wobble': {
        const grow = 0.05 + 0.3 * smoothstep(0.8, reveal, tau)
        const after = tau > reveal ? 0.36 * Math.exp(-(tau - reveal) / 2.2) + 0.07 : grow
        const amp = (tau > reveal ? after : grow) * wob
        const f = 2 * Math.PI * 0.85
        rx = amp * Math.sin(f * tau + ph1)
        rz = amp * 0.8 * Math.cos(f * 0.86 * tau + ph2)
        // slow swerve so the path visibly zig-zags
        const [dx, dz] = lean(Math.cos(driftA), Math.sin(driftA), 0.16 * wob * Math.sin(tau * 0.9) * smoothstep(1, 3, tau))
        const [px2, pz2] = lean(ldx, ldz, 0.22 * smoothstep(5, 11, tau))
        rx += dx + px2
        rz += dz + pz2
        roll = 0.5 * tau + (tau > reveal ? 2.4 * (1 - Math.exp(-(tau - reveal) * 2)) : 0)
        break
      }
      case 'breakup': {
        const amp = 0.04 + 0.26 * smoothstep(1.8, reveal, tau)
        rx = amp * wob * Math.sin(5.2 * tau + ph1)
        rz = amp * wob * Math.cos(4.4 * tau + ph2)
        roll = 0.4 * tau + 1.5 * smoothstep(2.5, reveal, tau)
        break
      }
      case 'explosion': {
        const shake = 0.012 + 0.05 * smoothstep(1.6, reveal, tau)
        rx = shake * wob * Math.sin(23 * tau + ph1)
        rz = shake * wob * Math.cos(19 * tau + ph2)
        break
      }
    }
    return [rx, rz, roll]
  }

  // integrate the CM
  let x = 0
  let y = 0
  let z = 0
  let vx = 0
  let vy = 0
  let vz = 0
  const q = new THREE.Quaternion()
  const axis = new THREE.Vector3()
  for (let i = 0; i < n; i++) {
    const tau = i * FLIGHT_DT
    const [rx, rz, roll] = tilt(tau)
    tiltQuat(rx, rz, roll, q)
    plan.px[i] = x
    plan.py[i] = y
    plan.pz[i] = z
    plan.qx[i] = q.x
    plan.qy[i] = q.y
    plan.qz[i] = q.z
    plan.qw[i] = q.w
    let thrust = smoothstep(0, 0.55, tau)
    if (outcome === 'wobble' && tau > reveal && tau < reveal + 0.6) thrust *= 0.55 + 0.45 * Math.abs(Math.sin(tau * 31))
    if (outcome === 'explosion' && tau > reveal - 0.9) thrust *= 0.7 + 0.3 * Math.abs(Math.sin(tau * 27))
    plan.thrust[i] = thrust
    axis.set(0, 1, 0).applyQuaternion(q)
    const acc = THRUST * thrust
    const drag = 0.035
    vx += (acc * axis.x - drag * vx) * FLIGHT_DT
    vy += (acc * axis.y - G - drag * vy) * FLIGHT_DT
    vz += (acc * axis.z - drag * vz) * FLIGHT_DT
    if (y <= 0 && vy < 0) {
      vy = 0
      vx = 0
      vz = 0
    }
    x += vx * FLIGHT_DT
    y = Math.max(0, y + vy * FLIGHT_DT)
    z += vz * FLIGHT_DT
  }

  // --- the duct-taped fin gives up (wobble) ---
  if (outcome === 'wobble') {
    const w = localToWorld(plan, reveal, input.tapedFinPivot)
    plan.fin = makeTrack(rng, reveal, w.p, [w.v[0] * 0.4, Math.min(w.v[1] * 0.35, 5), w.v[2] * 0.4], w.q, 0.12, {
      rMin: 3.9,
      rMax: 5.4,
      hops: 2,
      spin: 5,
      poofAfterRest: null,
      flutter: 1.6,
      fallMin: 2.6,
    })
    plan.fin.poofAt = TAU_CLEANUP + 0.3 - reveal
  }

  // --- breakup: chunks tumble down with smoke trails, bounce, poof ---
  if (outcome === 'breakup') {
    const pieces = [...input.chunkPivots.map((c) => ({ pivot: c.pivot, radius: c.radius })), { pivot: input.tapedFinPivot, radius: 0.12 }]
    pieces.forEach((c, i) => {
      const w = localToWorld(plan, reveal, c.pivot)
      const outx = w.p[0] - (LAUNCH_POINT[0] + plan.px[0])
      const outz = w.p[2] - (LAUNCH_POINT[2] + plan.pz[0])
      const ol = Math.hypot(outx, outz) || 1
      const kick = randRange(rng, 1.5, 3.2)
      const vHint: V3 = [w.v[0] * 0.5 + (outx / ol) * kick, w.v[1] * randRange(rng, 0.55, 0.95) + randRange(rng, -1, 2), w.v[2] * 0.5 + (outz / ol) * kick]
      plan.chunks.push(
        makeTrack(rng, reveal, w.p, vHint, w.q, Math.max(0.15, c.radius * 0.8), {
          rMin: 3.8,
          rMax: 5.6,
          hops: 2,
          spin: i === pieces.length - 1 ? 7 : randRange(rng, 2.2, 4.2),
          poofAfterRest: randRange(rng, 0.9, 1.6),
          fallMin: 1.8,
        }),
      )
    })
  }

  // --- explosion: cartoon fireball, debris arcs, the nose thrown clear ---
  if (outcome === 'explosion') {
    const centre = localToWorld(plan, reveal, [0, cm + 1.2, 0])
    plan.fireball = { at: reveal, center: centre.p, radius: input.reduced ? 3.6 : 6.2 }
    const count = Math.max(4, input.debrisCount)
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + randRange(rng, -0.3, 0.3)
      const p0: V3 = [centre.p[0] + Math.cos(a) * 0.8, centre.p[1] + randRange(rng, -1.5, 1.5), centre.p[2] + Math.sin(a) * 0.8]
      const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 6.28, rng() * 6.28, rng() * 6.28))
      const tr = makeTrack(rng, reveal, p0, [Math.cos(a) * 4, randRange(rng, 3, 11), Math.sin(a) * 4], q0, 0.1, {
        rMin: 3.6,
        rMax: 6.0,
        hops: 1,
        spin: randRange(rng, 6, 12) * (input.reduced ? 0.5 : 1),
        poofAfterRest: null,
        fallMin: 1.6,
      })
      tr.poofAt = TAU_CLEANUP + 0.2 + i * 0.07 - reveal
      plan.debris.push(tr)
    }
    // the nose section survives and lands on the apron, smouldering
    const top = input.chunkPivots[input.chunkPivots.length > 2 ? 2 : input.chunkPivots.length - 1]
    if (top) {
      const w = localToWorld(plan, reveal, top.pivot)
      const tr = makeTrack(rng, reveal, w.p, [randRange(rng, -2, 2), 12, randRange(rng, -2, 2)], w.q, Math.max(0.5, top.radius * 0.85), {
        rMin: 4.2,
        rMax: 5.6,
        hops: 2,
        spin: 3.2,
        poofAfterRest: null,
        fallMin: 2.4,
      })
      tr.poofAt = TAU_CLEANUP + 0.5 - reveal
      plan.hero = tr
    }
  }

  // --- the stowaway is flung clear onto the cushion (always before any reveal) ---
  if (input.stowaway) {
    const w = localToWorld(plan, STOWAWAY.detach, input.stowawayAnchor)
    const land: V3 = [CUSHION[0] + 0.15, CUSHION_SIZE.h * 0.88, CUSHION[1] - 0.1]
    const g = 11
    const v0 = solveVelocity(w.p, land, STOWAWAY.flight, g)
    const tr: PieceTrack = {
      t0: STOWAWAY.detach,
      p0: w.p,
      v0,
      g,
      tLand: STOWAWAY.flight,
      hops: [{ t0: STOWAWAY.flight, t1: STOWAWAY.flight + STOWAWAY.bounce, a: land, b: [land[0] - 0.1, land[1], land[2] + 0.15], h: 1.5 }],
      tRest: STOWAWAY.flight + STOWAWAY.bounce,
      rest: [land[0] - 0.1, land[1], land[2] + 0.15],
      q0: new THREE.Quaternion(),
      axis: new THREE.Vector3(0, 1, 0),
      spin: 4.5,
      qLand: new THREE.Quaternion(),
      qRest: new THREE.Quaternion(),
      poofAt: null,
      flutter: 0,
    }
    plan.stowaway = tr
  }
  plan.key = planKey(seed, outcome, input)
  return plan
}

export function planKey(seed: number, outcome: LaunchOutcome, input: Pick<PlanInput, 'reduced' | 'stowaway' | 'debrisCount'>): string {
  return `${seed}:${outcome}:${input.reduced ? 1 : 0}:${input.stowaway ? 1 : 0}:${input.debrisCount}`
}
