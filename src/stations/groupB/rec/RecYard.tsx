import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { events } from '@/core/events'
import { useInteractable } from '@/core/interaction'
import { useUIStore } from '@/state/ui'
import { ZONES } from '@/world/layout'
import { PALETTE } from '@/world/palette'
import { WorkerModel, type WorkerAnim, type WorkerLook } from '@/world/WorkerModel'
import { BatchMeshes } from '../shared/BatchMeshes'
import { Bubble, buildBubbleAtlas, useBubbleController, type BubbleAtlas } from '../shared/Bubble'
import { buildAtlas, fitText, grime, makeCanvasTexture } from '../shared/canvas'
import { StaticColliders } from '../shared/colliders'
import { FONT_DISPLAY, FONT_MONO } from '../shared/fonts'
import { useQuality, useReducedMotion } from '../shared/hooks'
import { recColliders } from './colliders'
import { BLEACHERS, RULES_INTERACT, SPECTATORS } from './layout'
import { ARGUE_PHRASES, DISPUTE_PHRASES, RETURN_PHRASES } from './opponent'
import { digits, recScore, scoreLine } from './score'
import { KEEPER_PHRASES, Soccer } from './Soccer'
import { Volleyball } from './Volleyball'
import { buildYard, scoreboardFace, seatX } from './yardStatic'

/**
 * RECREATION YARD (spec §5.5): fenced open-air yard with a soccer pitch and a
 * volleyball court, bleachers under a shade canopy, flood lights, a canvas
 * scoreboard (GOALS n · POINTS n) and a rules board at the gate that opens the
 * yard panel. Personal-interest area: short, optional, forgiving.
 */
const SPECTATOR_PHRASES = ['GOOOAL!', 'WOOO!', 'NICE!']

const SPECTATOR_LOOKS: Partial<WorkerLook>[] = [
  { helmet: '#E9B63F', vest: '#E57D35', shirt: '#5a4a6b', accessory: 'mug' },
  { helmet: '#f2f2ea', vest: '#d2e83e', shirt: '#3e5a40', face: 'beard' },
]

const RULES = ['1. NO FORKLIFTS ON THE PITCH.', '2. THE KEEPER IS ALWAYS RIGHT.', '3. “OUT” MEANS WHATEVER RHONDA SAYS.', '4. HYDRATE. STRETCH. ARGUE.']

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

function canvasTex(size: [number, number], draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = size[0]
  c.height = size[1]
  draw(c.getContext('2d')!, size[0], size[1])
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  return t
}

function makeYardMaterials(signTex: THREE.Texture) {
  const chainTex = canvasTex([128, 128], (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 5
    const step = w / 6
    for (let i = -6; i <= 12; i++) {
      ctx.beginPath()
      ctx.moveTo(i * step, 0)
      ctx.lineTo(i * step + h, h)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(i * step, h)
      ctx.lineTo(i * step + h, 0)
      ctx.stroke()
    }
  })
  const netTex = canvasTex([64, 64], (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, 7)
    ctx.fillRect(0, 0, 7, h)
  })
  const turfTex = canvasTex([256, 256], (ctx, w, h) => {
    ctx.fillStyle = '#4f7d3f'
    ctx.fillRect(0, 0, w, h / 2)
    ctx.fillStyle = '#5a8a48'
    ctx.fillRect(0, h / 2, w, h / 2)
    let s = 7
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = r() < 0.5 ? 'rgba(30,60,25,0.25)' : 'rgba(140,180,110,0.18)'
      ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 2 + r() * 3)
    }
  })
  const courtTex = canvasTex([256, 256], (ctx, w, h) => {
    ctx.fillStyle = '#b97a4c'
    ctx.fillRect(0, 0, w, h)
    let s = 11
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
    for (let i = 0; i < 3000; i++) {
      const v = 120 + Math.floor(r() * 90)
      ctx.fillStyle = `rgba(${v + 40},${v},${v - 40},0.18)`
      ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2)
    }
    grime(ctx, w, h, 4, 0.3)
  })
  const awningTex = canvasTex([64, 256], (ctx, w, h) => {
    ctx.fillStyle = PALETTE.safety
    ctx.fillRect(0, 0, w, h / 2)
    ctx.fillStyle = '#f1e9d6'
    ctx.fillRect(0, h / 2, w, h / 2)
    ctx.fillStyle = 'rgba(60,40,20,0.08)'
    for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1)
  })
  const mats = {
    chain: new THREE.MeshStandardMaterial({ map: chainTex, alphaTest: 0.45, side: THREE.DoubleSide, color: '#c9d0d1', metalness: 0.5, roughness: 0.45 }),
    net: new THREE.MeshStandardMaterial({ map: netTex, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.9 }),
    turf: new THREE.MeshStandardMaterial({ map: turfTex, roughness: 0.96, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    court: new THREE.MeshStandardMaterial({ map: courtTex, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    line: new THREE.MeshStandardMaterial({ color: '#f2f0e8', roughness: 0.8, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }),
    awning: new THREE.MeshStandardMaterial({ map: awningTex, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 }),
    sign: new THREE.MeshStandardMaterial({ map: signTex, emissiveMap: signTex, emissive: '#ffffff', emissiveIntensity: 0.12, roughness: 0.7, metalness: 0.05 }),
  }
  for (const [k, m] of Object.entries(mats)) m.name = `stations-b:rec-${k}`
  const textures = [chainTex, netTex, turfTex, courtTex, awningTex]
  return { mats, textures }
}

function buildSigns() {
  return buildAtlas(
    [
      {
        id: 'banner',
        w: 1024,
        h: 205,
        draw: (ctx, w, h) => {
          ctx.fillStyle = '#2b4a2c'
          ctx.fillRect(0, 0, w, h)
          ctx.strokeStyle = '#EAE3D2'
          ctx.lineWidth = 8
          ctx.strokeRect(10, 10, w - 20, h - 20)
          ctx.fillStyle = '#EAE3D2'
          fitText(ctx, 'McKEOWN INDUSTRIAL WORKS', w / 2, h * 0.36, w - 80, 70, FONT_DISPLAY, 700)
          ctx.fillStyle = PALETTE.hazard
          fitText(ctx, 'STAFF LEAGUE · EST. LAST TUESDAY', w / 2, h * 0.72, w - 120, 52, FONT_DISPLAY, 600)
          grime(ctx, w, h, 12, 0.5)
        },
      },
      {
        id: 'rules',
        w: 512,
        h: 358,
        draw: (ctx, w, h) => {
          ctx.fillStyle = '#e9e3cf'
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = '#2b4a2c'
          ctx.fillRect(0, 0, w, 70)
          ctx.fillStyle = '#f3eedf'
          fitText(ctx, 'REC YARD RULES', w / 2, 37, w - 40, 54, FONT_DISPLAY, 700)
          ctx.fillStyle = '#23292b'
          RULES.forEach((r, i) => fitText(ctx, r, 22, 102 + i * 46, w - 44, 30, FONT_DISPLAY, 600, 'left'))
          ctx.fillStyle = ZONES.rec.color
          ctx.fillRect(0, h - 52, w, 52)
          ctx.fillStyle = '#ffffff'
          fitText(ctx, 'PRESS E · HOW TO PLAY', w / 2, h - 25, w - 40, 32, FONT_DISPLAY, 700)
          grime(ctx, w, h, 21, 0.6)
        },
      },
    ],
    1024,
    4,
    8,
  )
}

// ---------------------------------------------------------------------------
// Scoreboard (dynamic canvas, redrawn only when the score changes)
// ---------------------------------------------------------------------------

function drawScoreboard(ctx: CanvasRenderingContext2D, w: number, h: number, goals: number, points: number): void {
  ctx.fillStyle = '#0d0f10'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#1b2022'
  ctx.fillRect(8, 8, w - 16, 52)
  ctx.fillStyle = '#EAE3D2'
  fitText(ctx, 'REC YARD · STAFF LEAGUE', w / 2, 35, w - 40, 38, FONT_DISPLAY, 700)
  const col = (cx: number, label: string, n: number, color: string) => {
    ctx.fillStyle = '#9aa3a5'
    fitText(ctx, label, cx, 92, 200, 34, FONT_DISPLAY, 700)
    ctx.fillStyle = '#1a1206'
    ctx.fillRect(cx - 86, 116, 172, 110)
    ctx.font = `600 104px ${FONT_MONO}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(255,170,40,0.12)'
    ctx.fillText('88', cx, 174)
    ctx.shadowColor = color
    ctx.shadowBlur = 16
    ctx.fillStyle = color
    ctx.fillText(digits(n), cx, 174)
    ctx.shadowBlur = 0
  }
  col(w * 0.27, 'GOALS', goals, '#ffb23f')
  col(w * 0.73, 'POINTS', points, '#ffb23f')
  ctx.fillStyle = '#5d6669'
  fitText(ctx, scoreLine(goals, points), w / 2, h - 18, w - 60, 22, FONT_MONO, 600)
}

function Scoreboard() {
  const face = useMemo(() => scoreboardFace(), [])
  const board = useMemo(() => {
    const c = makeCanvasTexture(512, 264)
    drawScoreboard(c.ctx, 512, 264, recScore.goals, recScore.points)
    c.texture.needsUpdate = true
    const mat = new THREE.MeshBasicMaterial({ map: c.texture, toneMapped: false })
    mat.name = 'stations-b:scoreboard'
    const geo = new THREE.PlaneGeometry(face.w, face.h)
    return { ...c, mat, geo }
  }, [face])
  useEffect(() => {
    const off = recScore.subscribe(() => {
      drawScoreboard(board.ctx, 512, 264, recScore.goals, recScore.points)
      board.texture.needsUpdate = true
    })
    return () => {
      off()
      board.texture.dispose()
      board.mat.dispose()
      board.geo.dispose()
    }
  }, [board])
  return <mesh geometry={board.geo} material={board.mat} position={face.pos} rotation-y={face.yaw} name="rec-scoreboard" />
}

// ---------------------------------------------------------------------------
// Spectators (cheer on goals)
// ---------------------------------------------------------------------------

function Spectators({ atlas, reduced }: { atlas: BubbleAtlas; reduced: boolean }) {
  const state = useRef({ cheerUntil: 0, clapUntil: 0, goals: recScore.goals, points: recScore.points })
  const bubble = useBubbleController()
  const anim = useRef<WorkerAnim[]>(SPECTATORS.map(() => 'sit'))
  useEffect(
    () =>
      recScore.subscribe(() => {
        const s = state.current
        const now = performance.now() / 1000
        if (recScore.goals > s.goals) {
          s.cheerUntil = now + 2.6
          bubble.say(SPECTATOR_PHRASES[recScore.goals % 2], 2)
        } else if (recScore.points > s.points) {
          s.clapUntil = now + 1.6
          if (recScore.points % 3 === 0) bubble.say(SPECTATOR_PHRASES[2], 1.6)
        }
        s.goals = recScore.goals
        s.points = recScore.points
      }),
    [bubble],
  )
  useFrame(() => {
    const now = performance.now() / 1000
    const s = state.current
    for (let i = 0; i < anim.current.length; i++) anim.current[i] = now < s.cheerUntil ? (i === 0 ? 'cheer' : 'wave') : now < s.clapUntil && i === 1 ? 'wave' : 'sit'
  })
  return (
    <group name="rec-spectators">
      {SPECTATORS.map((sp, i) => (
        <group key={i} position={[seatX(sp.tier), BLEACHERS.tierH * sp.tier, sp.z]} rotation-y={BLEACHERS.yaw}>
          <WorkerModel look={SPECTATOR_LOOKS[i % SPECTATOR_LOOKS.length]} anim={() => anim.current[i]} seed={sp.seed} />
          {i === 0 && <Bubble ctrl={bubble} atlas={atlas} reduced={reduced} position={[0, 1.75, 0]} height={0.4} />}
        </group>
      ))}
    </group>
  )
}

function RulesInteract() {
  useInteractable({
    id: 'rec:rules',
    verb: 'Read',
    label: 'Rec Yard Rules',
    radius: 2.3,
    getPosition: () => ({ x: RULES_INTERACT[0], y: 0, z: RULES_INTERACT[1] }),
    onInteract: () => {
      events.emit('sfx', { name: 'ui-click', volume: 0.6 })
      useUIStore.getState().openPanel('rec')
    },
  })
  return null
}

export function RecYard() {
  const quality = useQuality()
  const reduced = useReducedMotion()
  const built = useMemo(() => {
    const signs = buildSigns()
    const geos = buildYard({ uv: signs.uv })
    const { mats, textures } = makeYardMaterials(signs.texture)
    const bubbles = buildBubbleAtlas([...KEEPER_PHRASES, ...ARGUE_PHRASES, ...DISPUTE_PHRASES, ...RETURN_PHRASES, ...SPECTATOR_PHRASES])
    return { geos, mats, textures: [...textures, signs.texture], bubbles }
  }, [])
  const colliders = useMemo(() => recColliders(), [])
  useEffect(
    () => () => {
      Object.values(built.mats).forEach((m) => m.dispose())
      built.textures.forEach((t) => t.dispose())
      built.bubbles.texture.dispose()
    },
    [built],
  )
  const shadows = quality !== 'low'
  return (
    <group name="stations-b:rec-yard">
      <BatchMeshes geos={built.geos} shadows={shadows} materials={built.mats} noShadowKeys={['turf', 'court', 'line', 'chain', 'net']} name="rec" />
      <Scoreboard />
      <Soccer atlas={built.bubbles} reduced={reduced} />
      <Volleyball atlas={built.bubbles} reduced={reduced} />
      {quality !== 'low' && <Spectators atlas={built.bubbles} reduced={reduced} />}
      <StaticColliders defs={colliders} name="stations-b:rec-colliders" />
      <RulesInteract />
    </group>
  )
}
