import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getProject } from '@/content/projects'
import { simClock } from '@/core/clock'
import { events } from '@/core/events'
import { useInteractable } from '@/core/interaction'
import { yawToward } from '@/core/math'
import { useUIStore } from '@/state/ui'
import { ANCHORS, ZONES } from '@/world/layout'
import { PALETTE } from '@/world/palette'
import { DEFAULT_LOOK, getWorkerGeometry, type WorkerLook } from '@/world/WorkerModel'
import { Batch } from '../shared/batch'
import { BatchMeshes } from '../shared/BatchMeshes'
import { fitText, makeCanvasTexture, roundRectPath } from '../shared/canvas'
import { FONT_DISPLAY, FONT_MONO } from '../shared/fonts'
import { SCANNER } from './layout'
import { sampleSplats, scanState, type ScanState } from './splats'

/**
 * GAUSSIAN-SLAM SCANNER (spec §5.6): a turntable carries a miniature worker
 * figurine; a scan arm orbits it painting a red laser line; above it a cloud of
 * soft, colored, camera-facing splats (one instanced draw call, animated on the
 * GPU) reconstructs the figurine coarse-to-fine over ~20 s, holds, dissolves
 * and restarts. A monitor reads "RECONSTRUCTION nn%". Stylized: the real
 * project is linked from the panel (projects.ts).
 */
const PURPLE = ZONES.rnd.color
const scanOut: ScanState = { phase: 'scan', progress: 0, dissolve: 0, percent: 0 }
/** The monitor cart turns its screen toward the visitor's interaction spot. */
const MONITOR_YAW = yawToward({ x: SCANNER.monitor.x, z: SCANNER.monitor.z }, { x: ANCHORS.slamScanner.interact[0], z: ANCHORS.slamScanner.interact[1] })
const FIGURINE_SCALE = 0.26
export const MINI_LOOK: WorkerLook = { ...DEFAULT_LOOK, helmet: PALETTE.hazard, vest: PALETTE.safety, accessory: 'clipboard', face: 'mustache' }

// ---------------------------------------------------------------------------
// Splat material (instanced quads, additive)
// ---------------------------------------------------------------------------

const SPLAT_VERT = /* glsl */ `
  uniform float uProgress;
  uniform float uDissolve;
  uniform float uCycle;
  uniform float uTime;
  attribute vec3 aPos;
  attribute vec3 aNor;
  attribute vec3 aColor;
  attribute vec4 aSeed;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float age = (uProgress - aSeed.x) * uCycle;
    float on = step(0.0, age);
    float k = smoothstep(0.0, 1.6, age);
    vec3 p = aPos + aNor * (1.0 - k) * 0.22;
    p += aNor * uDissolve * (0.35 + aSeed.z);
    p.y += uDissolve * uDissolve * (0.9 + aSeed.y * 20.0);
    p.x += sin(uTime * 2.0 + aSeed.w * 7.0) * 0.012 * (1.0 - k);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float size = aSeed.y * mix(3.4, 1.0, k) * (1.0 + uDissolve * 1.2);
    float c = cos(aSeed.w);
    float s = sin(aSeed.w);
    vec2 q = position.xy * vec2(1.0 + aSeed.z * 1.6, 1.0);
    q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    mv.xy += q * size;
    gl_Position = projectionMatrix * mv;
    vUv = uv;
    vColor = aColor;
    vAlpha = on * mix(0.1, 0.9, k) * (1.0 - uDissolve);
  }`

const SPLAT_FRAG = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 d = vUv - 0.5;
    float g = exp(-dot(d, d) * 16.0);
    float a = g * vAlpha;
    if (a < 0.012) discard;
    gl_FragColor = vec4(vColor * a * 1.35 + vec3(0.02, 0.03, 0.06) * a, 1.0);
    #include <colorspace_fragment>
  }`

function makeSplatMesh(count: number) {
  const cloud = sampleSplats(getWorkerGeometry(MINI_LOOK), count, 4242)
  const base = new THREE.PlaneGeometry(1, 1)
  const geo = new THREE.InstancedBufferGeometry()
  geo.index = base.index
  geo.setAttribute('position', base.getAttribute('position'))
  geo.setAttribute('uv', base.getAttribute('uv'))
  geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(cloud.pos, 3))
  geo.setAttribute('aNor', new THREE.InstancedBufferAttribute(cloud.nor, 3))
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(cloud.color, 3))
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(cloud.seed, 4))
  geo.instanceCount = cloud.count
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 2.2)
  const mat = new THREE.ShaderMaterial({
    name: 'stations-b:splats',
    uniforms: { uProgress: { value: 0 }, uDissolve: { value: 0 }, uCycle: { value: SCANNER.cycle }, uTime: { value: 0 } },
    vertexShader: SPLAT_VERT,
    fragmentShader: SPLAT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.renderOrder = 4
  mesh.name = 'stations-b:splat-cloud'
  mesh.raycast = () => {}
  return { mesh, geo, mat, base, count: cloud.count }
}

// ---------------------------------------------------------------------------
// Laser fan (additive triangle from the scan head toward the turntable axis)
// ---------------------------------------------------------------------------

function laserGeometry(len: number, half: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -len, -half, 0, -len, half, 0], 3))
  g.setAttribute('aA', new THREE.Float32BufferAttribute([1, 0.35, 0.35], 1))
  g.setIndex([0, 1, 2])
  return g
}

function laserMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'stations-b:laser',
    uniforms: { uFlicker: { value: 1 } },
    vertexShader: 'attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uFlicker; varying float vA; void main(){ gl_FragColor = vec4(vec3(1.0, 0.12, 0.08) * vA * 0.55 * uFlicker, 1.0); }',
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  })
}

// ---------------------------------------------------------------------------
// Static scanner body (local frame: front faces -Z; yaw applied by the group)
// ---------------------------------------------------------------------------

function buildScannerStatic(): Map<string, THREE.BufferGeometry> {
  const b = new Batch()
  const { baseR, baseH, trackR } = SCANNER
  b.cyl('paint', 0, 0, 0, baseR + 0.08, 0.1, '#2a3033', 28)
  b.cyl('paint', 0, 0.1, 0, baseR, baseH - 0.1, '#353e42', 28)
  b.cyl('hazard', 0, 0.58, 0, baseR + 0.012, 0.09, '#ffffff', 28)
  b.cyl('paint', 0, 0.72, 0, baseR + 0.01, 0.05, PURPLE, 28)
  b.torus('metal', 0, baseH, 0, baseR - 0.03, 0.035, '#b8c0c2', [Math.PI / 2, 0, 0], 6, 32)
  // ring track for the scan arm + struts
  b.torus('metal', 0, 0.9, 0, trackR, 0.045, '#9aa3a5', [Math.PI / 2, 0, 0], 6, 40)
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3
    b.cylBetween('paint', [Math.sin(a) * trackR, 0, Math.cos(a) * trackR], [Math.sin(a) * trackR, 0.88, Math.cos(a) * trackR], 0.035, '#4a5458', 6)
    b.cylBetween('paint', [Math.sin(a) * (trackR - 0.02), 0.6, Math.cos(a) * (trackR - 0.02)], [Math.sin(a) * baseR, 0.6, Math.cos(a) * baseR], 0.025, '#4a5458', 6)
  }
  // front control panel
  b.groupR([0, 0.62, -baseR - 0.05], [-0.5, 0, 0], () => {
    b.box('paint', 0, 0, 0, 0.62, 0.3, 0.08, '#262c2f')
    const cols = ['#59ff86', '#ffc23f', '#ff4b3e', '#6fc8ff']
    for (let i = 0; i < 4; i++) b.box('glow', -0.21 + i * 0.14, 0.06, -0.045, 0.06, 0.04, 0.01, cols[i])
    b.box('paint', 0, -0.08, -0.045, 0.4, 0.06, 0.01, '#c9c3b0')
  })
  // overhead gantry with the hologram emitter
  for (const s of [-1, 1]) {
    const x = s * 1.38
    b.cyl('paint', x, 0, 0.62, 0.06, 3.62, '#3d4649', 10)
    b.box('paint', x, 0.05, 0.62, 0.36, 0.1, 0.36, '#2a3033')
  }
  b.box('paint', 0, 3.62, 0.62, 2.95, 0.16, 0.16, '#3d4649')
  b.cylBetween('metal', [0, 3.6, 0.62], [0, 3.42, 0], 0.03, '#9aa3a5', 6)
  b.torus('metal', 0, 3.38, 0, 0.42, 0.05, '#c3c9ca', [Math.PI / 2, 0, 0], 6, 28)
  b.torus('glow', 0, 3.33, 0, 0.36, 0.018, new THREE.Color('#9fd8ff').multiplyScalar(1.6), [Math.PI / 2, 0, 0], 4, 28)
  // hologram base ring (where the reconstruction stands)
  b.torus('glow', 0, SCANNER.holoY - 0.02, 0, 0.42, 0.012, new THREE.Color('#9fd8ff').multiplyScalar(1.3), [Math.PI / 2, 0, 0], 4, 32)
  // cable from the base to the monitor cart
  b.cylBetween('rubber', [0.5, 0.03, -0.62], [1.4, 0.03, -1.2], 0.03, '#1d1f20', 6)
  return b.build()
}

function buildTurntable(): Map<string, THREE.BufferGeometry> {
  const b = new Batch()
  b.cyl('metal', 0, 0, 0, 0.64, 0.05, '#c9ced0', 32)
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2
    b.box('paint', Math.sin(a) * 0.58, 0.052, Math.cos(a) * 0.58, 0.02, 0.006, 0.07, k % 6 === 0 ? PURPLE : '#3a4245', [0, a, 0])
  }
  b.cyl('paint', 0, 0.05, 0, 0.17, 0.04, '#2a3033', 20)
  return b.build()
}

function buildArm(): Map<string, THREE.BufferGeometry> {
  const b = new Batch()
  const r = SCANNER.trackR
  // carriage on the ring + post + head
  b.box('paint', 0, 0.94, r, 0.22, 0.12, 0.2, PALETTE.hazard)
  b.box('paint', 0, 1.45, r + 0.02, 0.07, 1.0, 0.07, '#e9b63f')
  b.box('paint', 0, 1.18, r - 0.06, 0.2, 0.16, 0.18, '#2a3033')
  b.box('glow', 0, 1.18, r - 0.155, 0.08, 0.05, 0.012, new THREE.Color('#ff3b2f').multiplyScalar(2))
  b.box('paint', 0, 1.96, r - 0.02, 0.16, 0.06, 0.16, '#2a3033')
  return b.build()
}

// ---------------------------------------------------------------------------
// Monitor (dynamic canvas)
// ---------------------------------------------------------------------------

function drawMonitor(ctx: CanvasRenderingContext2D, w: number, h: number, s: ScanState): void {
  ctx.fillStyle = '#071018'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#0f2230'
  ctx.fillRect(0, 0, w, 54)
  ctx.fillStyle = '#ff4b3e'
  ctx.beginPath()
  ctx.arc(28, 27, 9, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#cfe9ff'
  fitText(ctx, 'GAUSSIAN-SLAM · LIVE VIEW', 48, 28, w - 70, 30, FONT_DISPLAY, 700, 'left')
  ctx.fillStyle = '#7fc4ff'
  const label = s.phase === 'dissolve' ? 'RESETTING SCENE…' : 'RECONSTRUCTION'
  fitText(ctx, label, w / 2, 102, w - 60, 40, FONT_DISPLAY, 700)
  ctx.fillStyle = '#ffffff'
  ctx.font = `600 84px ${FONT_MONO}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = '#6fc8ff'
  ctx.shadowBlur = 14
  ctx.fillText(`${s.percent}%`, w / 2, 176)
  ctx.shadowBlur = 0
  // progress bar
  const bx = 36
  const bw = w - 72
  ctx.fillStyle = '#16303f'
  roundRectPath(ctx, bx, 232, bw, 26, 8)
  ctx.fill()
  ctx.fillStyle = s.phase === 'dissolve' ? '#ffb23f' : '#4fc3ff'
  roundRectPath(ctx, bx, 232, Math.max(10, bw * (s.phase === 'dissolve' ? 1 - s.dissolve : s.percent / 100)), 26, 8)
  ctx.fill()
  ctx.fillStyle = '#5f8aa3'
  fitText(ctx, 'STREAMED FRAMES → 3D GAUSSIANS', w / 2, 290, w - 60, 24, FONT_MONO, 600)
}

function useMonitor() {
  return useMemo(() => {
    const c = makeCanvasTexture(512, 320)
    drawMonitor(c.ctx, 512, 320, scanState(0, SCANNER.cycle, SCANNER.hold, SCANNER.dissolve))
    c.texture.needsUpdate = true
    const mat = new THREE.MeshBasicMaterial({ map: c.texture, toneMapped: false })
    mat.name = 'stations-b:slam-monitor'
    const geo = new THREE.PlaneGeometry(0.82, 0.51)
    return { ...c, mat, geo }
  }, [])
}

function buildMonitorCart(): Map<string, THREE.BufferGeometry> {
  const b = new Batch()
  b.boxB('paint', 0, 0.1, 0, 0.7, 0.05, 0.5, '#3a4245')
  for (const x of [-0.3, 0.3]) for (const z of [-0.2, 0.2]) b.cyl('rubber', x, 0, z, 0.05, 0.1, '#1d1f20', 8)
  b.cyl('metal', 0, 0.15, 0.1, 0.035, 1.05, '#9aa3a5', 8)
  b.boxB('paint', 0, 0.62, 0.0, 0.5, 0.04, 0.36, '#2f3639')
  b.box('matte', 0, 0.68, -0.04, 0.38, 0.03, 0.14, '#2b2a28')
  b.box('paint', 0, 1.35, 0.1, 0.92, 0.6, 0.07, '#1f2427')
  return b.build()
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SlamScanner({ quality, reduced, debug }: { quality: 'low' | 'medium' | 'high'; reduced: boolean; debug: { forceProgress: number | null } }) {
  const turntable = useRef<THREE.Group>(null)
  const holo = useRef<THREE.Group>(null)
  const arm = useRef<THREE.Group>(null)
  const count = quality === 'low' ? 650 : quality === 'high' ? 2300 : 1400
  const statics = useMemo(() => buildScannerStatic(), [])
  const table = useMemo(() => buildTurntable(), [])
  const armGeo = useMemo(() => buildArm(), [])
  const cart = useMemo(() => buildMonitorCart(), [])
  const splats = useMemo(() => makeSplatMesh(count), [count])
  const laser = useMemo(() => ({ geo: laserGeometry(SCANNER.trackR - 0.12, 0.34), mat: laserMaterial() }), [])
  const monitor = useMonitor()
  const lastPercent = useRef(-1)
  const lastPhase = useRef('')
  const angle = useRef({ table: 0, arm: 0 })

  useEffect(
    () => () => {
      splats.geo.dispose()
      splats.base.dispose()
      splats.mat.dispose()
    },
    [splats],
  )
  useEffect(
    () => () => {
      laser.geo.dispose()
      laser.mat.dispose()
      monitor.texture.dispose()
      monitor.mat.dispose()
      monitor.geo.dispose()
    },
    [laser, monitor],
  )

  useInteractable({
    id: 'rnd:slam',
    verb: 'Inspect',
    label: 'Gaussian-SLAM Scanner',
    radius: 2.4,
    priority: 0.2,
    enabled: () => !!getProject('gaussian-slam'),
    getPosition: () => ({ x: SCANNER.interact.x, y: 0, z: SCANNER.interact.z }),
    onInteract: () => {
      events.emit('sfx', { name: 'scanner-beep', position: [SCANNER.x, 1.2, SCANNER.z] })
      useUIStore.getState().openPanel('project', { projectId: 'gaussian-slam' })
    },
  })

  useFrame((_, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 0), 0.1)
    const t = simClock.t
    const s = scanState(t, SCANNER.cycle, SCANNER.hold, SCANNER.dissolve, scanOut)
    if (debug.forceProgress !== null) {
      s.phase = 'scan'
      s.progress = debug.forceProgress
      s.dissolve = 0
      s.percent = Math.min(100, Math.floor(debug.forceProgress * 100))
    }
    const u = splats.mat.uniforms
    u.uProgress.value = s.progress
    u.uDissolve.value = s.dissolve
    u.uTime.value = t
    const spin = reduced ? 0.18 : 0.42
    angle.current.table = (angle.current.table + dt * spin) % (Math.PI * 2)
    angle.current.arm = (angle.current.arm - dt * (reduced ? 0.35 : 0.95)) % (Math.PI * 2)
    if (turntable.current) turntable.current.rotation.y = angle.current.table
    if (holo.current) holo.current.rotation.y = angle.current.table
    if (arm.current) arm.current.rotation.y = angle.current.arm
    laser.mat.uniforms.uFlicker.value = s.phase === 'scan' ? (reduced ? 0.9 : 0.75 + 0.25 * Math.sin(t * 37) * Math.sin(t * 23)) : 0.15
    if (s.percent !== lastPercent.current || s.phase !== lastPhase.current) {
      lastPercent.current = s.percent
      lastPhase.current = s.phase
      drawMonitor(monitor.ctx, 512, 320, s)
      monitor.texture.needsUpdate = true
    }
  })

  const mon = SCANNER.monitor
  return (
    <group name="rnd-slam-scanner">
      <group position={[SCANNER.x, 0, SCANNER.z]} rotation-y={SCANNER.yaw}>
        <BatchMeshes geos={statics} shadows={false} name="slam" />
        <group ref={turntable} position={[0, SCANNER.baseH, 0]}>
          <BatchMeshes geos={table} shadows={false} name="slam-table" />
          <mesh geometry={getWorkerGeometry(MINI_LOOK)} material={figurineMaterial()} position={[0, 0.09, 0]} scale={FIGURINE_SCALE} />
        </group>
        <group ref={arm}>
          <BatchMeshes geos={armGeo} shadows={false} name="slam-arm" />
          <mesh geometry={laser.geo} material={laser.mat} position={[0, 1.18, SCANNER.trackR - 0.16]} rotation-y={-Math.PI / 2} renderOrder={5} />
        </group>
        <group ref={holo} position={[0, SCANNER.holoY, 0]} scale={SCANNER.holoScale}>
          <primitive object={splats.mesh} />
        </group>
      </group>
      <group position={[mon.x, 0, mon.z]} rotation-y={MONITOR_YAW}>
        <BatchMeshes geos={cart} shadows={false} name="slam-cart" />
        <mesh geometry={monitor.geo} material={monitor.mat} position={[0, 1.35, 0.06]} rotation-y={Math.PI} />
      </group>
    </group>
  )
}

let figMat: THREE.MeshStandardMaterial | null = null
function figurineMaterial(): THREE.MeshStandardMaterial {
  if (!figMat) {
    figMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.05 })
    figMat.name = 'stations-b:figurine'
  }
  return figMat
}
