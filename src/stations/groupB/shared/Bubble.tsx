import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { buildAtlas, roundRectPath, type UvRect } from './canvas'
import { FONT_DISPLAY } from './fonts'

/**
 * Comic speech bubbles above NPC heads (in-world fiction: "OUT!", "SAVE! …OH.").
 * All phrases of a station live in one canvas atlas; each bubble is a sprite
 * with its own lightweight Texture view (shared image source → one upload).
 * Pops in (or fades, with reduced motion), holds, fades out.
 */
export interface BubbleAtlas {
  texture: THREE.CanvasTexture
  uv: Record<string, UvRect>
  aspect: Record<string, number>
}

const CELL_H = 132
const FONT_PX = 62

export function buildBubbleAtlas(phrases: string[]): BubbleAtlas {
  const probe = document.createElement('canvas').getContext('2d')!
  probe.font = `700 ${FONT_PX}px ${FONT_DISPLAY}`
  const uniq = [...new Set(phrases)]
  const sizes = uniq.map((p) => Math.min(1000, Math.ceil(probe.measureText(p).width) + 76))
  const atlas = buildAtlas(
    uniq.map((p, i) => ({
      id: p,
      w: sizes[i],
      h: CELL_H,
      draw: (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h)
        const bh = h - 30
        // tail
        ctx.fillStyle = '#fbf8ef'
        ctx.strokeStyle = '#1f2426'
        ctx.lineWidth = 5
        roundRectPath(ctx, 4, 4, w - 8, bh - 4, 26)
        ctx.fill()
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(w / 2 - 16, bh - 3)
        ctx.lineTo(w / 2 + 2, h - 4)
        ctx.lineTo(w / 2 + 14, bh - 3)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillRect(w / 2 - 13, bh - 8, 25, 8)
        ctx.fillStyle = '#1f2426'
        ctx.font = `700 ${FONT_PX}px ${FONT_DISPLAY}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(p, w / 2, bh / 2 + 3)
      },
    })),
    1024,
    6,
    4,
  )
  const aspect: Record<string, number> = {}
  uniq.forEach((p, i) => (aspect[p] = sizes[i] / CELL_H))
  return { texture: atlas.texture, uv: atlas.uv, aspect }
}

export interface BubbleController {
  phrase: string | null
  started: number
  until: number
  /** Monotonic counter so repeated identical phrases re-pop. */
  serial: number
  say(phrase: string, seconds?: number): void
  clear(): void
}

export function useBubbleController(): BubbleController {
  return useMemo<BubbleController>(
    () => ({
      phrase: null,
      started: 0,
      until: 0,
      serial: 0,
      say(phrase: string, seconds = 2.2) {
        this.phrase = phrase
        this.started = performance.now() / 1000
        this.until = this.started + seconds
        this.serial++
      },
      clear() {
        this.phrase = null
      },
    }),
    [],
  )
}

export function Bubble({ ctrl, atlas, height = 0.44, reduced, position }: { ctrl: BubbleController; atlas: BubbleAtlas; height?: number; reduced: boolean; position: [number, number, number] }) {
  const sprite = useMemo(() => {
    const tex = atlas.texture.clone()
    tex.needsUpdate = false
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })
    const s = new THREE.Sprite(mat)
    s.center.set(0.5, 0)
    s.visible = false
    s.renderOrder = 10
    s.name = 'stations-b:bubble'
    // decorative: never a raycast target (other systems raycast the scene without a camera)
    s.raycast = () => {}
    return { s, mat, tex }
  }, [atlas])
  const shown = useRef(-1)
  useEffect(
    () => () => {
      sprite.mat.dispose()
      sprite.tex.dispose()
    },
    [sprite],
  )
  useFrame(() => {
    const { s, mat, tex } = sprite
    const now = performance.now() / 1000
    const p = ctrl.phrase
    if (!p || now > ctrl.until || !atlas.uv[p]) {
      if (s.visible) s.visible = false
      return
    }
    if (shown.current !== ctrl.serial) {
      shown.current = ctrl.serial
      const [u0, v0, u1, v1] = atlas.uv[p]
      tex.offset.set(u0, v0)
      tex.repeat.set(u1 - u0, v1 - v0)
      tex.updateMatrix()
    }
    const age = now - ctrl.started
    const left = ctrl.until - now
    const w = height * (atlas.aspect[p] ?? 3)
    let k = 1
    if (!reduced) {
      const a = Math.min(1, age / 0.18)
      k = a < 1 ? 0.3 + 0.7 * a + Math.sin(a * Math.PI) * 0.18 : 1
    }
    s.scale.set(w * k, height * k, 1)
    mat.opacity = Math.min(1, left / 0.3, reduced ? age / 0.25 : 1)
    s.visible = true
  })
  return <primitive object={sprite.s} position={position} />
}
