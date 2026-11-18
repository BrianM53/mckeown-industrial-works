import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import * as THREE from 'three'
import { runtime } from '@/core/runtime'
import { textures } from '@/world/materials'
import type { PuffKind } from '../gagKit'
import { BUBBLE_SLOTS, type NpcWorld } from '../world'

// ===========================================================================
// Pooled puffs / droplets / sparks (one instanced draw call)
// ===========================================================================

const MAX_PUFFS = 120

interface PuffSpec {
  color: [number, number, number]
  alpha: number
  size: [number, number]
  grow: [number, number]
  life: [number, number]
  up: [number, number]
  out: [number, number]
  gravity: number
  drag: number
  /** 0 soft puff texture, 1 round blob, 2 glowing dot. */
  shape: number
}

const SPECS: Record<PuffKind, PuffSpec> = {
  soot: { color: [0.11, 0.1, 0.1], alpha: 0.9, size: [0.35, 0.55], grow: [1.1, 1.6], life: [1.5, 2.3], up: [0.25, 0.7], out: [0.6, 1.4], gravity: -0.3, drag: 1.6, shape: 0 },
  dust: { color: [0.62, 0.58, 0.5], alpha: 0.6, size: [0.18, 0.3], grow: [0.45, 0.7], life: [0.8, 1.3], up: [0.25, 0.6], out: [0.5, 1.2], gravity: -0.2, drag: 2.2, shape: 0 },
  smoke: { color: [0.36, 0.36, 0.37], alpha: 0.55, size: [0.12, 0.2], grow: [0.45, 0.65], life: [1.1, 1.6], up: [0.6, 0.9], out: [0.05, 0.2], gravity: -0.15, drag: 0.8, shape: 0 },
  slime: { color: [0.36, 1.0, 0.3], alpha: 0.95, size: [0.07, 0.12], grow: [0.05, 0.09], life: [0.7, 1.1], up: [2.0, 3.4], out: [0.8, 1.8], gravity: 9, drag: 0.3, shape: 2 },
  foam: { color: [0.96, 0.93, 0.82], alpha: 1, size: [0.1, 0.16], grow: [0.08, 0.13], life: [0.9, 1.4], up: [2.4, 4.0], out: [1.0, 2.0], gravity: 8, drag: 0.4, shape: 1 },
  spark: { color: [1.0, 0.72, 0.3], alpha: 1, size: [0.05, 0.08], grow: [0.02, 0.03], life: [0.22, 0.42], up: [1.2, 2.6], out: [1.8, 3.6], gravity: 9, drag: 0.6, shape: 2 },
  paper: { color: [0.95, 0.94, 0.9], alpha: 1, size: [0.08, 0.12], grow: [0.08, 0.12], life: [0.8, 1.2], up: [1, 2], out: [0.5, 1], gravity: 4, drag: 1.2, shape: 1 },
}

const puffVert = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iCol;
attribute vec3 iMisc;
varying vec2 vUv;
varying vec4 vCol;
varying float vShape;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vCol = iCol;
  vShape = iMisc.z;
  vec4 mvPosition = viewMatrix * vec4(iPos, 1.0);
  float c = cos(iMisc.y);
  float s = sin(iMisc.y);
  vec2 q = position.xy * iMisc.x;
  mvPosition.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const puffFrag = /* glsl */ `
uniform sampler2D uMap;
uniform float uLight;
varying vec2 vUv;
varying vec4 vCol;
varying float vShape;
#include <fog_pars_fragment>
void main() {
  float a;
  vec3 col = vCol.rgb;
  if (vShape < 0.5) {
    vec4 t = texture2D(uMap, vUv);
    a = t.a * 2.2 * vCol.a;
    col *= (0.6 + 0.5 * t.r) * uLight;
  } else if (vShape < 1.5) {
    float d = length(vUv - 0.5) * 2.0;
    a = smoothstep(1.0, 0.75, d) * vCol.a;
    col *= (1.05 - 0.35 * d) * uLight;
  } else {
    float d = length(vUv - 0.5) * 2.0;
    a = smoothstep(1.0, 0.15, d) * vCol.a;
    col *= 1.4;
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, min(a, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

class PuffPool {
  readonly geo: THREE.InstancedBufferGeometry
  readonly mat: THREE.ShaderMaterial
  private pos = new Float32Array(MAX_PUFFS * 3)
  private col = new Float32Array(MAX_PUFFS * 4)
  private misc = new Float32Array(MAX_PUFFS * 3)
  private aPos: THREE.InstancedBufferAttribute
  private aCol: THREE.InstancedBufferAttribute
  private aMisc: THREE.InstancedBufferAttribute
  // simulation state
  private n = 0
  private px = new Float32Array(MAX_PUFFS)
  private py = new Float32Array(MAX_PUFFS)
  private pz = new Float32Array(MAX_PUFFS)
  private vx = new Float32Array(MAX_PUFFS)
  private vy = new Float32Array(MAX_PUFFS)
  private vz = new Float32Array(MAX_PUFFS)
  private age = new Float32Array(MAX_PUFFS)
  private life = new Float32Array(MAX_PUFFS)
  private s0 = new Float32Array(MAX_PUFFS)
  private s1 = new Float32Array(MAX_PUFFS)
  private rot = new Float32Array(MAX_PUFFS)
  private rotV = new Float32Array(MAX_PUFFS)
  private kind: PuffKind[] = new Array(MAX_PUFFS).fill('dust')
  private seed = 1

  constructor() {
    const base = new THREE.PlaneGeometry(1, 1)
    this.geo = new THREE.InstancedBufferGeometry()
    this.geo.index = base.index
    this.geo.setAttribute('position', base.getAttribute('position'))
    this.geo.setAttribute('uv', base.getAttribute('uv'))
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)
    this.aCol = new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage)
    this.aMisc = new THREE.InstancedBufferAttribute(this.misc, 3).setUsage(THREE.DynamicDrawUsage)
    this.geo.setAttribute('iPos', this.aPos)
    this.geo.setAttribute('iCol', this.aCol)
    this.geo.setAttribute('iMisc', this.aMisc)
    this.geo.instanceCount = 0
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null }, uLight: { value: 1 } }]),
      vertexShader: puffVert,
      fragmentShader: puffFrag,
      transparent: true,
      depthWrite: false,
      fog: true,
    })
    this.mat.uniforms.uMap.value = textures.smokePuff()
    this.mat.name = 'npc-puffs'
  }

  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647
    return this.seed / 2147483647
  }

  spawn(kind: PuffKind, x: number, y: number, z: number, count: number, spread: number): void {
    const s = SPECS[kind]
    for (let k = 0; k < count; k++) {
      if (this.n >= MAX_PUFFS) return
      const i = this.n++
      const a = this.rnd() * Math.PI * 2
      const r = Math.sqrt(this.rnd()) * spread
      const out = s.out[0] + (s.out[1] - s.out[0]) * this.rnd()
      this.px[i] = x + Math.cos(a) * r * 0.5
      this.py[i] = y + (this.rnd() - 0.5) * spread * 0.4
      this.pz[i] = z + Math.sin(a) * r * 0.5
      this.vx[i] = Math.cos(a) * out
      this.vz[i] = Math.sin(a) * out
      this.vy[i] = s.up[0] + (s.up[1] - s.up[0]) * this.rnd()
      this.age[i] = 0
      this.life[i] = s.life[0] + (s.life[1] - s.life[0]) * this.rnd()
      this.s0[i] = s.size[0] + (s.size[1] - s.size[0]) * this.rnd()
      this.s1[i] = s.grow[0] + (s.grow[1] - s.grow[0]) * this.rnd()
      this.rot[i] = this.rnd() * Math.PI * 2
      this.rotV[i] = (this.rnd() - 0.5) * 1.6
      this.kind[i] = kind
    }
  }

  update(dt: number, light: number): void {
    let w = 0
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt
      if (this.age[i] >= this.life[i]) continue
      const s = SPECS[this.kind[i]]
      const damp = Math.exp(-s.drag * dt)
      this.vx[i] *= damp
      this.vz[i] *= damp
      this.vy[i] = this.vy[i] * damp - s.gravity * dt
      this.px[i] += this.vx[i] * dt
      this.py[i] += this.vy[i] * dt
      this.pz[i] += this.vz[i] * dt
      if (this.py[i] < 0.02 && s.gravity > 0) {
        this.py[i] = 0.02
        this.vy[i] = 0
        this.vx[i] *= 0.5
        this.vz[i] *= 0.5
      }
      this.rot[i] += this.rotV[i] * dt
      // compact into slot w
      if (w !== i) {
        this.px[w] = this.px[i]
        this.py[w] = this.py[i]
        this.pz[w] = this.pz[i]
        this.vx[w] = this.vx[i]
        this.vy[w] = this.vy[i]
        this.vz[w] = this.vz[i]
        this.age[w] = this.age[i]
        this.life[w] = this.life[i]
        this.s0[w] = this.s0[i]
        this.s1[w] = this.s1[i]
        this.rot[w] = this.rot[i]
        this.rotV[w] = this.rotV[i]
        this.kind[w] = this.kind[i]
      }
      const u = this.age[w] / this.life[w]
      const size = this.s0[w] + (this.s1[w] - this.s0[w]) * (1 - (1 - u) * (1 - u))
      const fade = u < 0.12 ? u / 0.12 : 1 - (u - 0.12) / 0.88
      this.pos[w * 3] = this.px[w]
      this.pos[w * 3 + 1] = this.py[w]
      this.pos[w * 3 + 2] = this.pz[w]
      this.col[w * 4] = s.color[0]
      this.col[w * 4 + 1] = s.color[1]
      this.col[w * 4 + 2] = s.color[2]
      this.col[w * 4 + 3] = s.alpha * Math.max(0, fade)
      this.misc[w * 3] = size
      this.misc[w * 3 + 1] = this.rot[w]
      this.misc[w * 3 + 2] = s.shape
      w++
    }
    this.n = w
    this.geo.instanceCount = w
    if (w > 0) {
      this.aPos.needsUpdate = true
      this.aCol.needsUpdate = true
      this.aMisc.needsUpdate = true
    }
    this.mat.uniforms.uLight.value = light
  }

  dispose(): void {
    this.geo.dispose()
    this.mat.dispose()
  }
}

export function Puffs({ world, scale }: { world: NpcWorld; scale: number }) {
  const pool = useMemo(() => new PuffPool(), [])
  useEffect(() => () => pool.dispose(), [pool])
  useFrame((_, dt) => {
    const q = world.puffQueue
    while (q.length) {
      const r = q.shift()!
      const count = Math.max(1, Math.round(r.count * scale))
      pool.spawn(r.kind, r.pos[0], r.pos[1], r.pos[2], count, r.spread)
    }
    pool.update(Math.min(dt, 0.1), 0.35 + 0.65 * Math.max(0, Math.min(1, runtime.lighting.level)))
  })
  return <mesh geometry={pool.geo} material={pool.mat} frustumCulled={false} renderOrder={5} name="npc-puffs" />
}

// ===========================================================================
// Night-shift flashlights (emissive bodies + additive beams; no real lights)
// ===========================================================================

const beamVert = /* glsl */ `
varying float vAlong;
varying float vFres;
void main() {
  vAlong = uv.y;
  vec4 local = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    local = instanceMatrix * local;
    n = mat3(instanceMatrix) * n;
  #endif
  vec4 mv = modelViewMatrix * local;
  vec3 vn = normalize(normalMatrix * n);
  vFres = abs(dot(vn, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}
`
const beamFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying float vAlong;
varying float vFres;
void main() {
  float a = pow(clamp(vAlong, 0.0, 1.0), 1.7) * smoothstep(0.0, 0.7, vFres) * uIntensity;
  gl_FragColor = vec4(uColor * a, 1.0);
}
`

const BEAM_LEN = 3.6
const beamGeo = (() => {
  let g: THREE.BufferGeometry | null = null
  return () => {
    if (g) return g
    // narrow end (uv.y = 1) at the origin, wide end BEAM_LEN along -Z
    g = new THREE.CylinderGeometry(0.05, 0.85, BEAM_LEN, 18, 1, true)
    g.translate(0, -BEAM_LEN / 2, 0)
    g.rotateX(Math.PI / 2)
    return g
  }
})()

const torchGeo = (() => {
  let g: THREE.BufferGeometry | null = null
  return () => {
    if (g) return g
    const body = new THREE.CylinderGeometry(0.032, 0.028, 0.2, 10)
    body.rotateX(Math.PI / 2)
    body.translate(0, 0, 0.08)
    const lens = new THREE.CylinderGeometry(0.045, 0.045, 0.03, 12)
    lens.rotateX(Math.PI / 2)
    lens.translate(0, 0, -0.03)
    const merged = new THREE.BufferGeometry()
    const parts = [body, lens]
    const colors = [new THREE.Color('#2B2F31'), new THREE.Color('#FFF3C4')]
    let vCount = 0
    let iCount = 0
    for (const p of parts) {
      vCount += p.getAttribute('position').count
      iCount += p.index!.count
    }
    const pos = new Float32Array(vCount * 3)
    const col = new Float32Array(vCount * 3)
    const idx = new Uint16Array(iCount)
    let vo = 0
    let io = 0
    parts.forEach((p, k) => {
      const pa = p.getAttribute('position')
      for (let i = 0; i < pa.count; i++) {
        pos.set([pa.getX(i), pa.getY(i), pa.getZ(i)], (vo + i) * 3)
        col.set([colors[k].r, colors[k].g, colors[k].b], (vo + i) * 3)
      }
      const ix = p.index!
      for (let i = 0; i < ix.count; i++) idx[io + i] = ix.getX(i) + vo
      vo += pa.count
      io += ix.count
      p.dispose()
    })
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    merged.setAttribute('color', new THREE.BufferAttribute(col, 3))
    merged.setIndex(new THREE.BufferAttribute(idx, 1))
    g = merged
    return g
  }
})()

/** Flashlight held in the 'point' pose, relative to the worker root (faces -Z). */
const HAND = new THREE.Vector3(0.22, 1.36, -0.6)
const AIM = new THREE.Vector3(-0.08, -0.3, -0.95).normalize()

const _root = new THREE.Matrix4()
const _local = new THREE.Matrix4()
const _out = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _qAim = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), AIM)
const _p = new THREE.Vector3()
const _s = new THREE.Vector3(1, 1, 1)
const _zero = new THREE.Matrix4().makeScale(0, 0, 0)
const _yAxis = new THREE.Vector3(0, 1, 0)

export function Flashlights({ world, max }: { world: NpcWorld; max: number }) {
  const bodies = useRef<THREE.InstancedMesh>(null)
  const beams = useRef<THREE.InstancedMesh>(null)
  const torchMat = useMemo(() => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), [])
  const beamMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color('#FFE6B0') }, uIntensity: { value: 0.32 } },
        vertexShader: beamVert,
        fragmentShader: beamFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  )
  useEffect(
    () => () => {
      torchMat.dispose()
      beamMat.dispose()
    },
    [torchMat, beamMat],
  )
  _local.compose(HAND, _qAim, _s)

  useFrame(() => {
    const b = bodies.current
    const c = beams.current
    if (!b || !c) return
    let i = 0
    for (const brain of world.brains.values()) {
      if (i >= max) break
      const on = brain.flashlight && !brain.hidden && brain.anim === 'point' && Number.isFinite(brain.x)
      if (on) {
        _q.setFromAxisAngle(_yAxis, brain.yaw)
        _root.compose(_p.set(brain.x, brain.y, brain.z), _q, _s)
        _out.multiplyMatrices(_root, _local)
        b.setMatrixAt(i, _out)
        c.setMatrixAt(i, _out)
      } else {
        b.setMatrixAt(i, _zero)
        c.setMatrixAt(i, _zero)
      }
      i++
    }
    for (; i < max; i++) {
      b.setMatrixAt(i, _zero)
      c.setMatrixAt(i, _zero)
    }
    b.instanceMatrix.needsUpdate = true
    c.instanceMatrix.needsUpdate = true
    // only draw while anyone is holding one
    let any = false
    for (const brain of world.brains.values()) if (brain.flashlight) any = true
    b.visible = any
    c.visible = any
  })

  return (
    <>
      <instancedMesh ref={bodies} args={[torchGeo(), torchMat, max]} frustumCulled={false} visible={false} />
      <instancedMesh ref={beams} args={[beamGeo(), beamMat, max]} frustumCulled={false} visible={false} renderOrder={6} />
    </>
  )
}

// ===========================================================================
// Speech bubbles (≤ 3 at a time)
// ===========================================================================

const FONT_URL = `${(import.meta.env?.BASE_URL as string | undefined) ?? '/'}fonts/BarlowCondensed-SemiBold.woff`

function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w / 2 - 0.07, y)
  s.lineTo(x + w / 2, y - 0.1)
  s.lineTo(x + w / 2 + 0.07, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}

function BubbleSlot({ world, slot, reduced }: { world: NpcWorld; slot: number; reduced: boolean }) {
  const group = useRef<THREE.Group>(null)
  const [content, setContent] = useState<{ text: string; serial: number } | null>(null)
  const [size, setSize] = useState<[number, number]>([1, 0.3])
  const bgMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#F4EFE2', transparent: true, depthWrite: false, toneMapped: false }), [])
  const rimMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#252B2B', transparent: true, depthWrite: false, toneMapped: false }), [])
  const geos = useMemo(() => {
    const [w, h] = size
    return { bg: new THREE.ShapeGeometry(roundedRect(w, h, 0.09), 4), rim: new THREE.ShapeGeometry(roundedRect(w + 0.05, h + 0.05, 0.11), 4) }
  }, [size])
  useEffect(() => () => {
    geos.bg.dispose()
    geos.rim.dispose()
  }, [geos])
  useEffect(
    () => () => {
      bgMat.dispose()
      rimMat.dispose()
    },
    [bgMat, rimMat],
  )
  const textRef = useRef<THREE.Mesh & { fillOpacity?: number }>(null)

  useFrame(() => {
    let b: (typeof world.bubbles)[number] | undefined
    for (const x of world.bubbles) if (x.slot === slot) b = x
    const g = group.current
    if (!b) {
      if (content) setContent(null)
      if (g) g.visible = false
      return
    }
    if (!content || content.serial !== b.serial) setContent({ text: b.text, serial: b.serial })
    const brain = world.brains.get(b.npcId)
    if (!g || !brain) return
    g.visible = true
    const seatedDrop = brain.anim === 'sit' ? 0.45 : brain.anim === 'sleep' ? 1.2 : 0
    g.position.set(brain.x, brain.y + 2.3 - seatedDrop, brain.z)
    const age = b.total - b.left
    const pop = reduced ? 1 : Math.min(1, 0.55 + age / 0.18)
    const fade = Math.min(1, b.left / 0.3)
    g.scale.setScalar(pop)
    bgMat.opacity = 0.96 * fade
    rimMat.opacity = 0.9 * fade
    const tm = textRef.current
    if (tm && tm.fillOpacity !== fade) tm.fillOpacity = fade
  })

  return (
    <group ref={group} visible={false}>
      {content && (
        <Billboard>
          <mesh geometry={geos.rim} material={rimMat} position={[0, 0, -0.002]} renderOrder={20} />
          <mesh geometry={geos.bg} material={bgMat} renderOrder={21} />
          <Text
            ref={textRef}
            font={FONT_URL}
            fontSize={0.2}
            maxWidth={2.6}
            textAlign="center"
            anchorX="center"
            anchorY="middle"
            color="#252B2B"
            position={[0, 0, 0.004]}
            renderOrder={22}
            material-depthWrite={false}
            material-toneMapped={false}
            onSync={(m: THREE.Mesh & { textRenderInfo?: { blockBounds: number[] } }) => {
              const bb = m.textRenderInfo?.blockBounds
              if (!bb) return
              const w = Math.max(0.5, bb[2] - bb[0] + 0.32)
              const h = Math.max(0.3, bb[3] - bb[1] + 0.18)
              if (Math.abs(w - size[0]) > 0.01 || Math.abs(h - size[1]) > 0.01) setSize([w, h])
            }}
          >
            {content.text}
          </Text>
        </Billboard>
      )}
    </group>
  )
}

/**
 * drei <Text> suspends while troika loads its font. Each bubble therefore gets its
 * own Suspense boundary (otherwise the FIRST bubble of a session would suspend the
 * whole NPC module and every worker and prop would blink out until the font is
 * ready), and an invisible warm-up label loads the font right at mount so the
 * first real bubble normally doesn't wait at all.
 */
function FontWarmup() {
  return (
    <Text font={FONT_URL} fontSize={0.01} visible={false} frustumCulled={false}>
      Zzz
    </Text>
  )
}

export function Bubbles({ world, reduced }: { world: NpcWorld; reduced: boolean }) {
  return (
    <>
      <Suspense fallback={null}>
        <FontWarmup />
      </Suspense>
      {Array.from({ length: BUBBLE_SLOTS }, (_, i) => (
        <Suspense key={i} fallback={null}>
          <BubbleSlot world={world} slot={i} reduced={reduced} />
        </Suspense>
      ))}
    </>
  )
}
