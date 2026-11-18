import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { simClock } from '@/core/clock'
import { createRng } from '@/core/rng'
import type { Rect } from '@/core/types'
import { textures } from '@/world/materials'

/**
 * Soft rising wisps (cold-aisle fog over perforated tiles). Camera-facing
 * instanced quads animated entirely in the vertex shader from per-instance
 * seeds: no CPU work per frame beyond one uniform. Capped count (quality).
 */
const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uRise;
  uniform float uSize;
  attribute vec4 aSeed; // x, z, phase, speed
  varying vec2 vUv;
  varying float vFade;
  void main() {
    vUv = uv;
    float life = fract(uTime * aSeed.w + aSeed.z);
    float y = life * uRise;
    vFade = smoothstep(0.0, 0.18, life) * (1.0 - smoothstep(0.55, 1.0, life));
    vec3 center = vec3(aSeed.x + sin(uTime * 0.7 + aSeed.z * 9.0) * 0.08 * life, 0.05 + y, aSeed.y + cos(uTime * 0.6 + aSeed.z * 7.0) * 0.08 * life);
    vec4 mv = modelViewMatrix * vec4(center, 1.0);
    float s = uSize * (0.55 + life * 0.9);
    mv.xy += position.xy * s;
    gl_Position = projectionMatrix * mv;
  }`

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    float a = t.a * vFade * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor * (0.75 + 0.25 * t.r), a);
    #include <colorspace_fragment>
  }`

export function Wisps({
  areas,
  count,
  color = '#cfe6f2',
  rise = 1.4,
  size = 0.7,
  opacity = 0.32,
  speed = 0.12,
  seed = 5,
}: {
  areas: Rect[]
  count: number
  color?: string
  rise?: number
  size?: number
  opacity?: number
  speed?: number
  seed?: number
}) {
  const mesh = useMemo(() => {
    if (count <= 0 || areas.length === 0) return null
    const rng = createRng(seed)
    const base = new THREE.PlaneGeometry(1, 1)
    const geo = new THREE.InstancedBufferGeometry()
    geo.index = base.index
    geo.setAttribute('position', base.getAttribute('position'))
    geo.setAttribute('uv', base.getAttribute('uv'))
    const a = new Float32Array(count * 4)
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (let i = 0; i < count; i++) {
      const r = areas[i % areas.length]
      const x = r.minX + 0.15 + rng() * Math.max(0, r.maxX - r.minX - 0.3)
      const z = r.minZ + 0.15 + rng() * Math.max(0, r.maxZ - r.minZ - 0.3)
      a.set([x, z, rng(), speed * (0.7 + rng() * 0.6)], i * 4)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minZ = Math.min(minZ, z)
      maxZ = Math.max(maxZ, z)
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(a, 4))
    geo.instanceCount = count
    const cx = (minX + maxX) / 2
    const cz = (minZ + maxZ) / 2
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, rise / 2, cz), Math.hypot(maxX - minX, maxZ - minZ) / 2 + rise + size)
    const mat = new THREE.ShaderMaterial({
      name: 'stations-b:wisps',
      uniforms: {
        uTime: { value: 0 },
        uRise: { value: rise },
        uSize: { value: size },
        uMap: { value: textures.smokePuff() },
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: opacity },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    })
    const m = new THREE.Mesh(geo, mat)
    m.renderOrder = 3
    m.name = 'stations-b:wisps'
    return { m, mat, geo, base }
  }, [areas, count, color, rise, size, opacity, speed, seed])

  useEffect(
    () => () => {
      if (!mesh) return
      mesh.geo.dispose()
      mesh.base.dispose()
      mesh.mat.dispose()
    },
    [mesh],
  )

  useFrame(() => {
    if (mesh) mesh.mat.uniforms.uTime.value = simClock.t
  })

  return mesh ? <primitive object={mesh.m} /> : null
}
