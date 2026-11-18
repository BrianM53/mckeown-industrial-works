/**
 * RocketRuntime: owns the module's scene graph (built imperatively from the
 * geometry builders) and updates it ONCE per frame from factory.state — the
 * single source of truth. Nothing here keeps independent timers: positions are
 * functions of the sim's rocket state; the only local state is visual
 * smoothing (transporter safety lag, crew follower) that always converges back.
 */
import * as THREE from 'three'
import { events } from '@/core/events'
import { clamp, dampAngle, smoothstep, wrapAngle, yawToward } from '@/core/math'
import { runtime } from '@/core/runtime'
import type { QualityTier } from '@/core/types'
import { factory, type RocketPhase, type RocketState } from '@/systems/factory'
import type { WorkerAnim } from '@/world/WorkerModel'
import { getAtlas } from './atlas'
import {
  CLEAR_TRACK_CAPTION,
  CLEAR_TRACK_COOLDOWN,
  COLUMN_OFF,
  CRANE_PIVOT,
  CRANE_TROLLEY_Y,
  CUSHION,
  CUSHION_SIZE,
  DECK_Y,
  KIOSK,
  PAD_X,
  PAD_Z,
  QUALITY,
  RESET_FLASH_SECONDS,
  SIGN_BOARD,
  SIGN_POS,
  SIGN_YAW,
  T_AFTERMATH,
  T_IGNITION,
  T_LIFTOFF,
  TOWER_CX,
  TOWER_CZ,
  TRACK_CLEARANCE_AHEAD,
  TRACK_CLEARANCE_SIDE,
  TRANSPORTER,
  UMBILICAL_HINGE_Z,
  UMBILICAL_LEVELS,
  type RocketQuality,
} from './config'
import { armExtension, craneState, createCraneState, launchTime, rocketOnTransporter, ROCKET_YAW_IN_TOWER, ROLLOUT_CRUISE, RETURN_CRUISE, transportTarget, type CraneState } from './choreo'
import { createCrewPose, crewPose, CREW_DEFS, type CrewContext, type CrewPose } from './crew'
import { landingTimes, writeEffects, type FxFrame } from './effects'
import { buildFlightPlan, evalTrack, FLIGHT_SECONDS, planKey, rocketPose, STOWAWAY, TAU_CLEANUP, thrustAt, type FlightPlan } from './flight'
import { createFlameGeometry, fireballMaterial, flameMaterial } from './fxMaterials'
import { blinkLevels, BLINK, rocketMaterial, triangles, type V3 } from './geo'
import { ParticleBuffer } from './particles'
import { buildRocket, STAGE_COUNT, type RocketModel } from './rocketBuild'
import { BOARD_H, BOARD_W, drawBoard } from './signBoard'
import {
  BOGIES,
  buildArm,
  buildCable,
  buildClamp,
  buildCraneJib,
  buildCushion,
  buildDeckProps,
  buildPad,
  buildSignFrame,
  buildSleeper,
  buildTower,
  buildTrack,
  buildTransporter,
  buildTreadLink,
  buildTrolley,
  TREAD_PERIMETER,
  treadLoop,
  type FloodSpot,
} from './structures'
import { TRACK_PATH, type TrackPoint, type TrackProjection } from './track'

const _m = new THREE.Matrix4()
const _m2 = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _v = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _s = new THREE.Vector3()
const _one = new THREE.Vector3(1, 1, 1)
const Y = new THREE.Vector3(0, 1, 0)
const X = new THREE.Vector3(1, 0, 0)
const _tp: TrackPoint = { x: 0, z: 0, yaw: 0, tx: 1, tz: 0 }
const _proj: TrackProjection = { s: 0, lateral: 0, distance: 0 }
const _c = new THREE.Color()

const EMPTY_GEO = new THREE.BufferGeometry()
const AVIATION = new THREE.Color('#FF4A3A')
const AMBER = new THREE.Color('#FFB23F')
const WARM = new THREE.Color('#FFE6BE')
const GREEN = new THREE.Color('#5DFF7A')

/** Arm hinge on the tower's west face (inside), aimed at the rocket skin at θ ≈ 31°. */
const TOWER_ARM = (() => {
  const hx = TOWER_CX - COLUMN_OFF + 0.5
  const hz = UMBILICAL_HINGE_Z
  const r = 1.25
  const cxp = TOWER_CX - Math.cos((31 * Math.PI) / 180) * r
  const czp = TOWER_CZ + Math.sin((31 * Math.PI) / 180) * r
  const dx = cxp - hx
  const dz = czp - hz
  return { x: hx, z: hz, length: Math.hypot(dx, dz) - 0.3, connected: Math.atan2(-dz, dx), retracted: Math.PI / 2 }
})()

/** Did time move across `t` this frame? */
function crossed(prev: number, now: number, t: number): boolean {
  return prev < t && now >= t
}

interface Follower {
  x: number
  y: number
  z: number
  yaw: number
  speed: number
  init: boolean
}

export interface RocketStats {
  phase: RocketPhase
  T: number
  transporter: { s: number; u: number; speed: number; blocked: boolean; parked: boolean }
  particles: { smoke: number; smokeCap: number; glow: number; glowCap: number; dropped: number }
  drawCalls: number
  triangles: number
  meshes: number
  rocket: { seed: number; triangles: number; height: number } | null
  plan: { outcome: string; stowaway: boolean; debris: number; chunks: number } | null
  crew: { anim: WorkerAnim; x: number; z: number }[]
  quality: QualityTier
  reduced: boolean
}

export class RocketRuntime {
  readonly root = new THREE.Group()
  quality: QualityTier = 'medium'
  q: RocketQuality = QUALITY.medium
  reduced = false
  private mounted = false
  private disposables: { dispose(): void }[] = []

  // ------------------------------------------------------------ objects
  private surface = rocketMaterial()
  private towerFloods: FloodSpot[] = []
  private towerAviation: V3[] = []
  private padBeacons: V3[] = []
  private padAviation: V3[] = []
  private signLamps: V3[] = []
  private transporterBeacons: V3[] = []
  private transporter = new THREE.Group()
  private treads: THREE.InstancedMesh | null = null
  private clamps: THREE.InstancedMesh | null = null
  private arms: THREE.InstancedMesh | null = null
  private padArmHinges: { pos: V3; length: number; connectedYaw: number }[] = []
  private jib = new THREE.Group()
  private trolley: THREE.Mesh | null = null
  private cable: THREE.Mesh | null = null
  private rig: THREE.Mesh | null = null
  private jibTip: V3 = [0, 0, 0]
  private jibApex: V3 = [0, 0, 0]
  private cushion: THREE.Mesh | null = null
  private flames: THREE.InstancedMesh | null = null
  private fireball: THREE.Mesh | null = null
  private debris: THREE.InstancedMesh | null = null
  readonly flash = new THREE.PointLight('#FF9A4A', 0, 70, 1.6)
  private smoke: ParticleBuffer | null = null
  private glow: ParticleBuffer | null = null
  private signCanvas: HTMLCanvasElement | null = null
  private signCtx: CanvasRenderingContext2D | null = null
  private signTexture: THREE.CanvasTexture | null = null
  private signFace: THREE.Mesh | null = null
  private signLastDis = -1
  private resetUntil = -1
  private signKey = ''

  // rocket model (rebuilt per seed)
  model: RocketModel | null = null
  private modelSeed = -1
  private rocketGroup = new THREE.Group()
  private stageMeshes: THREE.Mesh[] = []
  private tapedFin: THREE.Mesh | null = null
  private chunkMeshes: THREE.Mesh[] = []
  private rigGeos: THREE.BufferGeometry[] = []

  // ------------------------------------------------------------ per-frame state
  T = 1e9
  phase: RocketPhase = 'assembling'
  trS = 0
  trSpeed = 0
  trBlocked = false
  /** Transporter stationary for a moment (physics proxy may be enabled). */
  parked = true
  private trInit = false
  private prevTargetS = 0
  private stillFor = 0
  private lastClearCaption = -1e9
  private wasBlocked = false
  private treadOffset = 0
  readonly transporterMatrix = new THREE.Matrix4()
  readonly rocketMatrix = new THREE.Matrix4()
  readonly rocketQuat = new THREE.Quaternion()
  rocketOnDeck = true
  rocketVisible = true
  private crane: CraneState = createCraneState()
  plan: FlightPlan | null = null
  private planBuiltFor = ''
  private planInputs = { id: -1, seed: -1, outcome: '' as string, reduced: false, stowaway: false, debris: -1 }
  private time = 0
  private prevT = 1e9
  private prevSimT = 0
  private landings: { tau: number; x: number; z: number; big: boolean }[] = []
  private fx: FxFrame
  private sparks = [
    { x: 0, y: 0, z: 0, on: false },
    { x: 0, y: 0, z: 0, on: false },
    { x: 0, y: 0, z: 0, on: false },
  ]
  // crew
  readonly crewGroups: (THREE.Group | null)[] = [null, null, null]
  readonly crewAnim: WorkerAnim[] = ['work', 'idle', 'idle']
  readonly crewSpeed = [0, 0, 0]
  readonly crewLook: (number | null)[] = [null, null, null]
  private crewPoses: CrewPose[] = [createCrewPose(), createCrewPose(), createCrewPose()]
  private followers: Follower[] = [0, 1, 2].map(() => ({ x: 0, y: 0, z: 0, yaw: 0, speed: 0, init: false }))
  private crewCtx: CrewContext
  private hookV = new THREE.Vector3()

  constructor() {
    this.root.name = 'factory-rocket'
    this.fx = {
      T: 1e9,
      simT: 0,
      plan: null,
      model: null,
      rocketMatrix: this.rocketMatrix,
      reduced: false,
      q: this.q,
      sparks: this.sparks,
      light: 1,
    }
    this.crewCtx = {
      T: 1e9,
      phase: 'assembling',
      outcome: null,
      stowaway: false,
      plan: null,
      trS: 0,
      trSpeed: 0,
      trBlocked: false,
      rocketMatrix: this.rocketMatrix,
      rocketQuat: this.rocketQuat,
      transporterMatrix: this.transporterMatrix,
      hook: this.hookV,
      craneLowering: false,
      player: runtime.player.position,
      anchor: [0, 4.35, 1.9],
    }
  }

  // ===================================================================== build

  mount(quality: QualityTier): void {
    if (this.mounted) return
    this.mounted = true
    this.quality = quality
    this.q = QUALITY[quality]
    this.fx.q = this.q
    getAtlas()
    const mat = this.surface
    const add = (geo: THREE.BufferGeometry, name: string, cast = true, parent: THREE.Object3D = this.root): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat)
      m.name = name
      m.castShadow = cast
      m.receiveShadow = true
      parent.add(m)
      this.disposables.push(geo)
      return m
    }
    // tower
    const tower = buildTower()
    this.towerFloods = tower.floods
    this.towerAviation = tower.aviation
    add(tower.geo, 'rocket-tower')
    // crane: jib assembly rotates about the pivot
    const jib = buildCraneJib()
    this.jibTip = jib.tip
    this.jibApex = jib.apex
    this.jib.position.set(CRANE_PIVOT[0], 0, CRANE_PIVOT[1])
    this.jib.name = 'rocket-crane'
    this.root.add(this.jib)
    add(jib.geo, 'rocket-crane-jib', true, this.jib)
    this.trolley = add(buildTrolley(), 'rocket-crane-trolley', false, this.jib)
    this.cable = add(buildCable(), 'rocket-crane-cable', false)
    this.cable.matrixAutoUpdate = false
    this.rig = new THREE.Mesh(EMPTY_GEO, mat)
    this.rig.name = 'rocket-crane-rig'
    this.rig.matrixAutoUpdate = false
    this.root.add(this.rig)
    // track + sleepers
    const track = buildTrack()
    add(track.geo, 'rocket-track', false)
    const sleeperGeo = buildSleeper()
    this.disposables.push(sleeperGeo)
    const sleepers = new THREE.InstancedMesh(sleeperGeo, mat, track.sleepers.length)
    track.sleepers.forEach((m, i) => sleepers.setMatrixAt(i, m))
    sleepers.instanceMatrix.needsUpdate = true
    sleepers.receiveShadow = true
    sleepers.name = 'rocket-sleepers'
    sleepers.computeBoundingSphere()
    this.root.add(sleepers)
    this.disposables.push(sleepers)
    // pad
    const pad = buildPad()
    this.padBeacons = pad.beacons
    this.padAviation = pad.aviation
    this.padArmHinges = pad.armHinges
    add(pad.geo, 'rocket-pad')
    // umbilical arms (2 tower + 2 pad) — one instanced draw
    const armGeo = buildArm(TOWER_ARM.length)
    this.disposables.push(armGeo)
    this.arms = new THREE.InstancedMesh(armGeo, mat, 4)
    this.arms.castShadow = true
    this.arms.name = 'rocket-arms'
    this.arms.frustumCulled = false
    this.root.add(this.arms)
    this.disposables.push(this.arms)
    // counter sign
    const sign = buildSignFrame()
    const signGroup = new THREE.Group()
    signGroup.position.set(SIGN_POS[0], 0, SIGN_POS[1])
    signGroup.rotation.y = SIGN_YAW
    signGroup.name = 'rocket-counter-sign'
    this.root.add(signGroup)
    const frame = add(sign.geo, 'rocket-sign-frame', true, signGroup)
    frame.userData.cameraFade = true
    signGroup.updateMatrixWorld(true)
    this.signLamps = sign.lamps.map((p) => {
      _v.set(p[0], p[1], p[2]).applyMatrix4(signGroup.matrixWorld)
      return [_v.x, _v.y, _v.z] as V3
    })
    this.createSignFace(signGroup)
    // deck bench + status kiosk
    add(buildDeckProps(), 'rocket-deck-props')
    // transporter
    this.transporter.name = 'rocket-transporter'
    this.root.add(this.transporter)
    const tb = buildTransporter()
    this.transporterBeacons = tb.beacons
    add(tb.geo, 'rocket-transporter-body', true, this.transporter)
    if (this.q.treadLinks) {
      const linkGeo = buildTreadLink()
      this.disposables.push(linkGeo)
      const per = Math.round(TREAD_PERIMETER / 0.21)
      this.treads = new THREE.InstancedMesh(linkGeo, mat, per * BOGIES.length)
      this.treads.name = 'rocket-treads'
      this.treads.frustumCulled = false
      this.transporter.add(this.treads)
      this.disposables.push(this.treads)
      this.updateTreads(0)
    }
    const clampGeo = buildClamp()
    this.disposables.push(clampGeo)
    this.clamps = new THREE.InstancedMesh(clampGeo, mat, 4)
    this.clamps.name = 'rocket-clamps'
    this.clamps.frustumCulled = false
    this.transporter.add(this.clamps)
    this.disposables.push(this.clamps)
    // rocket group (stage meshes are rebuilt per seed)
    this.rocketGroup.name = 'rocket-rocket'
    this.root.add(this.rocketGroup)
    // cushion
    this.cushion = add(buildCushion(), 'rocket-cushion', true)
    this.cushion.position.set(CUSHION[0], 0, CUSHION[1])
    this.cushion.visible = false
    // flames, fireball, debris
    const flameGeo = createFlameGeometry()
    this.disposables.push(flameGeo)
    this.flames = new THREE.InstancedMesh(flameGeo, flameMaterial(), 3)
    this.flames.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(9), 3)
    this.flames.name = 'rocket-flames'
    this.flames.frustumCulled = false
    this.flames.count = 0
    this.flames.renderOrder = 6
    this.root.add(this.flames)
    this.disposables.push(this.flames)
    const fbGeo = new THREE.IcosahedronGeometry(1, 3)
    this.disposables.push(fbGeo)
    this.fireball = new THREE.Mesh(fbGeo, fireballMaterial())
    this.fireball.name = 'rocket-fireball'
    this.fireball.visible = false
    this.fireball.renderOrder = 6
    this.root.add(this.fireball)
    const debrisGeo = new THREE.BoxGeometry(0.55, 0.12, 0.38)
    this.disposables.push(debrisGeo)
    this.debris = new THREE.InstancedMesh(debrisGeo, mat, 24)
    // created up front so the shader variant is compiled at load, not mid-explosion
    this.debris.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(24 * 3).fill(1), 3)
    this.debris.name = 'rocket-debris'
    this.debris.count = 0
    this.debris.frustumCulled = false
    this.debris.castShadow = true
    this.root.add(this.debris)
    this.disposables.push(this.debris)
    // particles
    this.smoke = new ParticleBuffer(Math.round(230 * this.q.smoke), 'smoke', 'smoke')
    this.glow = new ParticleBuffer(Math.round(200 * this.q.fire) + 40, 'glow', 'glow')
    this.root.add(this.smoke.mesh, this.glow.mesh)
    this.disposables.push(this.smoke, this.glow)
    // the one (always-present, usually dark) light: ignition / explosion glow
    this.flash.name = 'rocket-flash'
    this.flash.position.set(PAD_X, 2, PAD_Z)
    this.root.add(this.flash)
  }

  private createSignFace(parent: THREE.Object3D): void {
    if (typeof document === 'undefined') return
    const canvas = document.createElement('canvas')
    canvas.width = BOARD_W
    canvas.height = BOARD_H
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    this.signCanvas = canvas
    this.signCtx = ctx
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    this.signTexture = tex
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    mat.name = 'rocket:sign-face'
    const geo = new THREE.PlaneGeometry(SIGN_BOARD.w, SIGN_BOARD.h)
    const face = new THREE.Mesh(geo, mat)
    face.position.set(0, SIGN_BOARD.bottom + SIGN_BOARD.h / 2, -0.012)
    face.rotation.y = Math.PI
    face.name = 'rocket-sign-face'
    face.userData.cameraFade = true
    parent.add(face)
    this.signFace = face
    this.disposables.push(geo, mat, tex)
  }

  unmount(): void {
    if (!this.mounted) return
    this.mounted = false
    this.disposeModel()
    for (const d of this.disposables) {
      try {
        d.dispose()
      } catch {
        /* ignore */
      }
    }
    this.disposables = []
    this.root.clear()
    this.jib.clear()
    this.transporter.clear()
    this.rocketGroup.clear()
    this.smoke = null
    this.glow = null
    this.trolley = this.cable = this.rig = this.cushion = this.fireball = this.signFace = null
    this.treads = this.clamps = this.arms = this.flames = this.debris = null
    this.signTexture = null
    this.signCtx = null
    this.signCanvas = null
    this.trInit = false
    this.plan = null
    this.planBuiltFor = ''
    for (const f of this.followers) f.init = false
  }

  private disposeModel(): void {
    for (const m of [...this.stageMeshes, ...this.chunkMeshes]) m.removeFromParent()
    this.tapedFin?.removeFromParent()
    this.stageMeshes = []
    this.chunkMeshes = []
    this.tapedFin = null
    this.rigGeos = []
    if (this.rig) this.rig.geometry = EMPTY_GEO
    this.model?.dispose()
    this.model = null
    this.modelSeed = -1
  }

  private ensureModel(seed: number): void {
    if (this.model && this.modelSeed === seed) return
    this.disposeModel()
    const model = buildRocket(seed)
    this.model = model
    this.modelSeed = seed
    this.fx.model = model
    this.crewCtx.anchor = model.stowawayAnchor
    const mat = this.surface
    this.stageMeshes = model.stages.map((g, k) => {
      const m = new THREE.Mesh(g, mat)
      m.name = `rocket-stage-${k}`
      m.castShadow = true
      m.receiveShadow = true
      m.matrixAutoUpdate = false
      m.visible = false
      this.rocketGroup.add(m)
      return m
    })
    this.tapedFin = new THREE.Mesh(model.tapedFin, mat)
    this.tapedFin.name = 'rocket-taped-fin'
    this.tapedFin.castShadow = true
    this.tapedFin.matrixAutoUpdate = false
    this.tapedFin.visible = false
    this.rocketGroup.add(this.tapedFin)
    this.chunkMeshes = model.chunks.map((c, i) => {
      const m = new THREE.Mesh(c.geo, mat)
      m.name = `rocket-chunk-${i}`
      m.castShadow = true
      m.matrixAutoUpdate = false
      m.visible = false
      this.rocketGroup.add(m)
      return m
    })
    this.rigGeos = model.rigs
    this.plan = null
    this.planBuiltFor = ''
  }

  setQuality(q: QualityTier): void {
    if (q === this.quality) return
    this.quality = q
    // particle pools keep their capacity; emission rates follow the live tier
    this.q = { ...QUALITY[q], treadLinks: this.q.treadLinks }
    this.fx.q = this.q
  }

  // ==================================================================== update

  update(camera: THREE.Camera, rawDt: number): void {
    if (!this.mounted) return
    const dt = Math.min(Math.max(Number.isFinite(rawDt) ? rawDt : 0, 0), 0.1)
    this.time += dt
    const s = factory.state
    const r = s.rocket
    this.ensureModel(r.seed)
    const model = this.model!
    this.phase = r.phase
    const T = launchTime(r)
    this.T = T
    this.reducedEffects()

    this.updateTransporter(r, dt)
    this.ensurePlan(r)
    this.updateRocket(r, model)
    this.updateCraneAndArms(r, model)
    this.updateCushion()
    this.updateCrew(r, dt)
    this.updateEffects(camera, s.t)
    this.updateBlink()
    this.updateFlash()
    this.updateSign(s.t, s.counters)
    this.beats(T)
    this.prevT = T
    this.prevSimT = s.t
  }

  private reducedEffects(): void {
    this.fx.reduced = this.reduced
  }

  // ------------------------------------------------------------ transporter

  private playerOnTrack(s: number, dir: number): boolean {
    const p = runtime.player.position
    if (!Number.isFinite(p.x) || p.y > 1.2) return false
    TRACK_PATH.project(p.x, p.z, _proj)
    if (Math.abs(_proj.lateral) > TRANSPORTER.width / 2 + TRACK_CLEARANCE_SIDE) return false
    let sp = _proj.s
    const along = Math.sqrt(Math.max(0, _proj.distance * _proj.distance - _proj.lateral * _proj.lateral))
    if (_proj.s < 0.01) sp -= along
    else if (_proj.s > TRACK_PATH.length - 0.01) sp += along
    const half = TRANSPORTER.length / 2
    if (dir > 0) return sp > s - half + 0.2 && sp < s + half + TRACK_CLEARANCE_AHEAD
    return sp < s + half - 0.2 && sp > s - half - TRACK_CLEARANCE_AHEAD
  }

  private updateTransporter(r: RocketState, dt: number): void {
    const L = TRACK_PATH.length
    const target = clamp(transportTarget(r.phase, r.phaseTime), 0, 1) * L
    if (!this.trInit || !Number.isFinite(this.trS)) {
      this.trS = target
      this.prevTargetS = target
      this.trInit = true
    }
    // A debug time jump / phase skip moves the target farther in one frame than
    // the crawler could ever drive: follow it (keeping any visitor-caused lag).
    const jump = target - this.prevTargetS
    if (Math.abs(jump) > 2.5) this.trS = this.trBlocked ? clamp(this.trS + jump, 0, L) : target
    // the rocket must be on the pad from the countdown on: no waiting any more
    const urgent = r.phase === 'countdown' || r.phase === 'ignition' || r.phase === 'flight'
    if ((r.phase === 'ignition' || r.phase === 'flight') && Math.abs(target - this.trS) > 0.5) this.trS = target
    const lag = target - this.trS
    const dir = Math.sign(lag)
    const blocked = Math.abs(lag) > 0.02 && !urgent && this.playerOnTrack(this.trS, dir)
    const targetVel = dt > 0 ? Math.abs(target - this.prevTargetS) / dt : 0
    let s = this.trS
    if (!blocked) {
      const cruise = (r.phase === 'rollout' ? ROLLOUT_CRUISE : RETURN_CRUISE) * L
      const maxV = Math.min(targetVel, cruise * 1.4) + (urgent ? 9 : 2.6)
      const step = Math.min(Math.abs(lag), maxV * dt)
      s += dir * step
      if (Math.abs(target - s) > 26 && r.phase === 'assembling') s = target
    }
    this.trSpeed = dt > 0 ? (s - this.trS) / dt : 0
    this.trS = s
    this.prevTargetS = target
    this.trBlocked = blocked
    if (blocked && !this.wasBlocked && this.time - this.lastClearCaption > CLEAR_TRACK_COOLDOWN) {
      this.lastClearCaption = this.time
      events.emit('caption', { text: CLEAR_TRACK_CAPTION, kind: 'warning', duration: 3 })
      TRACK_PATH.sample(this.trS, _tp)
      events.emit('sfx', { name: 'forklift-horn', position: [_tp.x, 2, _tp.z], volume: 0.8, rate: 0.7 })
    }
    this.wasBlocked = blocked
    this.stillFor = Math.abs(this.trSpeed) < 0.01 ? this.stillFor + dt : 0
    this.parked = this.stillFor > 0.4
    // transform
    TRACK_PATH.sample(this.trS, _tp)
    this.transporter.position.set(_tp.x, 0, _tp.z)
    this.transporter.rotation.set(0, _tp.yaw, 0)
    this.transporter.updateMatrix()
    this.transporterMatrix.copy(this.transporter.matrix)
    if (this.treads && Math.abs(this.trSpeed) > 1e-4) {
      this.treadOffset -= this.trSpeed * dt
      this.updateTreads(this.treadOffset)
    }
  }

  private treadTmp = { y: 0, z: 0, a: 0 }

  private updateTreads(offset: number): void {
    const t = this.treads
    if (!t) return
    const per = Math.round(TREAD_PERIMETER / 0.21)
    const step = TREAD_PERIMETER / per
    let i = 0
    for (const [bx, bz] of BOGIES) {
      for (let k = 0; k < per; k++) {
        treadLoop(offset + k * step, this.treadTmp)
        _q.setFromAxisAngle(X, this.treadTmp.a)
        _m.compose(_v.set(bx, this.treadTmp.y, bz + this.treadTmp.z), _q, _one)
        t.setMatrixAt(i++, _m)
      }
    }
    t.instanceMatrix.needsUpdate = true
  }

  // ------------------------------------------------------------ flight plan

  private ensurePlan(r: RocketState): void {
    const outcome = r.outcome
    if (!outcome || !this.model) {
      if (r.phase === 'assembling' || r.phase === 'rollout' || r.phase === 'pad' || r.phase === 'countdown') {
        this.plan = null
        this.planBuiltFor = ''
        this.fx.plan = null
      }
      return
    }
    // cheap per-frame check (no allocation) before building the key string
    const pk = this.planInputs
    if (this.plan && pk.id === r.id && pk.seed === r.seed && pk.outcome === outcome && pk.reduced === this.reduced && pk.stowaway === r.stowaway && pk.debris === this.q.debris) return
    pk.id = r.id
    pk.seed = r.seed
    pk.outcome = outcome
    pk.reduced = this.reduced
    pk.stowaway = r.stowaway
    pk.debris = this.q.debris
    const input = {
      height: this.model.height,
      tapedFinPivot: this.model.tapedFinPivot,
      chunkPivots: this.model.chunks.map((c) => ({ pivot: c.pivot, radius: c.radius })),
      stowawayAnchor: this.model.stowawayAnchor,
      debrisCount: this.q.debris,
      reduced: this.reduced,
      stowaway: r.stowaway,
    }
    const key = `${r.id}:${planKey(r.seed, outcome, input)}`
    if (key === this.planBuiltFor && this.plan) return
    this.plan = buildFlightPlan(r.seed, outcome, input)
    this.planBuiltFor = key
    this.fx.plan = this.plan
    this.landings = landingTimes(this.plan)
  }

  // ------------------------------------------------------------ rocket

  private setStage(i: number, matrix: THREE.Matrix4 | null): void {
    const m = this.stageMeshes[i]
    if (!m) return
    if (!matrix) {
      m.visible = false
      return
    }
    m.visible = true
    m.matrix.copy(matrix)
    m.matrixWorldNeedsUpdate = true
  }

  private updateRocket(r: RocketState, model: RocketModel): void {
    const tau = this.T - T_LIFTOFF
    const plan = this.plan
    this.rocketOnDeck = rocketOnTransporter(r.phase)
    // rocket frame
    if (this.rocketOnDeck || !plan) {
      _m.makeTranslation(0, DECK_Y, 0)
      this.rocketMatrix.multiplyMatrices(this.transporterMatrix, _m)
      if (r.phase === 'ignition' || (r.phase === 'countdown' && r.phaseTime > 8.5)) {
        // the whole stack shudders on the clamps
        const k = r.phase === 'ignition' ? smoothstep(0, 1.2, r.phaseTime) : 0.2
        const a = (this.reduced ? 0.004 : 0.012) * k
        _q.setFromAxisAngle(_v.set(Math.sin(this.time * 41), 0, Math.cos(this.time * 37)).normalize(), a * Math.sin(this.time * 53))
        _m.makeRotationFromQuaternion(_q)
        this.rocketMatrix.multiply(_m)
      }
    } else {
      rocketPose(plan, tau, _v, _q)
      this.rocketMatrix.compose(_v, _q, _one)
    }
    this.rocketMatrix.decompose(_v2, this.rocketQuat, _s)
    const intact = !plan || tau < plan.intactUntil
    const inSky = r.phase === 'flight' && tau < FLIGHT_SECONDS
    this.rocketVisible = this.rocketOnDeck || (inSky && intact)

    // stages
    if (r.phase === 'assembling') {
      for (let k = 0; k < STAGE_COUNT; k++) this.setStage(k, k < r.stagesComplete ? this.rocketMatrix : null)
    } else {
      for (let k = 0; k < STAGE_COUNT; k++) this.setStage(k, this.rocketVisible ? this.rocketMatrix : null)
    }
    // taped fin follows the fins stage, unless it fell off
    const fin = this.tapedFin
    if (fin) {
      const finsMesh = this.stageMeshes[2]
      const shed = plan?.fin && tau >= plan.fin.t0 && r.phase !== 'assembling'
      if (shed && plan?.fin) {
        const sc = evalTrack(plan.fin, tau - plan.fin.t0, _v, _q)
        const pv = model.tapedFinPivot
        _m.compose(_v, _q, _s.setScalar(Math.max(0.001, sc)))
        _m.multiply(_m2.makeTranslation(-pv[0], -pv[1], -pv[2]))
        fin.matrix.copy(_m)
        fin.matrixWorldNeedsUpdate = true
        fin.visible = sc > 0.001 && tau < TAU_CLEANUP + 2
      } else if (finsMesh && finsMesh.visible) {
        fin.matrix.copy(finsMesh.matrix)
        fin.matrixWorldNeedsUpdate = true
        fin.visible = true
      } else fin.visible = false
    }
    // breakup chunks / explosion hero
    for (let i = 0; i < this.chunkMeshes.length; i++) this.chunkMeshes[i].visible = false
    if (plan && r.phase !== 'assembling' && tau >= plan.revealAt) {
      if (plan.outcome === 'breakup') {
        for (let i = 0; i < plan.chunks.length; i++) {
          const tr = plan.chunks[i]
          const isFin = i >= this.chunkMeshes.length
          const mesh = isFin ? this.tapedFin : this.chunkMeshes[i]
          if (!mesh) continue
          const pv = isFin ? model.tapedFinPivot : model.chunks[i].pivot
          const sc = evalTrack(tr, tau - tr.t0, _v, _q)
          _m.compose(_v, _q, _s.setScalar(Math.max(0.001, sc)))
          _m.multiply(_m2.makeTranslation(-pv[0], -pv[1], -pv[2]))
          mesh.matrix.copy(_m)
          mesh.matrixWorldNeedsUpdate = true
          mesh.visible = sc > 0.001
        }
      } else if (plan.outcome === 'explosion' && plan.hero) {
        const hi = Math.min(2, this.chunkMeshes.length - 1)
        const mesh = this.chunkMeshes[hi]
        if (mesh) {
          const pv = model.chunks[hi].pivot
          const sc = evalTrack(plan.hero, tau - plan.hero.t0, _v, _q)
          _m.compose(_v, _q, _s.setScalar(Math.max(0.001, sc)))
          _m.multiply(_m2.makeTranslation(-pv[0], -pv[1], -pv[2]))
          mesh.matrix.copy(_m)
          mesh.matrixWorldNeedsUpdate = true
          mesh.visible = sc > 0.001
        }
      }
    }
    // explosion debris
    const deb = this.debris
    if (deb) {
      let n = 0
      if (plan && plan.outcome === 'explosion' && r.phase !== 'assembling' && tau >= plan.revealAt) {
        for (let i = 0; i < plan.debris.length && n < 24; i++) {
          const tr = plan.debris[i]
          const sc = evalTrack(tr, tau - tr.t0, _v, _q)
          if (sc <= 0.001) continue
          _s.set(0.6 + (i % 3) * 0.35, 1 + (i % 2) * 0.6, 0.6 + ((i + 1) % 3) * 0.3).multiplyScalar(sc)
          _m.compose(_v, _q, _s)
          deb.setMatrixAt(n, _m)
          _c.set(i % 4 === 0 ? '#C8453A' : i % 4 === 1 ? '#E6DDC8' : i % 4 === 2 ? '#59666A' : '#2E2B29')
          deb.setColorAt(n, _c)
          n++
        }
      }
      deb.count = n
      if (n) {
        deb.instanceMatrix.needsUpdate = true
        if (deb.instanceColor) deb.instanceColor.needsUpdate = true
      }
    }
    // hold-down clamps: closed on the deck, swing open at liftoff
    const cl = this.clamps
    if (cl) {
      let open = 0
      if (r.phase === 'flight') open = smoothstep(-0.05, 0.35, tau)
      else if (r.phase === 'aftermath') open = 1
      else if (r.phase === 'reset') open = 1 - smoothstep(1, 4, r.phaseTime)
      const ang = open * 1.0
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2
        const rr = 1.28
        _q.setFromAxisAngle(Y, -a - Math.PI / 2)
        _q2.setFromAxisAngle(X, -ang)
        _q.multiply(_q2)
        _m.compose(_v.set(Math.cos(a) * rr, DECK_Y, Math.sin(a) * rr), _q, _one)
        cl.setMatrixAt(i, _m)
      }
      cl.instanceMatrix.needsUpdate = true
    }
    // flames
    const fl = this.flames
    if (fl) {
      let n = 0
      const tIgn = this.T - T_IGNITION
      if (tIgn >= 0 && this.rocketVisible && (!plan || tau < plan.intactUntil) && tau < FLIGHT_SECONDS) {
        const thrust = tau < 0 ? smoothstep(0, 1.4, tIgn) * 0.7 : plan ? thrustAt(plan, tau) : 1
        if (thrust > 0.02) {
          for (let i = 0; i < model.nozzles.length && i < 3; i++) {
            const nz = model.nozzles[i]
            const flick = this.reduced ? 1 : 0.88 + 0.12 * Math.sin(this.time * 47 + i * 2.1) * Math.sin(this.time * 31 + i)
            const len = (tau < 0 ? 1.3 + 1.4 * thrust : 2.4 + 3.6 * thrust) * (nz.radius / 0.8) * flick
            const rad = nz.radius * (0.95 + 0.1 * thrust)
            _m.compose(_v.set(nz.pos[0], nz.pos[1], nz.pos[2]), _q.identity(), _s.set(rad, len, rad))
            _m2.multiplyMatrices(this.rocketMatrix, _m)
            fl.setMatrixAt(n, _m2)
            fl.setColorAt(n, _c.setRGB(Math.min(1.2, 0.35 + thrust), 0, 0))
            n++
          }
        }
      }
      fl.count = n
      if (n) {
        fl.instanceMatrix.needsUpdate = true
        if (fl.instanceColor) fl.instanceColor.needsUpdate = true
      }
      ;(flameMaterial().uniforms.uTime as { value: number }).value = this.time
    }
    // fireball
    const fb = this.fireball
    if (fb) {
      const spec = plan?.fireball
      const a = spec ? tau - spec.at : -1
      if (spec && r.phase !== 'assembling' && a >= 0 && a < 2.0) {
        const rad = spec.radius * (1 - Math.exp(-a / 0.12)) * (1 + 0.18 * a)
        fb.visible = true
        fb.position.set(spec.center[0], spec.center[1] + a * 1.3, spec.center[2])
        fb.scale.setScalar(Math.max(0.01, rad))
        const u = fireballMaterial().uniforms
        u.uTime.value = this.time
        u.uAge.value = a / 2.0
        u.uOpacity.value = (1 - smoothstep(1.2, 2.0, a)) * (this.reduced ? 0.75 : 1)
        u.uHeat.value = this.reduced ? 0.6 : 1
      } else fb.visible = false
    }
  }

  // ------------------------------------------------------------ crane & arms

  private updateCraneAndArms(r: RocketState, model: RocketModel): void {
    const c = craneState(r.phase, r.phaseTime, r.stagesComplete, r.stageProgress, model.stageInfo, this.crane)
    this.hookV.set(c.hx, c.hy, c.hz)
    this.crewCtx.craneLowering = c.hanging >= 0 && r.stageProgress > 0.45 && r.stageProgress < 0.9
    // jib + trolley
    this.jib.rotation.y = c.jib
    if (this.trolley) this.trolley.position.set(0, 0, c.trolley)
    // hanging / staged part
    const yaw = ROCKET_YAW_IN_TOWER
    if (r.phase === 'assembling') {
      const k = c.hanging >= 0 ? c.hanging : c.staged
      if (k >= 0 && k < STAGE_COUNT) {
        const info = model.stageInfo[k]
        if (c.hanging >= 0) {
          _q.setFromAxisAngle(Y, yaw)
          _q2.setFromAxisAngle(X, c.sway)
          _q.premultiply(_q2)
          _m.compose(_v.set(c.hx, c.hy, c.hz), _q, _one)
          _m.multiply(_m2.makeTranslation(0, -info.hookY, 0))
        } else {
          // fabrication: the part grows up from the staging deck
          const grow = Math.max(0.04, c.grow)
          _q.setFromAxisAngle(Y, yaw)
          const baseY = 11 - info.minY * grow
          _m.compose(_v.set(c.hx, baseY, c.hz), _q, _s.set(1, grow, 1))
        }
        this.setStage(k, _m)
        if (k === 2 && this.tapedFin) {
          this.tapedFin.matrix.copy(_m)
          this.tapedFin.matrixWorldNeedsUpdate = true
          this.tapedFin.visible = true
        }
      }
    }
    // rig on the hook
    const rig = this.rig
    if (rig) {
      const rk = clamp(c.rig, 0, this.rigGeos.length - 1)
      const g = this.rigGeos[rk]
      if (g && rig.geometry !== g) rig.geometry = g
      const hookY = model.stageInfo[rk]?.hookY ?? 0
      _q.setFromAxisAngle(Y, yaw)
      _q2.setFromAxisAngle(X, c.hanging >= 0 ? c.sway : 0)
      _q.premultiply(_q2)
      _m.compose(_v.set(c.hx, c.hy, c.hz), _q, _one)
      _m.multiply(_m2.makeTranslation(0, -hookY, 0))
      rig.matrix.copy(_m)
      rig.matrixWorldNeedsUpdate = true
      rig.visible = true
    }
    // cable from the trolley to the hook block
    const cable = this.cable
    if (cable) {
      const top = CRANE_TROLLEY_Y - 0.5
      const len = Math.max(0.05, top - (c.hy + 0.55))
      cable.matrix.compose(_v.set(c.hx, top, c.hz), _q.identity(), _s.set(0.032, len, 0.032))
      cable.matrixWorldNeedsUpdate = true
    }
    // sparks: seated part being bolted, staging-deck fabrication, the welder at the base
    const k = Math.min(r.stagesComplete, STAGE_COUNT - 1)
    const seat = model.stageInfo[k]
    this.sparks[0].on = r.phase === 'assembling' && c.welding && Math.sin(this.prevSimT * 2.3) > -0.3
    if (seat) this.sparks[0].x = TOWER_CX + 1.0
    this.sparks[0].y = DECK_Y + (seat ? seat.minY + 0.4 : 1)
    this.sparks[0].z = TOWER_CZ + 0.6
    this.sparks[1].on = r.phase === 'assembling' && c.staged >= 0 && c.grow < 0.98
    this.sparks[1].x = c.hx
    this.sparks[1].y = 11 + (seat ? (seat.maxY - seat.minY) * c.grow : 1)
    this.sparks[1].z = c.hz
    // arms: 2 on the tower, 2 on the pad mast
    const arms = this.arms
    if (arms) {
      for (let i = 0; i < UMBILICAL_LEVELS.length; i++) {
        const y = UMBILICAL_LEVELS[i]
        const ext = armExtension(i, y, r.phase, r.phaseTime, model.stageInfo, r.stagesComplete)
        const yawA = TOWER_ARM.retracted + (TOWER_ARM.connected - TOWER_ARM.retracted) * smoothstep(0, 1, ext)
        _q.setFromAxisAngle(Y, yawA)
        _m.compose(_v.set(TOWER_ARM.x, y, TOWER_ARM.z), _q, _one)
        arms.setMatrixAt(i, _m)
      }
      for (let i = 0; i < this.padArmHinges.length; i++) {
        const h = this.padArmHinges[i]
        let ext = 0
        if (r.phase === 'pad') ext = smoothstep(1.0, 3.5, r.phaseTime)
        else if (r.phase === 'countdown') ext = 1 - smoothstep(2.5 + i * 0.4, 4.2 + i * 0.4, r.phaseTime)
        const yawA = h.connectedYaw - 1.25 * (1 - smoothstep(0, 1, ext))
        _q.setFromAxisAngle(Y, yawA)
        _s.set(h.length / TOWER_ARM.length, 1, 1)
        _m.compose(_v.set(h.pos[0], h.pos[1], h.pos[2]), _q, _s)
        arms.setMatrixAt(2 + i, _m)
      }
      arms.instanceMatrix.needsUpdate = true
    }
  }

  // ------------------------------------------------------------ cushion

  private updateCushion(): void {
    const cu = this.cushion
    if (!cu) return
    const plan = this.plan
    const st = plan?.stowaway
    const tau = this.T - T_LIFTOFF
    if (!st || this.phase === 'assembling' || tau < STOWAWAY.detach - 0.05) {
      cu.visible = false
      return
    }
    const land = st.t0 + st.tLand
    let sx = 1
    let sy = 1
    const inflate = smoothstep(STOWAWAY.detach, STOWAWAY.detach + 0.55, tau)
    const pop = 1 + Math.sin(clamp((tau - STOWAWAY.detach) / 0.7, 0, 1) * Math.PI) * 0.12
    sx = inflate * pop
    sy = inflate
    if (tau >= land) {
      const a = tau - land
      const squash = Math.exp(-a * 3.2) * Math.cos(a * 15)
      sy *= 1 - 0.38 * squash
      sx *= 1 + 0.16 * squash
    }
    // deflate during the aftermath once everyone has left
    const deflate = smoothstep(T_AFTERMATH + 3, T_AFTERMATH + 7, this.T)
    sy *= 1 - 0.95 * deflate
    sx *= 1 - 0.35 * deflate
    cu.visible = sy > 0.02
    cu.scale.set(Math.max(0.01, sx), Math.max(0.01, sy), Math.max(0.01, sx))
  }

  // ------------------------------------------------------------ crew

  private updateCrew(r: RocketState, dt: number): void {
    const ctx = this.crewCtx
    ctx.T = this.T
    ctx.phase = r.phase
    ctx.outcome = r.outcome
    ctx.plan = this.plan
    ctx.trS = this.trS
    ctx.trSpeed = this.trSpeed
    ctx.trBlocked = this.trBlocked
    if (r.phase === 'assembling') {
      const h = factory.state.history
      const last = h.length ? h[h.length - 1] : null
      ctx.stowaway = !!last && last.rocketId === r.id - 1 && last.stowaway
    } else ctx.stowaway = r.stowaway
    for (let i = 0; i < 3; i++) {
      const p = crewPose(i, ctx, this.crewPoses[i])
      const f = this.followers[i]
      const g = this.crewGroups[i]
      const dx = p.x - f.x
      const dy = p.y - f.y
      const dz = p.z - f.z
      const dist = Math.hypot(dx, dz)
      if (!f.init || p.snap || dist > 14 || !Number.isFinite(dist)) {
        f.x = p.x
        f.y = p.y
        f.z = p.z
        f.speed = p.speed
        f.yaw = p.yaw
        f.init = true
      } else {
        const maxStep = 6.5 * dt
        const k = dist > maxStep ? maxStep / dist : 1
        f.x += dx * k
        f.z += dz * k
        f.y += dy * Math.min(1, dt * 10)
        const moved = dist * k
        f.speed = dt > 0 ? moved / dt : 0
        const target = moved > 0.02 && (p.anim === 'walk' || p.anim === 'run' || dist > 0.25) ? Math.atan2(-dx, -dz) : p.yaw
        f.yaw = dampAngle(f.yaw, target, 10, dt)
      }
      // animation: catching up looks like walking/running
      let anim = p.anim
      let speed = p.speed
      if (!p.snap) {
        speed = f.speed
        if ((anim === 'idle' || anim === 'work' || anim === 'point' || anim === 'cheer') && f.speed > 0.5) anim = f.speed > 3 ? 'run' : 'walk'
        if ((anim === 'walk' || anim === 'run') && f.speed < 0.08) anim = 'idle'
      }
      this.crewAnim[i] = anim
      this.crewSpeed[i] = speed
      if (p.look) {
        const ly = wrapAngle(yawToward({ x: f.x, z: f.z }, { x: p.look.x, z: p.look.z }) - f.yaw)
        this.crewLook[i] = Math.abs(ly) < 1.6 ? ly : null
      } else this.crewLook[i] = null
      if (g) {
        g.position.set(f.x, f.y, f.z)
        if (p.quat) g.quaternion.copy(p.quat)
        else g.rotation.set(0, f.yaw, 0)
      }
    }
    // the welder at the rocket base throws sparks in bursts
    const a = this.followers[0]
    const welding = r.phase === 'assembling' && this.crewAnim[0] === 'work' && a.speed < 0.1 && Math.sin(this.prevSimT * 1.9) > -0.2
    this.sparks[2].on = welding
    this.sparks[2].x = a.x - Math.sin(a.yaw) * 0.62
    this.sparks[2].y = 1.05
    this.sparks[2].z = a.z - Math.cos(a.yaw) * 0.62
  }

  // ------------------------------------------------------------ effects

  private updateEffects(camera: THREE.Camera, simT: number): void {
    const smoke = this.smoke
    const glow = this.glow
    if (!smoke || !glow) return
    smoke.begin()
    glow.begin()
    this.fx.T = this.T
    this.fx.simT = simT
    this.fx.light = clamp(runtime.lighting.level, 0, 1)
    this.pushHalos(glow, camera)
    writeEffects(this.fx, smoke, glow)
    smoke.end(camera.position, 3.2)
    glow.end(camera.position, 1.0)
  }

  private haloLighthouse(x: number, z: number, camera: THREE.Camera, speed: number, phase: number): number {
    if (this.reduced) return 0.55
    const a = this.time * speed + phase
    const cx = camera.position.x - x
    const cz = camera.position.z - z
    const l = Math.hypot(cx, cz) || 1
    const d = Math.max(0, (Math.cos(a) * cx + Math.sin(a) * cz) / l)
    return 0.22 + 0.9 * Math.pow(d, 6)
  }

  private haloNight = 1

  /** One halo sprite (no closure: called many times per frame). */
  private halo(glow: ParticleBuffer, x: number, y: number, z: number, size: number, c: THREE.Color, k: number): void {
    if (k > 0.01) glow.push(x, y, z, size, Math.min(1, k * this.haloNight), 0, c.r, c.g, c.b)
  }

  private haloV3(glow: ParticleBuffer, p: V3, size: number, c: THREE.Color, k: number): void {
    this.halo(glow, p[0], p[1], p[2], size, c, k)
  }

  private pushHalos(glow: ParticleBuffer, camera: THREE.Camera): void {
    this.haloNight = 1 + (1 - clamp(runtime.lighting.level, 0, 1)) * 0.8
    const av = blinkLevels[BLINK.aviation]
    for (const p of this.towerAviation) this.haloV3(glow, p, 1.3, AVIATION, av * 0.85)
    for (const p of this.padAviation) this.haloV3(glow, p, 1.1, AVIATION, av * 0.85)
    // crane lights ride on the jib
    this.jib.updateMatrixWorld()
    _v.set(this.jibTip[0], this.jibTip[1], this.jibTip[2]).applyMatrix4(this.jib.matrixWorld)
    this.halo(glow, _v.x, _v.y, _v.z, 1.2, AVIATION, av * 0.85)
    _v.set(this.jibApex[0], this.jibApex[1], this.jibApex[2]).applyMatrix4(this.jib.matrixWorld)
    this.halo(glow, _v.x, _v.y, _v.z, 1.0, AVIATION, av * 0.7)
    for (const f of this.towerFloods) this.haloV3(glow, f.pos, 1.5, WARM, 0.32)
    for (const p of this.signLamps) this.haloV3(glow, p, 1.0, WARM, 0.45)
    // pad beacons: rotating amber "lighthouse" flashes while a launch is on
    const padOn = blinkLevels[BLINK.padBeacon]
    if (padOn > 0.2) {
      for (let i = 0; i < this.padBeacons.length; i++) {
        const p = this.padBeacons[i]
        this.haloV3(glow, p, 1.9, AMBER, padOn * this.haloLighthouse(p[0], p[2], camera, 5.5, i * 1.7))
      }
    }
    // transporter beacons while it moves
    const trOn = blinkLevels[BLINK.transporter]
    if (trOn > 0.2) {
      for (let i = 0; i < this.transporterBeacons.length; i++) {
        const b = this.transporterBeacons[i]
        _v.set(b[0], b[1], b[2]).applyMatrix4(this.transporterMatrix)
        this.halo(glow, _v.x, _v.y, _v.z, 1.5, AMBER, this.haloLighthouse(_v.x, _v.z, camera, 6.5, i * 2.3))
      }
    }
    // guidance ring chase lights (only once the guidance ring is on the rocket)
    const m = this.model
    const g = this.stageMeshes[3]
    if (m && g && g.visible) {
      for (let i = 0; i < m.lights.length; i++) {
        const l = m.lights[i]
        _v.set(l.pos[0], l.pos[1], l.pos[2]).applyMatrix4(g.matrix)
        _c.set(l.color)
        this.halo(glow, _v.x, _v.y, _v.z, 0.55, _c, blinkLevels[BLINK.guidance0 + i] * 0.75)
      }
    }
    // kiosk "ready" lamp
    this.halo(glow, KIOSK[0] + 0.3, 1.5, KIOSK[1], 0.4, GREEN, av * 0.6)
  }

  // ------------------------------------------------------------ blink, light

  private updateBlink(): void {
    const t = this.time
    blinkLevels[BLINK.steady] = 1
    // FAA-ish slow red flash
    const ph = (t % 1.6) / 1.6
    blinkLevels[BLINK.aviation] = this.reduced ? 0.85 : ph < 0.42 ? 1 : 0.08
    // guidance chase
    const rate = this.reduced ? 1.2 : 3.2
    for (let i = 0; i < 4; i++) {
      const k = (((t * rate) % 4) + 4) % 4
      const d = Math.min(Math.abs(k - i), 4 - Math.abs(k - i))
      blinkLevels[BLINK.guidance0 + i] = Math.max(0.12, 1 - d * 0.9)
    }
    const moving = Math.abs(this.trSpeed) > 0.05 || this.trBlocked
    blinkLevels[BLINK.transporter] = moving ? (this.reduced ? 0.9 : 0.55 + 0.45 * Math.sin(t * 9)) : 0.12
    const T = this.T
    const padActive = (this.phase === 'pad' || this.phase === 'countdown' || this.phase === 'ignition' || this.phase === 'flight') && T < T_LIFTOFF + 8
    blinkLevels[BLINK.padBeacon] = padActive ? 1 : 0.1
  }

  private updateFlash(): void {
    const L = this.flash
    const plan = this.plan
    const tau = this.T - T_LIFTOFF
    let intensity = 0
    const maxIgn = this.reduced ? 9 : 30
    const tIgn = this.T - T_IGNITION
    if (tIgn >= 0 && tIgn < 2 + 6) {
      if (tau < 0) {
        const k = smoothstep(0, 1.2, tIgn)
        intensity = maxIgn * k * (this.reduced ? 1 : 0.85 + 0.15 * Math.sin(this.time * 33))
        L.position.set(PAD_X, 1.4, PAD_Z)
      } else if (plan && tau < plan.intactUntil) {
        const nz = this.model?.nozzles[0]
        if (nz) _v.set(nz.pos[0], nz.pos[1] - 1.5, nz.pos[2]).applyMatrix4(this.rocketMatrix)
        else _v.set(PAD_X, 2, PAD_Z)
        L.position.copy(_v)
        const h = Math.max(0, _v.y - 2)
        intensity = maxIgn * thrustAt(plan, tau) * Math.exp(-h / 28) * (this.reduced ? 1 : 0.85 + 0.15 * Math.sin(this.time * 29))
      }
    }
    const fb = plan?.fireball
    if (fb && this.phase !== 'assembling') {
      const a = tau - fb.at
      if (a >= 0 && a < 1.6) {
        L.position.set(fb.center[0], fb.center[1], fb.center[2])
        // reduced motion: a slow warm swell instead of a flash
        const k = this.reduced ? 6 * Math.sin(Math.PI * Math.min(1, a / 1.6)) : 140 * Math.exp(-a / 0.35)
        intensity = Math.max(intensity, k)
      }
    }
    L.intensity = Number.isFinite(intensity) ? intensity : 0
  }

  // ------------------------------------------------------------ counter sign

  private updateSign(t: number, c: { successes: number; disassemblies: number; lastDisassemblyT: number }): void {
    const ctx = this.signCtx
    const tex = this.signTexture
    if (!ctx || !tex) return
    if (this.signLastDis >= 0 && c.disassemblies > this.signLastDis) this.resetUntil = t + RESET_FLASH_SECONDS
    this.signLastDis = c.disassemblies
    const flashing = t < this.resetUntil
    const elapsed = t - c.lastDisassemblyT
    const blinkOn = flashing && (this.reduced || Math.floor((this.resetUntil - t) * 2) % 2 === 0)
    const key = `${Math.floor(elapsed)}:${c.successes}:${c.disassemblies}:${blinkOn ? 1 : 0}`
    if (key === this.signKey) return
    this.signKey = key
    try {
      drawBoard(ctx, { elapsed, successes: c.successes, disassemblies: c.disassemblies, reset: blinkOn })
      tex.needsUpdate = true
    } catch {
      /* canvas unavailable */
    }
  }

  // ------------------------------------------------------------ visual-only sound beats

  private beats(T: number): void {
    const prev = this.prevT
    const jump = T - prev
    if (!(jump > 0) || jump > 1.0) return
    if (crossed(prev, T, 0.6)) events.emit('sfx', { name: 'steam-hiss', position: [PAD_X, 1.5, PAD_Z], volume: 0.8 })
    if (crossed(prev, T, 6)) events.emit('sfx', { name: 'steam-hiss', position: [PAD_X, 1.5, PAD_Z], volume: 0.6, rate: 0.85 })
    if (crossed(prev, T, T_LIFTOFF + 0.05)) events.emit('sfx', { name: 'machine-clank', position: [PAD_X, 1.5, PAD_Z], volume: 0.9 })
    const plan = this.plan
    if (!plan) return
    const tau0 = prev - T_LIFTOFF
    const tau1 = T - T_LIFTOFF
    if (plan.stowaway) {
      if (crossed(tau0, tau1, STOWAWAY.detach)) events.emit('sfx', { name: 'steam-hiss', position: [CUSHION[0], 0.8, CUSHION[1]], volume: 0.9, rate: 1.3 })
      if (crossed(tau0, tau1, STOWAWAY.detach + STOWAWAY.flight)) events.emit('sfx', { name: 'boing', position: [CUSHION[0], CUSHION_SIZE.h, CUSHION[1]], volume: 1 })
    }
    // (the wobble's fin clatter at the reveal is the audio module's 'rocket:outcome' sound)
    if ((plan.outcome === 'success' || plan.outcome === 'wobble') && crossed(tau0, tau1, plan.revealAt + 0.3)) {
      const d = CREW_DEFS[0].safe
      events.emit('sfx', { name: 'cheer', position: [d[0], 1.5, d[1]], volume: 0.6 })
    }
    let n = 0
    for (const l of this.landings) {
      if (crossed(tau0, tau1, l.tau) && n < 3) {
        n++
        events.emit('sfx', { name: l.big ? 'breakup-clank' : 'crate-bump', position: [l.x, 0.3, l.z], volume: l.big ? 0.7 : 0.5, rate: l.big ? 1.25 : 1 })
      }
    }
    if (crossed(tau0, tau1, TAU_CLEANUP + 0.2) && (plan.outcome !== 'success' || plan.fin)) events.emit('sfx', { name: 'steam-hiss', position: [PAD_X, 1.5, PAD_Z], volume: 0.5, rate: 1.4 })
  }

  // ------------------------------------------------------------ debug

  stats(): RocketStats {
    let draws = 0
    let tris = 0
    let meshes = 0
    this.root.traverseVisible((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      meshes++
      const inst = o as THREE.InstancedMesh
      const ig = m.geometry as THREE.InstancedBufferGeometry
      const count = inst.isInstancedMesh ? inst.count : ig.isInstancedBufferGeometry ? ig.instanceCount : 1
      if (count <= 0) return
      draws += 1 + (m.castShadow ? 1 : 0)
      tris += triangles(m.geometry) * count
    })
    const sm = this.smoke
    const gl = this.glow
    const plan = this.plan
    return {
      phase: this.phase,
      T: Math.round(this.T * 100) / 100,
      transporter: { s: Math.round(this.trS * 100) / 100, u: Math.round((this.trS / TRACK_PATH.length) * 1000) / 1000, speed: Math.round(this.trSpeed * 100) / 100, blocked: this.trBlocked, parked: this.parked },
      particles: { smoke: sm?.count ?? 0, smokeCap: sm?.capacity ?? 0, glow: gl?.count ?? 0, glowCap: gl?.capacity ?? 0, dropped: (sm?.dropped ?? 0) + (gl?.dropped ?? 0) },
      drawCalls: draws,
      triangles: tris,
      meshes,
      rocket: this.model ? { seed: this.model.seed, triangles: this.model.triangles, height: Math.round(this.model.height * 100) / 100 } : null,
      plan: plan ? { outcome: plan.outcome, stowaway: !!plan.stowaway, debris: plan.debris.length, chunks: plan.chunks.length } : null,
      crew: this.followers.map((f, i) => ({ anim: this.crewAnim[i], x: Math.round(f.x * 10) / 10, z: Math.round(f.z * 10) / 10 })),
      quality: this.quality,
      reduced: this.reduced,
    }
  }
}
