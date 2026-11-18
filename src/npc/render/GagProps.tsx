import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, CylinderCollider, RigidBody, type RapierCollider } from '@react-three/rapier'
import * as THREE from 'three'
import { GROUPS } from '@/core/collision'
import { mats } from '@/world/materials'
import { ARM, armIdle, type PropStates } from '../gagKit'
import { FOAM_PILE, JACK_A, JACK_B, JACK_SIZE, KICK_MACHINE, NAP_CONVEYOR, PRINTER, ROBOT_ARM, VAT } from '../propsData'
import { LABEL_FONT, Parts, labelTexture, metalMat, paintedMat } from './build'

const lazy = <T,>(make: () => T) => {
  let v: T | null = null
  return () => (v ??= make())
}

// ===========================================================================
// Pallet jacks (nose = local -Z)
// ===========================================================================

const jackGeo = lazy(() => {
  const p = new Parts()
  const red = '#C8553D'
  const dark = '#2B2F31'
  const L = JACK_SIZE.length
  // forks
  for (const sx of [-1, 1]) {
    p.box(0.16, 0.065, 1.12, red, [sx * 0.2, 0.07, -L / 2 + 0.56])
    p.cyl(0.034, 0.034, 0.1, dark, [sx * 0.2, 0.035, -L / 2 + 0.1], [0, 0, Math.PI / 2], 10)
  }
  // pump body + hydraulics + steer wheels
  p.rbox(0.62, 0.3, 0.3, 0.05, red, [0, 0.19, 0.42])
  p.cyl(0.055, 0.055, 0.26, '#7D8A8C', [0, 0.42, 0.43])
  for (const sx of [-1, 1]) p.cyl(0.085, 0.085, 0.06, dark, [sx * 0.1, 0.085, 0.5], [0, 0, Math.PI / 2], 14)
  // tiller + loop handle
  p.bar([0, 0.4, 0.45], [0, 1.02, 0.78], 0.024, dark)
  p.torus(0.11, 0.022, dark, [0, 1.1, 0.82], [0.5, 0, 0], Math.PI * 2, 16)
  p.box(0.12, 0.04, 0.05, red, [0, 1.21, 0.86], [0.5, 0, 0])
  // pallet
  for (const x of [-0.34, 0, 0.34]) p.box(0.07, 0.08, 1.0, '#7E5634', [x, 0.145, -0.33])
  for (let i = 0; i < 6; i++) p.box(0.8, 0.022, 0.12, i % 2 ? '#9A6B43' : '#A57449', [0, 0.196, -0.8 + i * 0.185])
  // load: cardboard boxes with tape
  const card = '#B98B57'
  const tape = '#D9C6A0'
  p.rbox(0.42, 0.36, 0.42, 0.015, card, [-0.17, 0.39, -0.55])
  p.box(0.425, 0.01, 0.07, tape, [-0.17, 0.572, -0.55])
  p.rbox(0.36, 0.3, 0.38, 0.015, card, [0.18, 0.36, -0.17])
  p.box(0.365, 0.01, 0.07, tape, [0.18, 0.512, -0.17])
  p.rbox(0.3, 0.24, 0.32, 0.015, '#C29563', [-0.12, 0.69, -0.47], [0, 0.3, 0])
  p.box(0.14, 0.09, 0.004, '#EFE8D6', [0.18, 0.38, -0.362])
  return p.build()
})

function Jack({ state, shadows }: { state: PropStates['jackA']; shadows: boolean }) {
  const g = useRef<THREE.Group>(null)
  useFrame(() => {
    const grp = g.current
    if (!grp) return
    grp.position.set(state.x, 0, state.z)
    grp.rotation.y = state.yaw
  })
  return (
    <group ref={g} position={[state.x, 0, state.z]} rotation-y={state.yaw}>
      <mesh geometry={jackGeo()} material={paintedMat()} castShadow={shadows} receiveShadow />
    </group>
  )
}

// ===========================================================================
// Kick machine: "PARTS TUMBLER" (front = local -Z, faces the aisle)
// ===========================================================================

const tumblerFrameGeo = lazy(() => {
  const p = new Parts()
  const frame = '#5B6668'
  p.box(1.24, 0.08, 1.0, '#2F3536', [0, 0.04, 0])
  for (const sx of [-1, 1]) {
    const x = sx * 0.5
    p.beam([x, 0.08, -0.4], [x, 0.84, 0], 0.07, frame)
    p.beam([x, 0.08, 0.4], [x, 0.84, 0], 0.07, frame)
    p.cyl(0.075, 0.075, 0.12, '#3A4142', [sx * 0.53, 0.84, 0], [0, 0, Math.PI / 2], 12)
  }
  // motor (back side) + feet
  p.cyl(0.15, 0.15, 0.36, '#3E6B4F', [0.25, 0.26, 0.3], [Math.PI / 2, 0, 0], 14)
  p.box(0.3, 0.06, 0.4, '#2F3536', [0.25, 0.1, 0.3])
  p.cyl(0.155, 0.155, 0.04, '#2B2F31', [0.25, 0.26, 0.49], [Math.PI / 2, 0, 0], 14)
  // exhaust stack with cap (world north side)
  p.bar([0.25, 0.4, 0.15], [0.25, 1.62, 0.15], 0.055, '#3A3F3F', 10)
  p.cyl(0.09, 0.07, 0.08, '#2B2F31', [0.25, 1.66, 0.15], undefined, 10)
  // front control panel + gauge + label backing
  p.rbox(0.42, 0.34, 0.08, 0.02, '#D9D4C5', [-0.26, 0.36, -0.46])
  p.box(0.54, 0.23, 0.05, '#2F3536', [0.18, 0.36, -0.47])
  p.beam([0.18, 0.08, -0.45], [0.18, 0.25, -0.45], 0.05, '#2F3536')
  p.cyl(0.075, 0.075, 0.04, '#2B2F31', [-0.36, 0.42, -0.51], [Math.PI / 2, 0, 0], 16)
  p.cyl(0.062, 0.062, 0.045, '#F1EEE6', [-0.36, 0.42, -0.512], [Math.PI / 2, 0, 0], 16)
  p.box(0.008, 0.05, 0.004, '#C0392B', [-0.36, 0.44, -0.536], [0, 0, -0.6])
  p.box(0.05, 0.05, 0.03, '#C0392B', [-0.16, 0.3, -0.5])
  // lamp post
  p.bar([-0.3, 0.84, 0.25], [-0.3, 1.38, 0.25], 0.02, '#3A4142', 8)
  return p.build()
})

const drumGeo = lazy(() => {
  const p = new Parts()
  p.cyl(0.38, 0.38, 0.9, '#B6542E', [0, 0, 0], [0, 0, Math.PI / 2], 18)
  for (const x of [-0.3, 0, 0.3]) p.torus(0.385, 0.024, '#7A3B2E', [x, 0, 0], [0, Math.PI / 2, 0], Math.PI * 2, 22)
  p.rbox(0.3, 0.05, 0.22, 0.015, '#8E3F24', [0.12, 0.385, 0])
  p.box(0.08, 0.03, 0.04, '#D9D4C5', [0.12, 0.42, 0])
  // flywheel + spokes on the axle end
  p.cyl(0.26, 0.26, 0.05, '#465356', [0.56, 0, 0], [0, 0, Math.PI / 2], 20)
  for (let i = 0; i < 4; i++) p.box(0.06, 0.46, 0.04, '#7D8A8C', [0.59, 0, 0], [i * (Math.PI / 4), 0, 0])
  p.cyl(0.06, 0.06, 0.14, '#2B2F31', [0.6, 0, 0], [0, 0, Math.PI / 2], 10)
  return p.build()
})

const tumblerLabel = lazy(
  () =>
    new THREE.MeshStandardMaterial({
      map: labelTexture('npc-tumbler', 256, 96, (ctx, w, h) => {
        ctx.fillStyle = '#E9B63F'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#1A1E1F'
        ctx.font = `700 40px ${LABEL_FONT}`
        ctx.textAlign = 'center'
        ctx.fillText('PARTS TUMBLER', w / 2, 42)
        ctx.font = `700 26px ${LABEL_FONT}`
        ctx.fillText('IF SPUTTERING: KICK GENTLY', w / 2, 80)
      }),
      roughness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
)

function KickMachine({ props, shadows, reduced }: { props: PropStates; shadows: boolean; reduced: boolean }) {
  const body = useRef<THREE.Group>(null)
  const drum = useRef<THREE.Mesh>(null)
  const lamp = useRef<THREE.Mesh>(null)
  const st = useRef({ angle: 0, t: 0 })
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1)
    const s = st.current
    s.t += dt
    const sput = props.kickSputter
    const boost = props.kickBoost
    // sputtering: the drum lurches and stalls; boosted: it flies
    const lurch = sput > 0 ? (Math.sin(s.t * 7.3) > 0.2 ? 1 : 0.05) : 1
    const speed = (2.4 + boost * 16) * (1 - sput * 0.85 + sput * 0.85 * lurch)
    s.angle -= speed * dt
    if (drum.current) drum.current.rotation.x = s.angle
    const b = body.current
    if (b) {
      const imp = props.kickImpact < 0.35 ? (1 - props.kickImpact / 0.35) * 0.05 : 0
      const shake = reduced ? 0 : sput * 0.018 * (lurch > 0.5 ? 1 : 0.3) + boost * 0.006 + imp
      b.position.set(Math.sin(s.t * 61) * shake, Math.abs(Math.sin(s.t * 47)) * shake * 0.6, Math.cos(s.t * 53) * shake)
      b.rotation.z = Math.sin(s.t * 37) * shake * 1.5
    }
    if (lamp.current) {
      const blink = reduced ? true : Math.sin(s.t * 9) > 0
      lamp.current.material = sput > 0.05 ? (blink ? mats.emissiveAmber() : mats.steelDark()) : boost > 0.05 ? mats.emissiveGreen() : mats.steelDark()
    }
  })
  return (
    <group position={[KICK_MACHINE.pos[0], 0, KICK_MACHINE.pos[1]]} rotation-y={KICK_MACHINE.yaw} name="npc-kick-machine">
      <group ref={body}>
        <mesh geometry={tumblerFrameGeo()} material={paintedMat()} castShadow={shadows} receiveShadow />
        <mesh ref={drum} geometry={drumGeo()} material={paintedMat()} position={[0, 0.84, 0]} castShadow={shadows} />
        <mesh ref={lamp} position={[-0.3, 1.42, 0.25]} material={mats.steelDark()}>
          <sphereGeometry args={[0.06, 12, 10]} />
        </mesh>
        <mesh position={[0.18, 0.36, -0.505]} rotation-y={Math.PI} material={tumblerLabel()}>
          <planeGeometry args={[0.5, 0.19]} />
        </mesh>
      </group>
    </group>
  )
}

// ===========================================================================
// Green vat (+ rising bubbles, feed pipe from the overhead rack, warning plate)
// ===========================================================================

const VAT_H = 1.02
const vatGeo = lazy(() => {
  const p = new Parts()
  const R = VAT.radius
  const steel = '#9AA6A5'
  p.cyl(R, R * 0.96, VAT_H - 0.1, steel, [0, 0.1 + (VAT_H - 0.1) / 2, 0], undefined, 24, true)
  p.cyl(R * 0.92, R * 0.9, VAT_H - 0.16, '#3D4A48', [0, 0.14 + (VAT_H - 0.16) / 2, 0], [Math.PI, 0, 0], 24, true)
  p.cyl(R * 0.96, R * 0.96, 0.04, '#465356', [0, 0.12, 0], undefined, 24)
  p.torus(R, 0.04, '#5B6668', [0, VAT_H, 0], [Math.PI / 2, 0, 0], Math.PI * 2, 28)
  for (const y of [0.32, 0.72]) p.torus(R + 0.012, 0.022, '#465356', [0, y, 0], [Math.PI / 2, 0, 0], Math.PI * 2, 28)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4
    p.cyl(0.045, 0.06, 0.16, '#2F3536', [Math.cos(a) * R * 0.7, 0.08, Math.sin(a) * R * 0.7], undefined, 8)
  }
  // feed pipe from the overhead rack down into the vat
  const px = -0.12
  const pz = -R + 0.12
  p.bar([px, 4.95, pz], [px, VAT_H + 0.35, pz], 0.05, '#7D8A8C', 10)
  p.torus(0.1, 0.05, '#7D8A8C', [px, VAT_H + 0.35, pz + 0.1], [0, Math.PI / 2, 0], Math.PI / 2, 8)
  p.cyl(0.075, 0.075, 0.05, '#5B6668', [px, 3.2, pz], undefined, 12)
  p.cyl(0.075, 0.075, 0.05, '#5B6668', [px, 1.9, pz], undefined, 12)
  p.cyl(0.06, 0.06, 0.08, '#C0392B', [px, 2.4, pz], undefined, 10)
  return p.build()
})

const slimeMat = lazy(() => {
  const m = new THREE.MeshStandardMaterial({ color: '#57e04a', emissive: '#3dff4f', emissiveIntensity: 0.9, roughness: 0.25, metalness: 0 })
  m.name = 'npc-slime'
  return m
})

const vatSign = lazy(
  () =>
    new THREE.MeshStandardMaterial({
      map: labelTexture('npc-vat-sign', 256, 160, (ctx, w, h) => {
        ctx.fillStyle = '#F1EEE6'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#2F8F3A'
        ctx.fillRect(0, 0, w, 48)
        ctx.fillStyle = '#F1EEE6'
        ctx.font = `700 40px ${LABEL_FONT}`
        ctx.textAlign = 'center'
        ctx.fillText('CAUTION', w / 2, 38)
        ctx.fillStyle = '#1A1E1F'
        ctx.font = `700 34px ${LABEL_FONT}`
        ctx.fillText('CONTENTS:', w / 2, 92)
        ctx.fillText('VERY GREEN', w / 2, 132)
      }),
      roughness: 0.7,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
)

const BUBBLES = 8
const _bm = new THREE.Matrix4()
const _bq = new THREE.Quaternion()
const _bp = new THREE.Vector3()
const _bs = new THREE.Vector3()

function Vat({ props, shadows }: { props: PropStates; shadows: boolean }) {
  const bubbles = useRef<THREE.InstancedMesh>(null)
  const surface = useRef<THREE.Mesh>(null)
  const t = useRef(0)
  const seeds = useMemo(() => Array.from({ length: BUBBLES }, (_, i) => ({ a: (i * 2.399) % (Math.PI * 2), r: 0.1 + ((i * 0.37) % 0.3), ph: i * 0.61 })), [])
  useFrame((_, dt) => {
    t.current += Math.min(dt, 0.1)
    const agit = props.vatAgitation
    const splash = props.vatSplash
    const im = bubbles.current
    if (im) {
      const rate = 0.6 + agit * 2.2
      for (let i = 0; i < BUBBLES; i++) {
        const s = seeds[i]
        const u = (t.current * rate + s.ph) % 1
        const size = (0.03 + agit * 0.05) * Math.sin(u * Math.PI)
        _bp.set(Math.cos(s.a + t.current * 0.3) * s.r, VAT_H - 0.12 + u * (0.06 + agit * 0.12) + splash * 0.3 * Math.sin(u * 3), Math.sin(s.a + t.current * 0.3) * s.r)
        im.setMatrixAt(i, _bm.compose(_bp, _bq, _bs.setScalar(Math.max(0.001, size))))
      }
      im.instanceMatrix.needsUpdate = true
    }
    const surf = surface.current
    if (surf) {
      surf.position.y = VAT_H - 0.12 + Math.sin(t.current * 6) * 0.01 * agit + splash * 0.06
      ;(surf.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.7 + agit * 0.8 + splash * 1.5
    }
  })
  return (
    <group position={[VAT.pos[0], 0, VAT.pos[1]]} name="npc-green-vat">
      <mesh geometry={vatGeo()} material={metalMat()} castShadow={shadows} receiveShadow />
      <mesh ref={surface} rotation-x={-Math.PI / 2} position={[0, VAT_H - 0.12, 0]} material={slimeMat()}>
        <circleGeometry args={[VAT.radius * 0.91, 24]} />
      </mesh>
      <instancedMesh ref={bubbles} args={[undefined, slimeMat(), BUBBLES]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
      </instancedMesh>
      {/* warning plate on the avenue side */}
      <mesh position={[VAT.radius + 0.015, 0.62, 0]} rotation-y={Math.PI / 2} material={vatSign()}>
        <planeGeometry args={[0.42, 0.26]} />
      </mesh>
    </group>
  )
}

// ===========================================================================
// Memo printer + ribbon (slot = local -Z, faces west)
// ===========================================================================

const printerGeo = lazy(() => {
  const p = new Parts()
  const leg = '#465356'
  p.box(0.95, 0.05, 0.7, '#5B6668', [0, 0.62, 0])
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(0.05, 0.6, 0.05, leg, [sx * 0.43, 0.3, sz * 0.31])
  p.box(0.9, 0.03, 0.62, '#5B6668', [0, 0.18, 0])
  // fanfold paper box on the shelf
  p.box(0.52, 0.22, 0.4, '#B98B57', [0, 0.31, 0.04])
  p.box(0.44, 0.06, 0.34, '#F1EEE6', [0, 0.43, 0.04])
  // printer body
  p.rbox(0.86, 0.3, 0.58, 0.05, '#D9D4C5', [0, 0.8, 0.02])
  p.rbox(0.8, 0.07, 0.4, 0.03, '#C4BEAD', [0, 0.97, 0.08])
  p.box(0.62, 0.04, 0.06, '#2B2F31', [0, 0.93, -0.27])
  p.box(0.3, 0.12, 0.02, '#3A4142', [0.22, 0.8, -0.275])
  for (let i = 0; i < 3; i++) p.box(0.04, 0.03, 0.02, i === 0 ? '#C0392B' : '#E9B63F', [0.12 + i * 0.07, 0.8, -0.29])
  // tractor-feed knobs
  for (const sx of [-1, 1]) p.cyl(0.04, 0.04, 0.06, '#2B2F31', [sx * 0.45, 0.84, 0.05], [0, 0, Math.PI / 2], 10)
  // cable to the wall
  p.bar([0.3, 0.7, 0.3], [0.38, 0.05, 0.62], 0.012, '#1C1F20', 6)
  return p.build()
})

const paperTexture = lazy(() => {
  const t = labelTexture('npc-memo-paper', 128, 512, (ctx, w, h) => {
    ctx.fillStyle = '#F4F2EA'
    ctx.fillRect(0, 0, w, h)
    for (let y = 0; y < h; y += 32) {
      if ((y / 32) % 2) {
        ctx.fillStyle = '#DCEBDD'
        ctx.fillRect(14, y, w - 28, 32)
      }
    }
    // tractor holes + perforation
    ctx.fillStyle = '#C9C6BA'
    for (let y = 8; y < h; y += 16) {
      ctx.beginPath()
      ctx.arc(7, y, 3, 0, Math.PI * 2)
      ctx.arc(w - 7, y, 3, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#B7B3A6'
    for (let x = 14; x < w - 14; x += 6) ctx.fillRect(x, 0, 3, 1)
    // "text"
    ctx.fillStyle = '#5C5A55'
    ctx.font = `700 12px ${LABEL_FONT}`
    ctx.fillText('MEMO RE: BREVITY', 20, 22)
    let seed = 7
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let y = 40; y < h - 6; y += 10) ctx.fillRect(20, y, 30 + r() * (w - 60), 3)
  })
  t.wrapS = THREE.ClampToEdgeWrapping
  t.wrapT = THREE.RepeatWrapping
  return t
})

const paperMat = lazy(() => {
  const m = new THREE.MeshStandardMaterial({ map: paperTexture(), roughness: 0.92, metalness: 0, side: THREE.DoubleSide })
  m.name = 'npc-memo-paper'
  return m
})

const RIBBON_W = 0.36
const ARC_SEGS = 10
const FLAT_SEGS = 40
/** Arc from the slot (local z -0.3, y 0.93) down to the floor at local z -0.95. */
const ARC_END_Z = -0.95
/** Approximate paper length of the arc (m). */
const ARC_LENGTH = 1.25

const arcGeo = lazy(() => {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  let v = 0
  let prev: [number, number] | null = null
  for (let i = 0; i <= ARC_SEGS; i++) {
    const u = i / ARC_SEGS
    // quadratic Bezier: slot → overhang → floor
    const z = (1 - u) * (1 - u) * -0.3 + 2 * u * (1 - u) * -0.85 + u * u * ARC_END_Z
    const y = (1 - u) * (1 - u) * 0.93 + 2 * u * (1 - u) * 0.95 + u * u * 0.012
    if (prev) v += Math.hypot(z - prev[0], y - prev[1])
    prev = [z, y]
    pos.push(-RIBBON_W / 2, y, z, RIBBON_W / 2, y, z)
    uv.push(0, v / 1.6, 1, v / 1.6)
    if (i > 0) {
      const a = (i - 1) * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
})

function Printer({ props, shadows, reduced }: { props: PropStates; shadows: boolean; reduced: boolean }) {
  const lamp = useRef<THREE.Mesh>(null)
  const arc = useRef<THREE.Mesh>(null)
  const flat = useRef<THREE.Mesh>(null)
  const t = useRef(0)
  const flatGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const n = (FLAT_SEGS + 1) * 2
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2))
    const idx: number[] = []
    for (let i = 0; i < FLAT_SEGS; i++) {
      const a = i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    g.setIndex(idx)
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
    return g
  }, [])
  useEffect(() => () => flatGeo.dispose(), [flatGeo])
  const lastLen = useRef(-1)

  useFrame((_, dt) => {
    t.current += Math.min(dt, 0.1)
    const len = props.printerLength
    const show = len > 0.02
    if (arc.current) {
      arc.current.visible = show
      // the paper feeds out of the slot: reveal the arc progressively
      const frac = Math.min(1, len / ARC_LENGTH)
      arc.current.geometry.setDrawRange(0, Math.max(6, Math.ceil(frac * ARC_SEGS) * 6))
    }
    const f = flat.current
    if (f) {
      const flatLen = Math.max(0, len - Math.abs(ARC_END_Z) + 0.3)
      f.visible = flatLen > 0.02
      const flutter = reduced ? 0 : 1
      if (f.visible && (Math.abs(flatLen - lastLen.current) > 1e-4 || flutter)) {
        lastLen.current = flatLen
        const pos = flatGeo.getAttribute('position') as THREE.BufferAttribute
        const uvs = flatGeo.getAttribute('uv') as THREE.BufferAttribute
        const z0 = ARC_END_Z
        for (let i = 0; i <= FLAT_SEGS; i++) {
          const u = i / FLAT_SEGS
          const d = u * flatLen
          const z = z0 - d
          // the free end curls up and flutters a little
          const tail = Math.max(0, 1 - (flatLen - d) / 0.6)
          const y = 0.012 + tail * tail * 0.12 + tail * 0.02 * Math.sin(t.current * 6 + d * 3) * flutter
          pos.setXYZ(i * 2, -RIBBON_W / 2, y, z)
          pos.setXYZ(i * 2 + 1, RIBBON_W / 2, y, z)
          // paper scrolls out of the slot: texture anchored at the free end
          const v = (flatLen - d) / 1.6
          uvs.setXY(i * 2, 0, v)
          uvs.setXY(i * 2 + 1, 1, v)
        }
        pos.needsUpdate = true
        uvs.needsUpdate = true
        flatGeo.computeBoundingSphere()
      }
    }
    if (lamp.current) {
      const blink = reduced || Math.sin(t.current * 10) > 0
      lamp.current.material =
        props.printerLamp === 1 ? (blink ? mats.emissiveAmber() : mats.steelDark()) : props.printerLamp === 2 ? mats.emissiveRed() : mats.emissiveGreen()
    }
  })

  return (
    <group position={[PRINTER.pos[0], 0, PRINTER.pos[1]]} rotation-y={PRINTER.yaw} name="npc-memo-printer">
      <mesh geometry={printerGeo()} material={paintedMat()} castShadow={shadows} receiveShadow />
      <mesh ref={lamp} position={[-0.3, 0.97, -0.24]} material={mats.emissiveGreen()}>
        <sphereGeometry args={[0.025, 10, 8]} />
      </mesh>
      <mesh ref={arc} geometry={arcGeo()} material={paperMat()} visible={false} />
      <mesh ref={flat} geometry={flatGeo} material={paperMat()} visible={false} frustumCulled={false} receiveShadow />
    </group>
  )
}

// ===========================================================================
// Robot arm + foam pit
// ===========================================================================

const ORANGE = '#E57D35'
const JOINT = '#2B2F31'

const armBaseGeo = lazy(() => {
  const p = new Parts()
  p.cyl(0.58, 0.62, 0.1, '#3A3F3F', [0, 0.05, 0], undefined, 24)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    p.cyl(0.03, 0.03, 0.05, '#9AA6A5', [Math.cos(a) * 0.5, 0.12, Math.sin(a) * 0.5], undefined, 6)
  }
  p.cyl(0.36, 0.42, ARM.pedestal - 0.1, '#465356', [0, 0.1 + (ARM.pedestal - 0.1) / 2, 0], undefined, 20)
  p.cyl(0.425, 0.425, 0.08, '#E9B63F', [0, 0.32, 0], undefined, 20)
  p.cyl(0.425, 0.425, 0.08, '#E9B63F', [0, 0.52, 0], undefined, 20)
  return p.build()
})

const turretGeo = lazy(() => {
  const p = new Parts()
  p.cyl(0.4, 0.4, 0.16, JOINT, [0, 0.08, 0], undefined, 22)
  p.rbox(0.56, 0.36, 0.5, 0.06, ORANGE, [0, 0.3, 0.05])
  p.cyl(0.17, 0.17, 0.62, JOINT, [0, ARM.shoulderY - ARM.pedestal, 0], [0, 0, Math.PI / 2], 16)
  p.box(0.3, 0.08, 0.02, '#1A1E1F', [0, 0.3, -0.205])
  return p.build()
})

const upperGeo = lazy(() => {
  const p = new Parts()
  p.rbox(0.26, ARM.l1 + 0.1, 0.28, 0.06, ORANGE, [0, ARM.l1 / 2, 0])
  p.box(0.27, 0.42, 0.02, '#1A1E1F', [0, ARM.l1 / 2, -0.145])
  p.cyl(0.14, 0.14, 0.36, JOINT, [0, ARM.l1, 0], [0, 0, Math.PI / 2], 14)
  return p.build()
})

const foreGeo = lazy(() => {
  const p = new Parts()
  p.rbox(0.2, ARM.l2, 0.2, 0.05, ORANGE, [0, ARM.l2 / 2, 0])
  p.cyl(0.11, 0.11, 0.12, JOINT, [0, ARM.l2, 0], undefined, 12)
  p.rbox(0.3, 0.08, 0.16, 0.02, JOINT, [0, ARM.l2 + 0.1, 0])
  p.bar([0, ARM.l2 * 0.3, 0.11], [0, ARM.l2 * 0.85, 0.11], 0.02, '#1A1E1F', 6)
  return p.build()
})

const fingerGeo = lazy(() => {
  const p = new Parts()
  p.box(0.045, 0.24, 0.1, '#7D8A8C', [0, 0.12, 0])
  p.box(0.06, 0.05, 0.11, '#E9B63F', [0, 0.235, 0])
  return p.build()
})

const foamFrameGeo = lazy(() => {
  const p = new Parts()
  const R = FOAM_PILE.radius
  const wood = '#9A6B43'
  const h = 0.42
  for (const s of [-1, 1]) {
    p.box(R * 2, h, 0.08, wood, [0, h / 2, s * (R - 0.04)])
    p.box(0.08, h, R * 2, wood, [s * (R - 0.04), h / 2, 0])
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(0.12, h + 0.06, 0.12, '#664530', [sx * (R - 0.04), (h + 0.06) / 2, sz * (R - 0.04)])
  p.box(R * 2 - 0.1, 0.04, R * 2 - 0.1, '#3D4241', [0, 0.02, 0])
  return p.build()
})

const foamGeo = lazy(() => {
  const p = new Parts()
  const R = FOAM_PILE.radius - 0.12
  const colors = ['#F1E9C8', '#EFD98A', '#F3C9B5', '#CFE2E6', '#F1EEE6']
  let seed = 11
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2
    const r = Math.sqrt(rnd()) * (R - 0.15)
    const s = 0.16 + rnd() * 0.14
    const y = 0.25 + rnd() * 0.32 + (1 - r / R) * 0.18
    p.rbox(s * 1.3, s, s * 1.1, 0.05, colors[i % colors.length], [Math.cos(a) * r, y, Math.sin(a) * r], [rnd() * 0.6, rnd() * 3, rnd() * 0.6])
  }
  return p.build()
})

const foamSign = lazy(
  () =>
    new THREE.MeshStandardMaterial({
      map: labelTexture('npc-foam-sign', 256, 128, (ctx, w, h) => {
        ctx.fillStyle = '#E9B63F'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#1A1E1F'
        ctx.fillRect(6, 6, w - 12, h - 12)
        ctx.fillStyle = '#E9B63F'
        ctx.font = `700 34px ${LABEL_FONT}`
        ctx.textAlign = 'center'
        ctx.fillText('FOAM PIT', w / 2, 52)
        ctx.font = `700 22px ${LABEL_FONT}`
        ctx.fillText('LANDING ZONE · ROBOT USE ONLY', w / 2, 92)
      }),
      roughness: 0.6,
    }),
)

function RobotArm({ props, shadows }: { props: PropStates; shadows: boolean }) {
  const turret = useRef<THREE.Group>(null)
  const upper = useRef<THREE.Group>(null)
  const fore = useRef<THREE.Group>(null)
  const fL = useRef<THREE.Mesh>(null)
  const fR = useRef<THREE.Mesh>(null)
  const foam = useRef<THREE.Mesh>(null)
  const clock = useRef(0)
  const fade = useMemo(() => ({ cameraFade: true }), [])
  useFrame((_, dt) => {
    clock.current += Math.min(dt, 0.1)
    const a = props.armOverride ? props.arm : armIdle(props.armClock, props.armNow)
    if (!props.armOverride) Object.assign(props.arm, a)
    else Object.assign(props.armNow, a)
    if (turret.current) turret.current.rotation.y = a.turret
    if (upper.current) upper.current.rotation.x = -a.shoulder
    if (fore.current) fore.current.rotation.x = -a.elbow
    const open = 0.07 + (1 - a.grip) * 0.07
    if (fL.current) fL.current.position.x = -open
    if (fR.current) fR.current.position.x = open
    const f = foam.current
    if (f) {
      const sq = props.foamSquash
      const wob = Math.sin(clock.current * 18) * sq
      f.scale.set(1 + sq * 0.08 + wob * 0.03, 1 - sq * 0.28 - wob * 0.05, 1 + sq * 0.08 - wob * 0.03)
    }
  })
  return (
    <>
      <group position={[ROBOT_ARM.pos[0], 0, ROBOT_ARM.pos[1]]} name="npc-robot-arm">
        <mesh geometry={armBaseGeo()} material={paintedMat()} castShadow={shadows} receiveShadow />
        <group ref={turret} position={[0, ARM.pedestal, 0]}>
          <mesh geometry={turretGeo()} material={paintedMat()} castShadow={shadows} userData={fade} />
          <group ref={upper} position={[0, ARM.shoulderY - ARM.pedestal, 0]}>
            <mesh geometry={upperGeo()} material={paintedMat()} castShadow={shadows} userData={fade} />
            <group ref={fore} position={[0, ARM.l1, 0]}>
              <mesh geometry={foreGeo()} material={paintedMat()} castShadow={shadows} userData={fade} />
              <mesh ref={fL} geometry={fingerGeo()} material={metalMat()} position={[-0.1, ARM.l2 + 0.12, 0]} userData={fade} />
              <mesh ref={fR} geometry={fingerGeo()} material={metalMat()} position={[0.1, ARM.l2 + 0.12, 0]} userData={fade} />
            </group>
          </group>
        </group>
      </group>
      <group position={[FOAM_PILE.pos[0], 0, FOAM_PILE.pos[1]]} name="npc-foam-pit">
        <mesh geometry={foamFrameGeo()} material={paintedMat()} castShadow={shadows} receiveShadow />
        <mesh ref={foam} geometry={foamGeo()} material={paintedMat()} castShadow={shadows} receiveShadow />
        <group position={[FOAM_PILE.radius + 0.25, 0, -FOAM_PILE.radius + 0.3]}>
          <mesh position={[0, 0.75, 0]} material={mats.steelDark()}>
            <cylinderGeometry args={[0.035, 0.035, 1.5, 8]} />
          </mesh>
          <mesh position={[0, 1.42, 0.04]} material={foamSign()}>
            <planeGeometry args={[0.7, 0.35]} />
          </mesh>
          <mesh position={[0, 1.42, 0.035]} rotation-y={Math.PI} material={mats.steelDark()}>
            <planeGeometry args={[0.72, 0.37]} />
          </mesh>
        </group>
      </group>
    </>
  )
}

// ===========================================================================
// Static colliders for every solid prop (jacks switch off while moving)
// ===========================================================================

function PropColliders({ props }: { props: PropStates }) {
  const ja = useRef<RapierCollider>(null)
  const jb = useRef<RapierCollider>(null)
  const state = useRef({ a: true, b: true })
  useFrame(() => {
    const s = state.current
    const want = (c: RapierCollider | null, moving: boolean, key: 'a' | 'b') => {
      if (!c || s[key] === !moving) return
      try {
        c.setEnabled(!moving)
        s[key] = !moving
      } catch {
        /* not ready */
      }
    }
    want(ja.current, props.jackA.moving, 'a')
    want(jb.current, props.jackB.moving, 'b')
  })
  const half = JACK_SIZE.length / 2
  const hw = JACK_SIZE.width / 2
  return (
    <RigidBody type="fixed" colliders={false} name="npc-props">
      <CuboidCollider args={[NAP_CONVEYOR.width / 2 + 0.1, NAP_CONVEYOR.height / 2 + 0.05, NAP_CONVEYOR.length / 2]} position={[NAP_CONVEYOR.pos[0], NAP_CONVEYOR.height / 2, NAP_CONVEYOR.pos[1]]} collisionGroups={GROUPS.static} />
      <CuboidCollider ref={ja} args={[half, 0.4, hw]} position={[JACK_A.pos[0], 0.4, JACK_A.pos[1]]} collisionGroups={GROUPS.static} />
      <CuboidCollider ref={jb} args={[half, 0.4, hw]} position={[JACK_B.pos[0], 0.4, JACK_B.pos[1]]} collisionGroups={GROUPS.static} />
      <CuboidCollider args={[0.5, 0.75, 0.62]} position={[KICK_MACHINE.pos[0], 0.75, KICK_MACHINE.pos[1]]} collisionGroups={GROUPS.static} />
      <CylinderCollider args={[0.55, VAT.radius + 0.04]} position={[VAT.pos[0], 0.55, VAT.pos[1]]} collisionGroups={GROUPS.static} />
      <CuboidCollider args={[0.36, 0.5, 0.48]} position={[PRINTER.pos[0] + 0.02, 0.5, PRINTER.pos[1]]} collisionGroups={GROUPS.static} />
      <CylinderCollider args={[0.55, 0.45]} position={[ROBOT_ARM.pos[0], 0.55, ROBOT_ARM.pos[1]]} collisionGroups={GROUPS.static} />
      <CuboidCollider args={[FOAM_PILE.radius, 0.24, FOAM_PILE.radius]} position={[FOAM_PILE.pos[0], 0.24, FOAM_PILE.pos[1]]} collisionGroups={GROUPS.static} />
    </RigidBody>
  )
}

// ===========================================================================

export function GagProps({ props, shadows, reduced }: { props: PropStates; shadows: boolean; reduced: boolean }) {
  return (
    <group name="npc-gag-props">
      <Jack state={props.jackA} shadows={shadows} />
      <Jack state={props.jackB} shadows={shadows} />
      <KickMachine props={props} shadows={shadows} reduced={reduced} />
      <Vat props={props} shadows={shadows} />
      <Printer props={props} shadows={shadows} reduced={reduced} />
      <RobotArm props={props} shadows={shadows} />
      <PropColliders props={props} />
    </group>
  )
}
