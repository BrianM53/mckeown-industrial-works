import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { audio } from '@/audio/api'
import { useSettings } from '@/state/settings'
import { textures } from '@/world/materials'
import { TRANSFORMER } from '../data/decor'
import { FONT_DISPLAY } from '../lib/fonts'
import { icon } from '../lib/signArt'
import { envLight } from '../lightState'
import { GROUND_VENTS } from './decorParts'
import { FLAGPOLES } from './perimeter'

// ---------------------------------------------------------------------------
// Flags outside the main gate (vertex-shader wave, one merged mesh)
// ---------------------------------------------------------------------------

function flagTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 480
  const ctx = c.getContext('2d')!
  const draw = (y: number, bg: string, fg: string, fn: () => void) => {
    ctx.save()
    ctx.translate(0, y)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, 256, 160)
    ctx.fillStyle = fg
    fn()
    ctx.restore()
  }
  draw(0, '#2F5F5B', '#EAE3D2', () => {
    ctx.font = `700 76px ${FONT_DISPLAY}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('MIW', 128, 70)
    ctx.font = `700 22px ${FONT_DISPLAY}`
    ctx.fillText('McKEOWN INDUSTRIAL WORKS', 128, 128)
  })
  draw(160, '#E9B63F', '#1E2323', () => icon(ctx, 'rocket', 128, 80, 120, '#1E2323'))
  draw(320, '#E57D35', '#1E2323', () => {
    ctx.font = `700 56px ${FONT_DISPLAY}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('SAFETY', 128, 58)
    ctx.font = `700 34px ${FONT_DISPLAY}`
    ctx.fillText('FIRST (ISH)', 128, 112)
  })
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

export function Flags() {
  const reduced = useSettings((s) => s.reducedMotion)
  const { mesh, uniforms } = useMemo(() => {
    const geos: THREE.BufferGeometry[] = []
    const W = 1.7
    const H = 1.05
    FLAGPOLES.forEach(([x, z], i) => {
      const g = new THREE.PlaneGeometry(W, H, 14, 4)
      g.translate(W / 2, 0, 0)
      const uv = g.getAttribute('uv') as THREE.BufferAttribute
      // map to this flag's band in the texture (top band = flag 0)
      for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - (i * 160 + (1 - uv.getY(k)) * 160) / 480)
      // wind toward east-north-east
      g.rotateY(0.39)
      g.translate(x, 8.55, z)
      geos.push(g)
    })
    const merged = mergeSimple(geos)
    const uniforms = { uTime: { value: 0 }, uAmp: { value: 1 } }
    const mat = new THREE.MeshStandardMaterial({ map: flagTexture(), side: THREE.DoubleSide, roughness: 0.85 })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime
      shader.uniforms.uAmp = uniforms.uAmp
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uAmp;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
  float fx = uv.x;
  float ph = position.x * 0.7 + position.z * 0.5;
  float wv = sin(fx * 7.0 - uTime * 4.2 + ph) * 0.13 * fx * uAmp + sin(fx * 13.0 - uTime * 6.1 + ph) * 0.04 * fx * uAmp;
  transformed.x += 0.38 * wv;
  transformed.z += 0.92 * wv;
  transformed.y -= fx * fx * 0.12;`,
        )
    }
    mat.customProgramCacheKey = () => 'env-flag'
    const mesh = new THREE.Mesh(merged, mat)
    mesh.castShadow = true
    mesh.frustumCulled = false
    mesh.name = 'env-flags'
    return { mesh, uniforms }
  }, [])
  useEffect(
    () => () => {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.MeshStandardMaterial).map?.dispose()
      ;(mesh.material as THREE.Material).dispose()
    },
    [mesh],
  )
  useFrame((_, dt) => {
    uniforms.uTime.value += Math.min(dt, 0.1)
    uniforms.uAmp.value = reduced ? 0.3 : 1
  })
  return <primitive object={mesh} />
}

function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  let off = 0
  for (const g of geos) {
    const p = g.getAttribute('position')
    const n = g.getAttribute('normal')
    const u = g.getAttribute('uv')
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i))
      nor.push(n.getX(i), n.getY(i), n.getZ(i))
      uv.push(u.getX(i), u.getY(i))
    }
    const ix = g.index!
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + off)
    off += p.count
    g.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  out.setIndex(idx)
  return out
}

// ---------------------------------------------------------------------------
// Refinery flare (far backdrop): flickering flame + glow
// ---------------------------------------------------------------------------

export function Flare() {
  const reduced = useSettings((s) => s.reducedMotion)
  const flame = useRef<THREE.Mesh>(null)
  const glow = useRef<THREE.Sprite>(null)
  const parts = useMemo(() => {
    const geo = new THREE.ConeGeometry(1.1, 5, 10, 1, true)
    geo.translate(0, 2.5, 0)
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#FF9A3C').multiplyScalar(2.2), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
    const smat = new THREE.SpriteMaterial({ map: textures.glowDot(), color: '#FFB05A', transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending })
    return { geo, mat, smat }
  }, [])
  useEffect(
    () => () => {
      parts.geo.dispose()
      parts.mat.dispose()
      parts.smat.dispose()
    },
    [parts],
  )
  useFrame((state) => {
    const t = state.clock.elapsedTime
    const f = reduced ? 1 : 0.85 + 0.15 * Math.sin(t * 9.1) + 0.08 * Math.sin(t * 23.7)
    if (flame.current) {
      flame.current.scale.set(f, 0.8 + 0.35 * f, f)
      flame.current.rotation.z = reduced ? 0 : Math.sin(t * 1.3) * 0.18 - 0.25
    }
    if (glow.current) glow.current.scale.setScalar(26 * f)
  })
  return (
    <group position={[40, 62, -176]}>
      <mesh ref={flame} geometry={parts.geo} material={parts.mat} />
      <sprite ref={glow} material={parts.smat} position={[0, 2.5, 0]} />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Transformer spark + steam vent hiss. (The transformer HUM is a world emitter
// of the audio module — see audio/emitters.ts — so it is not started here.)
// ---------------------------------------------------------------------------

export function AmbientEmitters() {
  const reduced = useSettings((s) => s.reducedMotion)
  const spark = useRef<THREE.Sprite>(null)
  const state = useRef({ next: 3, until: 0 })
  const mat = useMemo(
    () => new THREE.SpriteMaterial({ map: textures.glowDot(), color: '#A9D8FF', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    [],
  )
  useEffect(() => {
    const vents = GROUND_VENTS.slice(0, 3).map(([x, z]) => audio.loop('steam-vent', { position: [x, 0.4, z], volume: 0.22, refDistance: 2, maxDistance: 12 }))
    return () => {
      vents.forEach((v) => v.stop())
      mat.dispose()
    }
  }, [mat])
  useFrame((st) => {
    const t = st.clock.elapsedTime
    const s = state.current
    if (!spark.current) return
    if (reduced || envLight.level < 0.2) {
      mat.opacity = 0
      return
    }
    if (t > s.next) {
      s.until = t + 0.35
      s.next = t + 3 + Math.random() * 5
    }
    const on = t < s.until
    mat.opacity = on ? 0.5 + Math.random() * 0.5 : 0
    spark.current.scale.setScalar(on ? 0.4 + Math.random() * 0.5 : 0.01)
  })
  return <sprite ref={spark} material={mat} position={[TRANSFORMER.x + 0.6, TRANSFORMER.h + 1.05, TRANSFORMER.z]} />
}
