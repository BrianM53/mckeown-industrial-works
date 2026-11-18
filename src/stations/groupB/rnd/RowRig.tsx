import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getProject } from '@/content/projects'
import { events } from '@/core/events'
import { useInteractable } from '@/core/interaction'
import { useUIStore } from '@/state/ui'
import { PALETTE } from '@/world/palette'
import { WORKER_BONE_COUNT, WorkerModel, type WorkerLook } from '@/world/WorkerModel'
import { Batch } from '../shared/batch'
import { BatchMeshes } from '../shared/BatchMeshes'
import type { UvRect } from '../shared/canvas'
import { makeLedMesh, useLedClock } from '../server/Racks'
import { shown } from '../shared/hooks'
import { ROW_RIG } from './layout'
import { LAMP_ORDER, RowingModel, needleAngle, type FormError, type RowPose } from './rowing'

/**
 * ROW-PERGFECT TEST RIG (spec §5.6): a crash-test dummy (WorkerModel) rows a
 * rowing machine badly inside a goofy yellow test frame. Two motion-sensor
 * boxes with blinking LEDs ride on the handle, wired to a little computer box;
 * a big FORM-O-METER needle swings GOOD↔BAD and LEFT / RIGHT / RUSH / PAUSE
 * lamps light in sync with each sloppy stroke (the form errors the real
 * Row-Pergfect handle flags). Body motion comes from a small sagittal-plane
 * IK/FK solver driving the shared worker skeleton (falls back to whole-body
 * sliding if the skeleton layout ever changes).
 *
 * Rig frame: the rower faces local -X; the visitor side is local -Z.
 */
const DUMMY_LOOK: Partial<WorkerLook> = {
  helmet: '#E9C53F',
  helmetStripe: '#1f2022',
  vest: '#E9C53F',
  stripe: '#1f2022',
  shirt: '#e3be42',
  pants: '#2b2b2b',
  skin: '#e6c24c',
  boots: '#2b2b2b',
  gloves: '#2b2b2b',
  face: 'plain',
}

const SEAT_TOP = 0.5
const FOOT = { x: -0.92, y: 0.33 }
const SEAT_X = { catch: -0.5, finish: -0.08 }
const WORKER_Y = SEAT_TOP - 0.48
const L_THIGH = 0.41
const L_SHIN = 0.47
const L_UPPER = 0.275
const L_FORE = 0.285
const SPINE_PIVOT_Y = 0.6
const SPINE_TO_SHOULDER = 0.395
const THIGH_PIVOT_Y = 0.45
const CHAIN_EXIT = new THREE.Vector3(-1.1, 0.72, 0)
const GAUGE = { x: -2.15, z: -0.35, y: 1.75, r: 0.46 }
const LAMPS = { x: 2.1, z: -0.35, y: 1.36 }
const PI_BOX = new THREE.Vector3(1.72, 1.2, -0.12)

const LAMP_RGB: Record<FormError, THREE.Color> = {
  left: new THREE.Color('#ffb23f'),
  right: new THREE.Color('#ffb23f'),
  rush: new THREE.Color('#ff3b2f'),
  pause: new THREE.Color('#5fb8ff'),
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Planar two-bone IK: thigh angle (from straight down toward forward) and knee bend for a foot target. */
export function legIK(df: number, dy: number): { thigh: number; knee: number } {
  const d = clampN(Math.hypot(df, dy), 0.15, L_THIGH + L_SHIN - 1e-3)
  const a = Math.atan2(df, -dy)
  const b = Math.acos(clampN((L_THIGH * L_THIGH + d * d - L_SHIN * L_SHIN) / (2 * L_THIGH * d), -1, 1))
  const k = Math.acos(clampN((L_THIGH * L_THIGH + L_SHIN * L_SHIN - d * d) / (2 * L_THIGH * L_SHIN), -1, 1))
  return { thigh: a + b, knee: Math.PI - k }
}

interface Kin {
  seatX: number
  spine: number
  shL: number
  shR: number
  elbow: number
  head: number
  thigh: number
  knee: number
  drift: number
  /** Hand (handle) and shoulder positions in rig coordinates. */
  hand: THREE.Vector3
  shoulder: THREE.Vector3
}

function solve(p: RowPose, k: Kin): Kin {
  k.seatX = lerp(SEAT_X.catch, SEAT_X.finish, p.seat)
  k.spine = lerp(-0.52, 0.4, (p.body + 1) / 2)
  const armWorld = lerp(1.18, -0.32, p.arms)
  k.drift = p.drift
  k.shL = armWorld - k.spine + p.drift * 0.16
  k.shR = armWorld - k.spine - p.drift * 0.16
  k.elbow = lerp(0.12, 1.95, p.arms)
  k.head = -k.spine * 0.6
  const leg = legIK(k.seatX - FOOT.x, FOOT.y - WORKER_Y - THIGH_PIVOT_Y)
  k.thigh = leg.thigh
  k.knee = leg.knee
  // forward kinematics in the sagittal plane (u = forward toward the flywheel)
  const su = -SPINE_TO_SHOULDER * Math.sin(k.spine)
  const sy = SPINE_PIVOT_Y + SPINE_TO_SHOULDER * Math.cos(k.spine)
  const ta = k.spine + armWorld - k.spine
  const eu = su + L_UPPER * Math.sin(ta)
  const ey = sy - L_UPPER * Math.cos(ta)
  const tf = ta + k.elbow
  const hu = eu + L_FORE * Math.sin(tf)
  const hy = ey - L_FORE * Math.cos(tf)
  k.hand.set(k.seatX - hu, WORKER_Y + hy, p.drift * 0.09)
  k.shoulder.set(k.seatX - su, WORKER_Y + sy, 0)
  return k
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function buildStatic(uv: Record<string, UvRect>): Map<string, THREE.BufferGeometry> {
  const b = new Batch()
  const ALU = '#c9cfd0'
  const DARK = '#2b3134'
  const YEL = PALETTE.hazard
  // rowing machine: monorail, legs, flywheel housing, footrests, monitor arm
  b.box('metal', 0.1, 0.33, 0, 2.3, 0.06, 0.08, ALU)
  b.box('paint', 1.2, 0.17, 0, 0.08, 0.34, 0.08, DARK)
  b.box('paint', 1.2, 0.03, 0, 0.12, 0.06, 0.52, DARK)
  b.box('paint', -1.35, 0.03, 0, 0.14, 0.06, 0.62, DARK)
  b.cylBetween('paint', [-1.3, 0.06, 0], [-1.15, 0.33, 0], 0.035, DARK, 6)
  b.geo('paint', CYL_Z, [-1.32, 0.55, 0], [Math.PI / 2, 0, 0], [0.34, 0.26, 0.34], DARK)
  for (const z of [-0.135, 0.135]) b.torus('metal', -1.32, 0.55, z, 0.3, 0.018, '#9aa3a5', [0, 0, 0], 5, 28)
  b.box('paint', -1.12, 0.72, 0, 0.12, 0.08, 0.1, '#1f2427')
  for (const z of [-0.11, 0.11]) b.groupR([FOOT.x, FOOT.y, z], [0, 0, -0.62], () => b.box('paint', 0, 0, 0, 0.05, 0.3, 0.13, '#3a4245'))
  b.cylBetween('metal', [-1.28, 0.86, 0], [-1.02, 1.3, 0], 0.02, ALU, 6)
  b.box('paint', -0.98, 1.33, 0, 0.05, 0.16, 0.22, '#1f2427')
  b.box('glow', -0.952, 1.34, 0, 0.004, 0.11, 0.17, new THREE.Color('#6fc8ff').multiplyScalar(0.9))
  // yellow test frame (A-frames + top beam) and its sign
  for (const x of [-1.85, 1.78]) {
    for (const s of [-1, 1]) b.cylBetween('paint', [x, 0, s * 0.82], [x, 2.46, 0], 0.05, YEL, 8)
    b.box('paint', x, 0.03, 0, 0.14, 0.06, 1.8, '#3a4245')
    b.cylBetween('paint', [x, 0.9, -0.5], [x, 0.9, 0.5], 0.035, YEL, 6)
  }
  b.box('paint', -0.03, 2.48, 0, 3.75, 0.1, 0.12, YEL)
  b.box('paint', -0.03, 2.22, -0.065, 2.7, 0.42, 0.02, '#1f2427')
  b.quad('sign', -0.03, 2.22, -0.077, 2.62, 0.38, [0, Math.PI, 0], uv.rig)
  // the "computer" box on the frame (Pi in a lunchbox) with a ribbon cable
  b.box('paint', PI_BOX.x, PI_BOX.y, PI_BOX.z, 0.06, 0.16, 0.26, '#2b3134')
  b.box('matte', PI_BOX.x - 0.035, PI_BOX.y, PI_BOX.z, 0.012, 0.13, 0.22, '#2f7d3a')
  // gauge post + dial plate
  b.cyl('paint', GAUGE.x, 0, GAUGE.z + 0.06, 0.05, GAUGE.y - GAUGE.r + 0.05, '#3a4245', 10)
  b.box('paint', GAUGE.x, 0.03, GAUGE.z + 0.06, 0.4, 0.06, 0.4, DARK)
  b.geo('paint', CYL_Z, [GAUGE.x, GAUGE.y, GAUGE.z + 0.04], [Math.PI / 2, 0, 0], [GAUGE.r + 0.05, 0.06, GAUGE.r + 0.05], '#2f3639')
  b.torus('metal', GAUGE.x, GAUGE.y, GAUGE.z - 0.005, GAUGE.r + 0.02, 0.025, '#c3c9ca', [0, 0, 0], 6, 36)
  b.quad('sign', GAUGE.x, GAUGE.y, GAUGE.z - 0.012, GAUGE.r * 2 - 0.02, GAUGE.r * 2 - 0.02, [0, Math.PI, 0], uv.dial)
  // lamp panel
  b.cyl('paint', LAMPS.x, 0, LAMPS.z + 0.08, 0.05, LAMPS.y - 0.2, '#3a4245', 10)
  b.box('paint', LAMPS.x, 0.03, LAMPS.z + 0.08, 0.4, 0.06, 0.4, DARK)
  b.box('paint', LAMPS.x, LAMPS.y - 0.06, LAMPS.z + 0.06, 1.0, 0.46, 0.12, '#2b3134')
  b.quad('sign', LAMPS.x, LAMPS.y - 0.21, LAMPS.z - 0.003, 0.94, 0.15, [0, Math.PI, 0], uv.lamps)
  for (let i = 0; i < 4; i++) b.torus('metal', lampX(i), LAMPS.y, LAMPS.z - 0.01, 0.085, 0.018, '#aab3b5', [0, 0, 0], 5, 20)
  return b.build()
}

const CYL_Z = new THREE.CylinderGeometry(1, 1, 1, 28)

function lampX(i: number): number {
  return LAMPS.x + 0.3375 - i * 0.225
}

function buildSeat(): Map<string, THREE.BufferGeometry> {
  const b = new Batch()
  b.box('paint', 0, SEAT_TOP - 0.1, 0, 0.18, 0.08, 0.14, '#3a4245')
  b.box('matte', 0, SEAT_TOP - 0.035, 0, 0.34, 0.07, 0.3, '#1f2022')
  return b.build()
}

function buildHandle(): Map<string, THREE.BufferGeometry> {
  const b = new Batch()
  b.cylBetween('metal', [0, 0, -0.27], [0, 0, 0.27], 0.017, '#c9cfd0', 8)
  for (const s of [-1, 1]) {
    b.cylBetween('rubber', [0, 0, s * 0.14], [0, 0, s * 0.27], 0.024, '#1d1f20', 8)
    // motion-sensor boxes (green PCB in a clear case)
    b.box('matte', 0.0, 0.05, s * 0.2, 0.06, 0.045, 0.08, '#2f7d3a')
    b.box('paint', 0.0, 0.03, s * 0.2, 0.065, 0.02, 0.085, '#e8e4d8')
  }
  return b.build()
}

function buildFlywheel(): Map<string, THREE.BufferGeometry> {
  const b = new Batch()
  for (let k = 0; k < 6; k++) b.box('metal', 0, 0, 0, 0.52, 0.06, 0.012, '#7f8a8d', [0, 0, (k / 6) * Math.PI])
  b.geo('paint', CYL_Z, [0, 0, 0], [Math.PI / 2, 0, 0], [0.07, 0.05, 0.07], PALETTE.safety)
  return b.build()
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const _q = new THREE.Quaternion()
const _up = new THREE.Vector3(0, 1, 0)
const _d = new THREE.Vector3()
const _tmpC = new THREE.Color()

/** Stretch a unit-height cylinder mesh between two points (allocation-free). */
function stretch(mesh: THREE.Object3D | null, a: THREE.Vector3, b: THREE.Vector3, r: number): void {
  if (!mesh) return
  _d.subVectors(b, a)
  const len = _d.length()
  if (len < 1e-4) return
  mesh.position.addVectors(a, b).multiplyScalar(0.5)
  mesh.quaternion.copy(_q.setFromUnitVectors(_up, _d.multiplyScalar(1 / len)))
  mesh.scale.set(r, len, r)
}

const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true)

export function RowRig({ uv, reduced, model, signMat }: { uv: Record<string, UvRect>; reduced: boolean; model: RowingModel; signMat: THREE.Material }) {
  useLedClock()
  const statics = useMemo(() => buildStatic(uv), [uv])
  const seatGeo = useMemo(() => buildSeat(), [])
  const handleGeo = useMemo(() => buildHandle(), [])
  const flyGeo = useMemo(() => buildFlywheel(), [])
  const kin = useRef<Kin>({ seatX: 0, spine: 0, shL: 0, shR: 0, elbow: 0, head: 0, thigh: 0, knee: 0, drift: 0, hand: new THREE.Vector3(), shoulder: new THREE.Vector3() })
  const seat = useRef<THREE.Group>(null)
  const worker = useRef<THREE.Group>(null)
  const handle = useRef<THREE.Group>(null)
  const fly = useRef<THREE.Group>(null)
  const needle = useRef<THREE.Mesh>(null)
  const chain = useRef<THREE.Mesh>(null)
  const tether = useRef<THREE.Mesh>(null)
  const wire = useRef<THREE.Mesh>(null)
  const bones = useRef<THREE.Bone[] | null>(null)
  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3() }), [])

  // lamps: 4 instanced domes, colors updated only when they change
  const lamps = useMemo(() => {
    const g = new THREE.SphereGeometry(0.075, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)
    g.rotateX(-Math.PI / 2)
    const m = new THREE.MeshBasicMaterial({ toneMapped: false })
    m.name = 'stations-b:rig-lamps'
    const mesh = new THREE.InstancedMesh(g, m, 4)
    const mat = new THREE.Matrix4()
    for (let i = 0; i < 4; i++) {
      mat.makeTranslation(lampX(i), LAMPS.y, LAMPS.z - 0.02)
      mesh.setMatrixAt(i, mat)
      mesh.setColorAt(i, _tmpC.copy(LAMP_RGB[LAMP_ORDER[i]]).multiplyScalar(0.12))
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    mesh.name = 'stations-b:rig-lamps'
    return { mesh, g, m, last: [-1, -1, -1, -1] }
  }, [])

  // sensor LEDs riding on the handle + the computer box LEDs (GPU blink)
  const leds = useMemo(() => {
    const mk = (x: number, y: number, z: number, rgb: [number, number, number], rate: number, phase: number, mode: number) => ({
      matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(0.05, 0.05, 1)),
      rgb,
      rate,
      phase,
      duty: 0.5,
      mode,
    })
    const onHandle = makeLedMesh([
      mk(-0.034, 0.075, -0.2, [0.4, 1.7, 0.5], 9, 0.1, 2),
      mk(-0.034, 0.075, 0.2, [0.4, 1.7, 0.5], 9, 0.6, 2),
      mk(-0.034, 0.055, -0.17, [1.8, 0.4, 0.2], 1.4, 0.2, 1),
      mk(-0.034, 0.055, 0.23, [1.8, 0.4, 0.2], 1.4, 0.7, 1),
    ])
    // handle LEDs face the visitor (-Z) — orient quads accordingly
    const fix = new THREE.Matrix4().makeRotationY(Math.PI)
    for (let i = 0; i < onHandle.count; i++) {
      const m = new THREE.Matrix4()
      onHandle.getMatrixAt(i, m)
      const p = new THREE.Vector3().setFromMatrixPosition(m)
      m.copy(fix).setPosition(p.x, p.y, p.z - 0.05 * Math.sign(p.z) * 0)
      m.multiply(new THREE.Matrix4().makeScale(0.05, 0.05, 1))
      onHandle.setMatrixAt(i, m)
    }
    onHandle.instanceMatrix.needsUpdate = true
    onHandle.computeBoundingSphere()
    const box = makeLedMesh(
      [0, 1, 2].map((i) => ({
        matrix: new THREE.Matrix4().compose(new THREE.Vector3(PI_BOX.x - 0.045, PI_BOX.y + 0.04 - i * 0.035, PI_BOX.z - 0.13), new THREE.Quaternion().setFromAxisAngle(_up, -Math.PI / 2), new THREE.Vector3(0.05, 0.05, 1)),
        rgb: (i === 0 ? [0.4, 1.7, 0.5] : i === 1 ? [1.7, 0.95, 0.2] : [0.35, 0.85, 1.9]) as [number, number, number],
        rate: 2 + i * 3.1,
        phase: i * 0.3,
        duty: 0.5,
        mode: i === 0 ? 0 : 2,
      })),
    )
    return { onHandle, box }
  }, [])

  useEffect(
    () => () => {
      lamps.g.dispose()
      lamps.m.dispose()
      lamps.mesh.dispose()
      leds.onHandle.geometry.dispose()
      leds.box.geometry.dispose()
      leds.onHandle.dispose()
      leds.box.dispose()
    },
    [lamps, leds],
  )

  useInteractable({
    id: 'rnd:row-rig',
    verb: 'Inspect',
    label: 'Row-Pergfect Test Rig',
    radius: 2.4,
    priority: 0.2,
    enabled: () => !!getProject('row-pergfect'),
    getPosition: () => ({ x: ROW_RIG.interact.x - 0.95, y: 0, z: ROW_RIG.interact.z }),
    onInteract: () => {
      events.emit('sfx', { name: 'scanner-beep', position: [ROW_RIG.x, 1.2, ROW_RIG.z], rate: 0.8 })
      useUIStore.getState().openPanel('project', { projectId: 'row-pergfect' })
    },
  })

  useFrame((_, rawDt) => {
    if (!shown(worker.current)) return
    const dt = Math.min(Math.max(rawDt, 0), 0.1)
    const p = model.update(reduced ? dt * 0.7 : dt)
    const k = solve(p, kin.current)
    if (seat.current) seat.current.position.x = k.seatX
    if (worker.current) {
      worker.current.position.set(k.seatX, WORKER_Y, 0)
      // find the shared worker skeleton once (13 bones); else just slide the body
      if (!bones.current) {
        worker.current.traverse((o) => {
          const sm = o as THREE.SkinnedMesh
          if (!bones.current && sm.isSkinnedMesh && sm.skeleton && sm.skeleton.bones.length === WORKER_BONE_COUNT) bones.current = sm.skeleton.bones
        })
      }
      const bn = bones.current
      if (bn) {
        // bone order of world/WorkerModel: root, hips, spine, neck, head, shL, elL, shR, elR, thL, knL, thR, knR
        bn[2].rotation.x = k.spine
        bn[2].rotation.z = k.drift * 0.17
        bn[4].rotation.x = k.head
        bn[5].rotation.x = k.shL
        bn[7].rotation.x = k.shR
        bn[5].rotation.z = -0.12
        bn[7].rotation.z = 0.12
        bn[6].rotation.x = k.elbow
        bn[8].rotation.x = k.elbow
        bn[9].rotation.x = k.thigh
        bn[11].rotation.x = k.thigh
        bn[10].rotation.x = -k.knee
        bn[12].rotation.x = -k.knee
        bn[9].rotation.z = -0.08
        bn[11].rotation.z = 0.08
      }
    }
    if (handle.current) handle.current.position.copy(k.hand)
    stretch(chain.current, CHAIN_EXIT, k.hand, 0.008)
    tmp.a.set(k.seatX + 0.05, 2.43, 0)
    tmp.b.copy(k.shoulder).add(tmp.a.set(0.04, 0.0, 0)).setY(k.shoulder.y + 0.05)
    stretch(tether.current, tmp.a.set(k.seatX + 0.12, 2.43, 0), tmp.b, 0.007)
    stretch(wire.current, tmp.a.copy(k.hand).add(tmp.b.set(0, 0.06, 0.2)), PI_BOX, 0.006)
    if (fly.current) fly.current.rotation.z += p.flywheel * dt * (reduced ? 0.15 : 0.3)
    if (needle.current) needle.current.rotation.z = needleAngle(p.score)
    // lamps
    let dirty = false
    for (let i = 0; i < 4; i++) {
      const v = p.lamps[LAMP_ORDER[i]]
      const q = Math.round(v * 40)
      if (q === lamps.last[i]) continue
      lamps.last[i] = q
      const level = reduced ? (v > 0.05 ? 1.2 : 0.12) : 0.12 + 1.7 * v
      lamps.mesh.setColorAt(i, _tmpC.copy(LAMP_RGB[LAMP_ORDER[i]]).multiplyScalar(level))
      dirty = true
    }
    if (dirty && lamps.mesh.instanceColor) lamps.mesh.instanceColor.needsUpdate = true
  })

  return (
    <group name="rnd-row-rig" position={[ROW_RIG.x, 0, ROW_RIG.z]} rotation-y={ROW_RIG.yaw}>
      <BatchMeshes geos={statics} shadows={false} materials={{ sign: signMat }} name="rowrig" />
      <group ref={seat}>
        <BatchMeshes geos={seatGeo} shadows={false} name="rowrig-seat" />
      </group>
      <group ref={worker} position={[SEAT_X.catch, WORKER_Y, 0]} rotation-y={Math.PI / 2}>
        <WorkerModel look={DUMMY_LOOK} anim="sit" seed={5} castShadow={false} />
      </group>
      <group ref={handle}>
        <BatchMeshes geos={handleGeo} shadows={false} name="rowrig-handle" />
        <primitive object={leds.onHandle} />
      </group>
      <group ref={fly} position={[-1.32, 0.55, 0]}>
        <BatchMeshes geos={flyGeo} shadows={false} name="rowrig-flywheel" />
      </group>
      <mesh ref={needle} position={[GAUGE.x, GAUGE.y, GAUGE.z - 0.03]} geometry={NEEDLE_GEO} material={needleMat()} />
      <mesh ref={chain} geometry={UNIT_CYL} material={chainMat()} />
      <mesh ref={tether} geometry={UNIT_CYL} material={tetherMat()} />
      <mesh ref={wire} geometry={UNIT_CYL} material={wireMat()} />
      <primitive object={lamps.mesh} />
      <primitive object={leds.box} />
    </group>
  )
}

const NEEDLE_GEO = (() => {
  const g = new THREE.BoxGeometry(0.03, 0.38, 0.015)
  g.translate(0, 0.15, 0)
  return g
})()

const matCache = new Map<string, THREE.Material>()
function cachedMat(key: string, make: () => THREE.Material): THREE.Material {
  let m = matCache.get(key)
  if (!m) {
    m = make()
    m.name = `stations-b:${key}`
    matCache.set(key, m)
  }
  return m
}
const needleMat = () => cachedMat('needle', () => new THREE.MeshStandardMaterial({ color: '#d32f24', roughness: 0.4, metalness: 0.2 }))
const chainMat = () => cachedMat('chain', () => new THREE.MeshStandardMaterial({ color: '#8d979a', roughness: 0.4, metalness: 0.8 }))
const tetherMat = () => cachedMat('tether', () => new THREE.MeshStandardMaterial({ color: '#e57d35', roughness: 0.8 }))
const wireMat = () => cachedMat('wire', () => new THREE.MeshStandardMaterial({ color: '#2a2d30', roughness: 0.8 }))
