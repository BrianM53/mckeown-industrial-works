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

/**
 * Tileable 2D value noise with lattice period `period` (x, y in lattice units;
 * wraps every `period` cells), 0..1. Used for seamless procedural textures.
 */
function periodicNoise(seed: number, period: number): (x: number, y: number) => number {
  const P = Math.max(1, Math.round(period))
  const hash = (ix: number, iy: number) => {
    const xx = ((ix % P) + P) % P
    const yy = ((iy % P) + P) % P
    let h = (xx * 374761393 + yy * 668265263 + seed * 1442695041) | 0
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
  return (x, y) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const u = xf * xf * (3 - 2 * xf)
    const v = yf * yf * (3 - 2 * yf)
    const a = hash(xi, yi)
    const b = hash(xi + 1, yi)
    const c = hash(xi, yi + 1)
    const d = hash(xi + 1, yi + 1)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
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

  // ---- added by the environment module -----------------------------------

  /** Tangent-space normal map of corrugated sheet ribs (8 ribs across U; linear color space). */
  corrugatedNormal(): THREE.Texture {
    const t = canvasTexture('corrugatedNormal', 128, (ctx, s) => {
      const img = ctx.createImageData(s, s)
      for (let x = 0; x < s; x++) {
        const a = (x / s) * Math.PI * 2 * 8
        // slightly squared sine profile reads like trapezoidal sheet
        const dh = Math.cos(a) + 0.6 * Math.cos(3 * a)
        const nx = -dh * 0.62
        const inv = 1 / Math.hypot(nx, 1)
        const r = Math.round((nx * inv * 0.5 + 0.5) * 255)
        const b = Math.round((inv * 0.5 + 0.5) * 255)
        for (let y = 0; y < s; y++) {
          const i = (y * s + x) * 4
          img.data[i] = r
          img.data[i + 1] = 128
          img.data[i + 2] = b
          img.data[i + 3] = 255
        }
      }
      ctx.putImageData(img, 0, 0)
    })
    t.colorSpace = THREE.NoColorSpace
    return t
  },
  /** Near-white painted-metal wear (smudges, scratches, speckle). Multiply with a base/vertex color. */
  paintWear(): THREE.Texture {
    return canvasTexture('paintWear', 256, (ctx, s) => {
      ctx.fillStyle = '#ececea'
      ctx.fillRect(0, 0, s, s)
      const r = noiseRand(33)
      for (let i = 0; i < 28; i++) {
        const g = ctx.createRadialGradient(r() * s, r() * s, 0, r() * s, r() * s, 10 + r() * 50)
        g.addColorStop(0, `rgba(90,82,70,${0.05 + r() * 0.08})`)
        g.addColorStop(1, 'rgba(90,82,70,0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, s, s)
      }
      for (let i = 0; i < 1800; i++) {
        const v = Math.floor(170 + r() * 80)
        ctx.fillStyle = `rgba(${v},${v - 4},${v - 10},${0.12 + r() * 0.2})`
        ctx.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2)
      }
      ctx.strokeStyle = 'rgba(255,255,250,0.35)'
      ctx.lineWidth = 1
      for (let i = 0; i < 26; i++) {
        const x = r() * s
        const y = r() * s
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + (r() - 0.5) * 40, y + (r() - 0.5) * 14)
        ctx.stroke()
      }
      // a few drip streaks
      for (let i = 0; i < 16; i++) {
        const x = r() * s
        const y = r() * s * 0.5
        const len = 30 + r() * 90
        const g = ctx.createLinearGradient(x, y, x, y + len)
        g.addColorStop(0, `rgba(110,70,40,${0.1 + r() * 0.12})`)
        g.addColorStop(1, 'rgba(110,70,40,0)')
        ctx.fillStyle = g
        ctx.fillRect(x, y, 1.5 + r() * 2.5, len)
      }
    })
  },
  /** Neutral running-bond brick (dark recessed mortar). Tint with a base/vertex color. */
  brick(): THREE.Texture {
    return canvasTexture('brick', 256, (ctx, s) => {
      ctx.fillStyle = '#7d7973'
      ctx.fillRect(0, 0, s, s)
      const r = noiseRand(51)
      const rows = 8
      const cols = 4
      const bh = s / rows
      const bw = s / cols
      for (let j = 0; j < rows; j++) {
        const off = j % 2 ? bw / 2 : 0
        for (let i = -1; i < cols + 1; i++) {
          const v = 200 + Math.floor(r() * 55)
          const warm = Math.floor(r() * 10)
          ctx.fillStyle = `rgb(${v},${v - 6 - warm},${v - 14 - warm})`
          ctx.fillRect(i * bw + off + 2, j * bh + 2, bw - 4, bh - 4)
          ctx.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.06})`
          ctx.fillRect(i * bw + off + 2, j * bh + 2, bw - 4, 2)
        }
      }
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = `rgba(40,30,25,${0.05 + r() * 0.1})`
        ctx.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2)
      }
    })
  },
  /** Asphalt aggregate (multiply with an asphalt tone). */
  asphalt(): THREE.Texture {
    return canvasTexture('asphaltAggregate', 256, (ctx, s) => {
      ctx.fillStyle = '#c8c8c6'
      ctx.fillRect(0, 0, s, s)
      const r = noiseRand(77)
      for (let i = 0; i < 5200; i++) {
        const v = Math.floor(120 + r() * 135)
        ctx.fillStyle = `rgba(${v},${v},${v - 3},${0.25 + r() * 0.5})`
        const w = 0.8 + r() * 2.2
        ctx.fillRect(r() * s, r() * s, w, w)
      }
      for (let i = 0; i < 10; i++) {
        const g = ctx.createRadialGradient(r() * s, r() * s, 0, r() * s, r() * s, 20 + r() * 60)
        g.addColorStop(0, `rgba(20,20,20,${0.05 + r() * 0.08})`)
        g.addColorStop(1, 'rgba(20,20,20,0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, s, s)
      }
    })
  },
  /** Dusty window with a warm lit interior (use on an unlit/emissive material). */
  dustyWindow(): THREE.Texture {
    return canvasTexture('dustyWindow', 128, (ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, 0, s)
      g.addColorStop(0, '#ffe2ae')
      g.addColorStop(0.55, '#f2b46e')
      g.addColorStop(1, '#a8703e')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, s, s)
      const r = noiseRand(91)
      // interior silhouettes (shelves / machinery)
      ctx.fillStyle = 'rgba(70,45,25,0.35)'
      for (let i = 0; i < 6; i++) ctx.fillRect(r() * s, s * (0.45 + r() * 0.3), 8 + r() * 26, s)
      ctx.fillStyle = 'rgba(255,245,220,0.35)'
      ctx.fillRect(0, s * 0.08, s, 4)
      // dust and grime
      for (let i = 0; i < 700; i++) {
        ctx.fillStyle = `rgba(120,100,80,${0.04 + r() * 0.1})`
        ctx.fillRect(r() * s, r() * s, 1 + r() * 3, 1 + r() * 3)
      }
      const dirt = ctx.createLinearGradient(0, s * 0.7, 0, s)
      dirt.addColorStop(0, 'rgba(90,70,50,0)')
      dirt.addColorStop(1, 'rgba(90,70,50,0.45)')
      ctx.fillStyle = dirt
      ctx.fillRect(0, 0, s, s)
      // diagonal glare
      ctx.fillStyle = 'rgba(255,255,255,0.10)'
      ctx.beginPath()
      ctx.moveTo(s * 0.15, 0)
      ctx.lineTo(s * 0.35, 0)
      ctx.lineTo(s * 0.05, s)
      ctx.lineTo(-s * 0.15, s)
      ctx.fill()
      // mullions
      ctx.fillStyle = '#262b2b'
      ctx.fillRect(0, 0, s, 5)
      ctx.fillRect(0, s - 5, s, 5)
      ctx.fillRect(0, 0, 5, s)
      ctx.fillRect(s - 5, 0, 5, s)
      ctx.fillRect(s / 2 - 2, 0, 4, s)
      ctx.fillRect(0, s / 2 - 2, s, 4)
    })
  },
  /** Square floor tile with grout edges (one tile per texture; multiply with a floor color). */
  floorTiles(): THREE.Texture {
    return canvasTexture('floorTiles', 128, (ctx, s) => {
      ctx.fillStyle = '#e4e2dc'
      ctx.fillRect(0, 0, s, s)
      const r = noiseRand(5)
      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = `rgba(80,76,70,${0.03 + r() * 0.06})`
        ctx.fillRect(r() * s, r() * s, 1 + r() * 3, 1 + r() * 3)
      }
      ctx.fillStyle = 'rgba(60,58,54,0.55)'
      ctx.fillRect(0, 0, s, 3)
      ctx.fillRect(0, 0, 3, s)
    })
  },
  /** Soft smoke/steam puff: alpha = density, red = top-lit shading (linear data). */
  smokePuff(): THREE.Texture {
    const t = canvasTexture('smokePuff', 128, (ctx, s) => {
      ctx.clearRect(0, 0, s, s)
      const r = noiseRand(17)
      for (let i = 0; i < 22; i++) {
        const a = r() * Math.PI * 2
        const d = r() * s * 0.2
        const x = s / 2 + Math.cos(a) * d
        const y = s / 2 + Math.sin(a) * d
        const rad = s * (0.18 + r() * 0.16)
        const shade = Math.round(255 * (0.55 + 0.45 * (1 - y / s)))
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
        g.addColorStop(0, `rgba(${shade},${shade},${shade},0.32)`)
        g.addColorStop(1, `rgba(${shade},${shade},${shade},0)`)
        ctx.fillStyle = g
        ctx.fillRect(0, 0, s, s)
      }
    })
    t.colorSpace = THREE.NoColorSpace
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
    return t
  },
  /**
   * Seamless poured-slab concrete for large world-space ground sampling: soft
   * multi-octave mottling, aggregate speckle and a few pits — no hard-edged
   * blotches, so it never reads as a repeating pattern of spots.
   */
  concreteSlab(): THREE.Texture {
    return canvasTexture('concreteSlab', 512, (ctx, s) => {
      const img = ctx.createImageData(s, s)
      const octaves: [number, number, number][] = [
        // [lattice period across the texture, amplitude, seed]
        [3, 15, 11],
        [6, 11, 23],
        [12, 7, 37],
        [24, 5, 41],
        [64, 4, 53],
      ]
      const noises = octaves.map(([p, , seed]) => periodicNoise(seed, p))
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++) {
          let v = 138
          for (let o = 0; o < octaves.length; o++) {
            const p = octaves[o][0]
            v += (noises[o]((x / s) * p, (y / s) * p) - 0.5) * 2 * octaves[o][1]
          }
          const i = (y * s + x) * 4
          img.data[i] = v
          img.data[i + 1] = v - 1
          img.data[i + 2] = v - 9
          img.data[i + 3] = 255
        }
      ctx.putImageData(img, 0, 0)
      const r = noiseRand(61)
      // aggregate speckle (light and dark)
      for (let i = 0; i < 9000; i++) {
        const light = r() < 0.5
        const v = light ? 168 + Math.floor(r() * 50) : 70 + Math.floor(r() * 40)
        ctx.fillStyle = `rgba(${v},${v},${v - 6},${0.1 + r() * 0.22})`
        const w = 0.8 + r() * 1.8
        ctx.fillRect(r() * s, r() * s, w, w)
      }
      // small pits / chips
      for (let i = 0; i < 90; i++) {
        const x = r() * s
        const y = r() * s
        ctx.fillStyle = `rgba(52,48,42,${0.18 + r() * 0.2})`
        ctx.beginPath()
        ctx.arc(x, y, 0.8 + r() * 2.2, 0, Math.PI * 2)
        ctx.fill()
      }
      // a few hairline cracks
      ctx.lineWidth = 1
      for (let i = 0; i < 7; i++) {
        let x = r() * s
        let y = r() * s
        let a = r() * Math.PI * 2
        ctx.strokeStyle = `rgba(48,44,38,${0.14 + r() * 0.12})`
        ctx.beginPath()
        ctx.moveTo(x, y)
        const n = 6 + Math.floor(r() * 10)
        for (let k = 0; k < n; k++) {
          a += (r() - 0.5) * 0.9
          x += Math.cos(a) * (5 + r() * 9)
          y += Math.sin(a) * (5 + r() * 9)
          ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
    })
  },
  /** Radial glow dot (white, alpha falloff) for halos and light cones. */
  glowDot(): THREE.Texture {
    const t = canvasTexture('glowDot', 64, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
      g.addColorStop(0, 'rgba(255,255,255,1)')
      g.addColorStop(0.25, 'rgba(255,255,255,0.55)')
      g.addColorStop(0.6, 'rgba(255,255,255,0.12)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.clearRect(0, 0, s, s)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, s, s)
    })
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
    return t
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
  // ---- added by the environment module -----------------------------------
  /** Corrugated sheet metal (normal-mapped ribs). Clone and set normalMap.repeat for large panels. */
  corrugatedSteel: () =>
    std('corrugatedSteel', { color: PALETTE.steel, normalMap: textures.corrugatedNormal(), roughness: 0.5, metalness: 0.55 }),
  /** Running-bond brick. */
  brickWall: () => std('brickWall', { color: PALETTE.brick, map: textures.brick(), roughness: 0.9, metalness: 0.02 }),
  /** Warm lit window (unlit, glows without lights). */
  windowLit: () => memo('windowLit', () => new THREE.MeshBasicMaterial({ map: textures.dustyWindow(), color: '#ffffff' })),
  /** Unlit warm lamp lens. */
  lampLens: () => memo('lampLens', () => new THREE.MeshBasicMaterial({ color: new THREE.Color('#FFE4B5').multiplyScalar(2.2) })),
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
