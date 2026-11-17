import * as THREE from 'three'
import { PALETTE } from './palette'

/**
 * Shared material & procedural-texture library. ALWAYS reuse these instead of
 * creating per-mesh materials (keeps draw state and memory low). Materials are
 * created lazily and cached for the app lifetime — never dispose them.
 *
 * Owner: environment module (may add entries; must not rename/remove existing ones).
 */

const cache = new Map<string, THREE.Material>()
const texCache = new Map<string, THREE.Texture>()

function memo<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined
  if (!m) {
    m = make()
    m.name = key
    cache.set(key, m)
  }
  return m
}

function canvasTexture(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void, repeat = 1): THREE.Texture {
  let t = texCache.get(key)
  if (t) return t
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  draw(ctx, size)
  t = new THREE.CanvasTexture(canvas)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  texCache.set(key, t)
  return t
}

/** Deterministic value noise for texture painting. */
function noiseRand(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const textures = {
  /** Diagonal yellow/black hazard stripes. */
  hazardStripes(): THREE.Texture {
    return canvasTexture('hazard', 128, (ctx, s) => {
      ctx.fillStyle = PALETTE.hazard
      ctx.fillRect(0, 0, s, s)
      ctx.fillStyle = PALETTE.soot
      for (let i = -s; i < s * 2; i += 32) {
        ctx.beginPath()
        ctx.moveTo(i, 0)
        ctx.lineTo(i + 16, 0)
        ctx.lineTo(i + 16 - s, s)
        ctx.lineTo(i - s, s)
        ctx.closePath()
        ctx.fill()
      }
    })
  },
  /** Speckled, stained concrete. */
  concrete(): THREE.Texture {
    return canvasTexture('concrete', 256, (ctx, s) => {
      ctx.fillStyle = '#8a897f'
      ctx.fillRect(0, 0, s, s)
      const r = noiseRand(7)
      for (let i = 0; i < 2600; i++) {
        const v = Math.floor(110 + r() * 60)
        ctx.fillStyle = `rgba(${v},${v},${v - 6},${0.08 + r() * 0.12})`
        const w = 1 + r() * 3
        ctx.fillRect(r() * s, r() * s, w, w)
      }
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = `rgba(40,38,34,${0.03 + r() * 0.05})`
        ctx.beginPath()
        ctx.arc(r() * s, r() * s, 8 + r() * 40, 0, Math.PI * 2)
        ctx.fill()
      }
    })
  },
  /** Corrugated sheet-metal stripes (use with a base color). */
  corrugated(): THREE.Texture {
    return canvasTexture('corrugated', 128, (ctx, s) => {
      for (let x = 0; x < s; x++) {
        const v = 170 + Math.round(60 * Math.sin((x / s) * Math.PI * 16))
        ctx.fillStyle = `rgb(${v},${v},${v})`
        ctx.fillRect(x, 0, 1, s)
      }
    })
  },
  /** Rust streaks / grime overlay (multiply with base color). */
  grime(): THREE.Texture {
    return canvasTexture('grime', 256, (ctx, s) => {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, s, s)
      const r = noiseRand(21)
      for (let i = 0; i < 70; i++) {
        const x = r() * s
        const len = 20 + r() * 120
        const g = ctx.createLinearGradient(x, 0, x, len)
        g.addColorStop(0, `rgba(120,70,40,${0.15 + r() * 0.25})`)
        g.addColorStop(1, 'rgba(120,70,40,0)')
        ctx.fillStyle = g
        ctx.fillRect(x, r() * s * 0.6, 2 + r() * 5, len)
      }
    })
  },
  /** Metal floor grating. */
  grating(): THREE.Texture {
    return canvasTexture('grating', 128, (ctx, s) => {
      ctx.fillStyle = '#2a2f30'
      ctx.fillRect(0, 0, s, s)
      ctx.strokeStyle = '#6f7a7b'
      ctx.lineWidth = 4
      for (let i = 0; i <= s; i += 16) {
        ctx.beginPath()
        ctx.moveTo(i, 0)
        ctx.lineTo(i, s)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(0, i)
        ctx.lineTo(s, i)
        ctx.stroke()
      }
    })
  },
  /** Conveyor belt surface (scroll texture.offset.y to animate). */
  belt(): THREE.Texture {
    return canvasTexture('belt', 128, (ctx, s) => {
      ctx.fillStyle = '#222626'
      ctx.fillRect(0, 0, s, s)
      ctx.fillStyle = '#3a4142'
      for (let y = 0; y < s; y += 16) ctx.fillRect(0, y, s, 5)
    })
  },
}

type StdOpts = THREE.MeshStandardMaterialParameters

function std(key: string, opts: StdOpts): THREE.MeshStandardMaterial {
  return memo(key, () => new THREE.MeshStandardMaterial(opts))
}

/** Named shared materials. */
export const mats = {
  steel: () => std('steel', { color: PALETTE.steel, roughness: 0.55, metalness: 0.6 }),
  steelDark: () => std('steelDark', { color: PALETTE.gunmetal, roughness: 0.6, metalness: 0.55 }),
  steelLight: () => std('steelLight', { color: PALETTE.steelLight, roughness: 0.45, metalness: 0.65 }),
  charcoal: () => std('charcoal', { color: PALETTE.charcoal, roughness: 0.85, metalness: 0.2 }),
  soot: () => std('soot', { color: PALETTE.soot, roughness: 0.95, metalness: 0.1 }),
  rust: () => std('rust', { color: PALETTE.rust, roughness: 0.85, metalness: 0.35 }),
  concrete: () => std('concrete', { color: '#ffffff', map: textures.concrete(), roughness: 0.95, metalness: 0 }),
  asphalt: () => std('asphalt', { color: PALETTE.asphalt, roughness: 0.95, metalness: 0 }),
  hazard: () => std('hazard', { color: PALETTE.hazard, roughness: 0.6, metalness: 0.2 }),
  hazardStripes: () => std('hazardStripes', { map: textures.hazardStripes(), roughness: 0.65, metalness: 0.15 }),
  safety: () => std('safety', { color: PALETTE.safety, roughness: 0.6, metalness: 0.2 }),
  teal: () => std('teal', { color: PALETTE.teal, roughness: 0.6, metalness: 0.3 }),
  cream: () => std('cream', { color: PALETTE.cream, roughness: 0.8, metalness: 0.05 }),
  paintWhite: () => std('paintWhite', { color: PALETTE.paintWhite, roughness: 0.8, metalness: 0.05 }),
  brick: () => std('brick', { color: PALETTE.brick, roughness: 0.9, metalness: 0.05 }),
  rubber: () => std('rubber', { color: '#1b1d1e', roughness: 0.95, metalness: 0 }),
  glass: () =>
    memo(
      'glass',
      () =>
        new THREE.MeshStandardMaterial({
          color: PALETTE.glass,
          roughness: 0.15,
          metalness: 0.2,
          transparent: true,
          opacity: 0.32,
          depthWrite: false,
        }),
    ),
  belt: () => std('belt', { map: textures.belt(), roughness: 0.9, metalness: 0.1 }),
  grating: () => std('grating', { map: textures.grating(), roughness: 0.7, metalness: 0.5 }),
  furnaceGlow: () => std('furnaceGlow', { color: PALETTE.furnace, emissive: PALETTE.furnace, emissiveIntensity: 2.2, roughness: 0.5 }),
  emissiveRed: () => std('emissiveRed', { color: '#ff3b2f', emissive: '#ff3b2f', emissiveIntensity: 2, roughness: 0.5 }),
  emissiveGreen: () => std('emissiveGreen', { color: '#5dff7a', emissive: '#5dff7a', emissiveIntensity: 1.8, roughness: 0.5 }),
  emissiveAmber: () => std('emissiveAmber', { color: '#ffb23f', emissive: '#ffb23f', emissiveIntensity: 1.8, roughness: 0.5 }),
  emissiveBlue: () => std('emissiveBlue', { color: '#6fc8ff', emissive: '#6fc8ff', emissiveIntensity: 1.8, roughness: 0.5 }),
  emissiveCream: () => std('emissiveCream', { color: '#fff3d6', emissive: '#fff3d6', emissiveIntensity: 1.4, roughness: 0.5 }),
}

/** A cached flat-color standard material for one-off accents (keyed by color+params). */
export function colorMat(color: string, roughness = 0.7, metalness = 0.2, emissiveIntensity = 0): THREE.MeshStandardMaterial {
  const key = `c:${color}:${roughness}:${metalness}:${emissiveIntensity}`
  return std(key, {
    color,
    roughness,
    metalness,
    emissive: emissiveIntensity > 0 ? color : '#000000',
    emissiveIntensity,
  })
}
