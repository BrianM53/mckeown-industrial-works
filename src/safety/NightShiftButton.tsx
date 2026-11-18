import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import * as THREE from 'three'
import { simClock } from '@/core/clock'
import { GROUPS } from '@/core/collision'
import { registerDebug } from '@/core/debug'
import { events } from '@/core/events'
import { useInteractable, type Interactable } from '@/core/interaction'
import { runtime } from '@/core/runtime'
import { useGameStore } from '@/state/game'
import { useSettings } from '@/state/settings'
import { director } from '@/systems/director'
import { mats, textures } from '@/world/materials'
import { PALETTE } from '@/world/palette'
import { setStatus, signArt, statusArt } from './art'
import { NIGHT, NIGHT_BUTTON } from './config'
import { easeOutCubic, partMatrix, PartBuilder, vertexColorMat, type V3 } from './geometry'
import { NightShiftFsm } from './nightShift'

/**
 * NIGHT SHIFT button at ANCHORS.nightShiftButton (west of the main aisle, facing
 * east): an oversized red mushroom button on a hazard-yellow pedestal under a
 * hinged, hazard-striped clear cover, with a "NIGHT SHIFT — DO NOT TEST" sign, a
 * status display and a lamp that blinks while it recharges.
 *
 * Owns the Night Shift FSM (sole writer of runtime.lighting) + its watchdog.
 */

// ---------------------------------------------------------------------------
// Geometry (local space, front = -Z; built once)
// ---------------------------------------------------------------------------

const HEAD_TILT = -0.32
const HEAD = partMatrix({ position: [0, 1.1, 0.02], rotation: [HEAD_TILT, 0, 0] })
/** Button center on the head's top face (head-local). */
const BUTTON_LOCAL: V3 = [0, 0.118, -0.04]
/** Cover hinge axis (head-local): along the back edge of the top face. */
const HINGE_LOCAL: V3 = [0, 0.099, 0.3]
const COVER_OPEN = 1.85

const rbox = (w: number, h: number, d: number, r = 0.035) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3))

function buildBody(): THREE.BufferGeometry {
  const b = new PartBuilder()
  // base plate + bolts
  b.add(rbox(0.9, 0.07, 0.76, 0.02), '#3A4244', { position: [0, 0.035, 0] })
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(new THREE.CylinderGeometry(0.028, 0.028, 0.024, 8), '#A4ABAB', { position: [0.38 * sx, 0.08, 0.31 * sz] })
  // hazard-yellow pedestal with a dark kick plate and a rear conduit
  b.add(rbox(0.64, 0.98, 0.5, 0.04), PALETTE.hazard, { position: [0, 0.07 + 0.49, 0] })
  b.add(rbox(0.68, 0.06, 0.54, 0.02), '#2A2F30', { position: [0, 0.1, 0] })
  b.add(new THREE.CylinderGeometry(0.045, 0.045, 0.9, 10), '#5A6466', { position: [0.21, 0.52, 0.28] })
  b.add(new THREE.TorusGeometry(0.12, 0.045, 8, 10, Math.PI / 2), '#5A6466', { position: [0.21, 0.07, 0.4], rotation: [0, Math.PI / 2, Math.PI] })
  // display bezel on the front
  b.add(rbox(0.48, 0.17, 0.03, 0.012), '#1B1D1E', { position: [0, 0.76, -0.255] })
  // tilted console head with the button bezel
  b.add(rbox(0.84, 0.19, 0.7, 0.035), '#2F3638', { parent: HEAD })
  b.add(new THREE.CylinderGeometry(0.255, 0.28, 0.04, 40), PALETTE.hazard, { parent: HEAD, position: [BUTTON_LOCAL[0], 0.105, BUTTON_LOCAL[2]] })
  b.add(new THREE.CylinderGeometry(0.195, 0.195, 0.045, 32), '#1B1D1E', { parent: HEAD, position: [BUTTON_LOCAL[0], 0.108, BUTTON_LOCAL[2]] })
  // cover hinge barrels
  for (const sx of [-1, 1]) {
    b.add(new THREE.CylinderGeometry(0.024, 0.024, 0.1, 10), '#9AA3A3', {
      parent: HEAD,
      position: [0.2 * sx, HINGE_LOCAL[1] + 0.013, HINGE_LOCAL[2] + 0.013],
      rotation: [0, 0, Math.PI / 2],
    })
  }
  // little engraved plate under the button: front edge of the head
  b.add(rbox(0.4, 0.055, 0.012, 0.006), '#C9C3B0', { parent: HEAD, position: [0, 0.0, -0.356] })
  return b.build()
}

/** Pedestal stripe band + painted floor frame (hazard stripes material, UVs tiled per meter). */
function buildStripes(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const tile = (g: THREE.BufferGeometry, u: number, v: number) => {
    const uv = g.getAttribute('uv') as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v)
    return g
  }
  const band = tile(new THREE.BoxGeometry(0.66, 0.16, 0.52), 2.3, 0.58)
  band.translate(0, 0.21, 0)
  parts.push(band)
  // floor frame 1.7 x 1.5 m, 0.1 m wide, at y 0.036 (above the environment's floor paint)
  const W = 1.8
  const D = 1.6
  const t = 0.1
  const strips: Array<[number, number, number, number]> = [
    [0, -D / 2 + t / 2, W, t],
    [0, D / 2 - t / 2, W, t],
    [-W / 2 + t / 2, 0, t, D - 2 * t],
    [W / 2 - t / 2, 0, t, D - 2 * t],
  ]
  for (const [x, z, w, d] of strips) {
    const g = tile(new THREE.PlaneGeometry(w, d), w / 0.32, d / 0.32)
    g.rotateX(-Math.PI / 2)
    g.translate(x, 0.036, z)
    parts.push(g)
  }
  // merge (same attributes: position/normal/uv, all indexed)
  const b = new PartBuilder()
  for (const p of parts) b.add(p, '#ffffff')
  return b.build()
}

function buildCap(): THREE.BufferGeometry {
  const b = new PartBuilder()
  b.add(new THREE.CylinderGeometry(0.135, 0.14, 0.065, 28), '#ffffff', { position: [0, 0.032, 0] })
  b.add(new THREE.SphereGeometry(0.235, 36, 14, 0, Math.PI * 2, 0, Math.PI / 2), '#ffffff', { position: [0, 0.056, 0], scale: [1, 0.5, 1] })
  b.add(new THREE.TorusGeometry(0.232, 0.014, 6, 36), '#ffffff', { position: [0, 0.057, 0], rotation: [Math.PI / 2, 0, 0] })
  return b.build()
}

/** Cover parts, relative to the hinge axis (the cover hangs toward -Z from it). */
function buildCoverFrame(): THREE.BufferGeometry {
  const b = new PartBuilder()
  const w = 0.6
  const d = 0.6
  const h = 0.25
  const t = 0.036
  const zc = -d / 2 - 0.01
  for (const y of [t / 2, h - t / 2]) {
    b.add(new THREE.BoxGeometry(w + t, t, t), '#ffffff', { position: [0, y, zc - d / 2] })
    b.add(new THREE.BoxGeometry(w + t, t, t), '#ffffff', { position: [0, y, zc + d / 2] })
    for (const sx of [-1, 1]) b.add(new THREE.BoxGeometry(t, t, d), '#ffffff', { position: [(w / 2) * sx, y, zc] })
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(new THREE.BoxGeometry(t, h, t), '#ffffff', { position: [(w / 2) * sx, h / 2, zc + (d / 2) * sz] })
  // lift tab
  b.add(new THREE.BoxGeometry(0.15, 0.05, 0.035), '#ffffff', { position: [0, h * 0.55, zc - d / 2 - 0.03] })
  return b.build()
}

const COVER_SHELL = (() => {
  const g = new THREE.BoxGeometry(0.59, 0.24, 0.59)
  g.translate(0, 0.125, -0.31)
  return g
})()

function buildSignFrame(): THREE.BufferGeometry {
  const b = new PartBuilder()
  for (const sx of [-1, 1]) b.add(new THREE.CylinderGeometry(0.035, 0.04, 2.5, 10), '#2E3436', { position: [0.5 * sx, 1.25, 0.46] })
  b.add(rbox(1.14, 0.74, 0.04, 0.015), '#2E3436', { position: [0, 2.04, 0.48] })
  b.add(new THREE.CylinderGeometry(0.07, 0.085, 0.07, 14), '#2A2F30', { position: [0, 2.445, 0.48] })
  return b.build()
}

const SIGN_FACE = (() => {
  const g = new THREE.PlaneGeometry(1.08, 0.675)
  g.rotateY(Math.PI)
  g.translate(0, 2.04, 0.458)
  return g
})()
const DISPLAY_FACE = (() => {
  const g = new THREE.PlaneGeometry(0.42, 0.105)
  g.rotateY(Math.PI)
  g.translate(0, 0.76, -0.2715)
  return g
})()
const LAMP_GEO = new THREE.SphereGeometry(0.07, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)

let geoCache: { body: THREE.BufferGeometry; stripes: THREE.BufferGeometry; cap: THREE.BufferGeometry; coverFrame: THREE.BufferGeometry; signFrame: THREE.BufferGeometry } | null = null
function geos() {
  if (!geoCache) geoCache = { body: buildBody(), stripes: buildStripes(), cap: buildCap(), coverFrame: buildCoverFrame(), signFrame: buildSignFrame() }
  return geoCache
}

// ---------------------------------------------------------------------------
// System: FSM + watchdog + debug
// ---------------------------------------------------------------------------

const round = (v: number) => Math.round(v * 100) / 100

function createNightShift(): NightShiftFsm {
  return new NightShiftFsm({
    now: () => simClock.t,
    emit: (name, payload) => events.emit(name, payload),
    director,
    lighting: runtime.lighting,
    setNightShift: (v) => useGameStore.getState().setNightShift(v),
    reducedMotion: () => !!useSettings.getState().reducedMotion,
  })
}

export function NightShiftSystem() {
  const [fsm] = useState(createNightShift)
  useEffect(() => {
    fsm.revive()
    const offs = [
      simClock.onTick(() => fsm.tick()),
      registerDebug('nightShift', {
        /** Start now (skips any remaining cooldown, bypasses director pacing). */
        start: () => {
          fsm.skipCooldown()
          return fsm.start({ force: true })
        },
        getState: () => ({
          phase: fsm.phase,
          level: round(runtime.lighting.level),
          emergency: round(runtime.lighting.emergency),
          cooldownRemaining: round(fsm.cooldownRemaining()),
        }),
        /** End the blackout immediately (normal cooldown follows). */
        restore: () => fsm.forceRestore(),
      }),
    ]
    // Wall-clock watchdog: keeps working when the sim clock / render loop stalls.
    const iv = window.setInterval(() => fsm.watchdog(), 500)
    return () => {
      for (const off of offs) off()
      window.clearInterval(iv)
      fsm.dispose()
    }
  }, [fsm])
  useFrame(() => {
    fsm.watchdog()
  })
  return <NightShiftButton fsm={fsm} />
}

// ---------------------------------------------------------------------------
// Visual + interaction
// ---------------------------------------------------------------------------

const READY = '#5DFF7A'
const AMBER = '#FFB23F'
const RED = '#FF3B2F'
const C_READY = new THREE.Color(READY)
const C_AMBER = new THREE.Color(AMBER)
const C_RED = new THREE.Color(RED)
const C_GLOW_ACTIVE = new THREE.Color('#FF3B26')
const C_GLOW_IDLE = new THREE.Color('#FF5A3A')
/** Pre-built status strings (no per-frame string building). */
const RECHARGE_TEXT = Array.from({ length: Math.ceil(NIGHT.cooldown + NIGHT.blackout + 2 * NIGHT.gentleFade) + 2 }, (_, i) => `RECHARGE ${i}s`)
/** Minimum seconds between two "still recharging" toasts. */
const DUD_TOAST_GAP = 3

/** Prompt label while the button cannot be pressed (the visitor still sees why). */
function busyLabel(fsm: NightShiftFsm): string {
  if (fsm.isActive()) return `${NIGHT_BUTTON.label} (lights out)`
  return `${NIGHT_BUTTON.label} (recharging, ${Math.ceil(fsm.cooldownRemaining())} s)`
}

function NightShiftButton({ fsm }: { fsm: NightShiftFsm }) {
  const anchor = NIGHT_BUTTON.anchor
  const quality = useGameStore((s) => s.quality)
  const shadows = quality !== 'low'
  const g = geos()

  const capRef = useRef<THREE.Group>(null)
  const coverRef = useRef<THREE.Group>(null)
  const glowRef = useRef<THREE.Sprite>(null)
  const signRef = useRef<THREE.Group>(null)
  const press = useRef({ t: -1, dud: -1, lastDudToast: -Infinity })
  const clock = useRef(0)

  const own = useMemo(() => {
    const button = new THREE.MeshStandardMaterial({ color: '#D3271B', emissive: '#FF2A1C', emissiveIntensity: 0.5, roughness: 0.26, metalness: 0.05 })
    button.name = 'safety-night-button'
    const lamp = new THREE.MeshStandardMaterial({ color: '#1f2a22', emissive: READY, emissiveIntensity: 1.6, roughness: 0.3 })
    lamp.name = 'safety-night-lamp'
    const sign = signArt()
    const signMat = new THREE.MeshStandardMaterial({
      map: sign?.texture ?? null,
      color: sign ? '#ffffff' : PALETTE.hazard,
      roughness: 0.75,
      metalness: 0.05,
      emissive: '#ffffff',
      emissiveMap: sign?.texture ?? null,
      emissiveIntensity: sign ? 0.12 : 0,
    })
    signMat.name = 'safety-night-sign'
    const status = statusArt()
    const display = new THREE.MeshBasicMaterial({ map: status?.texture ?? null, color: status ? '#ffffff' : '#0b0f0f', toneMapped: false })
    display.name = 'safety-night-display'
    const glow = new THREE.SpriteMaterial({
      map: textures.glowDot(),
      color: '#FF3B26',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    glow.name = 'safety-night-glow'
    return { button, lamp, signMat, display, glow }
  }, [])
  useEffect(
    () => () => {
      own.button.dispose()
      own.lamp.dispose()
      own.signMat.dispose()
      own.display.dispose()
      own.glow.dispose()
    },
    [own],
  )
  useEffect(() => {
    const s = signRef.current
    if (s) s.userData.cameraFade = true
  }, [])

  // E-interaction: "Press — Night Shift button" (enabled() false while running / recharging).
  const def = useMemo<Interactable>(
    () => ({
      id: 'safety:night-shift-button',
      verb: NIGHT_BUTTON.verb,
      get label() {
        return fsm.phase === 'idle' ? NIGHT_BUTTON.label : busyLabel(fsm)
      },
      radius: 2.4,
      priority: 1,
      getPosition: () => ({ x: anchor.interact[0], y: 0, z: anchor.interact[1] }),
      enabled: () => fsm.canStart(),
      onInteract: () => {
        if (!fsm.canStart()) return
        press.current.t = 0
        press.current.dud = -1
        events.emit('sfx', { name: 'big-button', position: [anchor.position[0], 1.1, anchor.position[1]] })
        if (!fsm.start()) events.emit('toast', { text: NIGHT_BUTTON.jammedToast, kind: 'info', duration: 4 })
      },
    }),
    [fsm, anchor],
  )
  useInteractable(def)
  // Disabled targets get no prompt, so while the button is unavailable a status
  // stand-in takes its place: the prompt shows the remaining recharge seconds and
  // pressing it only rattles the locked cover.
  const busyDef = useMemo<Interactable>(
    () => ({
      id: 'safety:night-shift-button:busy',
      verb: NIGHT_BUTTON.verb,
      get label() {
        return busyLabel(fsm)
      },
      radius: 2.4,
      priority: 1,
      getPosition: () => ({ x: anchor.interact[0], y: 0, z: anchor.interact[1] }),
      enabled: () => fsm.phase !== 'idle',
      onInteract: () => {
        const pr = press.current
        if (pr.t < 0) pr.dud = 0
        const now = clock.current
        if (now - pr.lastDudToast < DUD_TOAST_GAP) return
        pr.lastDudToast = now
        const text = fsm.isActive() ? NIGHT_BUTTON.busyToast : NIGHT_BUTTON.rechargeToast(Math.ceil(fsm.cooldownRemaining()))
        events.emit('toast', { text, kind: 'info', duration: 3.5 })
      },
    }),
    [fsm, anchor],
  )
  useInteractable(busyDef)

  useFrame((_, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 0), 0.1)
    clock.current += dt
    const t = clock.current
    const reduced = useSettings.getState().reducedMotion
    const phase = fsm.phase
    const active = fsm.isActive()

    // press animation: cover flips open, button goes down, cover drops back
    const pr = press.current
    let open = 0
    let down = 0
    if (pr.t >= 0) {
      pr.t += dt
      const T = pr.t
      open = T < 0.22 ? easeOutCubic(T / 0.22) : T < 1.35 ? 1 : T < 1.6 ? 1 - ((T - 1.35) / 0.25) ** 2 : 0
      down = T > 0.18 && T < 0.5 ? Math.sin(((T - 0.18) / 0.32) * Math.PI) : 0
      if (T >= 1.6) pr.t = -1
    } else if (pr.dud >= 0) {
      // locked: the cover only rattles on its hinge (a small nudge with reduced motion)
      pr.dud += dt
      const T = pr.dud
      open = T < 0.42 ? Math.abs(Math.sin((T / 0.42) * Math.PI * (reduced ? 1 : 3))) * (reduced ? 0.05 : 0.11) * (1 - T / 0.42) : 0
      if (T >= 0.42) pr.dud = -1
    }
    if (coverRef.current) coverRef.current.rotation.x = open * COVER_OPEN
    if (capRef.current) capRef.current.position.y = BUTTON_LOCAL[1] - down * 0.04

    // button lamp + status display + lamp on the sign
    let capGlow: number
    if (active) {
      capGlow = 2.3
      setStatus('LIGHTS OUT', RED)
      own.lamp.emissive.copy(C_RED)
      own.lamp.emissiveIntensity = reduced ? 2 : 1.2 + 1.2 * Math.max(0, Math.sin(t * 5))
    } else if (phase === 'cooldown') {
      const blink = reduced ? 0.55 + 0.45 * Math.sin(t * 2.2) : Math.sin(t * Math.PI * 2) > 0 ? 1 : 0.08
      capGlow = 0.2 + 1.6 * blink
      const s = Math.min(RECHARGE_TEXT.length - 1, Math.max(0, Math.ceil(fsm.cooldownRemaining())))
      setStatus(RECHARGE_TEXT[s], AMBER)
      own.lamp.emissive.copy(C_AMBER)
      own.lamp.emissiveIntensity = 0.3 + 1.8 * blink
    } else {
      capGlow = reduced ? 0.75 : 0.6 + 0.3 * Math.sin(t * 2.4)
      setStatus('READY', READY)
      own.lamp.emissive.copy(C_READY)
      own.lamp.emissiveIntensity = 1.6
    }
    own.button.emissiveIntensity = capGlow
    // halo: strongest in the dark
    const dark = 1 - Math.min(1, Math.max(0, runtime.lighting.level))
    const halo = Math.min(1, capGlow / 2.3) * (0.18 + 0.82 * dark)
    own.glow.opacity = halo * 0.85
    if (glowRef.current) {
      glowRef.current.visible = halo > 0.02
      const s = 0.9 + 0.5 * dark
      glowRef.current.scale.set(s, s, s)
    }
    own.glow.color.copy(active ? C_GLOW_ACTIVE : C_GLOW_IDLE)
  })

  const capPos = useMemo<V3>(() => [BUTTON_LOCAL[0], BUTTON_LOCAL[1], BUTTON_LOCAL[2]], [])
  const glowPos = useMemo(() => {
    const v = new THREE.Vector3(BUTTON_LOCAL[0], BUTTON_LOCAL[1] + 0.12, BUTTON_LOCAL[2]).applyMatrix4(HEAD)
    return [v.x, v.y, v.z] as V3
  }, [])

  return (
    <group name="safety-night-shift" position={[anchor.position[0], 0, anchor.position[1]]} rotation={[0, anchor.yaw, 0]}>
      <mesh geometry={g.body} material={vertexColorMat(0.55, 0.3)} castShadow={shadows} receiveShadow />
      <mesh geometry={g.stripes} material={mats.hazardStripes()} castShadow={false} receiveShadow />
      <mesh geometry={DISPLAY_FACE} material={own.display} />
      {/* the tilted console head carries the button and the hinged cover */}
      <group matrixAutoUpdate={false} matrix={HEAD}>
        <group ref={capRef} position={capPos}>
          <mesh geometry={g.cap} material={own.button} castShadow={shadows} />
        </group>
        <group position={HINGE_LOCAL}>
          <group ref={coverRef}>
            <mesh geometry={g.coverFrame} material={mats.hazardStripes()} castShadow={shadows} />
            <mesh geometry={COVER_SHELL} material={mats.glass()} renderOrder={3} />
          </group>
        </group>
      </group>
      <sprite ref={glowRef} material={own.glow} position={glowPos} renderOrder={6} />
      <group ref={signRef} name="night-shift-sign">
        <mesh geometry={g.signFrame} material={vertexColorMat(0.55, 0.3)} castShadow={shadows} />
        <mesh geometry={SIGN_FACE} material={own.signMat} />
        <mesh geometry={LAMP_GEO} material={own.lamp} position={[0, 2.48, 0.48]} />
      </group>
      <ButtonCollider />
    </group>
  )
}

/** Pedestal + sign posts footprint (static: blocks bodies and the camera boom). */
const ButtonCollider = memo(function ButtonCollider() {
  return (
    <RigidBody type="fixed" colliders={false} name="safety-night-shift-body">
      <CuboidCollider args={[0.47, 0.66, 0.52]} position={[0, 0.66, 0]} collisionGroups={GROUPS.static} />
    </RigidBody>
  )
})
