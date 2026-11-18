/**
 * Launch effects as ANALYTIC emitters: every particle is computed from its
 * spawn index and the current launch time, so effects are deterministic,
 * survive time jumps and never accumulate state. Emitters push into the shared
 * pools in priority order; a full pool simply drops the rest.
 */
import * as THREE from 'three'
import { smoothstep } from '@/core/math'
import { CUSHION, CUSHION_SIZE, PAD_X, PAD_Z, T_IGNITION, T_LIFTOFF, TRENCH } from './config'
import { evalTrack, rocketPose, thrustAt, trackLandings, STOWAWAY, TAU_CLEANUP, type FlightPlan, type PieceTrack } from './flight'
import type { RocketQuality } from './config'
import type { RocketModel } from './rocketBuild'
import { hash01, type ParticleBuffer } from './particles'

export interface FxFrame {
  /** Launch time (s since countdown start). */
  T: number
  /** Continuous sim time (ambient emitters). */
  simT: number
  plan: FlightPlan | null
  model: RocketModel | null
  /** Current rocket frame while it stands on the transporter (countdown vents, ignition). */
  rocketMatrix: THREE.Matrix4
  reduced: boolean
  q: RocketQuality
  /** Active spark emitters (welding). */
  sparks: { x: number; y: number; z: number; on: boolean }[]
  /** Night-shift light level 0..1 (smoke lit colour follows it). */
  light: number
}

const _p = new THREE.Vector3()
const _p2 = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _axis = new THREE.Vector3()
const _m = new THREE.Matrix4()
const WIND_X = 0.85
const WIND_Z = -0.35

/** Linear colour helpers (pushed as linear RGB). */
const STEAM = new THREE.Color('#F2EEE6')
const BILLOW = new THREE.Color('#DCD6CC')
const CONTRAIL = new THREE.Color('#EDE7DD')
const DARK = new THREE.Color('#4A4642')
const SOOT = new THREE.Color('#2E2B29')
const DUST = new THREE.Color('#B9AC98')
const FIRE_A = new THREE.Color('#FFD27A')
const FIRE_B = new THREE.Color('#FF7A2A')
const SPARK = new THREE.Color('#FFC46B')

function pushSmoke(buf: ParticleBuffer, x: number, y: number, z: number, size: number, alpha: number, rot: number, c: THREE.Color, light: number): boolean {
  const l = 0.35 + 0.65 * light
  return buf.push(x, y, z, size, alpha, rot, c.r * l, c.g * l, c.b * l)
}

/** Spawn-index range [k0, k1] alive at time t for a constant-rate emitter starting at t0. */
function aliveRange(t: number, t0: number, t1: number, dt: number, life: number): [number, number] {
  const tc = Math.min(t, t1)
  if (tc < t0) return [1, 0]
  const k1 = Math.floor((tc - t0) / dt)
  const k0 = Math.max(0, Math.ceil((t - life - t0) / dt))
  return [k0, k1]
}

// ---------------------------------------------------------------------------
// Ignition billow: a variable-rate emitter (inverse of the cumulative count)
// ---------------------------------------------------------------------------

/** Piecewise-constant rates (per second) starting at T_IGNITION. */
const BILLOW_RATES: [number, number][] = [
  [0, 15],
  [1.6, 8.5],
  [4.2, 3.2],
  [9, 0],
]

function billowCount(t: number, scale: number): number {
  let n = 0
  for (let i = 0; i < BILLOW_RATES.length - 1; i++) {
    const [a, r] = BILLOW_RATES[i]
    const b = BILLOW_RATES[i + 1][0]
    if (t <= a) break
    n += (Math.min(t, b) - a) * r * scale
  }
  return n
}

function billowSpawnTime(k: number, scale: number): number {
  let n = 0
  for (let i = 0; i < BILLOW_RATES.length - 1; i++) {
    const [a, r] = BILLOW_RATES[i]
    const b = BILLOW_RATES[i + 1][0]
    const seg = (b - a) * r * scale
    if (k < n + seg && r > 0) return a + (k - n) / (r * scale)
    n += seg
  }
  return Infinity
}

function ignitionBillow(f: FxFrame, smoke: ParticleBuffer): void {
  const t = f.T - T_IGNITION
  if (t < 0 || t > 18) return
  const scale = f.q.smoke * (f.reduced ? 0.6 : 1)
  const total = Math.floor(billowCount(Math.min(t, 9), scale))
  const life = 6.5
  for (let k = total; k >= 0; k--) {
    const ts = billowSpawnTime(k, scale)
    if (!Number.isFinite(ts)) continue
    const a = t - ts
    if (a < 0) continue
    if (a > life) break
    const h1 = hash01(k, 1, 101)
    const h2 = hash01(k, 2, 101)
    const h3 = hash01(k, 3, 101)
    const u = a / life
    let x: number
    let z: number
    let y: number
    const kind = h1 < 0.62 ? 0 : 1
    if (kind === 0) {
      // out of the flame trench ends (east / west), decelerating, rising
      const side = h2 < 0.5 ? -1 : 1
      const v0 = 7 + h3 * 4
      const drag = 0.85
      const dist = (v0 / drag) * (1 - Math.exp(-drag * a))
      x = PAD_X + side * (TRENCH.halfLength - 0.8 + dist)
      z = PAD_Z + (hash01(k, 4, 101) - 0.5) * 2.2 + (hash01(k, 5, 101) - 0.5) * dist * 0.45
      y = 0.7 + a * 1.1 + a * a * 0.12
    } else {
      // rolling ring around the transporter
      const ang = h2 * Math.PI * 2
      const v0 = 3 + h3 * 2.5
      const dist = 3.2 + (v0 / 0.9) * (1 - Math.exp(-0.9 * a))
      x = PAD_X + Math.cos(ang) * dist
      z = PAD_Z + Math.sin(ang) * dist
      y = 0.9 + a * 1.5 + a * a * 0.1
    }
    x += WIND_X * a * a * 0.12
    z += WIND_Z * a * a * 0.12
    const size = 1.8 + 5.6 * (1 - Math.exp(-a / 1.6)) * (0.8 + 0.4 * h3)
    const alpha = 0.62 * smoothstep(0, 0.07, u) * (1 - u) * (1 - u * 0.4)
    if (!pushSmoke(smoke, x, y, z, size, alpha, h1 * 6.28 + a * (h2 - 0.5) * 0.6, BILLOW, f.light)) return
  }
}

// ---------------------------------------------------------------------------

function countdownSteam(f: FxFrame, smoke: ParticleBuffer): void {
  const m = f.model
  if (!m) return
  const t0 = 0.6
  const t1 = T_IGNITION + 0.4
  if (f.T < t0 || f.T > t1 + 2) return
  const dt = 0.16 / f.q.smoke
  const life = 1.9
  for (let v = 0; v < m.vents.length; v++) {
    const vent = m.vents[v]
    _p.set(vent[0], vent[1], vent[2]).applyMatrix4(f.rocketMatrix)
    // outward direction from the rocket axis
    _p2.set(0, vent[1], 0).applyMatrix4(f.rocketMatrix)
    const ox = _p.x - _p2.x
    const oz = _p.z - _p2.z
    const ol = Math.hypot(ox, oz) || 1
    const [k0, k1] = aliveRange(f.T, t0 + v * 0.05, t1, dt, life)
    for (let k = k1; k >= k0; k--) {
      const a = f.T - (t0 + v * 0.05 + k * dt)
      if (a < 0) continue
      const u = a / life
      const h = hash01(k, v, 202)
      const out = 1.4 * a * (0.8 + h * 0.4)
      const x = _p.x + (ox / ol) * out + WIND_X * a * 0.5
      const z = _p.z + (oz / ol) * out + WIND_Z * a * 0.5
      const y = _p.y + 0.6 * a - 0.35 * a * a * 0.3
      const size = 0.35 + 1.5 * Math.sqrt(u)
      const alpha = 0.5 * smoothstep(0, 0.1, u) * (1 - u)
      if (!pushSmoke(smoke, x, y, z, size, alpha, h * 6.28, STEAM, f.light)) return
    }
  }
}

function contrail(f: FxFrame, smoke: ParticleBuffer): void {
  const plan = f.plan
  const m = f.model
  if (!plan || !m) return
  const tau = f.T - T_LIFTOFF
  if (tau < 0) return
  const end = Math.min(12, plan.intactUntil)
  const dt = 0.085 / f.q.smoke
  const life = 5.2
  const [k0, k1] = aliveRange(tau, 0, end, dt, life)
  const nz = m.nozzles[0]
  for (let k = k1; k >= k0; k--) {
    const ts = k * dt
    const a = tau - ts
    if (a < 0) continue
    const u = a / life
    rocketPose(plan, ts, _p, _q)
    _axis.set(0, 1, 0).applyQuaternion(_q)
    _p2.set(nz.pos[0], nz.pos[1], nz.pos[2]).applyQuaternion(_q).add(_p)
    const thrust = thrustAt(plan, ts)
    const h = hash01(k, 7, 303)
    const ex = 6 * thrust * (1 - Math.exp(-a * 1.6))
    let x = _p2.x - _axis.x * ex + WIND_X * a * 0.9
    let y = _p2.y - _axis.y * ex + a * 0.25
    let z = _p2.z - _axis.z * ex + WIND_Z * a * 0.9
    // close to the pad the exhaust spreads sideways instead of digging in
    if (y < 1.2) {
      const spread = (1.2 - y) * 2.2
      const ang = h * Math.PI * 2
      x += Math.cos(ang) * spread
      z += Math.sin(ang) * spread
      y = 1.2
    }
    const size = (0.9 + 3.6 * Math.sqrt(u)) * (0.85 + 0.3 * h)
    const alpha = 0.5 * smoothstep(0, 0.06, u) * (1 - u) * (0.6 + 0.4 * thrust)
    if (!pushSmoke(smoke, x, y, z, size, alpha, h * 6.28, CONTRAIL, f.light)) return
  }
}

function pieceTrails(f: FxFrame, smoke: ParticleBuffer, tracks: PieceTrack[], maxPieces: number, salt: number): void {
  const tau = f.T - T_LIFTOFF
  const dt = 0.13 / f.q.smoke
  const life = 1.9
  for (let i = 0; i < Math.min(tracks.length, maxPieces); i++) {
    const tr = tracks[i]
    const t = tau - tr.t0
    if (t < 0 || t > tr.tLand + life) continue
    const [k0, k1] = aliveRange(t, 0, tr.tLand, dt, life)
    for (let k = k1; k >= k0; k--) {
      const ts = k * dt
      const a = t - ts
      if (a < 0) continue
      evalTrack(tr, ts, _p, _q)
      const u = a / life
      const h = hash01(k, i, salt)
      const size = 0.5 + 1.8 * Math.sqrt(u)
      const alpha = 0.55 * smoothstep(0, 0.08, u) * (1 - u)
      if (!pushSmoke(smoke, _p.x + WIND_X * a * 0.6, _p.y + a * 0.6, _p.z + WIND_Z * a * 0.6, size, alpha, h * 6.28, DARK, f.light)) return
    }
  }
}

/** A short burst of puffs at time tb (in flight time) and position. */
function puffBurst(f: FxFrame, smoke: ParticleBuffer, tb: number, x: number, y: number, z: number, count: number, size: number, color: THREE.Color, salt: number): boolean {
  const tau = f.T - T_LIFTOFF
  const a = tau - tb
  const life = 1.5
  if (a < 0 || a > life) return true
  const u = a / life
  const n = Math.max(2, Math.round(count * f.q.smoke))
  for (let k = 0; k < n; k++) {
    const h1 = hash01(k, salt, 404)
    const h2 = hash01(k, salt, 405)
    const ang = h1 * Math.PI * 2
    const r = (1 - Math.exp(-a * 3)) * (0.6 + h2 * 0.9) * size
    const s = size * (0.6 + 1.1 * Math.sqrt(u)) * (0.8 + 0.4 * h2)
    const alpha = 0.6 * smoothstep(0, 0.08, u) * (1 - u)
    if (!pushSmoke(smoke, x + Math.cos(ang) * r, y + a * 0.7 + h2 * 0.3, z + Math.sin(ang) * r, s, alpha, h1 * 6.28, color, f.light)) return false
  }
  return true
}

function breakupAndDebrisPuffs(f: FxFrame, smoke: ParticleBuffer): void {
  const plan = f.plan
  if (!plan) return
  const all: [PieceTrack[], number][] = [
    [plan.chunks, 1],
    [plan.debris, 2],
  ]
  for (const [tracks, salt] of all) {
    for (let i = 0; i < tracks.length; i++) {
      const tr = tracks[i]
      // dust where it first hits the ground
      const land = tr.t0 + tr.tLand
      if (!puffBurst(f, smoke, land, tr.hops[0]?.a[0] ?? tr.rest[0], 0.3, tr.hops[0]?.a[2] ?? tr.rest[2], salt === 1 ? 5 : 2, 0.9, DUST, i * 13 + salt)) return
      if (tr.poofAt !== null) {
        if (!puffBurst(f, smoke, tr.t0 + tr.poofAt, tr.rest[0], tr.rest[1] + 0.2, tr.rest[2], salt === 1 ? 7 : 2, 1.1, STEAM, i * 17 + salt + 5)) return
      }
    }
  }
  for (const tr of [plan.fin, plan.hero]) {
    if (!tr) continue
    if (!puffBurst(f, smoke, tr.t0 + tr.tLand, tr.hops[0]?.a[0] ?? tr.rest[0], 0.3, tr.hops[0]?.a[2] ?? tr.rest[2], 4, 0.8, DUST, 77)) return
    if (tr.poofAt !== null && !puffBurst(f, smoke, tr.t0 + tr.poofAt, tr.rest[0], tr.rest[1] + 0.2, tr.rest[2], 6, 1.0, STEAM, 78)) return
  }
  // the stowaway's landing raises a little dust off the cushion
  const st = plan.stowaway
  if (st) puffBurst(f, smoke, st.t0 + st.tLand, CUSHION[0], CUSHION_SIZE.h, CUSHION[1], 4, 0.7, DUST, 91)
}

/** Smouldering wisps from wreckage lying on the apron until clean-up. */
function smoulder(f: FxFrame, smoke: ParticleBuffer): void {
  const plan = f.plan
  if (!plan) return
  const tau = f.T - T_LIFTOFF
  const life = 3.2
  const dt = 0.32 / f.q.smoke
  const list = [plan.hero, plan.fin]
  for (let i = 0; i < list.length; i++) {
    const tr = list[i]
    if (!tr) continue
    const start = tr.t0 + tr.tRest
    const stop = tr.poofAt !== null ? tr.t0 + tr.poofAt : TAU_CLEANUP
    const [k0, k1] = aliveRange(tau, start, stop, dt, life)
    for (let k = k1; k >= k0; k--) {
      const a = tau - (start + k * dt)
      if (a < 0) continue
      const u = a / life
      const h = hash01(k, i, 505)
      const alpha = 0.32 * smoothstep(0, 0.1, u) * (1 - u)
      if (!pushSmoke(smoke, tr.rest[0] + WIND_X * a * 0.7 + (h - 0.5) * 0.3, tr.rest[1] + 0.3 + a * 0.9, tr.rest[2] + WIND_Z * a * 0.7, 0.5 + 1.6 * u, alpha, h * 6.28, i === 0 ? SOOT : DARK, f.light)) return
    }
  }
}

function explosionSmoke(f: FxFrame, smoke: ParticleBuffer): void {
  const fb = f.plan?.fireball
  if (!fb) return
  const tau = f.T - T_LIFTOFF
  const a0 = tau - fb.at
  if (a0 < 0 || a0 > 16) return
  const n = Math.round((f.reduced ? 16 : 26) * f.q.smoke)
  const scale = fb.radius / 6.2
  for (let k = 0; k < n; k++) {
    const delay = hash01(k, 1, 606) * 0.7
    const a = a0 - delay
    if (a < 0) continue
    const life = 9 + hash01(k, 2, 606) * 5
    if (a > life) continue
    const u = a / life
    const th = hash01(k, 3, 606) * Math.PI * 2
    const ph = Math.acos(2 * hash01(k, 4, 606) - 1)
    const sp = (5 + hash01(k, 5, 606) * 4) * scale
    const r = (sp / 1.4) * (1 - Math.exp(-1.4 * a))
    const x = fb.center[0] + Math.sin(ph) * Math.cos(th) * r + WIND_X * a * a * 0.08
    const z = fb.center[2] + Math.sin(ph) * Math.sin(th) * r + WIND_Z * a * a * 0.08
    const y = Math.max(1, fb.center[1] + Math.cos(ph) * r * 0.7 + a * 0.6)
    const size = (2.6 + 6 * (1 - Math.exp(-a / 2.2))) * scale * (0.8 + 0.4 * hash01(k, 6, 606))
    const alpha = 0.7 * smoothstep(0.15, 0.5, a) * (1 - u) * (1 - u * 0.3)
    const c = a < 1.2 ? DARK : SOOT
    if (!pushSmoke(smoke, x, y, z, size, alpha, th, c, f.light)) return
  }
}

// ---------------------------------------------------------------------------
// Additive glow: engine fire, explosion embers, welding sparks
// ---------------------------------------------------------------------------

function pushGlow(buf: ParticleBuffer, x: number, y: number, z: number, size: number, alpha: number, c: THREE.Color, mul: number): boolean {
  return buf.push(x, y, z, size, alpha, 0, c.r * mul, c.g * mul, c.b * mul)
}

function engineFire(f: FxFrame, glow: ParticleBuffer): void {
  const m = f.model
  if (!m) return
  const t = f.T - T_IGNITION
  if (t < 0) return
  const plan = f.plan
  const tau = f.T - T_LIFTOFF
  const intact = !plan || tau < plan.intactUntil
  if (!intact || tau > 12) return
  const ign = smoothstep(0, 1.6, t)
  const thrust = tau < 0 ? ign * 0.75 : plan ? thrustAt(plan, tau) : 1
  if (thrust <= 0.02) return
  // current rocket frame
  if (tau >= 0 && plan) {
    rocketPose(plan, tau, _p2, _q)
    _m.compose(_p2, _q, _p.set(1, 1, 1))
  } else _m.copy(f.rocketMatrix)
  _axis.set(0, 1, 0).transformDirection(_m)
  const life = 0.32
  const dt = 0.022 / f.q.fire
  for (let nI = 0; nI < m.nozzles.length; nI++) {
    const nz = m.nozzles[nI]
    _p.set(nz.pos[0], nz.pos[1], nz.pos[2]).applyMatrix4(_m)
    const [k0, k1] = aliveRange(t, nI * 0.007, 1e9, dt, life)
    const big = nz.radius / 0.8
    for (let k = k1; k >= k0; k--) {
      const a = t - (nI * 0.007 + k * dt)
      if (a < 0) continue
      const u = a / life
      const h = hash01(k, nI, 707)
      const speed = 14 * thrust
      let x = _p.x - _axis.x * speed * a
      let y = _p.y - _axis.y * speed * a
      let z = _p.z - _axis.z * speed * a
      if (y < 0.6) {
        // splash along the deck / into the trench
        const over = (0.6 - y) * 1.6
        x += Math.cos(h * 12.6) * over
        z += Math.sin(h * 12.6) * over * 0.4
        y = 0.6
      }
      const size = (0.7 + 1.6 * u) * big * (0.8 + 0.4 * h)
      const alpha = (1 - u) * (0.55 + 0.45 * thrust)
      const c = u < 0.35 ? FIRE_A : FIRE_B
      if (!pushGlow(glow, x + (h - 0.5) * 0.3 * u, y, z + (hash01(k, nI, 708) - 0.5) * 0.3 * u, size, alpha, c, 1.3)) return
    }
  }
}

function explosionFire(f: FxFrame, glow: ParticleBuffer): void {
  const plan = f.plan
  const fb = plan?.fireball
  if (!plan || !fb) return
  const tau = f.T - T_LIFTOFF
  const a = tau - fb.at
  if (a < 0 || a > 3.5) return
  const n = Math.round((f.reduced ? 22 : 48) * f.q.fire)
  for (let k = 0; k < n; k++) {
    const life = 0.9 + hash01(k, 1, 808) * 1.6
    if (a > life) continue
    const u = a / life
    const th = hash01(k, 2, 808) * Math.PI * 2
    const ph = Math.acos(2 * hash01(k, 3, 808) - 1)
    const sp = (9 + hash01(k, 4, 808) * 10) * (fb.radius / 6.2)
    const r = (sp / 2.2) * (1 - Math.exp(-2.2 * a))
    const x = fb.center[0] + Math.sin(ph) * Math.cos(th) * r
    const z = fb.center[2] + Math.sin(ph) * Math.sin(th) * r
    const y = fb.center[1] + Math.cos(ph) * r - 2.5 * a * a
    const size = (0.5 + 0.9 * (1 - u)) * (fb.radius / 6.2 + 0.3)
    if (!pushGlow(glow, x, Math.max(0.2, y), z, size, (1 - u) * (f.reduced ? 0.6 : 1), u < 0.4 ? FIRE_A : FIRE_B, 1.4)) return
  }
  // burning debris: a glowing ember riding on each piece while airborne
  for (let i = 0; i < plan.debris.length; i++) {
    const tr = plan.debris[i]
    const t = tau - tr.t0
    if (t < 0 || t > tr.tLand) continue
    evalTrack(tr, t, _p, _q)
    if (!pushGlow(glow, _p.x, _p.y, _p.z, 0.7, 0.8 * (1 - t / tr.tLand), FIRE_B, 1.3)) return
  }
}

function breakupPop(f: FxFrame, glow: ParticleBuffer): void {
  const plan = f.plan
  if (!plan || plan.outcome !== 'breakup' || !plan.chunks.length) return
  const tau = f.T - T_LIFTOFF
  const a = tau - plan.revealAt
  if (a < 0 || a > 0.9) return
  const c = plan.chunks[Math.min(1, plan.chunks.length - 1)].p0
  const n = Math.round(22 * f.q.fire)
  for (let k = 0; k < n; k++) {
    const u = a / 0.9
    const th = hash01(k, 1, 909) * Math.PI * 2
    const ph = Math.acos(2 * hash01(k, 2, 909) - 1)
    const r = (6 + hash01(k, 3, 909) * 6) * a
    if (!pushGlow(glow, c[0] + Math.sin(ph) * Math.cos(th) * r, c[1] + Math.cos(ph) * r - 4 * a * a, c[2] + Math.sin(ph) * Math.sin(th) * r, 0.5 * (1 - u) + 0.2, 1 - u, u < 0.3 ? FIRE_A : SPARK, 1.2)) return
  }
}

function weldSparks(f: FxFrame, glow: ParticleBuffer): void {
  const life = 0.55
  const dt = 0.035 / f.q.fire
  for (let e = 0; e < f.sparks.length; e++) {
    const s = f.sparks[e]
    if (!s.on) continue
    const [k0, k1] = aliveRange(f.simT, 0, 1e12, dt, life)
    for (let k = k1; k >= k0; k--) {
      const a = f.simT - k * dt
      if (a < 0) continue
      const u = a / life
      const h1 = hash01(k, e, 111)
      const h2 = hash01(k, e, 112)
      const h3 = hash01(k, e, 113)
      const vx = (h1 - 0.5) * 3.2
      const vz = (h2 - 0.5) * 3.2
      const vy = 0.8 + h3 * 2.2
      const y = s.y + vy * a - 4.9 * a * a
      if (y < 0.03) continue
      if (!pushGlow(glow, s.x + vx * a, y, s.z + vz * a, 0.09 + 0.07 * (1 - u), (1 - u) * 0.95, SPARK, 1.6)) return
    }
  }
}

/** Write every effect for this frame (smoke first by priority, then glow). */
export function writeEffects(f: FxFrame, smoke: ParticleBuffer, glow: ParticleBuffer): void {
  const T = f.T
  const launchWindow = T > -1 && T < 60
  if (launchWindow) {
    ignitionBillow(f, smoke)
    contrail(f, smoke)
    explosionSmoke(f, smoke)
    if (f.plan) {
      pieceTrails(f, smoke, f.plan.chunks, 6, 1234)
      pieceTrails(f, smoke, f.plan.fin ? [f.plan.fin] : [], 1, 2345)
      if (f.plan.hero) pieceTrails(f, smoke, [f.plan.hero], 1, 3456)
    }
    breakupAndDebrisPuffs(f, smoke)
    smoulder(f, smoke)
    countdownSteam(f, smoke)
    engineFire(f, glow)
    explosionFire(f, glow)
    breakupPop(f, glow)
  }
  weldSparks(f, glow)
}

/** Ground contacts (flight time) where debris lands — for bounce sound effects. */
export function landingTimes(plan: FlightPlan): { tau: number; x: number; z: number; big: boolean }[] {
  const out: { tau: number; x: number; z: number; big: boolean }[] = []
  const add = (tr: PieceTrack | null, big: boolean) => {
    if (!tr) return
    const ts = trackLandings(tr)
    ts.forEach((t, i) => {
      const p = i === 0 ? tr.hops[0]?.a ?? tr.rest : tr.hops[i - 1].b
      out.push({ tau: tr.t0 + t, x: p[0], z: p[2], big: big && i === 0 })
    })
  }
  plan.chunks.forEach((c) => add(c, true))
  add(plan.fin, true)
  add(plan.hero, true)
  out.sort((a, b) => a.tau - b.tau)
  return out
}

export const STOWAWAY_LAND_TAU = STOWAWAY.detach + STOWAWAY.flight
