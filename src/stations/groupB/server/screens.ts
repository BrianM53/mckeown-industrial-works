import * as THREE from 'three'
import { simClock } from '@/core/clock'
import { FONT_MONO } from '../shared/fonts'
import type { CrtScreen, CrtStyle } from './crt'

/**
 * CRT screen atlas + shader. Every screen in the hall lives in ONE canvas
 * texture and ONE merged mesh (a single draw call): per-vertex `aCell` selects
 * the atlas cell. The shader adds barrel curvature, scanlines, a rolling
 * refresh band, vignette and the blinking "PRESS E" band (bottom 14% of each
 * cell). Reduced motion: no blink, no roll.
 */
export const CELL = { w: 512, h: 384 }
/** Bottom band of a cell (in cell v, 0 = bottom) that blinks: holds the prompt. */
export const PROMPT_BAND = 0.15

const STYLE: Record<CrtStyle, { size: number; lh: number; color: string; weight: number }> = {
  dim: { size: 17, lh: 25, color: '#3fae69', weight: 600 },
  rule: { size: 10, lh: 14, color: '#2f8a52', weight: 600 },
  title: { size: 30, lh: 36, color: '#c8ffd9', weight: 600 },
  body: { size: 19, lh: 25, color: '#7dff9e', weight: 600 },
  tech: { size: 18, lh: 25, color: '#5ee08b', weight: 600 },
  prompt: { size: 23, lh: 30, color: '#d2ffe0', weight: 600 },
  big: { size: 104, lh: 104, color: '#b5ffcb', weight: 600 },
}

function paintCell(ctx: CanvasRenderingContext2D, s: CrtScreen, w: number, h: number): void {
  const bg = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w * 0.7)
  bg.addColorStop(0, '#06180d')
  bg.addColorStop(1, '#020804')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  const padX = 24
  let y = 18
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  for (const line of s.lines) {
    const st = STYLE[line.style]
    if (line.style === 'rule') {
      ctx.fillStyle = st.color
      for (let x = padX; x < w - padX; x += 12) ctx.fillRect(x, y + 5, 7, 2)
      y += st.lh
      continue
    }
    if (y + st.lh > h * (1 - PROMPT_BAND) - 4) break
    ctx.font = `${st.weight} ${st.size}px ${FONT_MONO}`
    ctx.fillStyle = st.color
    ctx.shadowColor = st.color
    ctx.shadowBlur = line.style === 'title' || line.style === 'big' ? 10 : 5
    let text = line.text
    // never overflow the glass: trim with an ellipsis if the font is wider than expected
    while (text.length > 1 && ctx.measureText(text).width > w - padX * 2) text = `${text.slice(0, -2)}…`
    ctx.fillText(text, padX, y)
    y += st.lh
  }
  ctx.shadowBlur = 0
  if (s.prompt) {
    const st = STYLE.prompt
    ctx.font = `${st.weight} ${st.size}px ${FONT_MONO}`
    ctx.fillStyle = st.color
    ctx.shadowColor = st.color
    ctx.shadowBlur = 8
    ctx.textBaseline = 'middle'
    ctx.fillText(s.prompt, padX, h * (1 - PROMPT_BAND / 2) - 6)
    ctx.shadowBlur = 0
  }
}

export interface ScreenAtlas {
  texture: THREE.CanvasTexture
  /** Cell rect [u0, v0, du, dv] per screen id. */
  cells: Record<string, [number, number, number, number]>
}

export function buildScreenAtlas(screens: CrtScreen[]): ScreenAtlas {
  const cols = 4
  const rows = Math.max(1, Math.ceil(screens.length / cols))
  const canvas = document.createElement('canvas')
  canvas.width = CELL.w * cols
  canvas.height = CELL.h * rows
  const ctx = canvas.getContext('2d')!
  const cells: ScreenAtlas['cells'] = {}
  screens.forEach((s, i) => {
    const cx = (i % cols) * CELL.w
    const cy = Math.floor(i / cols) * CELL.h
    ctx.save()
    ctx.translate(cx, cy)
    ctx.beginPath()
    ctx.rect(0, 0, CELL.w, CELL.h)
    ctx.clip()
    paintCell(ctx, s, CELL.w, CELL.h)
    ctx.restore()
    const inset = 1.5
    cells[s.id] = [(cx + inset) / canvas.width, 1 - (cy + CELL.h - inset) / canvas.height, (CELL.w - inset * 2) / canvas.width, (CELL.h - inset * 2) / canvas.height]
  })
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return { texture, cells }
}

export const screenUniforms = { uTime: { value: 0 }, uCalm: { value: 0 } }

export function makeScreenMaterial(texture: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'stations-b:crt',
    uniforms: { map: { value: texture }, uTime: screenUniforms.uTime, uCalm: screenUniforms.uCalm },
    vertexShader: /* glsl */ `
      attribute vec4 aCell;
      varying vec2 vUv;
      varying vec4 vCell;
      void main() {
        vUv = uv;
        vCell = aCell;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float uTime;
      uniform float uCalm;
      varying vec2 vUv;
      varying vec4 vCell;
      void main() {
        vec2 c = vUv - 0.5;
        vec2 uv = 0.5 + c * (1.0 + 0.09 * dot(c, c));
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        vec3 tex = texture2D(map, vCell.xy + clamp(uv, 0.0, 1.0) * vCell.zw).rgb;
        float band = step(uv.y, ${PROMPT_BAND.toFixed(3)});
        float blink = mix(1.0, 0.25 + 0.75 * step(0.42, fract(uTime * 0.85 + vCell.x * 3.1)), band * (1.0 - uCalm));
        float scan = 0.8 + 0.2 * sin(uv.y * 420.0);
        float rollPos = fract(uTime * 0.11 + vCell.y);
        float roll = 1.0 + (1.0 - uCalm) * 0.1 * smoothstep(0.06, 0.0, abs(uv.y - rollPos));
        float vig = smoothstep(0.78, 0.22, length(c * vec2(1.0, 1.15)));
        vec3 col = tex * scan * roll * blink * (0.45 + 0.65 * vig) * 1.25;
        col += vec3(0.008, 0.03, 0.014) * vig;
        gl_FragColor = vec4(col * inside, 1.0);
        #include <colorspace_fragment>
      }`,
  })
}

export function tickScreens(calm: boolean): void {
  screenUniforms.uTime.value = simClock.t
  screenUniforms.uCalm.value = calm ? 1 : 0
}

/** Gently bulged screen quad (convex toward +Z), w × h, segmented for curvature. */
function bulgedQuad(w: number, h: number, bulge: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, 8, 6)
  const p = g.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const nx = (p.getX(i) / w) * 2
    const ny = (p.getY(i) / h) * 2
    p.setZ(i, bulge * (1 - 0.5 * (nx * nx + ny * ny)))
  }
  g.computeVertexNormals()
  return g
}

export interface ScreenPlacement {
  id: string
  matrix: THREE.Matrix4
  w: number
  h: number
}

/** Merge every screen into one geometry with per-vertex atlas cells. */
export function buildScreenGeometry(placements: ScreenPlacement[], atlas: ScreenAtlas): THREE.BufferGeometry {
  const parts = placements.map((pl) => {
    const g = bulgedQuad(pl.w, pl.h, Math.min(pl.w, pl.h) * 0.06)
    g.applyMatrix4(pl.matrix)
    const cell = atlas.cells[pl.id] ?? [0, 0, 0.01, 0.01]
    const n = g.getAttribute('position').count
    const a = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) a.set(cell, i * 4)
    g.setAttribute('aCell', new THREE.BufferAttribute(a, 4))
    return g
  })
  let vCount = 0
  let iCount = 0
  for (const g of parts) {
    vCount += g.getAttribute('position').count
    iCount += g.index!.count
  }
  const pos = new Float32Array(vCount * 3)
  const uv = new Float32Array(vCount * 2)
  const cell = new Float32Array(vCount * 4)
  const idx = new Uint16Array(iCount)
  let vo = 0
  let io = 0
  for (const g of parts) {
    const n = g.getAttribute('position').count
    pos.set(g.getAttribute('position').array as Float32Array, vo * 3)
    uv.set(g.getAttribute('uv').array as Float32Array, vo * 2)
    cell.set(g.getAttribute('aCell').array as Float32Array, vo * 4)
    const gi = g.index!
    for (let i = 0; i < gi.count; i++) idx[io + i] = gi.getX(i) + vo
    vo += n
    io += gi.count
    g.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  out.setAttribute('aCell', new THREE.BufferAttribute(cell, 4))
  out.setIndex(new THREE.BufferAttribute(idx, 1))
  out.computeBoundingSphere()
  return out
}
