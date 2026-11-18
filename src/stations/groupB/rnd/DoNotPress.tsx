import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { simClock } from '@/core/clock'
import { registerDebug } from '@/core/debug'
import { events } from '@/core/events'
import { useInteractable, type Interactable } from '@/core/interaction'
import { createRng } from '@/core/rng'
import { runtime } from '@/core/runtime'
import { director } from '@/systems/director'
import { EAST } from '@/world/layout'
import { PALETTE } from '@/world/palette'
import { Batch } from '../shared/batch'
import { BatchMeshes } from '../shared/BatchMeshes'
import type { UvRect } from '../shared/canvas'
import { shown } from '../shared/hooks'
import { DoNotPressMachine, type DnpState } from './doNotPress'
import { DNP, DNP_GEOM, dnpInteractPoint } from './layout'

/**
 * DO NOT PRESS (spec §16): a big red button on a pedestal, labeled DO NOT PRESS.
 * Pressing it opens a floor hatch and raises a SECOND, LARGER button on a taller
 * pedestal ("SERIOUSLY, DO NOT PRESS"). Pressing that one puffs a little
 * confetti, flips down a lit "THANK YOU FOR YOUR FEEDBACK" sign on the west wall
 * and unlocks the hidden 'do-not-press' achievement. 60 s after the last press
 * everything folds away again (DoNotPressMachine, unit-tested).
 *
 * Built in a local frame whose front faces −Z, placed with yaw EAST so the
 * buttons face the visitor coming from the annex door. Moving parts are small
 * separate batches; the confetti is one GPU-animated instanced draw call that
 * only renders during the puff.
 */
const RED = '#d6281e'
const DARK = '#2b3134'
const STEEL = '#3d4649'
const P1_HEAD_Y = 0.92
const P1_TILT = -0.38
const P2_HEAD_Y = 1.1
const P2_TILT = -0.3
/** How far the second pedestal (incl. its sign post) sinks below the floor when stowed. */
const P2_SINK = 2.2
const HATCH_OPEN = 1.95
const SIGN_PANEL = { w: 2.6, h: 0.56 }
/** Hinge of the flip-down thank-you sign (world). */
const SIGN_HINGE = { x: DNP.sign.x + 0.16, y: DNP.sign.y + 0.36, z: DNP.sign.z }
const CONFETTI_DUR = 4.2
const CONFETTI_COLORS = ['#ff4b3e', '#ffc23f', '#5dbb63', '#4fc3ff', '#c77dff', '#ffffff', '#ff8fd0']

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Static parts: pedestal 1 with its sign, the hatch frame + bollards, the wall sign housing. */
function buildStatic(uv: Record<string, UvRect>): Map<string, THREE.BufferGeometry> {
  const b = new Batch()
  // pedestal 1 (local frame, front −Z)
  b.group(DNP.b1.x, 0, DNP.b1.z, EAST, () => {
    b.boxB('paint', 0, 0, 0, 0.56, 0.05, 0.56, '#2a3033')
    b.boxB('paint', 0, 0.05, 0.02, 0.36, 0.8, 0.36, '#cfcab9')
    b.boxB('hazard', 0, 0.1, 0.02, 0.372, 0.12, 0.372, '#ffffff')
    b.groupR([0, P1_HEAD_Y, 0.02], [P1_TILT, 0, 0], () => {
      b.box('paint', 0, 0, 0, 0.44, 0.1, 0.42, DARK)
      b.cyl('paint', 0, 0.05, 0, 0.16, 0.03, PALETTE.hazard, 24)
      b.torus('metal', 0, 0.08, 0, 0.155, 0.012, '#c3c9ca', [Math.PI / 2, 0, 0], 5, 28)
      b.cyl('metal', 0, 0.075, 0, 0.122, 0.018, '#7d878a', 20)
    })
    // the label, on a post right behind the button
    b.cylBetween('metal', [0, 0.85, 0.17], [0, 1.58, 0.17], 0.022, '#8d979a', 8)
    b.box('paint', 0, 1.42, 0.17, 0.7, 0.21, 0.03, DARK)
    b.quad('sign', 0, 1.42, 0.153, 0.66, 0.18, [0, Math.PI, 0], uv.dnp1)
  })
  // hatch frame (hazard striped), dark pit and keep-clear bollards around it
  const { half, frame, bollardHalf } = DNP_GEOM
  b.group(DNP.b2.x, 0, DNP.b2.z, EAST, () => {
    const y0 = 0.016
    b.box('matte', 0, y0 + 0.002, 0, half * 2, 0.004, half * 2, '#07090a')
    for (const s of [-1, 1]) {
      b.boxMinMax('hazard', -half - frame, y0, s * half, half + frame, 0.04, s * (half + frame), '#ffffff')
      b.boxMinMax('hazard', s * half, y0, -half, s * (half + frame), 0.04, half, '#ffffff')
    }
    const corners: [number, number][] = [
      [-bollardHalf, -bollardHalf],
      [bollardHalf, -bollardHalf],
      [bollardHalf, bollardHalf],
      [-bollardHalf, bollardHalf],
    ]
    corners.forEach(([x, z]) => {
      b.cyl('paint', x, 0, z, 0.05, 0.86, PALETTE.hazard, 10)
      b.cyl('rubber', x, 0.86, z, 0.056, 0.05, '#1d1f20', 10)
      b.cyl('paint', x, 0, z, 0.09, 0.03, '#2a3033', 10)
    })
    for (let i = 0; i < 4; i++) {
      const a = corners[i]
      const c = corners[(i + 1) % 4]
      b.cylBetween('paint', [a[0], 0.74, a[1]], [c[0], 0.74, c[1]], 0.016, '#c8302a', 6)
    }
  })
  // thank-you sign housing on the west wall
  const hx = SIGN_HINGE.x
  b.boxMinMax('paint', DNP.sign.x - 0.06, SIGN_HINGE.y, SIGN_HINGE.z - SIGN_PANEL.w / 2 - 0.1, hx + 0.05, SIGN_HINGE.y + 0.16, SIGN_HINGE.z + SIGN_PANEL.w / 2 + 0.1, '#2f3639')
  b.boxMinMax('hazard', hx + 0.05, SIGN_HINGE.y + 0.02, SIGN_HINGE.z - SIGN_PANEL.w / 2 - 0.1, hx + 0.056, SIGN_HINGE.y + 0.14, SIGN_HINGE.z + SIGN_PANEL.w / 2 + 0.1, '#ffffff')
  for (const s of [-1, 1]) b.cylBetween('metal', [hx, SIGN_HINGE.y, SIGN_HINGE.z + s * (SIGN_PANEL.w / 2 - 0.15)], [hx, SIGN_HINGE.y + 0.16, SIGN_HINGE.z + s * (SIGN_PANEL.w / 2 - 0.15)], 0.03, '#8d979a', 8)
  // conduit from the housing's north end down the wall and across the floor to pedestal 1 (the "wiring")
  const cz = DNP.sign.z - SIGN_PANEL.w / 2 + 0.05
  b.cylBetween('rubber', [DNP.sign.x + 0.02, SIGN_HINGE.y, cz], [DNP.sign.x + 0.02, 0.05, cz], 0.02, '#1d1f20', 6)
  b.cylBetween('rubber', [DNP.sign.x + 0.04, 0.03, cz], [DNP.b1.x - 0.22, 0.03, DNP.b1.z - 0.05], 0.02, '#1d1f20', 6)
  return b.build()
}

/** Button cap: local origin at its rest position on the head. */
function buildCap(r: number, h: number): Map<string, THREE.BufferGeometry> {
  const b = new Batch()
  b.cyl('paint', 0, 0, 0, r, h, RED, 24)
  b.sphere('paint', 0, h, 0, r * 0.98, RED, 24, 8, [1, 0.36, 1])
  return b.build()
}

/** Second (larger) pedestal; local origin on the floor, front −Z. */
function buildPedestal2(uv: Record<string, UvRect>): Map<string, THREE.BufferGeometry> {
  const b = new Batch()
  b.boxB('paint', 0, 0, 0, 0.66, 0.06, 0.66, '#2a3033')
  b.boxB('paint', 0, 0.06, 0.02, 0.5, 0.96, 0.5, '#c8302a')
  b.boxB('hazard', 0, 0.14, 0.02, 0.512, 0.16, 0.512, '#ffffff')
  b.boxB('hazard', 0, 0.78, 0.02, 0.512, 0.1, 0.512, '#ffffff')
  b.groupR([0, P2_HEAD_Y, 0.02], [P2_TILT, 0, 0], () => {
    b.box('paint', 0, 0, 0, 0.66, 0.12, 0.6, DARK)
    b.cyl('paint', 0, 0.06, 0, 0.275, 0.035, PALETTE.hazard, 28)
    b.torus('metal', 0, 0.095, 0, 0.27, 0.016, '#c3c9ca', [Math.PI / 2, 0, 0], 5, 32)
    b.cyl('metal', 0, 0.09, 0, 0.235, 0.02, '#7d878a', 24)
  })
  // sign on a tall post
  b.cylBetween('metal', [0, 1.0, 0.24], [0, 2.12, 0.24], 0.03, '#8d979a', 8)
  b.box('paint', 0, 1.9, 0.24, 1.14, 0.25, 0.04, '#141414')
  b.quad('sign', 0, 1.9, 0.218, 1.1, 0.196, [0, Math.PI, 0], uv.dnp2)
  for (const s of [-1, 1]) {
    b.cyl('paint', s * 0.5, 2.025, 0.24, 0.055, 0.03, STEEL, 12)
    b.sphere('lamp', s * 0.5, 2.07, 0.24, 0.05, '#ffb23f', 12, 6, [1, 1.2, 1])
  }
  return b.build()
}

/** One hatch door leaf, hinged at its outer edge (local x = 0), extending toward +x. */
function buildDoor(): Map<string, THREE.BufferGeometry> {
  const b = new Batch()
  const { half } = DNP_GEOM
  b.box('paint', half / 2, 0.012, 0, half - 0.01, 0.024, half * 2 - 0.01, '#4a5458')
  for (let k = 0; k < 3; k++) b.box('metal', half / 2, 0.026, -half + 0.2 + k * ((half * 2 - 0.4) / 2), half - 0.08, 0.006, 0.05, '#8d979a')
  return b.build()
}

/** Flip sign panel in hinge space: hangs down from the hinge, front faces +X. */
function buildSignPanel(): Map<string, THREE.BufferGeometry> {
  const b = new Batch()
  const { w, h } = SIGN_PANEL
  b.box('paint', 0, -h / 2, 0, 0.04, h + 0.06, w + 0.06, '#23292b')
  for (const s of [-1, 1]) b.box('hazard', -0.022, -h / 2 + s * (h / 2 - 0.05), 0, 0.004, 0.06, w - 0.2, '#ffffff')
  return b.build()
}

function signFrontGeometry(uv: UvRect): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(SIGN_PANEL.w, SIGN_PANEL.h)
  const a = g.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) < 0.5 ? uv[0] : uv[2], a.getY(i) < 0.5 ? uv[1] : uv[3])
  g.rotateY(Math.PI / 2)
  g.translate(0.023, -SIGN_PANEL.h / 2, 0)
  return g
}

// ---------------------------------------------------------------------------
// Confetti (GPU-animated, one draw call, only during the puff)
// ---------------------------------------------------------------------------

const CONFETTI_VERT = /* glsl */ `
  uniform float uT;
  uniform float uScale;
  uniform float uFloor;
  attribute vec3 aVel;
  attribute vec3 aColor;
  attribute vec4 aSeed;
  varying vec3 vColor;
  void main() {
    float t = uT;
    float k = 2.6;
    float vt = 0.85;
    float e = (1.0 - exp(-k * t)) / k;
    vec3 p = vec3(aVel.x * e, (aVel.y + vt) * e - vt * t, aVel.z * e);
    float fl = min(t, 1.0);
    p.x += sin(t * 5.0 + aSeed.z * 6.283) * 0.07 * fl;
    p.z += cos(t * 4.3 + aSeed.z * 9.1) * 0.07 * fl;
    float landed = step(p.y, uFloor + 0.002);
    p.y = max(p.y, uFloor);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float ang = aSeed.y * t + aSeed.z * 6.283;
    vec2 q = position.xy * aSeed.x * uScale;
    q.x *= mix(abs(cos(ang * 1.7)) * 0.8 + 0.2, 1.0, landed);
    float c = cos(ang);
    float s = sin(ang);
    mv.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    gl_Position = projectionMatrix * mv;
    vColor = aColor;
  }`

const CONFETTI_FRAG = /* glsl */ `
  uniform float uLight;
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor * uLight, 1.0);
    #include <colorspace_fragment>
  }`

function makeConfetti(count: number) {
  const rng = createRng(1977)
  const base = new THREE.PlaneGeometry(1, 0.62)
  const geo = new THREE.InstancedBufferGeometry()
  geo.index = base.index
  geo.setAttribute('position', base.getAttribute('position'))
  const vel = new Float32Array(count * 3)
  const col = new Float32Array(count * 3)
  const seed = new Float32Array(count * 4)
  const c = new THREE.Color()
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2
    const spread = 0.45 + rng() * 1.6
    // local frame of the mesh is world-aligned: bias the puff east, toward the visitor
    vel[i * 3] = Math.cos(a) * spread + 0.55
    vel[i * 3 + 1] = 2.8 + rng() * 2.4
    vel[i * 3 + 2] = Math.sin(a) * spread
    c.set(CONFETTI_COLORS[Math.floor(rng() * CONFETTI_COLORS.length)])
    col.set([c.r, c.g, c.b], i * 3)
    seed.set([0.048 + rng() * 0.032, (rng() < 0.5 ? -1 : 1) * (4 + rng() * 7), rng(), rng()], i * 4)
  }
  geo.setAttribute('aVel', new THREE.InstancedBufferAttribute(vel, 3))
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3))
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4))
  geo.instanceCount = count
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.6, 0, 0), 3.2)
  const mat = new THREE.ShaderMaterial({
    name: 'stations-b:confetti',
    uniforms: { uT: { value: 0 }, uScale: { value: 1 }, uFloor: { value: 0 }, uLight: { value: 1 } },
    vertexShader: CONFETTI_VERT,
    fragmentShader: CONFETTI_FRAG,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'stations-b:confetti'
  mesh.visible = false
  mesh.raycast = () => {}
  return { mesh, geo, base, mat }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const easeOutBack = (x: number, c1 = 0.9) => 1 + (c1 + 1) * (x - 1) ** 3 + c1 * (x - 1) ** 2
const smooth = (x: number) => x * x * (3 - 2 * x)
const GAG_ID = 'gag:do-not-press'

export interface DoNotPressProps {
  uv: Record<string, UvRect>
  signMat: THREE.Material
  quality: 'low' | 'medium' | 'high'
  reduced: boolean
}

export function DoNotPress({ uv, signMat, quality, reduced }: DoNotPressProps) {
  const machine = useMemo(() => new DoNotPressMachine(DNP.resetAfter), [])
  const statics = useMemo(() => buildStatic(uv), [uv])
  const cap1 = useMemo(() => buildCap(0.105, 0.045), [])
  const cap2 = useMemo(() => buildCap(0.205, 0.06), [])
  const ped2 = useMemo(() => buildPedestal2(uv), [uv])
  const door = useMemo(() => buildDoor(), [])
  const door2 = useMemo(() => buildDoor(), [])
  const panel = useMemo(() => buildSignPanel(), [])
  const front = useMemo(() => {
    const g = signFrontGeometry(uv.thanks)
    const m = new THREE.MeshBasicMaterial({ map: (signMat as THREE.MeshStandardMaterial).map ?? null, toneMapped: false })
    m.name = 'stations-b:dnp-thanks'
    m.color.setScalar(0.1)
    return { g, m }
  }, [uv, signMat])
  const count = quality === 'low' ? 55 : quality === 'high' ? 140 : 95
  const confetti = useMemo(() => makeConfetti(count), [count])

  const root = useRef<THREE.Group>(null)
  const cap1Ref = useRef<THREE.Group>(null)
  const cap2Ref = useRef<THREE.Group>(null)
  const ped2Ref = useRef<THREE.Group>(null)
  const doorL = useRef<THREE.Group>(null)
  const doorR = useRef<THREE.Group>(null)
  const panelRef = useRef<THREE.Group>(null)
  const st = useRef({ lastT: simClock.t, prev: 'idle' as DnpState, burstAt: -1, flipSfx: false })
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced

  useEffect(
    () => () => {
      front.g.dispose()
      front.m.dispose()
    },
    [front],
  )
  useEffect(
    () => () => {
      confetti.geo.dispose()
      confetti.base.dispose()
      confetti.mat.dispose()
    },
    [confetti],
  )
  // never leave a director slot behind
  useEffect(() => () => director.end(GAG_ID), [])

  const api = useMemo(() => {
    const press = (): boolean => {
      if (machine.canPress1()) return machine.press1()
      if (machine.canPress2()) {
        machine.press2()
        // voluntary gag: mark it so disruptive events (OSHA etc.) wait their turn
        director.request({ id: GAG_ID, kind: 'player', cooldown: 0, duration: 5 })
        events.emit('achievement', { id: 'do-not-press' })
        return true
      }
      return false
    }
    return { press }
  }, [machine])

  const def = useMemo<Interactable>(
    () => ({
      id: 'rnd:do-not-press',
      verb: 'Press',
      get label() {
        return machine.state === 'armed' ? 'SERIOUSLY, DO NOT PRESS' : 'DO NOT PRESS'
      },
      radius: 2.2,
      priority: 0.3,
      enabled: () => machine.canPress1() || machine.canPress2(),
      getPosition: () => {
        const p = dnpInteractPoint(machine.state === 'idle' ? 1 : 2)
        return { x: p.x, y: 0, z: p.z }
      },
      onInteract: () => {
        api.press()
      },
    }),
    [machine, api],
  )
  useInteractable(def)

  useEffect(
    () =>
      registerDebug('rnd', {
        pressDoNotPress: () => api.press(),
        resetDoNotPress: () => {
          machine.reset()
          st.current.burstAt = -1
        },
        doNotPress: () => ({ state: machine.state, t: +machine.t.toFixed(2), sinceLast: +machine.sinceLast.toFixed(2), presses: machine.presses }),
      }),
    [api, machine],
  )

  useFrame(() => {
    const s = st.current
    // tick the machine from sim time (pauses with the sim; debug clock.advance fast-forwards it)
    const now = simClock.t
    let d = now - s.lastT
    s.lastT = now
    if (!(d >= 0) || d > 600) d = 0
    let ch = machine.channels()
    for (let guard = 0; d > 1e-6 && guard < 2600; guard++) {
      const step = Math.min(d, 0.25)
      ch = machine.update(step)
      d -= step
    }
    // side effects on state changes
    if (machine.state !== s.prev) {
      s.prev = machine.state
      const b1: [number, number, number] = [DNP.b1.x, 1.0, DNP.b1.z]
      const b2: [number, number, number] = [DNP.b2.x, 1.2, DNP.b2.z]
      if (machine.state === 'rising') {
        events.emit('sfx', { name: 'big-button', position: b1 })
        events.emit('sfx', { name: 'power-up', position: [DNP.b2.x, 0.3, DNP.b2.z], volume: 0.55 })
      } else if (machine.state === 'armed') {
        events.emit('sfx', { name: 'machine-clank', position: b2, volume: 0.45 })
      } else if (machine.state === 'thanks') {
        events.emit('sfx', { name: 'big-button', position: b2, rate: 0.72 })
        events.emit('sfx', { name: 'cheer', position: b2, volume: 0.35 })
        s.burstAt = now
        s.flipSfx = false
      } else if (machine.state === 'sinking') {
        events.emit('sfx', { name: 'power-down', position: [DNP.b2.x, 0.4, DNP.b2.z], volume: 0.4 })
      } else if (machine.state === 'idle') {
        director.end(GAG_ID)
      }
    }
    if (machine.state === 'thanks' && !s.flipSfx && ch.sign > 0.85) {
      s.flipSfx = true
      events.emit('sfx', { name: 'machine-clank', position: [SIGN_HINGE.x, SIGN_HINGE.y, SIGN_HINGE.z], volume: 0.35, rate: 1.3 })
    }

    if (!shown(root.current)) return
    const red = reducedRef.current
    if (cap1Ref.current) cap1Ref.current.position.y = 0.05 - ch.b1 * 0.035
    if (doorL.current) doorL.current.rotation.z = ch.hatch * HATCH_OPEN
    if (doorR.current) doorR.current.rotation.z = ch.hatch * HATCH_OPEN
    const p2 = ped2Ref.current
    if (p2) {
      p2.position.y = -P2_SINK * (1 - ch.rise)
      const vis = ch.rise > 0.002
      if (p2.visible !== vis) p2.visible = vis
    }
    if (cap2Ref.current) cap2Ref.current.position.y = 0.08 - ch.b2 * 0.05
    if (panelRef.current) {
      const k = ch.sign <= 0 ? 0 : ch.sign >= 1 ? 1 : red ? smooth(ch.sign) : easeOutBack(ch.sign)
      panelRef.current.rotation.z = Math.PI * (1 - k)
    }
    const level = Number.isFinite(runtime.lighting.level) ? Math.min(1, Math.max(0, runtime.lighting.level)) : 1
    // lit once it hangs down; a brief fluorescent stutter as it powers on (not with reduced motion)
    const age = machine.state === 'thanks' ? machine.t : 1
    const flick = red || age > 1.4 || age < 0.85 ? 1 : 0.55 + 0.45 * Math.round(Math.abs(Math.sin(age * 41)))
    front.m.color.setScalar((0.1 + 0.9 * ch.sign * flick) * (0.35 + 0.65 * level))

    // confetti
    const m = confetti.mesh
    const t = s.burstAt >= 0 ? (now - s.burstAt) * (red ? 0.8 : 1) : -1
    const on = t >= 0 && t < CONFETTI_DUR
    if (m.visible !== on) m.visible = on
    if (on) {
      const u = confetti.mat.uniforms
      u.uT.value = t
      u.uScale.value = 1 - Math.min(1, Math.max(0, (t - (CONFETTI_DUR - 0.9)) / 0.9))
      u.uFloor.value = 0.03 - CONFETTI_ORIGIN[1]
      u.uLight.value = 0.4 + 0.6 * level
    } else if (t >= CONFETTI_DUR) s.burstAt = -1
  })

  const { half } = DNP_GEOM
  return (
    <group name="rnd-do-not-press" ref={root}>
      <BatchMeshes geos={statics} shadows={false} materials={{ sign: signMat }} name="dnp" />
      <group position={[DNP.b1.x, 0, DNP.b1.z]} rotation-y={EAST}>
        <group position={[0, P1_HEAD_Y, 0.02]} rotation-x={P1_TILT}>
          <group ref={cap1Ref} position={[0, 0.05, 0]}>
            <BatchMeshes geos={cap1} shadows={false} name="dnp-cap1" />
          </group>
        </group>
      </group>
      <group position={[DNP.b2.x, 0, DNP.b2.z]} rotation-y={EAST}>
        <group ref={doorL} position={[-half, 0.018, 0]}>
          <BatchMeshes geos={door} shadows={false} name="dnp-door-l" />
        </group>
        <group ref={doorR} position={[half, 0.018, 0]} rotation-y={Math.PI}>
          <BatchMeshes geos={door2} shadows={false} name="dnp-door-r" />
        </group>
        <group ref={ped2Ref} position={[0, -P2_SINK, 0]} visible={false}>
          <BatchMeshes geos={ped2} shadows={false} materials={{ sign: signMat }} name="dnp-ped2" />
          <group position={[0, P2_HEAD_Y, 0.02]} rotation-x={P2_TILT}>
            <group ref={cap2Ref} position={[0, 0.08, 0]}>
              <BatchMeshes geos={cap2} shadows={false} name="dnp-cap2" />
            </group>
          </group>
        </group>
      </group>
      <group ref={panelRef} position={[SIGN_HINGE.x, SIGN_HINGE.y, SIGN_HINGE.z]} rotation-z={Math.PI}>
        <BatchMeshes geos={panel} shadows={false} name="dnp-thanks" />
        <mesh geometry={front.g} material={front.m} name="dnp-thanks-front" />
      </group>
      <primitive object={confetti.mesh} position={CONFETTI_ORIGIN} />
    </group>
  )
}

/** Where the confetti puffs from (top of the second button, world). */
const CONFETTI_ORIGIN: [number, number, number] = [DNP.b2.x + 0.12, 1.3, DNP.b2.z]

