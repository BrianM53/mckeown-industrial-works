import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mats } from '@/world/materials'
import { CRATE_SIZE, type PropStates } from '../gagKit'
import { NAP_CONVEYOR } from '../propsData'
import { LABEL_FONT, Parts, labelTexture, metalMat, paintedMat } from './build'

/**
 * "PARTS RETURN" roller conveyor in the Maintenance Bay (the forklift driver's
 * favourite nap spot) and its crate. Rollers spin while the motor runs.
 */
const L = NAP_CONVEYOR.length
const W = NAP_CONVEYOR.width
const H = NAP_CONVEYOR.height
const ROLLERS = 18
const ROLLER_R = 0.043

let frameGeo: THREE.BufferGeometry | null = null
let steelGeo: THREE.BufferGeometry | null = null
let rollerGeo: THREE.BufferGeometry | null = null
let crateGeo: THREE.BufferGeometry | null = null

function buildFrame(): THREE.BufferGeometry {
  if (frameGeo) return frameGeo
  const p = new Parts()
  const rail = '#D9A532'
  // side rails (C-channel look: web + lips)
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - 0.035)
    p.box(0.05, 0.15, L, rail, [x, H - 0.045, 0])
    p.box(0.09, 0.02, L, rail, [x - sx * 0.02, H + 0.03, 0])
    p.box(0.09, 0.02, L, rail, [x - sx * 0.02, H - 0.12, 0])
  }
  // motor housing (south end, east side) + control box
  p.rbox(0.28, 0.28, 0.4, 0.04, '#E57D35', [W / 2 + 0.16, H - 0.12, L / 2 - 0.42])
  p.cyl(0.11, 0.11, 0.2, '#465356', [W / 2 + 0.16, H - 0.12, L / 2 - 0.12], [Math.PI / 2, 0, 0])
  p.rbox(0.16, 0.24, 0.14, 0.02, '#2F3536', [W / 2 + 0.16, H + 0.16, L / 2 - 0.45])
  p.box(0.05, 0.05, 0.02, '#C0392B', [W / 2 + 0.16, H + 0.17, L / 2 - 0.37])
  // end stop backing plate
  p.box(W + 0.06, 0.22, 0.05, '#2F3536', [0, H + 0.02, -L / 2 - 0.03])
  frameGeo = p.build()
  return frameGeo
}

function buildSteel(): THREE.BufferGeometry {
  if (steelGeo) return steelGeo
  const p = new Parts()
  const leg = '#7D8A8C'
  const zs = [-L / 2 + 0.2, 0, L / 2 - 0.2]
  for (const z of zs) {
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 - 0.05)
      p.box(0.055, H - 0.12, 0.055, leg, [x, (H - 0.12) / 2, z])
      p.box(0.14, 0.02, 0.14, '#465356', [x, 0.01, z])
    }
    p.box(W - 0.1, 0.045, 0.045, leg, [0, 0.24, z])
  }
  for (const sx of [-1, 1]) p.box(0.04, 0.04, L - 0.4, leg, [sx * (W / 2 - 0.05), 0.16, 0])
  steelGeo = p.build()
  return steelGeo
}

function buildRoller(): THREE.BufferGeometry {
  if (rollerGeo) return rollerGeo
  const p = new Parts()
  p.cyl(ROLLER_R, ROLLER_R, W - 0.12, '#B9C2C1', [0, 0, 0], [0, 0, Math.PI / 2], 12)
  // a dark band so the spin reads
  p.box(W - 0.14, 0.012, 0.022, '#3A4142', [0, ROLLER_R - 0.003, 0])
  rollerGeo = p.build()
  return rollerGeo
}

/** Crate geometry centered on its middle. */
function buildCrate(): THREE.BufferGeometry {
  if (crateGeo) return crateGeo
  const { w, h, d } = CRATE_SIZE
  const p = new Parts()
  const wood = '#A97A4B'
  const batten = '#6E4B2D'
  p.box(w - 0.02, h - 0.02, d - 0.02, wood, [0, 0, 0])
  const t = 0.05
  // edge battens
  for (const sy of [-1, 1])
    for (const sz of [-1, 1]) p.box(w, t, t, batten, [0, sy * (h / 2 - t / 2), sz * (d / 2 - t / 2)])
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) p.box(t, h, t, batten, [sx * (w / 2 - t / 2), 0, sz * (d / 2 - t / 2)])
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) p.box(t, t, d, batten, [sx * (w / 2 - t / 2), sy * (h / 2 - t / 2), 0])
  // diagonal braces on the long sides
  for (const sx of [-1, 1]) {
    const len = Math.hypot(h - 0.1, d - 0.1)
    p.box(0.03, len, 0.07, batten, [sx * (w / 2 + 0.005), 0, 0], [Math.atan2(d - 0.1, h - 0.1), 0, 0])
  }
  crateGeo = p.build()
  return crateGeo
}

function noRidingTexture(): THREE.Texture {
  return labelTexture('npc-no-riding', 512, 64, (ctx, w, h) => {
    ctx.fillStyle = '#E9B63F'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#1A1E1F'
    ctx.fillRect(0, 0, w, 5)
    ctx.fillRect(0, h - 5, w, 5)
    ctx.font = `700 40px ${LABEL_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('⚠ NO RIDING · NO NAPPING ON CONVEYOR', w / 2, h / 2 + 2)
  })
}

function thisSideUpTexture(): THREE.Texture {
  return labelTexture('npc-this-side-up', 256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(30,24,20,0.82)'
    ctx.font = `700 46px ${LABEL_FONT}`
    ctx.textAlign = 'center'
    ctx.fillText('THIS SIDE', w / 2, h * 0.68)
    ctx.fillText('UP', w / 2, h * 0.86)
    ctx.beginPath()
    ctx.moveTo(w / 2, h * 0.08)
    ctx.lineTo(w / 2 + 52, h * 0.42)
    ctx.lineTo(w / 2 + 18, h * 0.42)
    ctx.lineTo(w / 2 + 18, h * 0.52)
    ctx.lineTo(w / 2 - 18, h * 0.52)
    ctx.lineTo(w / 2 - 18, h * 0.42)
    ctx.lineTo(w / 2 - 52, h * 0.42)
    ctx.closePath()
    ctx.fill()
  })
}

let labelMat: THREE.MeshStandardMaterial | null = null
let decalMat: THREE.MeshStandardMaterial | null = null
function noRidingMat(): THREE.MeshStandardMaterial {
  labelMat ??= new THREE.MeshStandardMaterial({ map: noRidingTexture(), roughness: 0.6, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2 })
  return labelMat
}
function sideUpMat(): THREE.MeshStandardMaterial {
  decalMat ??= new THREE.MeshStandardMaterial({
    map: thisSideUpTexture(),
    transparent: true,
    roughness: 0.9,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  })
  return decalMat
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3(1, 1, 1)

export function ConveyorProp({ props, shadows }: { props: PropStates; shadows: boolean }) {
  const rollers = useRef<THREE.InstancedMesh>(null)
  const lamp = useRef<THREE.Mesh>(null)
  const spin = useRef(0)
  const ready = useRef(false)
  const zs = useMemo(() => Array.from({ length: ROLLERS }, (_, i) => -L / 2 + 0.12 + (i * (L - 0.24)) / (ROLLERS - 1)), [])

  useFrame((_, dt) => {
    const run = props.conveyorRun
    const im = rollers.current
    if (im && (run > 0.001 || !ready.current)) {
      ready.current = true
      // rollers turn "toward north" (top surface moves -z) at ~0.25 m/s
      spin.current -= (Math.min(dt, 0.1) * run * 0.25) / ROLLER_R
      _e.set(spin.current, 0, 0)
      _q.setFromEuler(_e)
      for (let i = 0; i < ROLLERS; i++) {
        _p.set(0, H - ROLLER_R, zs[i])
        im.setMatrixAt(i, _m.compose(_p, _q, _s))
      }
      im.instanceMatrix.needsUpdate = true
    }
    if (lamp.current) lamp.current.material = run > 0.05 ? mats.emissiveGreen() : mats.steelDark()
  })

  return (
    <group position={[NAP_CONVEYOR.pos[0], 0, NAP_CONVEYOR.pos[1]]} name="npc-nap-conveyor">
      <mesh geometry={buildFrame()} material={paintedMat()} castShadow={shadows} receiveShadow />
      <mesh geometry={buildSteel()} material={metalMat()} castShadow={shadows} />
      <instancedMesh ref={rollers} args={[buildRoller(), metalMat(), ROLLERS]} castShadow={false} receiveShadow />
      <mesh ref={lamp} position={[W / 2 + 0.16, H + 0.31, L / 2 - 0.45]} material={mats.steelDark()}>
        <sphereGeometry args={[0.035, 10, 8]} />
      </mesh>
      {/* hazard bumper at the downstream end */}
      <mesh position={[0, H + 0.04, -L / 2 - 0.07]} material={mats.hazardStripes()} castShadow={shadows}>
        <boxGeometry args={[W + 0.08, 0.13, 0.06]} />
      </mesh>
      {/* stencil on the east rail (faces the bay door) */}
      <mesh position={[W / 2 + 0.002, H - 0.045, -0.35]} rotation={[0, Math.PI / 2, 0]} material={noRidingMat()}>
        <planeGeometry args={[1.9, 0.12]} />
      </mesh>
      <NapCrate props={props} shadows={shadows} />
    </group>
  )
}

/** The crate, positioned from props.napCrate (world-space center) relative to the conveyor group. */
function NapCrate({ props, shadows }: { props: PropStates; shadows: boolean }) {
  const g = useRef<THREE.Group>(null)
  const decal = sideUpMat()
  useFrame(() => {
    const grp = g.current
    if (!grp) return
    const c = props.napCrate
    grp.position.set(c.x - NAP_CONVEYOR.pos[0], c.y, c.z - NAP_CONVEYOR.pos[1])
    grp.rotation.set(c.rx, c.ry, c.rz, 'YXZ')
  })
  const { w, d } = CRATE_SIZE
  return (
    <group ref={g} name="npc-nap-crate">
      <mesh geometry={buildCrate()} material={paintedMat()} castShadow={shadows} receiveShadow />
      <mesh position={[w / 2 + 0.006, 0, 0]} rotation={[0, Math.PI / 2, 0]} material={decal}>
        <planeGeometry args={[d * 0.62, CRATE_SIZE.h * 0.85]} />
      </mesh>
      <mesh position={[-w / 2 - 0.006, 0, 0]} rotation={[0, -Math.PI / 2, 0]} material={decal}>
        <planeGeometry args={[d * 0.62, CRATE_SIZE.h * 0.85]} />
      </mesh>
    </group>
  )
}
