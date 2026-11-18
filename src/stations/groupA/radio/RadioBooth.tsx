import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { audio } from '@/audio/api'
import { simClock } from '@/core/clock'
import { registerDebug } from '@/core/debug'
import { events } from '@/core/events'
import { useInteractable } from '@/core/interaction'
import { runtime } from '@/core/runtime'
import { useSettings } from '@/state/settings'
import { useUIStore } from '@/state/ui'
import { ANCHORS, ZONES } from '@/world/layout'
import { Builder } from '../lib/builder'
import { type Atlas, canvasTexture, makeCanvas } from '../lib/canvas'
import { C } from '../lib/materials'
import { BuiltMeshes, StaticColliders, useBuilt, type BoxCol } from '../lib/react'
import { drawOnAir } from './art'
import { dialFraction, dialMhz, eqLevel, onAirTarget, stepLight } from './onAir'

/**
 * BROADCAST BOOTH — Code Story (zone 'radio').
 * Broadcast desk with a sloped 16-channel mixer (moving faders), hutch with a
 * sweeping tuning dial, VU meters and studio monitors, a boom mic reaching
 * toward the visitor, a wall equalizer (instanced LED segments), a glowing
 * ON AIR box (lit while the Code Story panel is open and during periodic live
 * segments), the framed episode poster (real title from content) and a
 * station-jingle cart machine. The desk (ANCHORS.radioDesk) opens the Code
 * Story panel.
 */
const IN = ZONES.radio.building!.interior
const INTERACT = ANCHORS.radioDesk.interact as [number, number]
const DZ = ANCHORS.radioDesk.position[1]
const DESK = { x0: 34.6, x1: 36.4, z0: DZ - 1.7, z1: DZ + 1.7, top: 0.76 }
const MIXER = { x0: 34.75, x1: 35.85, z0: DZ - 1.45, z1: DZ + 1.45, slope: 0.16 }
const HUTCH = { x0: 35.95, x1: 36.4, y1: 1.55 }
const DIAL = { x: HUTCH.x0 - 0.012, z: DZ, y: 1.2, w: 1.3, h: 0.365 }
const VU_Z = [DZ - 1.15, DZ + 1.15]
const SPK_Z = [DZ - 1.25, DZ + 1.25]
const EQ = { x: IN.maxX - 0.15, z0: DZ - 1.6, bars: 16, segs: 12, y0: 1.24, dz: 0.2, dy: 0.145 }
const ONAIR = { x: IN.maxX - 0.21, z: DZ, y: 3.65, w: 1.5, h: 0.6 }
const FLOOR_SPK_Z = [DZ - 2.25, DZ + 2.25]
const EASEL = { x: 34.75, z: 14.4, yaw: 0.5 }
const CART = { x: 34.95, z: 8.3 }
const JINGLE_INTERACT: [number, number] = [33.75, 8.25]
const JINGLE_COOLDOWN = 5
const JINGLE_VISUAL = 2.4

/** Mixer surface height at world x (rises away from the visitor). */
const mixerY = (x: number) => DESK.top + 0.05 + (x - MIXER.x0) * Math.tan(MIXER.slope)

function buildBooth(cells: Record<string, { uv: [number, number, number, number] }>): Builder {
  const b = new Builder()
  const uv = (k: string) => cells[k]?.uv ?? null
  const faceW = -Math.PI / 2 // planes facing west (-X)
  const faceE = Math.PI / 2
  // ---- desk -----------------------------------------------------------------
  b.rbox('paint', [(DESK.x0 + DESK.x1) / 2, DESK.top / 2, DZ], [DESK.x1 - DESK.x0, DESK.top, DESK.z1 - DESK.z0], 0.04, C.woodDark)
  b.box('paint', [(DESK.x0 + DESK.x1) / 2 - 0.02, DESK.top + 0.02, DZ], [DESK.x1 - DESK.x0 + 0.1, 0.04, DESK.z1 - DESK.z0 + 0.08], '#2a2f31')
  b.box('paint', [DESK.x0 - 0.01, 0.62, DZ], [0.02, 0.1, DESK.z1 - DESK.z0 - 0.1], '#C8553D')
  b.plane('atlas', [DESK.x0 - 0.025, 0.4, DZ], 2.8, 0.32, '#ffffff', [0, faceW, 0], uv('plate'))
  // sloped mixer: housing + textured surface + knob caps
  const mz = (MIXER.z0 + MIXER.z1) / 2
  const mw = MIXER.z1 - MIXER.z0
  const mxc = (MIXER.x0 + MIXER.x1) / 2
  b.push([mxc, mixerY(mxc), mz], 0, 0, MIXER.slope)
  b.box('paint', [0, -0.04, 0], [MIXER.x1 - MIXER.x0 + 0.06, 0.08, mw + 0.06], '#1f2426')
  b.plane('atlas', [0, 0.002, 0], mw, MIXER.x1 - MIXER.x0, '#ffffff', [-Math.PI / 2, 0, -Math.PI / 2], uv('mixer'))
  for (let i = 0; i < 16; i++) {
    const z = -mw / 2 + (i + 0.5) * (mw / 16)
    for (let k = 0; k < 3; k++) {
      const x = (MIXER.x1 - MIXER.x0) / 2 - (0.12 + k * 0.13) * ((MIXER.x1 - MIXER.x0) / 1.0)
      b.cyl('paint', x, 0, z, 0.026, 0.035, ['#c8553d', '#e9b63f', '#d6dcd9'][k], 10)
    }
  }
  b.pop()
  // hutch with dial window, VU meters
  b.box('paint', [(HUTCH.x0 + HUTCH.x1) / 2, (DESK.top + HUTCH.y1) / 2, DZ], [HUTCH.x1 - HUTCH.x0, HUTCH.y1 - DESK.top, DESK.z1 - DESK.z0 - 0.2], C.woodDark)
  b.box('paint', [HUTCH.x0 - 0.01, HUTCH.y1 - 0.03, DZ], [0.02, 0.06, DESK.z1 - DESK.z0 - 0.2], '#C8553D')
  b.box('paint', [DIAL.x + 0.004, DIAL.y, DIAL.z], [0.012, DIAL.h + 0.08, DIAL.w + 0.08], C.brassDark)
  b.plane('atlas', [DIAL.x - 0.004, DIAL.y, DIAL.z], DIAL.w, DIAL.h, '#ffffff', [0, faceW, 0], uv('dial'))
  for (const z of VU_Z) {
    b.box('paint', [HUTCH.x0 + 0.004, 1.2, z], [0.012, 0.29, 0.43], '#1d2122')
    b.plane('atlas', [HUTCH.x0 - 0.006, 1.2, z], 0.36, 0.234, '#ffffff', [0, faceW, 0], uv('vu'))
  }
  // studio monitors on the hutch
  for (const z of SPK_Z) {
    b.rbox('paint', [HUTCH.x0 + 0.2, HUTCH.y1 + 0.28, z], [0.36, 0.56, 0.38], 0.03, '#1f2224')
    b.cylAxis('paint', [HUTCH.x0 + 0.015, HUTCH.y1 + 0.45, z], 'x', 0.05, 0.02, '#c8cfcc', 14)
    b.torus('paint', [HUTCH.x0 + 0.02, HUTCH.y1 + 0.2, z], 0.12, 0.018, '#3a3f42', 'x', Math.PI * 2, 0, 6, 18)
  }
  // mug + headphones hanging on the mic post
  b.cyl('paint', 36.18, HUTCH.y1, DZ, 0.05, 0.11, '#efe9dd', 12)
  // boom mic: clamp, post, two arm segments, springs, mic + pop filter
  const post: [number, number, number] = [DESK.x0 + 0.12, DESK.top + 0.04, DZ - 1.55]
  b.box('metal', [post[0], DESK.top + 0.02, post[2]], [0.1, 0.08, 0.1], C.charcoal)
  b.cyl('metal', post[0], post[1], post[2], 0.02, 0.5, C.chrome, 8)
  const j1: [number, number, number] = [post[0], post[1] + 0.5, post[2]]
  const j2: [number, number, number] = [post[0] - 0.32, j1[1] + 0.45, post[2] + 0.62]
  const mic: [number, number, number] = [DESK.x0 - 0.42, 1.66, DZ - 0.35]
  b.tube('metal', j1, j2, 0.016, C.charcoal, 6)
  b.tube('metal', [j1[0], j1[1] + 0.06, j1[2]], [j2[0], j2[1] + 0.06, j2[2]], 0.012, C.charcoal, 6)
  b.tube('metal', j2, [mic[0] + 0.05, mic[1] + 0.12, mic[2]], 0.016, C.charcoal, 6)
  b.sphere('metal', j1, 0.035, C.charcoal, 8, 6)
  b.sphere('metal', j2, 0.035, C.charcoal, 8, 6)
  b.tube('metal', [j1[0] + 0.04, j1[1] + 0.02, j1[2]], [j2[0] + 0.04, j2[1] + 0.02, j2[2]], 0.02, '#8d979a', 8)
  b.tube('paint', [mic[0] + 0.05, mic[1] + 0.12, mic[2]], [mic[0] + 0.02, mic[1] + 0.02, mic[2]], 0.012, C.charcoal, 6)
  b.tube('paint', [mic[0] + 0.12, mic[1] - 0.02, mic[2]], [mic[0] - 0.08, mic[1] - 0.02, mic[2]], 0.048, '#2a2e30', 14)
  b.sphere('metal', [mic[0] - 0.09, mic[1] - 0.02, mic[2]], 0.052, '#b9c0c2', 14, 10)
  b.cylAxis('dark', [mic[0] - 0.2, mic[1] - 0.03, mic[2]], 'x', 0.1, 0.012, '#141617', 20)
  b.torus('paint', [mic[0] - 0.2, mic[1] - 0.03, mic[2]], 0.1, 0.008, C.charcoal, 'x', Math.PI * 2, 0, 5, 20)
  // headphones hanging on the post
  b.torus('dark', [post[0] - 0.03, DESK.top + 0.42, post[2]], 0.09, 0.014, C.rubber, 'x', Math.PI, Math.PI, 5, 12)
  for (const dz of [-0.09, 0.09]) b.cylAxis('dark', [post[0] - 0.03, DESK.top + 0.33, post[2] + dz], 'z', 0.05, 0.04, C.rubber, 12)
  // ---- cart machine (station jingles) on a little rack --------------------------
  b.rbox('paint', [CART.x, 0.45, CART.z], [0.6, 0.9, 0.62], 0.03, '#2a2f31')
  b.plane('atlas', [CART.x - 0.305, 0.68, CART.z], 0.52, 0.16, '#ffffff', [0, faceW, 0], uv('cart'))
  b.rbox('paint', [CART.x, 0.99, CART.z], [0.52, 0.18, 0.54], 0.03, '#d9d0b8')
  b.box('paint', [CART.x - 0.27, 1.0, CART.z + 0.05], [0.03, 0.05, 0.3], '#141617')
  b.box('paint', [CART.x - 0.3, 1.0, CART.z + 0.05], [0.08, 0.035, 0.24], '#2a2e30')
  b.cyl('paint', CART.x + 0.08, 1.08, CART.z - 0.14, 0.085, 0.03, C.charcoal, 16)
  // ---- east wall: equalizer frame, ON AIR housing, call sign, floor speakers -----
  b.box('paint', [IN.maxX - 0.06, (EQ.y0 + EQ.y0 + EQ.segs * EQ.dy) / 2 - 0.07, DZ], [0.12, EQ.segs * EQ.dy + 0.22, EQ.bars * EQ.dz + 0.25], '#121516')
  b.box('paint', [IN.maxX - 0.1, ONAIR.y, ONAIR.z], [0.2, ONAIR.h + 0.12, ONAIR.w + 0.12], '#1b1f20')
  b.plane('atlas', [IN.maxX - 0.03, 4.48, DZ], 4.5, 0.45, '#ffffff', [0, faceW, 0], uv('callsign'))
  for (const z of FLOOR_SPK_Z) {
    b.rbox('paint', [IN.maxX - 0.32, 0.72, z], [0.5, 1.44, 0.62], 0.03, '#1c1f21')
    b.cylAxis('paint', [IN.maxX - 0.575, 1.22, z], 'x', 0.06, 0.02, '#c8cfcc', 14)
    for (const y of [0.42, 0.86]) b.torus('paint', [IN.maxX - 0.575, y, z], 0.2, 0.025, '#3a3f42', 'x', Math.PI * 2, 0, 6, 20)
  }
  // ---- easel with the framed episode poster ----------------------------------------
  b.push([EASEL.x, 0, EASEL.z], EASEL.yaw)
  for (const sx of [-1, 1]) b.tube('paint', [sx * 0.42, 0, -0.22], [sx * 0.16, 2.0, 0.1], 0.03, C.wood, 6)
  b.tube('paint', [0, 0, 0.62], [0, 1.9, 0.12], 0.03, C.wood, 6)
  b.box('paint', [0, 0.7, -0.13], [1.02, 0.05, 0.12], C.woodDark)
  b.push([0, 1.36, -0.06], 0, 0.1)
  b.box('paint', [0, 0, 0.02], [1.0, 1.3, 0.05], '#2a1d16')
  b.box('metal', [0, 0, -0.008], [0.94, 1.24, 0.012], C.brass)
  b.plane('atlas', [0, 0, -0.016], 0.9, 1.2, '#ffffff', [0, Math.PI, 0], uv('poster'))
  b.pop()
  b.pop()
  void faceE
  return b
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _c = new THREE.Color()
const _e = new THREE.Euler()
const X_AXIS = new THREE.Vector3(1, 0, 0)
const SEG_DARK = new THREE.Color('#1a1d1e')

function segColor(j: number, segs: number, out: THREE.Color): THREE.Color {
  const f = j / (segs - 1)
  return out.set(f > 0.82 ? '#ff4b3a' : f > 0.6 ? '#ffb23f' : '#6fe07a').multiplyScalar(1.7)
}

export const RADIO_BOXES: BoxCol[] = [
  // desk + hutch + monitors
  { c: [(DESK.x0 + DESK.x1) / 2, 0.95, DZ], h: [(DESK.x1 - DESK.x0) / 2 + 0.03, 0.95, (DESK.z1 - DESK.z0) / 2 + 0.03] },
  // cart machine rack
  { c: [CART.x, 0.55, CART.z], h: [0.31, 0.55, 0.32] },
  // floor speakers + equalizer wall
  { c: [IN.maxX - 0.32, 0.75, DZ], h: [0.3, 0.75, 2.6] },
  // easel (approximate footprint)
  { c: [EASEL.x - 0.09, 1.0, EASEL.z + 0.07], h: [0.4, 1.0, 0.48] },
]

export function RadioBooth({ shadows, atlas, atlasMat }: { shadows: boolean; atlas: Atlas; atlasMat: THREE.Material }) {
  const reduced = useSettings((s) => s.reducedMotion)
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced
  const meshes = useBuilt(() => buildBooth(atlas.cells), [atlas])

  const dyn = useMemo(() => {
    // ON AIR face: own texture + emissive material (brightness animated)
    const oc = makeCanvas(512, 200)
    drawOnAir(oc.getContext('2d')!, 512, 200)
    const onTex = canvasTexture(oc)
    const onMat = new THREE.MeshStandardMaterial({ map: onTex, emissiveMap: onTex, emissive: '#ffffff', emissiveIntensity: 0.05, roughness: 0.4, color: '#5a2a24' })
    const onGeo = new THREE.PlaneGeometry(ONAIR.w, ONAIR.h)
    // equalizer: instanced LED segments
    const segGeo = new THREE.BoxGeometry(0.03, EQ.dy * 0.72, EQ.dz * 0.8)
    const segMat = new THREE.MeshBasicMaterial({ color: '#ffffff' })
    const eq = new THREE.InstancedMesh(segGeo, segMat, EQ.bars * EQ.segs)
    for (let i = 0; i < EQ.bars; i++)
      for (let j = 0; j < EQ.segs; j++) {
        const k = i * EQ.segs + j
        _m.makeTranslation(EQ.x, EQ.y0 + j * EQ.dy, EQ.z0 + (i + 0.5) * EQ.dz)
        eq.setMatrixAt(k, _m)
        eq.setColorAt(k, SEG_DARK)
      }
    if (eq.instanceColor) eq.instanceColor.setUsage(THREE.DynamicDrawUsage)
    // faders (16) on the mixer
    const faderGeo = new THREE.BoxGeometry(0.05, 0.035, 0.07)
    const faderMat = new THREE.MeshStandardMaterial({ color: '#d9dcd6', roughness: 0.4, metalness: 0.3 })
    const faders = new THREE.InstancedMesh(faderGeo, faderMat, 16)
    faders.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    // woofer cones (2 per floor speaker + 1 per monitor) pulse
    const coneGeo = new THREE.CircleGeometry(1, 20).rotateY(-Math.PI / 2)
    const coneMat = new THREE.MeshStandardMaterial({ color: '#2b2f31', roughness: 0.7 })
    const cones = new THREE.InstancedMesh(coneGeo, coneMat, 6)
    cones.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    // dial + VU needles
    const needleGeo = new THREE.BoxGeometry(0.008, 1, 0.012).translate(0, 0.5, 0)
    const needleMat = new THREE.MeshBasicMaterial({ color: '#c8302a' })
    const needles = new THREE.InstancedMesh(needleGeo, needleMat, 3)
    needles.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    // jingle button
    const btnGeo = new THREE.CylinderGeometry(0.06, 0.065, 0.05, 16)
    const btnMat = new THREE.MeshStandardMaterial({ color: '#c8302a', emissive: '#ff3b2f', emissiveIntensity: 0.15, roughness: 0.4 })
    for (const m of [eq, faders, cones, needles]) m.frustumCulled = false
    return { onTex, onMat, onGeo, segGeo, segMat, eq, faderGeo, faderMat, faders, coneGeo, coneMat, cones, needleGeo, needleMat, needles, btnGeo, btnMat }
  }, [])
  useEffect(
    () => () => {
      const d = dyn
      for (const x of [d.onTex, d.onMat, d.onGeo, d.segGeo, d.segMat, d.faderGeo, d.faderMat, d.coneGeo, d.coneMat, d.needleGeo, d.needleMat, d.btnGeo, d.btnMat]) x.dispose()
      for (const m of [d.eq, d.faders, d.cones, d.needles]) m.dispose()
    },
    [dyn],
  )

  const st = useRef({ light: 0, tuned: 0, jingleUntil: -Infinity, cooldownUntil: -Infinity, fader: new Float32Array(16).fill(0.5), time: 0, energy: 0.35, init: false })
  const btnRef = useRef<THREE.Mesh>(null)

  const playJingle = () => {
    const s = st.current
    const now = simClock.t
    if (now < s.cooldownUntil) return
    s.jingleUntil = now + JINGLE_VISUAL
    s.cooldownUntil = now + JINGLE_COOLDOWN
    audio.play('radio-jingle', { position: [CART.x, 1.1, CART.z] })
    events.emit('caption', { text: '♪ Station jingle', kind: 'sound', duration: 3 })
    events.emit('achievement', { id: 'radio-jingle' })
  }

  useInteractable({
    id: 'station:codestory-desk',
    label: 'Code Story Interview',
    verb: 'Tune in',
    radius: 2.45,
    priority: 0.2,
    getPosition: () => ({ x: INTERACT[0], y: 0, z: INTERACT[1] }),
    onInteract: () => useUIStore.getState().openPanel('codestory'),
  })
  useInteractable({
    id: 'station:radio-jingle',
    label: 'Station jingle',
    verb: 'Play',
    radius: 1.35,
    priority: 0.1,
    getPosition: () => ({ x: JINGLE_INTERACT[0], y: 0, z: JINGLE_INTERACT[1] }),
    enabled: () => simClock.t >= st.current.cooldownUntil,
    onInteract: playJingle,
  })
  useEffect(
    () =>
      registerDebug('stationsA', {
        jingle: () => playJingle(),
        onAir: () => ({ light: st.current.light, tuned: st.current.tuned }),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useFrame((_, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 0), 0.1)
    const s = st.current
    const p = runtime.player.position
    const inside = runtime.world.interior === 'radio'
    const near = inside || Math.hypot(p.x - ZONES.radio.center[0], p.z - ZONES.radio.center[1]) < 30
    if (!near && s.init) return
    s.init = true
    const red = reducedRef.current
    s.time += dt
    const t = simClock.t
    const panelOpen = useUIStore.getState().panel?.id === 'codestory'
    const jingle = t < s.jingleUntil
    const on = onAirTarget({ t, panelOpen, jingleUntil: s.jingleUntil })
    s.light = stepLight(s.light, on, dt, red)
    s.tuned += ((on ? 1 : 0) - s.tuned) * (1 - Math.exp(-dt * 1.6))
    const targetEnergy = jingle ? 1 : on ? 0.85 : 0.32
    s.energy += (targetEnergy - s.energy) * (1 - Math.exp(-dt * 4))
    const energy = red ? Math.min(s.energy, 0.55) : s.energy
    const tm = red ? Math.floor(s.time * 4) / 4 : s.time

    // ON AIR box
    dyn.onMat.emissiveIntensity = 0.05 + s.light * 1.9
    dyn.onMat.color.setRGB(0.36 + 0.64 * s.light, 0.17 + 0.3 * s.light, 0.14 + 0.25 * s.light)

    // equalizer
    const eq = dyn.eq
    for (let i = 0; i < EQ.bars; i++) {
      const lvl = eqLevel(i, EQ.bars, tm, energy)
      const lit = Math.round(lvl * EQ.segs)
      for (let j = 0; j < EQ.segs; j++) eq.setColorAt(i * EQ.segs + j, j < lit ? segColor(j, EQ.segs, _c) : SEG_DARK)
    }
    if (eq.instanceColor) eq.instanceColor.needsUpdate = true

    // faders drift (more when live)
    const fd = dyn.faders
    const mw = MIXER.z1 - MIXER.z0
    for (let i = 0; i < 16; i++) {
      const target = 0.35 + 0.3 * Math.sin(tm * (0.25 + i * 0.07) + i * 1.9) * (0.4 + energy * 0.6)
      s.fader[i] += (target - s.fader[i]) * (1 - Math.exp(-dt * 2))
      // fader slots occupy the near (west) half of the mixer
      const x = MIXER.x0 + 0.06 + s.fader[i] * (MIXER.x1 - MIXER.x0) * 0.42
      _e.set(0, 0, MIXER.slope)
      _q.setFromEuler(_e)
      _m.compose(_p.set(x, mixerY(x) + 0.03, MIXER.z0 + (i + 0.5) * (mw / 16)), _q, _s.set(1, 1, 1))
      fd.setMatrixAt(i, _m)
    }
    fd.instanceMatrix.needsUpdate = true

    // speaker cones pulse with the bass
    const bass = eqLevel(0, EQ.bars, tm, energy)
    const pulse = red ? 1 : 1 + bass * 0.08
    const cones = dyn.cones
    let ci = 0
    for (const z of FLOOR_SPK_Z)
      for (const y of [0.42, 0.86]) {
        _m.compose(_p.set(IN.maxX - 0.58, y, z), _q.identity(), _s.set(1, 0.19 * pulse, 0.19 * pulse))
        cones.setMatrixAt(ci++, _m)
      }
    for (const z of SPK_Z) {
      _m.compose(_p.set(HUTCH.x0 + 0.013, HUTCH.y1 + 0.2, z), _q.identity(), _s.set(1, 0.11 * pulse, 0.11 * pulse))
      cones.setMatrixAt(ci++, _m)
    }
    cones.instanceMatrix.needsUpdate = true

    // dial needle sweeps (settles on 101.3 when tuned) + VU needles
    const nd = dyn.needles
    const f = dialFraction(dialMhz(tm, s.tuned))
    _m.compose(_p.set(DIAL.x - 0.012, DIAL.y - DIAL.h * 0.42, DIAL.z + (0.5 - (40 / 640 + f * (1 - 80 / 640))) * DIAL.w * -1), _q.identity(), _s.set(1, DIAL.h * 0.84, 1))
    nd.setMatrixAt(0, _m)
    for (let k = 0; k < 2; k++) {
      const lvl = eqLevel(k * 5 + 2, EQ.bars, tm, energy)
      const ang = (-0.55 + lvl * 1.1) * (k === 0 ? 1 : 1)
      _q.setFromAxisAngle(X_AXIS, ang)
      _m.compose(_p.set(HUTCH.x0 - 0.012, 1.2 - 0.1, VU_Z[k]), _q, _s.set(1, 0.17, 1))
      nd.setMatrixAt(1 + k, _m)
    }
    nd.instanceMatrix.needsUpdate = true

    // jingle button glows while the cart plays
    if (btnRef.current) {
      dyn.btnMat.emissiveIntensity = jingle ? (red ? 1.2 : 0.8 + 0.6 * Math.abs(Math.sin(s.time * 8))) : 0.15
      btnRef.current.position.y = 1.115 - (jingle && t - (s.jingleUntil - JINGLE_VISUAL) < 0.25 ? 0.02 : 0)
    }
  })

  return (
    <group name="broadcast-booth">
      <BuiltMeshes meshes={meshes} shadows={shadows} materialFor={(k) => (k === 'atlas' ? atlasMat : undefined)} />
      <mesh geometry={dyn.onGeo} material={dyn.onMat} position={[ONAIR.x, ONAIR.y, ONAIR.z]} rotation-y={-Math.PI / 2} />
      <primitive object={dyn.eq} />
      <primitive object={dyn.faders} />
      <primitive object={dyn.cones} />
      <primitive object={dyn.needles} />
      <mesh ref={btnRef} geometry={dyn.btnGeo} material={dyn.btnMat} position={[CART.x + 0.08, 1.115, CART.z - 0.14]} />
      <StaticColliders name="radio-colliders" boxes={RADIO_BOXES} />
    </group>
  )
}
