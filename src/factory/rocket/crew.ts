/**
 * Launch crew choreography (3 workers). Nominal poses are pure functions of
 * the launch time T (see choreo.launchTime), the transporter's on-screen state
 * and the flight plan; the component smooths them with a speed-limited
 * follower so any discontinuity (debug jumps, a visitor blocking the track)
 * becomes a short walk instead of a teleport.
 *
 *   assembling  A welds at the rocket base, B supervises with a clipboard,
 *               C signals the crane.
 *   rollout     all three walk alongside the transporter.
 *   pad         C (the inspector) hops onto the deck and climbs the ladder.
 *   countdown   everyone runs out through the barrier gap to a safe spot and
 *               panics briefly — unless C is the stowaway, who keeps working,
 *               then turns round and waves at the crowd.
 *   flight      watchers point, then cheer or panic by outcome; the stowaway
 *               is flung onto the cushion, gets up, dusts off, waves.
 *   return      everyone walks back along the track behind the empty
 *               transporter to their tower stations.
 */
import * as THREE from 'three'
import { clamp, lerp, smoothstep, yawToward } from '@/core/math'
import type { LaunchOutcome, Vec2 } from '@/core/types'
import type { WorkerAnim, WorkerLook } from '@/world/WorkerModel'
import { PALETTE } from '@/world/palette'
import { CREW_SAFE_SPOTS, CUSHION, DECK_Y, PAD_X, PAD_Z, T_AFTERMATH, T_IGNITION, T_LIFTOFF, T_PAD, T_ROLLOUT, TOWER_CX, TOWER_CZ, TRANSPORTER } from './config'
import { evalTrack, STOWAWAY, type FlightPlan } from './flight'
import { TRACK_PATH, type TrackPoint } from './track'

export const CREW_LOOKS: Partial<WorkerLook>[] = [
  { helmet: '#EAE3D2', vest: PALETTE.safety, shirt: '#3d4d58', pants: '#2f3b44', accessory: 'wrench', face: 'beard', helmetStripe: PALETTE.signalRed },
  { helmet: PALETTE.hazard, vest: PALETTE.signalRed, shirt: '#55606a', pants: '#2b3640', accessory: 'clipboard', face: 'mustache' },
  { helmet: PALETTE.signalBlue, vest: PALETTE.hazard, shirt: '#4b5b66', pants: '#33404a', accessory: 'headset', face: 'glasses', skin: '#a8785a' },
]

export interface CrewPose {
  x: number
  y: number
  z: number
  yaw: number
  /** When set, the full orientation (attached to a tilting rocket). */
  quat: THREE.Quaternion | null
  anim: WorkerAnim
  /** Walk/run cadence speed (m/s); the follower overrides it with the real speed. */
  speed: number
  /** World point to glance at, or null. */
  look: THREE.Vector3 | null
  /** Bypass the follower (attached to the rocket, flying, climbing). */
  snap: boolean
}

export function createCrewPose(): CrewPose {
  return { x: 0, y: 0, z: 0, yaw: 0, quat: null, anim: 'idle', speed: 0, look: null, snap: false }
}

export interface CrewContext {
  T: number
  phase: string
  outcome: LaunchOutcome | null
  /** The current launch has a stowaway (or, while assembling, the previous one had). */
  stowaway: boolean
  plan: FlightPlan | null
  /** Transporter on screen: arc length, signed speed (m/s), blocked by the visitor. */
  trS: number
  trSpeed: number
  trBlocked: boolean
  /** Rocket frame (world) while it stands on the transporter or flies; identity-safe. */
  rocketMatrix: THREE.Matrix4
  rocketQuat: THREE.Quaternion
  /** Transporter frame (world, origin on the track at ground level). */
  transporterMatrix: THREE.Matrix4
  /** Crane hook (C points at it while it lowers a part). */
  hook: THREE.Vector3
  craneLowering: boolean
  player: THREE.Vector3
  /** Ladder radius position for the climb (rocket frame z of the stowaway anchor). */
  anchor: [number, number, number]
}

interface CrewDef {
  station: Vec2
  stationFacing: Vec2
  /** Alongside the transporter: forward offset (m along the track) and lateral (+ = right). */
  fwd: number
  lat: number
  /** Gap waypoint on the way out and the safe spot. */
  gap: Vec2
  safe: Vec2
  /** Lateral offset while walking back along the track. */
  retLat: number
  /** Points after leaving the track near the tower, ending at the station. */
  exit: Vec2[]
  delay: number
}

/** Where the stowaway stands after hopping off the cushion. */
export const STOWAWAY_GROUND: Vec2 = [CUSHION[0] + 1.3, CUSHION[1] + 2.0]

export const CREW_DEFS: CrewDef[] = [
  {
    station: [TOWER_CX - 3.35, TOWER_CZ - 2.9],
    stationFacing: [TOWER_CX - 0.6, TOWER_CZ - 1.2],
    fwd: 1.3,
    lat: -2.85,
    gap: [PAD_X - 2.6, PAD_Z + 8.4],
    safe: CREW_SAFE_SPOTS[0],
    retLat: -2.6,
    exit: [
      [TOWER_CX + 4.6, TOWER_CZ - 2.9],
      [TOWER_CX - 3.35, TOWER_CZ - 2.9],
    ],
    delay: 0,
  },
  {
    station: [TOWER_CX + 3.7, TOWER_CZ + 3.25],
    stationFacing: [TOWER_CX + 1.0, TOWER_CZ + 0.4],
    fwd: -1.6,
    lat: 2.85,
    gap: [PAD_X + 2.6, PAD_Z + 8.4],
    safe: CREW_SAFE_SPOTS[1],
    retLat: 2.6,
    exit: [
      [TOWER_CX + 4.6, TOWER_CZ + 3.0],
      [TOWER_CX + 3.7, TOWER_CZ + 3.25],
    ],
    delay: 0.8,
  },
  {
    station: [TOWER_CX - 3.3, TOWER_CZ + 3.0],
    stationFacing: [TOWER_CX + 2.0, TOWER_CZ + 4.0],
    fwd: -3.7,
    lat: -1.0,
    gap: [PAD_X - 1.0, PAD_Z + 8.6],
    safe: CREW_SAFE_SPOTS[2],
    retLat: 2.1,
    exit: [
      [TOWER_CX + 4.4, TOWER_CZ + 2.7],
      [TOWER_CX - 3.3, TOWER_CZ + 3.0],
    ],
    delay: 1.6,
  },
]

const WALK = 1.45
const RUN = 4.6
const RETURN_START = T_AFTERMATH + 3.0
/** Arc length where the return walk leaves the track (east of the tower portal). */
const S_EXIT = 7.0
/** Arc length where the crew join the track on the way back (just south of the barrier gap). */
const S_ENTER = TRACK_PATH.length - 10.3

const _tp: TrackPoint = { x: 0, z: 0, yaw: 0, tx: 1, tz: 0 }
const _v = new THREE.Vector3()
const _rear = new THREE.Vector3()
const _deck = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _qFacing = new THREE.Quaternion()
const _look = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const PAD_LOOK = new THREE.Vector3(PAD_X, 4, PAD_Z)

/** Track point with extrapolation beyond both ends, offset laterally. */
function trackSide(s: number, lat: number, out: { x: number; z: number; yaw: number }): void {
  const L = TRACK_PATH.length
  TRACK_PATH.sample(clamp(s, 0, L), _tp)
  let x = _tp.x
  let z = _tp.z
  if (s < 0) {
    x += _tp.tx * s
    z += _tp.tz * s
  } else if (s > L) {
    x += _tp.tx * (s - L)
    z += _tp.tz * (s - L)
  }
  // right of travel = (-tz, tx)
  out.x = x - _tp.tz * lat
  out.z = z + _tp.tx * lat
  out.yaw = _tp.yaw
}

const _side = { x: 0, z: 0, yaw: 0 }

/** Walk a polyline at a given distance; returns heading yaw. */
function walkPolyline(pts: Vec2[], d: number, out: { x: number; z: number; yaw: number }): boolean {
  let rem = Math.max(0, d)
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (rem <= len || i === pts.length - 1) {
      const t = len > 1e-6 ? clamp(rem / len, 0, 1) : 1
      out.x = lerp(a[0], b[0], t)
      out.z = lerp(a[1], b[1], t)
      out.yaw = yawToward({ x: a[0], z: a[1] }, { x: b[0], z: b[1] })
      return rem <= len
    }
    rem -= len
  }
  out.x = pts[pts.length - 1][0]
  out.z = pts[pts.length - 1][1]
  return false
}

function polylineLength(pts: Vec2[]): number {
  let l = 0
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return l
}

function setStation(def: CrewDef, i: number, ctx: CrewContext, out: CrewPose): void {
  out.x = def.station[0]
  out.z = def.station[1]
  out.y = 0
  out.yaw = yawToward({ x: def.station[0], z: def.station[1] }, { x: def.stationFacing[0], z: def.stationFacing[1] })
  out.speed = 0
  out.look = null
  if (i === 0) out.anim = 'work'
  else if (i === 1) {
    out.anim = 'idle'
    out.look = _look[i].copy(ctx.hook)
  } else {
    out.anim = ctx.craneLowering ? 'point' : 'idle'
    out.look = _look[i].copy(ctx.hook)
    if (ctx.craneLowering) out.yaw = yawToward({ x: out.x, z: out.z }, { x: ctx.hook.x, z: ctx.hook.z })
  }
}

/** Where the crew member stands beside the transporter at track position s. */
function besideTransporter(def: CrewDef, s: number, out: CrewPose): void {
  trackSide(s + def.fwd, def.lat, _side)
  out.x = _side.x
  out.z = _side.z
  out.y = 0
  out.yaw = _side.yaw
}

/** Run from (x0,z0) via the gap to the safe spot, starting at time t0. */
function runToSafety(def: CrewDef, x0: number, z0: number, t0: number, T: number, out: CrewPose): number {
  const pts: Vec2[] = [[x0, z0], def.gap, def.safe]
  const len = polylineLength(pts)
  const d = (T - t0) * RUN
  const moving = walkPolyline(pts, d, _side)
  out.x = _side.x
  out.z = _side.z
  out.y = 0
  if (moving && d > 0) {
    out.yaw = _side.yaw
    out.anim = 'run'
    out.speed = RUN
  }
  return t0 + len / RUN
}

function watch(out: CrewPose, i: number, target: THREE.Vector3): void {
  out.yaw = yawToward({ x: out.x, z: out.z }, { x: target.x, z: target.z })
  out.look = _look[i].copy(target)
}

/** The return walk (shared by everyone from RETURN_START). Returns true while still walking. */
function returnWalk(def: CrewDef, startX: number, startZ: number, ctx: CrewContext, out: CrewPose): boolean {
  const t = ctx.T - (RETURN_START + def.delay)
  trackSide(S_ENTER, def.retLat, _side)
  const enterX = _side.x
  const enterZ = _side.z
  const len1 = Math.hypot(enterX - startX, enterZ - startZ)
  const len2 = S_ENTER - S_EXIT
  trackSide(S_EXIT, def.retLat, _side)
  const exitPts: Vec2[] = [[_side.x, _side.z], ...def.exit]
  const len3 = polylineLength(exitPts)
  const d = Math.max(0, t) * WALK
  out.y = 0
  out.speed = WALK
  out.anim = t > 0 ? 'walk' : 'idle'
  if (d < len1) {
    const k = len1 > 1e-6 ? d / len1 : 1
    out.x = lerp(startX, enterX, k)
    out.z = lerp(startZ, enterZ, k)
    if (t > 0) out.yaw = yawToward({ x: startX, z: startZ }, { x: enterX, z: enterZ })
    return true
  }
  if (d < len1 + len2) {
    // walk toward the tower (decreasing s), staying behind the returning transporter
    let s = S_ENTER - (d - len1)
    s = Math.max(s, ctx.trS + TRANSPORTER.length / 2 + 2.6)
    trackSide(s, def.retLat, _side)
    out.x = _side.x
    out.z = _side.z
    out.yaw = _side.yaw + Math.PI
    return true
  }
  const walking = walkPolyline(exitPts, d - len1 - len2, _side)
  out.x = _side.x
  out.z = _side.z
  if (walking) out.yaw = _side.yaw
  return walking && d - len1 - len2 < len3
}

function rocketPoint(ctx: CrewContext, local: [number, number, number], out: THREE.Vector3): THREE.Vector3 {
  return out.set(local[0], local[1], local[2]).applyMatrix4(ctx.rocketMatrix)
}

function transporterPoint(ctx: CrewContext, local: [number, number, number], out: THREE.Vector3): THREE.Vector3 {
  return out.set(local[0], local[1], local[2]).applyMatrix4(ctx.transporterMatrix)
}

/**
 * Nominal pose of crew member `i` for the current context.
 */
export function crewPose(i: number, ctx: CrewContext, out: CrewPose): CrewPose {
  const def = CREW_DEFS[i]
  const T = ctx.T
  out.quat = null
  out.snap = false
  out.look = null
  out.speed = 0
  out.anim = 'idle'
  const isC = i === 2
  const stowaway = isC && ctx.stowaway

  // ------------------------------------------------------------ rollout
  if (T >= T_ROLLOUT && T < T_PAD) {
    const tr = T - T_ROLLOUT
    besideTransporter(def, ctx.trS, out)
    if (tr < 3.2) {
      // stroll from the station to the transporter's side
      const k = smoothstep(0, 3.2, tr)
      const sx = out.x
      const sz = out.z
      out.x = lerp(def.station[0], sx, k)
      out.z = lerp(def.station[1], sz, k)
      out.yaw = yawToward({ x: def.station[0], z: def.station[1] }, { x: sx, z: sz })
      out.anim = 'walk'
      out.speed = WALK
      return out
    }
    const v = Math.abs(ctx.trSpeed)
    if (ctx.trBlocked && i === 0) {
      out.anim = 'point'
      watch(out, i, _v.set(ctx.player.x, 1.5, ctx.player.z))
    } else if (v > 0.15) {
      out.anim = 'walk'
      out.speed = v
    } else {
      out.anim = 'idle'
      watch(out, i, _v.copy(PAD_LOOK))
    }
    return out
  }

  // ------------------------------------------------------------ pad + countdown + ignition + flight
  if (T >= T_PAD && T < RETURN_START + def.delay) {
    const sPad = ctx.trS
    // stand-by spot beside the parked transporter
    besideTransporter(def, sPad, out)
    const sideX = out.x
    const sideZ = out.z

    if (isC) {
      // the inspector: walk to the rear of the deck, hop up, climb the ladder
      const rear = transporterPoint(ctx, [0, 0, TRANSPORTER.length / 2 + 0.45], _rear)
      const deck = transporterPoint(ctx, [0, DECK_Y, ctx.anchor[2]], _deck)
      const climbTop = ctx.anchor
      const tp = T - T_PAD
      if (tp < 1.6) {
        out.x = lerp(sideX, rear.x, smoothstep(0, 1.6, tp))
        out.z = lerp(sideZ, rear.z, smoothstep(0, 1.6, tp))
        out.yaw = yawToward({ x: sideX, z: sideZ }, { x: rear.x, z: rear.z })
        out.anim = 'walk'
        out.speed = WALK
        return out
      }
      const climbing = (local: [number, number, number], facing: number, anim: WorkerAnim, speed: number) => {
        rocketPoint(ctx, local, _v)
        out.x = _v.x
        out.y = _v.y
        out.z = _v.z
        out.quat = _q.copy(ctx.rocketQuat).multiply(_qFacing.setFromAxisAngle(Y_AXIS, facing))
        out.yaw = 0
        out.anim = anim
        out.speed = speed
        out.snap = true
      }
      // when C is not the stowaway he climbs down at T = 0 and runs
      const downAt = 0
      if (!stowaway && T >= downAt) {
        const td = T - downAt
        if (td < 1.4) {
          const k = smoothstep(0, 1.4, td)
          climbing([0, lerp(climbTop[1], 0, k), climbTop[2]], 0, 'walk', 0.8)
          return out
        }
        if (td < 1.85) {
          const k = smoothstep(1.4, 1.85, td)
          out.x = lerp(deck.x, rear.x, k)
          out.z = lerp(deck.z, rear.z, k)
          out.y = DECK_Y * (1 - k) + Math.sin(k * Math.PI) * 0.5
          out.yaw = yawToward({ x: deck.x, z: deck.z }, { x: rear.x, z: rear.z })
          out.anim = 'tumble'
          out.snap = true
          return out
        }
        const arrive = runToSafety(def, rear.x, rear.z, downAt + 1.85, T, out)
        if (T >= arrive) postArrival(i, ctx, T - arrive, out)
        return out
      }
      if (tp < 2.1) {
        // hop onto the deck
        const k = smoothstep(1.6, 2.1, tp)
        out.x = lerp(rear.x, deck.x, k)
        out.z = lerp(rear.z, deck.z, k)
        out.y = DECK_Y * k + Math.sin(k * Math.PI) * 0.5
        out.yaw = yawToward({ x: rear.x, z: rear.z }, { x: deck.x, z: deck.z })
        out.anim = 'walk'
        out.speed = WALK
        out.snap = true
        return out
      }
      if (tp < 4.2) {
        const k = smoothstep(2.1, 4.2, tp)
        climbing([0, lerp(0, climbTop[1], k), climbTop[2]], 0, 'walk', 0.8)
        return out
      }
      // on the ladder (stowaway or still inspecting before T = 0)
      const tau = T - T_LIFTOFF
      if (stowaway && ctx.plan?.stowaway && tau >= STOWAWAY.detach) {
        stowawayFlight(ctx, tau, out)
        return out
      }
      if (T < 4 || !stowaway) {
        climbing(climbTop, 0, 'work', 0)
      } else if (T < T_IGNITION) {
        climbing(climbTop, Math.PI, 'wave', 0)
      } else {
        climbing(climbTop, Math.PI, 'panic', 0)
      }
      return out
    }

    // A and B: hang around the parked transporter, then run at T = 0
    if (T < 0) {
      out.x = sideX
      out.z = sideZ
      out.anim = i === 0 ? 'idle' : 'point'
      watch(out, i, _v.set(PAD_X, 4.5, PAD_Z))
      return out
    }
    const arrive = runToSafety(def, sideX, sideZ, 0, T, out)
    if (T >= arrive) postArrival(i, ctx, T - arrive, out)
    return out
  }

  // ------------------------------------------------------------ return walk / stations
  if (T >= RETURN_START + def.delay - 1e-6 && T < 200) {
    let sx = def.safe[0]
    let sz = def.safe[1]
    if (stowaway) {
      sx = STOWAWAY_GROUND[0]
      sz = STOWAWAY_GROUND[1]
    }
    const walking = returnWalk(def, sx, sz, ctx, out)
    if (walking) return out
  }
  setStation(def, i, ctx, out)
  return out
}

/** After reaching the safe spot: panic, watch, react to the outcome. */
function postArrival(i: number, ctx: CrewContext, since: number, out: CrewPose): void {
  const T = ctx.T
  watch(out, i, _v.copy(PAD_LOOK))
  out.speed = 0
  if (since < 1.3) {
    out.anim = 'panic'
    return
  }
  out.anim = 'idle'
  if (T >= T_IGNITION && T < T_IGNITION + 0.9) {
    out.anim = 'panic'
    return
  }
  const tau = T - T_LIFTOFF
  const plan = ctx.plan
  if (tau < 0 || !plan) {
    if (T > 4 && ctx.stowaway) {
      out.anim = 'point'
      watch(out, i, _v.set(PAD_X, 6, PAD_Z + 1.5))
    }
    return
  }
  // follow the rocket (or the airborne stowaway)
  const st = plan.stowaway
  if (st && tau >= STOWAWAY.detach && tau < STOWAWAY.detach + STOWAWAY.flight + 0.3) {
    evalTrack(st, tau - st.t0, _v, _q)
    out.anim = 'point'
    watch(out, i, _v)
    return
  }
  if (st && tau >= STOWAWAY.detach + STOWAWAY.flight && tau < STOWAWAY.detach + STOWAWAY.flight + 2.4) {
    out.anim = 'cheer'
    return
  }
  const rev = plan.revealAt
  if (tau < rev) {
    out.anim = tau < 2.5 ? 'point' : 'idle'
    watch(out, i, _v.set(PAD_X, Math.min(60, 6 + tau * tau * 1.9), PAD_Z))
    return
  }
  const after = tau - rev
  if (ctx.outcome === 'success' || ctx.outcome === 'wobble') {
    out.anim = after < 3.2 ? 'cheer' : 'idle'
    if (ctx.outcome === 'wobble' && after < 1.2) out.anim = 'point'
  } else {
    out.anim = after < 1.8 ? 'panic' : 'idle'
  }
}

/** The stowaway after letting go of the rocket. */
function stowawayFlight(ctx: CrewContext, tau: number, out: CrewPose): void {
  const st = ctx.plan!.stowaway!
  const t = tau - st.t0
  out.snap = true
  out.quat = null
  if (t < st.tLand) {
    evalTrack(st, t, _v, _q)
    out.x = _v.x
    out.y = _v.y
    out.z = _v.z
    out.yaw = t * st.spin
    out.anim = 'tumble'
    return
  }
  if (t < st.tRest) {
    evalTrack(st, t, _v, _q)
    out.x = _v.x
    out.y = _v.y
    out.z = _v.z
    out.yaw = st.tLand * st.spin
    out.anim = 'tumble'
    return
  }
  const lieEnd = st.tRest + STOWAWAY.lie
  const hopEnd = lieEnd + STOWAWAY.hopOff
  const dustEnd = hopEnd + STOWAWAY.dust
  const waveEnd = dustEnd + STOWAWAY.wave
  const ground: Vec2 = STOWAWAY_GROUND
  if (t < lieEnd) {
    out.x = st.rest[0]
    out.y = st.rest[1] - 0.05
    out.z = st.rest[2]
    out.yaw = 0.4
    out.anim = 'sleep'
    return
  }
  if (t < hopEnd) {
    const k = smoothstep(lieEnd, hopEnd, t)
    out.x = lerp(st.rest[0], ground[0], k)
    out.z = lerp(st.rest[2], ground[1], k)
    out.y = lerp(st.rest[1], 0, k) + Math.sin(k * Math.PI) * 0.55
    out.yaw = yawToward({ x: st.rest[0], z: st.rest[2] }, { x: ground[0], z: ground[1] })
    out.anim = 'idle'
    return
  }
  out.x = ground[0]
  out.z = ground[1]
  out.y = 0
  out.snap = false
  out.yaw = yawToward({ x: ground[0], z: ground[1] }, { x: PAD_X, z: PAD_Z + 9 })
  if (t < dustEnd) out.anim = 'work'
  else if (t < waveEnd) out.anim = 'wave'
  else {
    out.anim = 'idle'
    out.look = _look[2].set(PAD_X, 2, PAD_Z)
  }
}

/** True when the crew member is in the air / on the rocket (no ground shadow follower). */
export function crewAirborne(p: CrewPose): boolean {
  return p.y > 0.05
}
