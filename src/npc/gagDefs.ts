/**
 * The seven ambient gags (spec §8). Each is a deterministic timeline of t:
 * actor poses (keyframe tracks / kinematics), prop states and effect cues.
 * Every gag starts from actors settled at a known station, never touches a
 * restricted zone, and ends with each actor at a spot from which a validated
 * straight walk leads back to its station (see npc.gags.test.ts).
 *
 * Cartoon slapstick only: everybody pops up, dusts off and goes back to work.
 */
import { yawToward } from '@/core/math'
import type { Vec2, Vec3 } from '@/core/types'
import { GAG_QUIPS } from '@/content/dialogue'
import { EAST, NORTH, SOUTH, WEST } from '@/world/layout'
import {
  ARM,
  CRATE_REST,
  Track,
  armIK,
  armIdle,
  armTip,
  crossed,
  ease,
  easeIn,
  easeOut,
  mix,
  mixArm,
  span,
  type ArmAngles,
  type GagFx,
  type Key,
  type PropStates,
} from './gagKit'
import { FOAM_PILE, JACK_A, JACK_B, JACK_SIZE, KICK_MACHINE, NAP_CONVEYOR, PRINTER, ROBOT_ARM, VAT } from './propsData'
import { NAP_SPOT, stationPos } from './roster'
import { defaultPose, type ActorPose } from './types'

export interface GagActor {
  npc: string
  /** Station the NPC must be settled at for the gag to start. */
  station: string
  /** Station it walks back to afterwards. */
  returnTo: string
  /** Optional via points for the walk back (validated with the rest of the route). */
  returnVia?: Vec2[]
}

export interface GagContext {
  fx: GagFx
  props: PropStates
  /** Writable pose per actor npc id (yaw = target facing). */
  poses: Record<string, ActorPose>
  player: { x: number; z: number }
  /** Free-running seconds (idle animation phase). */
  clock: number
}

export interface GagDef {
  /** Director id, e.g. 'gag:nap'. */
  id: string
  label: string
  cooldown: number
  duration: number
  /** Where it happens (visibility test + 'gag:start' position). */
  anchor: Vec3
  actors: GagActor[]
  /** Idle bystanders within this radius turn to watch. */
  audience: number
  /**
   * Ground the choreography sweeps through (circles [x, z, radius]): the gag only
   * starts on its own while the visitor stands clear of all of them, so nobody
   * tumbles, rolls or splashes straight through them.
   */
  keepClear?: [number, number, number][]
  /** Ground position of each actor when the timeline ends. */
  endPositions(): Record<string, Vec2>
  start(ctx: GagContext): void
  update(t: number, dt: number, ctx: GagContext): void
  /** Put props back to rest (normal end or abort). */
  finish(ctx: GagContext, aborted: boolean): void
}

const v3 = (x: number, y: number, z: number): Vec3 => [x, y, z]

// ===========================================================================
// (a) Nap: the forklift driver naps on the conveyor end and gets boxed.
// ===========================================================================

const NAP_Y = NAP_CONVEYOR.height
const NAP_OFF: Vec2 = [NAP_CONVEYOR.pos[0] - 0.95, NAP_SPOT[1]]
const CRATE_FLOOR = { x: NAP_CONVEYOR.pos[0] - 1.15, y: 0.28, z: NAP_CONVEYOR.pos[1] + 1.15 }
const NAP_PICK: Vec2 = [CRATE_FLOOR.x + 0.05, CRATE_FLOOR.z - 0.72]
const NAP_DROP: Vec2 = [NAP_CONVEYOR.pos[0] - 0.92, CRATE_REST.z]
const NAP_TOUCH_Z = NAP_SPOT[1] + 1.38
const NAP_COVER_Z = NAP_SPOT[1] - 0.38

const napTrack = new Track([
  { t: 0, p: NAP_SPOT, y: NAP_Y, yaw: SOUTH, a: 'sleep', face: 'hold' },
  { t: 5.5, a: 'sit' },
  { t: 6.2, p: NAP_SPOT, y: NAP_Y },
  { t: 6.9, p: NAP_OFF, y: 0, yaw: SOUTH },
  { t: 7.0, a: 'cheer', yaw: EAST },
  { t: 8.0, a: 'walk', face: 'move', p: NAP_OFF, yaw: EAST },
  { t: 8.8, p: NAP_PICK },
  { t: 8.8, a: 'work', face: 'hold', yaw: SOUTH },
  { t: 9.4, a: 'carry', carry: true, p: NAP_PICK, yaw: SOUTH },
  { t: 10.2, p: NAP_DROP, face: 'move' },
  { t: 10.25, face: 'hold', yaw: EAST },
  { t: 11.2, carry: false, a: 'idle', yaw: EAST },
  { t: 12.0, p: NAP_DROP },
])

export const GAG_NAP: GagDef = {
  id: 'gag:nap',
  label: 'Forklift driver napping on a conveyor gets boxed',
  cooldown: 100,
  duration: 12,
  anchor: v3(NAP_CONVEYOR.pos[0], 1, NAP_CONVEYOR.pos[1]),
  actors: [{ npc: 'driver', station: 'nap', returnTo: 'lean' }],
  audience: 9,
  keepClear: [
    [NAP_OFF[0], NAP_OFF[1], 1.0],
    [NAP_PICK[0], NAP_PICK[1], 1.0],
    [NAP_DROP[0], NAP_DROP[1], 1.0],
  ],
  endPositions: () => ({ driver: napTrack.end }),
  start(ctx) {
    ctx.fx.sfx('machine-clank', v3(CRATE_REST.x, 0.8, CRATE_REST.z + 0.3), 0.6, 0.8)
  },
  update(t, dt, ctx) {
    const pose = ctx.poses.driver
    napTrack.sample(t, pose)
    const P = ctx.props
    const c = P.napCrate
    P.conveyorRun = t < 2.7 ? Math.min(1, t / 0.3) : Math.max(0, 1 - (t - 2.7) / 0.3)
    if (t < 2.0) {
      // riding the rollers toward the boots
      c.x = CRATE_REST.x
      c.y = CRATE_REST.y
      c.z = mix(CRATE_REST.z, NAP_TOUCH_Z, easeIn(span(t, 0, 2.0)))
      c.rx = c.ry = c.rz = 0
    } else if (t < 2.7) {
      // hop and flip over his chest
      const u = span(t, 2.0, 2.7)
      c.z = mix(NAP_TOUCH_Z, NAP_COVER_Z, ease(u))
      c.y = CRATE_REST.y + Math.sin(u * Math.PI) * 0.95
      c.rx = -Math.PI * ease(u)
    } else if (t < 5.4) {
      // boxed: muffled struggling
      const burst = (t > 3.2 && t < 3.7) || (t > 4.3 && t < 4.9) ? 1 : 0.15
      c.z = NAP_COVER_Z
      c.y = CRATE_REST.y + Math.abs(Math.sin(t * 13)) * 0.035 * burst
      c.rx = -Math.PI
      c.rz = Math.sin(t * 21) * 0.06 * burst
    } else if (t < 6.3) {
      // pops off onto the floor
      const u = span(t, 5.4, 6.3)
      c.x = mix(CRATE_REST.x, CRATE_FLOOR.x, u)
      c.z = mix(NAP_COVER_Z, CRATE_FLOOR.z, u)
      c.y = mix(CRATE_REST.y, CRATE_FLOOR.y, u) + Math.sin(u * Math.PI) * 1.1
      c.rx = -Math.PI - Math.PI * easeOut(u)
      c.ry = 0.6 * u
      c.rz = 0
    } else if (t < 9.4) {
      c.x = CRATE_FLOOR.x
      c.y = CRATE_FLOOR.y
      c.z = CRATE_FLOOR.z
      c.rx = 0
      c.ry = 0.6
    } else if (t < 10.6) {
      // carried in front of the driver
      const fx = -Math.sin(pose.yaw)
      const fz = -Math.cos(pose.yaw)
      c.x = pose.x + fx * 0.6
      c.z = pose.z + fz * 0.6
      c.y = mix(CRATE_FLOOR.y, 1.02, ease(span(t, 9.4, 9.8)))
      c.ry = pose.yaw
      c.rx = 0
    } else {
      // set back on the rollers
      const u = ease(span(t, 10.6, 11.2))
      const fx = -Math.sin(EAST)
      c.x = mix(NAP_DROP[0] + fx * 0.6, CRATE_REST.x, u)
      c.z = CRATE_REST.z
      c.y = mix(1.02, CRATE_REST.y, u)
      c.ry = 0
      c.rx = 0
    }
    if (crossed(t, dt, 0.4)) ctx.fx.say('driver', GAG_QUIPS.napSnore, 1.8)
    if (crossed(t, dt, 2.7)) {
      ctx.fx.sfx('crate-bump', v3(c.x, 1, c.z), 0.9)
      ctx.fx.puff('dust', v3(c.x, 0.85, c.z), 6, 0.5)
    }
    if (crossed(t, dt, 3.4) || crossed(t, dt, 4.5)) ctx.fx.sfx('machine-clank', v3(c.x, 1, c.z), 0.45, 1.4)
    if (crossed(t, dt, 5.4)) {
      ctx.fx.sfx('boing', v3(c.x, 1.2, c.z), 0.9)
      ctx.fx.puff('dust', v3(NAP_SPOT[0], 1.0, NAP_SPOT[1]), 8, 0.6)
    }
    if (crossed(t, dt, 6.3)) {
      ctx.fx.sfx('crate-bump', v3(CRATE_FLOOR.x, 0.3, CRATE_FLOOR.z), 0.7)
      ctx.fx.puff('dust', v3(CRATE_FLOOR.x, 0.1, CRATE_FLOOR.z), 5, 0.5)
    }
    if (crossed(t, dt, 7.0)) ctx.fx.say('driver', GAG_QUIPS.napUp, 2.4)
    if (crossed(t, dt, 11.0)) ctx.fx.sfx('crate-bump', v3(CRATE_REST.x, 0.9, CRATE_REST.z), 0.5, 1.2)
  },
  finish(ctx) {
    Object.assign(ctx.props.napCrate, CRATE_REST)
    ctx.props.conveyorRun = 0
  },
}

// ===========================================================================
// (b) Soot: a puff from the smelter; the worker stumbles out black and shakes it off.
// ===========================================================================

const SOOT_HOME: Vec2 = stationPos('smelter', 'furnace')
const SOOT_OUT: Vec2 = [SOOT_HOME[0] + 1.7, SOOT_HOME[1] - 0.1]
const SOOT_SRC = v3(SOOT_HOME[0] - 0.95, 1.15, SOOT_HOME[1] + 0.25)

const sootTrack = new Track([
  { t: 0, p: SOOT_HOME, a: 'work', yaw: WEST, soot: 0 },
  { t: 0.95, a: 'panic', soot: 0 },
  { t: 1.0, p: SOOT_HOME, face: 'move' },
  { t: 1.2, soot: 1 },
  { t: 2.3, p: SOOT_OUT, a: 'idle', face: 'hold', yaw: EAST },
  { t: 3.3, a: 'panic', soot: 1 },
  { t: 4.4, a: 'idle' },
  { t: 4.6, soot: 0.35 },
  { t: 6.0, p: SOOT_OUT, yaw: EAST },
])

export const GAG_SOOT: GagDef = {
  id: 'gag:soot',
  label: 'Soot puff from the smelter',
  cooldown: 90,
  duration: 6,
  anchor: SOOT_SRC,
  actors: [{ npc: 'smelter', station: 'furnace', returnTo: 'furnace' }],
  audience: 9,
  keepClear: [
    [SOOT_HOME[0] + 0.85, SOOT_HOME[1], 1.0],
    [SOOT_OUT[0], SOOT_OUT[1], 1.1],
  ],
  endPositions: () => ({ smelter: sootTrack.end }),
  start(ctx) {
    ctx.fx.sfx('machine-clank', SOOT_SRC, 0.6, 0.7)
  },
  update(t, dt, ctx) {
    const pose = ctx.poses.smelter
    sootTrack.sample(t, pose)
    if (crossed(t, dt, 0.9)) {
      ctx.fx.puff('soot', SOOT_SRC, 16, 0.75)
      ctx.fx.sfx('steam-hiss', SOOT_SRC, 0.9, 0.75)
    }
    if (crossed(t, dt, 1.6)) ctx.fx.puff('soot', v3(pose.x, 1.2, pose.z), 7, 0.5)
    if (crossed(t, dt, 2.5)) ctx.fx.say('smelter', GAG_QUIPS.sootCough, 1.6)
    if (crossed(t, dt, 3.4)) ctx.fx.puff('soot', v3(pose.x, 1.1, pose.z), 10, 0.6)
    if (crossed(t, dt, 4.5)) ctx.fx.say('smelter', GAG_QUIPS.sootShake, 2.4)
  },
  finish() {},
}

// ===========================================================================
// (c) Vat: the green vat splashes the tank fabricator.
// ===========================================================================

const VAT_HOME: Vec2 = stationPos('tank', 'outer')
const VAT_LOOK: Vec2 = [18.45, 13.95]
const VAT_BACK: Vec2 = [18.45, 13.0]
const VAT_YAW = yawToward({ x: VAT_LOOK[0], z: VAT_LOOK[1] }, { x: VAT.pos[0], z: VAT.pos[1] })

const vatTrack = new Track([
  { t: 0, p: VAT_HOME, a: 'work', yaw: WEST, slime: 0 },
  { t: 0.8, a: 'idle', yaw: VAT_YAW },
  { t: 1.3, a: 'walk', p: VAT_HOME },
  { t: 2.4, p: VAT_LOOK, a: 'work', face: 'hold', yaw: VAT_YAW },
  { t: 4.1, a: 'panic', p: VAT_LOOK, slime: 0 },
  { t: 4.35, slime: 1 },
  { t: 5.1, p: VAT_BACK, a: 'idle', yaw: VAT_YAW },
  { t: 6.3, a: 'panic' },
  { t: 7.1, a: 'idle', slime: 0.75, yaw: WEST },
  { t: 7.9, p: VAT_BACK, yaw: WEST },
])

export const GAG_VAT: GagDef = {
  id: 'gag:vat',
  label: 'Green vat splash',
  cooldown: 110,
  duration: 7.9,
  anchor: v3(VAT.pos[0], 1.2, VAT.pos[1]),
  actors: [{ npc: 'tank', station: 'outer', returnTo: 'outer' }],
  audience: 9,
  keepClear: [
    [VAT_LOOK[0], VAT_LOOK[1], 1.1],
    [VAT_BACK[0], VAT_BACK[1], 1.0],
  ],
  endPositions: () => ({ tank: vatTrack.end }),
  start() {},
  update(t, dt, ctx) {
    const pose = ctx.poses.tank
    vatTrack.sample(t, pose)
    const P = ctx.props
    if (t < 2.4) P.vatAgitation = 0.25
    else if (t < 4.1) P.vatAgitation = mix(0.25, 1, ease(span(t, 2.4, 4.1)))
    else P.vatAgitation = mix(1, 0.25, ease(span(t, 4.1, 7.1)))
    const top = v3(VAT.pos[0], 1.25, VAT.pos[1])
    if (crossed(t, dt, 2.9)) ctx.fx.sfx('steam-hiss', top, 0.45, 0.55)
    if (crossed(t, dt, 4.1)) {
      P.vatSplash = 1
      ctx.fx.puff('slime', top, 18, 0.55)
      ctx.fx.sfx('boing', top, 0.8, 0.8)
      ctx.fx.sfx('steam-hiss', top, 0.7, 1.6)
    }
    if (crossed(t, dt, 5.3)) ctx.fx.say('tank', GAG_QUIPS.vatOops, 2)
    if (crossed(t, dt, 6.4)) ctx.fx.puff('slime', v3(pose.x, 1.2, pose.z), 8, 0.45)
    if (crossed(t, dt, 7.2)) ctx.fx.say('tank', GAG_QUIPS.vatShrug, 2.2)
  },
  finish(ctx) {
    ctx.props.vatAgitation = 0.25
  },
}

// ===========================================================================
// (d) Memo: the printer outside the break room unrolls a 10 m memo, then rewinds it.
// ===========================================================================

const PRINTER_TOP = v3(PRINTER.pos[0], 1.15, PRINTER.pos[1])

export const GAG_MEMO: GagDef = {
  id: 'gag:memo',
  label: 'Ludicrously long memo',
  cooldown: 95,
  duration: 14,
  anchor: v3(PRINTER.pos[0] - 4, 0.6, PRINTER.pos[1]),
  actors: [],
  audience: 14,
  endPositions: () => ({}),
  start(ctx) {
    ctx.props.printerLamp = 1
    ctx.fx.sfx('scanner-beep', PRINTER_TOP, 0.7)
  },
  update(t, dt, ctx) {
    const P = ctx.props
    if (t < 0.5) P.printerLength = 0
    else if (t < 7.5) P.printerLength = PRINTER.ribbonLength * ease(span(t, 0.5, 7.5))
    else if (t < 11) P.printerLength = PRINTER.ribbonLength
    else P.printerLength = PRINTER.ribbonLength * (1 - easeIn(span(t, 11, 13.4)))
    P.printerFeeding = (t > 0.5 && t < 7.5) || (t > 11 && t < 13.4) ? 1 : 0
    for (const at of [0.6, 2.1, 3.6, 5.1, 6.6]) if (crossed(t, dt, at)) ctx.fx.sfx('printer-whir', PRINTER_TOP, 0.65)
    if (crossed(t, dt, 7.6)) {
      P.printerLamp = 2
      ctx.fx.sfx('machine-clank', PRINTER_TOP, 0.55, 1.3)
      ctx.fx.puff('smoke', PRINTER_TOP, 4, 0.2)
    }
    if (crossed(t, dt, 11) || crossed(t, dt, 12.2)) ctx.fx.sfx('printer-whir', PRINTER_TOP, 0.6, 1.6)
    if (crossed(t, dt, 13.5)) {
      P.printerLamp = 0
      ctx.fx.sfx('scanner-beep', PRINTER_TOP, 0.6, 1.3)
    }
  },
  finish(ctx) {
    ctx.props.printerLength = 0
    ctx.props.printerLamp = 0
    ctx.props.printerFeeding = 0
  },
}

// ===========================================================================
// (e) Machine kick: the tumbler sputters until it gets kicked, then runs fast.
// ===========================================================================

const KICK_HOME: Vec2 = stationPos('circuit', 'test')
/** Approach from the south side (seen in profile from the aisle), around the machine. */
const KICK_VIA: Vec2 = [KICK_MACHINE.pos[0] + 1.4, KICK_MACHINE.pos[1] + 1.15]
const KICK_SPOT: Vec2 = [KICK_MACHINE.pos[0] + 0.1, KICK_MACHINE.pos[1] + 1.15]
const KICK_STACK = v3(KICK_MACHINE.pos[0] + 0.15, 1.75, KICK_MACHINE.pos[1] - 0.25)
const KICK_HIT = v3(KICK_MACHINE.pos[0] + 0.1, 0.45, KICK_MACHINE.pos[1] + 0.62)
const KICK_IMPACT = 6.15

const kickTrack = new Track([
  { t: 0, p: KICK_HOME, a: 'work', yaw: EAST },
  { t: 1.0, a: 'idle', yaw: yawToward({ x: KICK_HOME[0], z: KICK_HOME[1] }, { x: KICK_MACHINE.pos[0], z: KICK_MACHINE.pos[1] }) },
  { t: 1.6, a: 'walk', p: KICK_HOME },
  { t: 4.0, p: KICK_VIA },
  { t: 5.1, p: KICK_SPOT, a: 'idle', face: 'hold', yaw: NORTH },
  { t: 5.9, a: 'kick' },
  { t: 6.5, a: 'idle' },
  { t: 7.1, a: 'cheer' },
  { t: 8.3, a: 'idle', yaw: NORTH },
  { t: 8.9, p: KICK_SPOT, yaw: NORTH },
])

export const GAG_KICK: GagDef = {
  id: 'gag:kick',
  label: 'Percussive maintenance',
  cooldown: 80,
  duration: 8.9,
  anchor: v3(KICK_MACHINE.pos[0], 0.9, KICK_MACHINE.pos[1]),
  actors: [{ npc: 'circuit', station: 'test', returnTo: 'test', returnVia: [KICK_VIA] }],
  audience: 10,
  keepClear: [
    [KICK_VIA[0], KICK_VIA[1], 1.0],
    [KICK_SPOT[0], KICK_SPOT[1], 1.1],
  ],
  endPositions: () => ({ circuit: kickTrack.end }),
  start() {},
  update(t, dt, ctx) {
    kickTrack.sample(t, ctx.poses.circuit)
    const P = ctx.props
    if (t < KICK_IMPACT) P.kickSputter = Math.min(1, t / 0.4)
    else P.kickSputter = 0
    for (const at of [0.2, 0.9, 1.6, 2.3, 3.0, 3.7, 4.4, 5.1]) {
      if (crossed(t, dt, at)) {
        ctx.fx.sfx('machine-clank', KICK_STACK, 0.5, 0.8 + ((at * 7) % 0.4))
        ctx.fx.puff('smoke', KICK_STACK, 3, 0.15)
      }
    }
    if (crossed(t, dt, 5.2)) ctx.fx.say('circuit', GAG_QUIPS.kickBefore, 1.8)
    if (crossed(t, dt, KICK_IMPACT)) {
      P.kickBoost = 1
      P.kickImpact = 0
      ctx.fx.sfx('machine-kick', KICK_HIT, 1)
      ctx.fx.puff('spark', KICK_HIT, 7, 0.25)
      ctx.fx.achievement('machine-kick', KICK_HIT, 15)
    }
    if (crossed(t, dt, 7.2)) ctx.fx.say('circuit', GAG_QUIPS.kickAfter, 2.4)
  },
  finish(ctx) {
    ctx.props.kickSputter = 0
  },
}

// ===========================================================================
// (f) Pallet-jack standoff in the main aisle south of the QC arch.
// ===========================================================================

const JACK_REACH = JACK_SIZE.length / 2 + 0.4
const SA_HOME: Vec2 = stationPos('smelter', 'furnace')
const SB_HOME: Vec2 = stationPos('circuit', 'booth')
const SA_GRAB: Vec2 = [JACK_A.pos[0] - JACK_REACH, JACK_A.pos[1]]
const SB_GRAB: Vec2 = [JACK_B.pos[0] + JACK_REACH, JACK_B.pos[1]]
const SA_MEET: Vec2 = [-0.15 - JACK_SIZE.length - 0.4, JACK_A.pos[1]]
const SB_MEET: Vec2 = [0.15 + JACK_SIZE.length + 0.4, JACK_B.pos[1]]
const SA_BACK: Vec2 = [SA_MEET[0] - 1.05, JACK_A.pos[1]]
const SB_BACK: Vec2 = [SB_MEET[0] + 1.05, JACK_B.pos[1]]

function standoffKeys(home: Vec2, grab: Vec2, meet: Vec2, back: Vec2, yaw: number, lag: number): Key[] {
  return [
    { t: 0, p: home, a: 'walk' },
    { t: 1.4, p: grab, a: 'idle', face: 'hold', yaw },
    { t: 1.9 + lag, a: 'walk', face: 'hold', yaw, p: grab },
    { t: 5.6, p: meet, a: 'idle' },
    { t: 7.3, a: 'walk', gait: 0.7, p: meet },
    { t: 8.4, p: back, a: 'idle', gait: null },
    { t: 9.0, a: 'walk', p: back },
    { t: 9.9, p: meet, a: 'idle' },
    { t: 11.3 + lag, a: 'walk', gait: 0.8, p: meet },
    { t: 14.6, p: grab, a: 'idle', gait: null },
    { t: 15.2, p: grab, yaw },
  ]
}

const standA = new Track(standoffKeys(SA_HOME, SA_GRAB, SA_MEET, SA_BACK, EAST, 0))
const standB = new Track(standoffKeys(SB_HOME, SB_GRAB, SB_MEET, SB_BACK, WEST, 0.25))

function placeJack(jack: PropStates['jackA'], worker: ActorPose, parked: Vec2, yaw: number, pushing: boolean): void {
  if (pushing) {
    jack.x = worker.x - Math.sin(yaw) * JACK_REACH
    jack.z = worker.z - Math.cos(yaw) * JACK_REACH
    jack.moving = true
  } else {
    jack.x = parked[0]
    jack.z = parked[1]
    jack.moving = false
  }
  jack.yaw = yaw
}

export const GAG_STANDOFF: GagDef = {
  id: 'gag:standoff',
  label: 'Pallet-jack standoff',
  cooldown: 120,
  duration: 15.2,
  anchor: v3(0, 1, JACK_A.pos[1]),
  actors: [
    { npc: 'smelter', station: 'furnace', returnTo: 'furnace' },
    { npc: 'circuit', station: 'booth', returnTo: 'booth' },
  ],
  audience: 10,
  // both jacks roll nose to nose across the aisle
  keepClear: [[0, JACK_A.pos[1], 3.2]],
  endPositions: () => ({ smelter: standA.end, circuit: standB.end }),
  start() {},
  update(t, dt, ctx) {
    const a = standA.sample(t, ctx.poses.smelter)
    const b = standB.sample(t, ctx.poses.circuit)
    placeJack(ctx.props.jackA, a, JACK_A.pos, JACK_A.yaw, t >= 1.9 && t < 14.6)
    placeJack(ctx.props.jackB, b, JACK_B.pos, JACK_B.yaw, t >= 2.15 && t < 14.6)
    const pa = v3(a.x, 1.1, a.z)
    const pb = v3(b.x, 1.1, b.z)
    if (crossed(t, dt, 5.8)) {
      ctx.fx.sfx('forklift-horn', pa, 0.5, 1.9)
      ctx.fx.say('smelter', GAG_QUIPS.standoffA1, 1.8)
    }
    if (crossed(t, dt, 6.5)) {
      ctx.fx.sfx('forklift-horn', pb, 0.5, 2.15)
      ctx.fx.say('circuit', GAG_QUIPS.standoffB1, 1.9)
    }
    if (crossed(t, dt, 10.0) || crossed(t, dt, 10.28)) ctx.fx.sfx('forklift-horn', pa, 0.55, 1.95)
    if (crossed(t, dt, 10.0)) ctx.fx.say('smelter', GAG_QUIPS.standoffA2, 1.4)
    if (crossed(t, dt, 10.6) || crossed(t, dt, 10.85)) ctx.fx.sfx('forklift-horn', pb, 0.55, 2.2)
    if (crossed(t, dt, 10.6)) ctx.fx.say('circuit', GAG_QUIPS.standoffB2, 1.4)
    if (crossed(t, dt, 14.7)) ctx.fx.say('smelter', GAG_QUIPS.standoffEnd, 1.4)
    if (crossed(t, dt, 15.0)) ctx.fx.say('circuit', GAG_QUIPS.standoffEnd, 1.4)
  },
  finish(ctx) {
    const P = ctx.props
    Object.assign(P.jackA, { x: JACK_A.pos[0], z: JACK_A.pos[1], yaw: JACK_A.yaw, moving: false })
    Object.assign(P.jackB, { x: JACK_B.pos[0], z: JACK_B.pos[1], yaw: JACK_B.yaw, moving: false })
  },
}

// ===========================================================================
// (g) Robot arm flings the crew chief into the foam pile.
// ===========================================================================

const ARM_CHIEF: Vec2 = [-10.9, -9.2]
const ARM_LAND: Vec2 = [FOAM_PILE.pos[0], FOAM_PILE.pos[1]]
const ARM_OUT: Vec2 = [-10.55, -13.35]
const ARM_HOLD_OFFSET = 0.22
const ARM_SINK = -0.32
const TURRET_CHIEF = yawToward({ x: ROBOT_ARM.pos[0], z: ROBOT_ARM.pos[1] }, { x: ARM_CHIEF[0], z: ARM_CHIEF[1] })
const TURRET_FOAM = yawToward({ x: ROBOT_ARM.pos[0], z: ROBOT_ARM.pos[1] }, { x: FOAM_PILE.pos[0], z: FOAM_PILE.pos[1] })
const CHIEF_REACH = Math.hypot(ARM_CHIEF[0] - ROBOT_ARM.pos[0], ARM_CHIEF[1] - ROBOT_ARM.pos[1]) - ARM_HOLD_OFFSET
const POSE_GRAB: ArmAngles = { turret: TURRET_CHIEF, ...armIK(CHIEF_REACH, 0), grip: 0 }
const POSE_GRABBED: ArmAngles = { ...POSE_GRAB, grip: 1 }
const POSE_LIFT: ArmAngles = { turret: TURRET_CHIEF, ...armIK(1.25, 0.85), grip: 1 }
const POSE_RELEASE: ArmAngles = { turret: TURRET_FOAM, ...armIK(1.55, 1.05), grip: 1 }

const _tip = { x: 0, y: 0, z: 0 }
const _held = { x: 0, y: 0, z: 0 }
const _a0: ArmAngles = { turret: 0, shoulder: 0, elbow: 0, grip: 0 }
const _idle: ArmAngles = { turret: 0, shoulder: 0, elbow: 0, grip: 0 }
const _rel = { x: 0, y: 0, z: 0, set: false }

/** Where the held chief's feet are for the given arm angles. */
function heldPosition(a: ArmAngles, out: { x: number; y: number; z: number }) {
  armTip(a, _tip)
  out.x = _tip.x - Math.sin(a.turret) * ARM_HOLD_OFFSET
  out.z = _tip.z - Math.cos(a.turret) * ARM_HOLD_OFFSET
  out.y = _tip.y - ARM.shoulderY
  return out
}

const armOutTrack = new Track([
  { t: 6.6, p: ARM_LAND, y: ARM_SINK, a: 'walk' },
  { t: 7.9, p: ARM_OUT, y: 0, a: 'thumbsup', face: 'hold', yaw: EAST }, // "I'm fine!"
  { t: 9.6, p: ARM_OUT, yaw: EAST },
])

let armWaveYaw = EAST

export const GAG_ROBOT_ARM: GagDef = {
  id: 'gag:robot-arm',
  label: 'Robot arm launches the crew chief into foam',
  cooldown: 110,
  duration: 9.6,
  anchor: v3(ROBOT_ARM.pos[0], 1.6, ROBOT_ARM.pos[1] - 1.5),
  actors: [{ npc: 'chief', station: 'arm', returnTo: 'arm' }],
  audience: 12,
  keepClear: [
    [ARM_CHIEF[0], ARM_CHIEF[1], 1.0],
    [(ARM_CHIEF[0] + ARM_LAND[0]) / 2, (ARM_CHIEF[1] + ARM_LAND[1]) / 2, 1.6],
    [ARM_OUT[0], ARM_OUT[1], 1.0],
  ],
  endPositions: () => ({ chief: ARM_OUT }),
  start(ctx) {
    Object.assign(_a0, ctx.props.armNow)
    ctx.props.armOverride = true
    _rel.set = false
    armWaveYaw = yawToward({ x: ARM_OUT[0], z: ARM_OUT[1] }, ctx.player)
  },
  update(t, dt, ctx) {
    const P = ctx.props
    const pose = ctx.poses.chief
    // ---- arm joints
    if (t < 1.4) mixArm(_a0, POSE_GRAB, ease(span(t, 0, 1.4)), P.arm)
    else if (t < 1.7) mixArm(POSE_GRAB, POSE_GRABBED, span(t, 1.4, 1.7), P.arm)
    else if (t < 2.6) mixArm(POSE_GRABBED, POSE_LIFT, ease(span(t, 1.7, 2.6)), P.arm)
    else if (t < 3.15) mixArm(POSE_LIFT, POSE_RELEASE, easeIn(span(t, 2.6, 3.15)), P.arm)
    else if (t < 5.4) {
      armIdle(P.armClock, _idle)
      mixArm({ ...POSE_RELEASE, grip: 0 }, _idle, ease(span(t, 3.15, 5.4)), P.arm)
    } else {
      armIdle(P.armClock, P.arm)
      P.armOverride = false
    }
    // ---- the chief
    pose.lean = 0
    pose.carry = false
    pose.hidden = false
    pose.soot = 0
    pose.slime = 0
    if (t < 1.7) {
      pose.x = ARM_CHIEF[0]
      pose.z = ARM_CHIEF[1]
      pose.y = 0
      pose.yaw = TURRET_CHIEF + Math.PI
      pose.anim = t < 1.45 ? 'idle' : 'panic'
      pose.speed = 0
    } else if (t < 3.15) {
      heldPosition(P.arm, _held)
      pose.x = _held.x
      pose.z = _held.z
      pose.y = Math.max(0, _held.y)
      pose.yaw = P.arm.turret + Math.PI
      pose.anim = 'panic'
      pose.speed = 0
      _rel.x = pose.x
      _rel.y = pose.y
      _rel.z = pose.z
      _rel.set = true
    } else if (t < 4.1) {
      if (!_rel.set) {
        heldPosition(POSE_RELEASE, _rel)
        _rel.set = true
      }
      const u = span(t, 3.15, 4.1)
      pose.x = mix(_rel.x, ARM_LAND[0], u)
      pose.z = mix(_rel.z, ARM_LAND[1], u)
      pose.y = mix(_rel.y, ARM_SINK, u) + 4 * u * (1 - u) * 0.9
      pose.yaw = TURRET_FOAM + Math.PI + u * 1.2
      pose.anim = 'tumble'
      pose.speed = 0
    } else if (t < 6.6) {
      pose.x = ARM_LAND[0]
      pose.z = ARM_LAND[1]
      pose.y = ARM_SINK + Math.sin(t * 9) * 0.05
      pose.anim = 'panic'
      pose.yaw = TURRET_FOAM + Math.PI + 1.2
      pose.speed = 0
    } else {
      armOutTrack.sample(t, pose)
      if (t >= 7.9) pose.yaw = armWaveYaw
    }
    // ---- cues
    if (crossed(t, dt, 1.0)) ctx.fx.say('chief', GAG_QUIPS.armGrab, 1.3)
    if (crossed(t, dt, 1.55)) ctx.fx.sfx('machine-clank', v3(ARM_CHIEF[0], 1.3, ARM_CHIEF[1]), 0.6, 1.2)
    if (crossed(t, dt, 2.65)) ctx.fx.sfx('machine-clank', v3(ROBOT_ARM.pos[0], 2, ROBOT_ARM.pos[1]), 0.7, 0.7)
    if (crossed(t, dt, 4.1)) {
      P.foamSquash = 1
      ctx.fx.sfx('boing', v3(ARM_LAND[0], 0.6, ARM_LAND[1]), 1)
      ctx.fx.puff('foam', v3(ARM_LAND[0], 0.7, ARM_LAND[1]), 18, 0.9)
    }
    if (crossed(t, dt, 5.4)) ctx.fx.say('chief', GAG_QUIPS.armFoam, 1.8)
    if (crossed(t, dt, 6.8)) ctx.fx.puff('foam', v3(ARM_LAND[0], 0.6, ARM_LAND[1]), 6, 0.6)
    if (crossed(t, dt, 8.1)) ctx.fx.say('chief', GAG_QUIPS.armThumbs, 2.2)
  },
  finish(ctx) {
    ctx.props.armOverride = false
  },
}

export const GAGS: GagDef[] = [GAG_NAP, GAG_SOOT, GAG_VAT, GAG_MEMO, GAG_KICK, GAG_STANDOFF, GAG_ROBOT_ARM]

export function gagById(id: string): GagDef | undefined {
  const full = id.startsWith('gag:') ? id : `gag:${id}`
  return GAGS.find((g) => g.id === full)
}

/** A fresh pose object per actor, seeded from where the brain currently is. */
export function initialPose(x: number, z: number, y: number, yaw: number): ActorPose {
  const p = defaultPose()
  p.x = x
  p.z = z
  p.y = y
  p.yaw = yaw
  return p
}
