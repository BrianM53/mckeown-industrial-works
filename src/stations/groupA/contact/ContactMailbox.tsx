import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { audio } from '@/audio/api'
import { registerDebug } from '@/core/debug'
import { useInteractable } from '@/core/interaction'
import { runtime } from '@/core/runtime'
import { useSettings } from '@/state/settings'
import { useUIStore } from '@/state/ui'
import { ANCHORS, ZONES } from '@/world/layout'
import { Builder, type V3 } from '../lib/builder'
import { type AtlasItem, buildAtlas, fitText, font, hazardBand, rivets, roundRect, type Ctx } from '../lib/canvas'
import { C } from '../lib/materials'
import { BuiltMeshes, StaticColliders, useBuilt, type BoxCol } from '../lib/react'
import { TUBE_ENTRY } from '../personnel/OfficeDressing'
import { capsuleAt, polyLength, SEND_TIMING } from './tubeRoute'

/**
 * CONTACT MAILBOX (ANCHORS.contactMailbox, intake plaza, facing west):
 * a brass-and-enamel pneumatic post station. "Send" opens the contact panel
 * immediately while a brass capsule whooshes up the glass tube, along the
 * overhead line and into the Personnel Office wall. Header sign:
 * CONTACT · HIRE · SAY HELLO.
 */
const [MX, MZ] = ANCHORS.contactMailbox.position as [number, number]
const INTERACT = ANCHORS.contactMailbox.interact as [number, number]
const FRONT_X = MX - 0.2 // cabinet front face (faces -X)
const BACK_X = MX + 0.3
const HALF_W = 0.35
const TUBE_X = MX + 0.15
const RUN_Y = TUBE_ENTRY.y
const WALL_Z = ZONES.personnel.building!.footprint.maxZ // outer face of the office's south wall

/** Capsule route: inside the cabinet → up the riser → east along the overhead run → into the office wall. */
export const CAPSULE_PATH: V3[] = [
  [MX - 0.02, 1.02, MZ],
  [TUBE_X, 1.55, MZ],
  [TUBE_X, RUN_Y, MZ],
  [TUBE_ENTRY.x, RUN_Y, MZ],
  [TUBE_ENTRY.x, RUN_Y, WALL_Z + 0.05],
]

function drawHeader(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#20302b'
  roundRect(ctx, 0, 0, w, h, 16)
  ctx.fill()
  ctx.strokeStyle = '#d7b45a'
  ctx.lineWidth = 8
  roundRect(ctx, 9, 9, w - 18, h - 18, 10)
  ctx.stroke()
  fitText(ctx, 'CONTACT · HIRE', w / 2, h * 0.36, w - 80, h * 0.33, { color: '#f4ecd6', tracking: 0.05 })
  fitText(ctx, 'SAY HELLO', w / 2, h * 0.7, w - 120, h * 0.3, { color: '#E9B63F', tracking: 0.12 })
  // envelope glyph
  ctx.strokeStyle = '#E9B63F'
  ctx.lineWidth = 5
  for (const x of [52, w - 52]) {
    ctx.strokeRect(x - 26, h * 0.7 - 17, 52, 34)
    ctx.beginPath()
    ctx.moveTo(x - 26, h * 0.7 - 17)
    ctx.lineTo(x, h * 0.7 + 4)
    ctx.lineTo(x + 26, h * 0.7 - 17)
    ctx.stroke()
  }
  rivets(ctx, 0, 0, w, h, 22, 6, '#6b5520')
}

function drawPlaque(ctx: Ctx, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#ecd27e')
  g.addColorStop(1, '#94712a')
  ctx.fillStyle = g
  roundRect(ctx, 0, 0, w, h, 8)
  ctx.fill()
  fitText(ctx, 'PNEUMATIC POST', w / 2, h * 0.38, w - 30, h * 0.36, { color: '#2a2210', tracking: 0.06 })
  fitText(ctx, 'EXPRESS TO PERSONNEL · NO LIVE ANIMALS', w / 2, h * 0.74, w - 30, h * 0.18, { weight: 600, color: '#3d3015' })
}

function drawGauge(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#f2ecdc'
  ctx.beginPath()
  ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#c8302a'
  ctx.lineWidth = 8
  ctx.beginPath()
  ctx.arc(w / 2, h / 2, w * 0.36, Math.PI * 1.75, Math.PI * 2.25)
  ctx.stroke()
  ctx.strokeStyle = '#1f2324'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(w / 2, h / 2)
  ctx.lineTo(w * 0.78, h * 0.3)
  ctx.stroke()
  ctx.fillStyle = '#1f2324'
  ctx.font = font(h * 0.14, 700)
  ctx.textAlign = 'center'
  ctx.fillText('PSI', w / 2, h * 0.75)
}

function drawStripe(ctx: Ctx, w: number, h: number): void {
  hazardBand(ctx, 0, 0, w, h, '#E9B63F', '#1d2122', h * 0.8)
}

const ITEMS: AtlasItem[] = [
  { key: 'header', w: 640, h: 300, draw: drawHeader },
  { key: 'plaque', w: 320, h: 90, draw: drawPlaque },
  { key: 'gauge', w: 96, h: 96, draw: drawGauge },
  { key: 'stripe', w: 256, h: 32, draw: drawStripe },
]

function buildMailbox(cells: Record<string, { uv: [number, number, number, number] }>): Builder {
  const b = new Builder()
  const uv = (k: string) => cells[k]?.uv ?? null
  const ry = Math.PI / 2 // planes facing -X (west)
  const GREEN = '#2E4B40'
  // plinth + cabinet
  b.rbox('paint', [MX + 0.05, 0.07, MZ], [0.78, 0.14, 0.98], 0.03, '#8c8a80')
  b.plane('sign', [MX - 0.345, 0.07, MZ], 0.98, 0.1, '#ffffff', [0, -ry, 0], uv('stripe'))
  b.rbox('paint', [(FRONT_X + BACK_X) / 2, 0.85, MZ], [BACK_X - FRONT_X, 1.42, HALF_W * 2], 0.05, GREEN)
  // brass edge trim
  for (const sz of [-1, 1]) b.box('metal', [FRONT_X - 0.005, 0.85, MZ + sz * (HALF_W - 0.02)], [0.03, 1.4, 0.04], C.brass)
  b.box('metal', [FRONT_X - 0.005, 1.545, MZ], [0.03, 0.04, HALF_W * 2], C.brass)
  b.box('metal', [FRONT_X - 0.005, 0.18, MZ], [0.03, 0.06, HALF_W * 2], C.brass)
  // hatch: brass door, porthole, handle, hinges
  b.rbox('metal', [FRONT_X - 0.02, 1.02, MZ], [0.05, 0.56, 0.46], 0.03, C.brass)
  b.cylAxis('metal', [FRONT_X - 0.05, 1.07, MZ], 'x', 0.125, 0.03, C.brassDark, 20)
  b.cylAxis('glass', [FRONT_X - 0.066, 1.07, MZ], 'x', 0.1, 0.012, '#ffffff', 20)
  b.torus('metal', [FRONT_X - 0.07, 0.86, MZ + 0.12], 0.045, 0.012, C.chrome, 'x', Math.PI, Math.PI / 2, 6, 12)
  for (const y of [0.85, 1.2]) b.cylAxis('metal', [FRONT_X - 0.045, y, MZ - 0.24], 'y', 0.022, 0.1, C.chrome, 8)
  // lamp sockets
  for (const dz of [-0.12, 0.12]) b.cylAxis('paint', [FRONT_X - 0.02, 1.42, MZ + dz], 'x', 0.04, 0.03, C.charcoal, 12)
  // plaque
  b.plane('sign', [FRONT_X - 0.012, 0.52, MZ], 0.52, 0.15, '#ffffff', [0, -ry, 0], uv('plaque'))
  // header sign (facing west) on two brass stand-offs
  for (const dz of [-0.42, 0.42]) b.tube('metal', [MX - 0.05, 1.55, MZ + dz], [MX - 0.15, 1.66, MZ + dz], 0.025, C.brass, 8)
  b.rbox('paint', [MX - 0.16, 1.98, MZ], [0.06, 0.66, 1.36], 0.025, '#1a2421')
  b.plane('sign', [MX - 0.195, 1.98, MZ], 1.3, 0.61, '#ffffff', [0, -ry, 0], uv('header'))
  // glass riser + support post with clamps
  b.cyl('metal', TUBE_X, 1.55, MZ, 0.11, 0.08, C.brass, 16)
  b.tube('glass', [TUBE_X, 1.6, MZ], [TUBE_X, RUN_Y, MZ], 0.075, '#ffffff', 16, undefined, true)
  const POST_X = MX + 0.36
  b.cyl('paint', POST_X, 0.14, MZ, 0.06, RUN_Y + 0.35, C.gunmetal, 10)
  for (let y = 2.4; y < RUN_Y - 0.2; y += 0.75) {
    b.cyl('metal', TUBE_X, y, MZ, 0.092, 0.06, C.brass, 16)
    b.box('paint', [(TUBE_X + POST_X) / 2, y + 0.03, MZ], [POST_X - TUBE_X, 0.035, 0.05], C.charcoal)
  }
  // junction at the top: brass elbow + manifold + gauge
  b.sphere('metal', [TUBE_X, RUN_Y, MZ], 0.11, C.brass, 16, 12)
  b.rbox('metal', [POST_X, RUN_Y + 0.12, MZ], [0.22, 0.34, 0.3], 0.03, C.brassDark)
  b.cylAxis('metal', [POST_X - 0.12, RUN_Y + 0.16, MZ], 'x', 0.08, 0.03, C.brass, 16)
  b.plane('sign', [POST_X - 0.137, RUN_Y + 0.16, MZ], 0.13, 0.13, '#ffffff', [0, -ry, 0], uv('gauge'))
  return b
}

/** The thin overhead run (y ≈ 4.9): the camera fades it while it hides the worker instead of colliding with it. */
function buildOverhead(): Builder {
  const b = new Builder()
  const POST_X = MX + 0.36
  // overhead run east to the office + elbow + wall flange
  b.tube('glass', [TUBE_X + 0.1, RUN_Y, MZ], [TUBE_ENTRY.x - 0.1, RUN_Y, MZ], 0.075, '#ffffff', 16, undefined, true)
  for (let x = TUBE_X + 0.6; x < TUBE_ENTRY.x - 0.3; x += 0.7) b.cylAxis('metal', [x, RUN_Y, MZ], 'x', 0.092, 0.06, C.brass, 16)
  b.sphere('metal', [TUBE_ENTRY.x, RUN_Y, MZ], 0.11, C.brass, 16, 12)
  b.tube('metal', [TUBE_ENTRY.x, RUN_Y, MZ - 0.1], [TUBE_ENTRY.x, RUN_Y, WALL_Z + 0.02], 0.075, C.brass, 14)
  b.cylAxis('metal', [TUBE_ENTRY.x, RUN_Y, WALL_Z + 0.03], 'z', 0.13, 0.05, C.brassDark, 16)
  // companion conduit (grey) + wall bracket
  const CY = RUN_Y + 0.24
  b.tube('metal', [POST_X, CY, MZ], [TUBE_ENTRY.x + 0.35, CY, MZ], 0.035, '#8D979A', 8)
  b.sphere('metal', [TUBE_ENTRY.x + 0.35, CY, MZ], 0.045, '#8D979A', 8, 6)
  b.tube('metal', [TUBE_ENTRY.x + 0.35, CY, MZ], [TUBE_ENTRY.x + 0.35, CY, WALL_Z + 0.02], 0.035, '#8D979A', 8)
  const BX = TUBE_ENTRY.x - 0.55
  b.box('paint', [BX, RUN_Y - 0.11, (MZ + WALL_Z) / 2], [0.05, 0.05, MZ - WALL_Z + 0.08], C.charcoal)
  b.tube('paint', [BX, RUN_Y - 0.6, WALL_Z + 0.02], [BX, RUN_Y - 0.12, MZ - 0.2], 0.022, C.charcoal, 6)
  b.box('paint', [BX, RUN_Y - 0.3, WALL_Z + 0.03], [0.14, 0.7, 0.04], C.charcoal)
  return b
}

const LAMP_GEO = new THREE.SphereGeometry(0.032, 10, 8)
const CAPSULE_GEO = (() => {
  const g = new THREE.CylinderGeometry(0.06, 0.06, 0.22, 14)
  return g
})()
const BAND_GEO = new THREE.TorusGeometry(0.061, 0.012, 6, 16).rotateX(Math.PI / 2)
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

export const MAILBOX_BOXES: BoxCol[] = [
  // cabinet + sign + post (keeps the worker out of the riser)
  { c: [MX + 0.07, 1.15, MZ], h: [0.36, 1.15, HALF_W + 0.12] },
]

export function ContactMailbox({ shadows, atlasScale }: { shadows: boolean; atlasScale: number }) {
  const atlas = useMemo(() => buildAtlas(ITEMS, 1024, { scale: atlasScale, anisotropy: 8 }), [atlasScale])
  const signMat = useMemo(() => new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.55, metalness: 0.1 }), [atlas])
  useEffect(
    () => () => {
      atlas.texture.dispose()
      signMat.dispose()
    },
    [atlas, signMat],
  )
  const meshes = useBuilt(() => buildMailbox(atlas.cells), [atlas])
  const overhead = useBuilt(buildOverhead, [])
  const mats = useMemo(
    () => ({
      brass: new THREE.MeshStandardMaterial({ color: C.brass, roughness: 0.28, metalness: 0.9 }),
      felt: new THREE.MeshStandardMaterial({ color: '#7a1f1a', roughness: 0.9 }),
      ready: new THREE.MeshBasicMaterial({ color: new THREE.Color('#5dff7a').multiplyScalar(2.2) }),
      sent: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb23f').multiplyScalar(2.4) }),
      lever: new THREE.MeshStandardMaterial({ color: C.chrome, roughness: 0.3, metalness: 0.85 }),
      knob: new THREE.MeshStandardMaterial({ color: '#c8302a', roughness: 0.4 }),
    }),
    [],
  )
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])

  const reduced = useSettings((s) => s.reducedMotion)
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced
  const capsuleRef = useRef<THREE.Group>(null)
  const leverRef = useRef<THREE.Group>(null)
  const readyRef = useRef<THREE.Mesh>(null)
  const sentRef = useRef<THREE.Mesh>(null)
  const st = useRef({ running: false, t: 0, freeze: null as number | null, sent: 0 })
  const pathLen = useMemo(() => polyLength(CAPSULE_PATH), [])

  const send = () => {
    const s = st.current
    if (s.running) return
    s.running = true
    s.t = 0
    s.sent++
    audio.play('tube-whoosh', { position: [TUBE_X, 2.2, MZ] })
  }

  useInteractable({
    id: 'station:contact-mailbox',
    label: 'Contact Tube (Say Hello)',
    verb: 'Send',
    radius: 2.3,
    priority: 0.2,
    getPosition: () => ({ x: INTERACT[0], y: 0, z: INTERACT[1] }),
    onInteract: () => {
      send()
      useUIStore.getState().openPanel('contact')
    },
  })

  useEffect(() => {
    const s = st.current
    return registerDebug('stationsA', {
      send: () => send(),
      freezeSend: (t: number | null) => {
        s.freeze = typeof t === 'number' && Number.isFinite(t) ? t : null
      },
      sendState: () => ({ running: s.running, t: s.t, sent: s.sent }),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useFrame((_, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 0), 0.1)
    const s = st.current
    const p = runtime.player.position
    if (!s.running && Math.hypot(p.x - MX, p.z - MZ) > 45) return
    if (s.running) {
      s.t = s.freeze ?? s.t + dt
      if (s.t >= SEND_TIMING.total) s.running = false
    }
    const t = s.running ? s.t : SEND_TIMING.total + 10
    const cap = capsuleRef.current
    if (cap) {
      const c = capsuleAt(CAPSULE_PATH, pathLen, t, _a, _b)
      cap.visible = c.visible
      if (c.visible) {
        cap.position.copy(_a)
        cap.quaternion.setFromUnitVectors(UP, _b)
      }
    }
    if (leverRef.current) {
      const down = s.running && t < SEND_TIMING.leverUp ? Math.min(1, t / 0.12) : 0
      leverRef.current.rotation.z = -0.35 + down * 1.1
    }
    const blink = reducedRef.current ? true : Math.sin(t * 18) > -0.3
    if (sentRef.current) sentRef.current.visible = s.running && blink
    if (readyRef.current) readyRef.current.visible = !s.running
  })

  return (
    <group name="contact-mailbox">
      <BuiltMeshes meshes={meshes} shadows={shadows} materialFor={(k) => (k === 'sign' ? signMat : undefined)} />
      <BuiltMeshes meshes={overhead} shadows={shadows} cameraFade />
      <group ref={capsuleRef} position={CAPSULE_PATH[0]}>
        <mesh geometry={CAPSULE_GEO} material={mats.brass} />
        <mesh geometry={BAND_GEO} material={mats.felt} position={[0, 0.08, 0]} />
        <mesh geometry={BAND_GEO} material={mats.felt} position={[0, -0.08, 0]} />
      </group>
      <group ref={leverRef} position={[MX + 0.02, 1.18, MZ + HALF_W + 0.03]} rotation-z={-0.35}>
        <mesh geometry={LEVER_GEO} material={mats.lever} />
        <mesh geometry={KNOB_GEO} material={mats.knob} position={[0, 0.3, 0]} />
      </group>
      <mesh ref={readyRef} geometry={LAMP_GEO} material={mats.ready} position={[FRONT_X - 0.04, 1.42, MZ - 0.12]} />
      <mesh ref={sentRef} geometry={LAMP_GEO} material={mats.sent} position={[FRONT_X - 0.04, 1.42, MZ + 0.12]} visible={false} />
      <StaticColliders name="mailbox-colliders" boxes={MAILBOX_BOXES} />
    </group>
  )
}

const LEVER_GEO = new THREE.CylinderGeometry(0.018, 0.018, 0.3, 8).translate(0, 0.15, 0)
const KNOB_GEO = new THREE.SphereGeometry(0.045, 12, 8)
