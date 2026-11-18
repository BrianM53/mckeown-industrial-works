import * as THREE from 'three'
import { RESTRICTED_ZONES, ZONES, type ZoneId } from '@/world/layout'
import { PALETTE } from '@/world/palette'
import { BUILDINGS } from '../data/buildings'
import { BLADE_LABELS, MOTTO, POSTERS, WELCOME_SUB, WELCOME_TITLE, buildingSignText } from '../data/text'
import { atlasColorTexture, buildAtlas, type AtlasItem, type Cell } from '../lib/atlas'
import {
  CREAM,
  INK,
  PANEL,
  drawArch,
  drawBlade,
  drawBuildingSign,
  drawContainerSide,
  drawGantryPanel,
  drawIncidentBoard,
  drawMotto,
  drawOnAir,
  drawPegboard,
  drawPieFace,
  drawPoster,
  drawRestricted,
  drawSimpleSign,
  drawStencil,
  drawTruckSide,
  drawVendingFront,
  drawWhiteboard,
  text,
} from '../lib/signArt'

/** All vertical signage in one sRGB atlas (one texture, two materials: sign / poster). */
export interface SignAtlas {
  texture: THREE.CanvasTexture
  cells: Record<string, Cell>
}

/** Gantry panel contents (directions are fixed by the layout: west / north / east of the main aisle). */
export const GANTRY_PANELS: { key: string; arrow: 'left' | 'up' | 'right'; items: { label: string; color: string }[] }[] = [
  {
    key: 'gantry:left',
    arrow: 'left',
    items: [
      { label: 'CONTROL ROOM · HARMONY AI', color: ZONES.control.color },
      { label: 'SERVER HALL · GITHUB', color: ZONES.server.color },
      { label: 'R&D ANNEX', color: ZONES.rnd.color },
    ],
  },
  {
    key: 'gantry:up',
    arrow: 'up',
    items: [
      { label: 'PRODUCTION', color: ZONES.production.color },
      { label: 'ROCKET TOWER', color: ZONES.tower.color },
      { label: 'LAUNCH YARD', color: ZONES.launch.color },
    ],
  },
  {
    key: 'gantry:right',
    arrow: 'right',
    items: [
      { label: 'RADIO BOOTH · CODE STORY', color: ZONES.radio.color },
      { label: 'REC YARD', color: ZONES.rec.color },
      { label: 'BREAK ROOM', color: ZONES.breakroom.color },
    ],
  },
]

/** Extra simple signs: key -> [title, sub, bg, fg, accent?]. */
export const SIMPLE_SIGNS: Record<string, [string, string, string, string, string?]> = {
  'spawn:personnel': ['RÉSUMÉ · PERSONNEL  →', '', PANEL, CREAM, ZONES.personnel.color],
  'spawn:maintenance': ['←  MAINTENANCE BAY', '', PANEL, CREAM, ZONES.maintenance.color],
  'gantry:back': ['VISITOR INTAKE  ·  EXIT', 'THANK YOU FOR NOT TOUCHING ANYTHING', PANEL, CREAM, PALETTE.hazard],
  gate: ['MAIN GATE — CLOSED', 'VISITORS: PLEASE USE THE WEBSITE', '#C8302A', '#F7F1E6'],
  fence1: ['PRIVATE PROPERTY', 'NO TRESPASSING. ALSO NO PASSING.', '#F1ECE0', INK, '#C8302A'],
  fence2: ['ROCKET TESTING NEARBY', 'EXPECT THE UNEXPECTED. THEN DUCK.', '#F1ECE0', INK, PALETTE.hazard],
  fence3: ['THIS FENCE IS LOAD-BEARING', 'PLEASE DO NOT LEAN ON IT', '#F1ECE0', INK, PALETTE.safety],
  lift: ['LIFT CAPACITY: 1 ROCKET', '(SMALL ROCKET)', PALETTE.hazard, INK],
  sigh: ['DESIGNATED SIGHING AREA', 'PLEASE SIGH RESPONSIBLY', '#2F7D4A', '#F3EFE4'],
  serving: ['NOW SERVING: 0', 'PLEASE TAKE A NUMBER', '#1B1F1F', '#FF6B4A'],
  obs: ['OBSERVATION DECK', 'FOR OBSERVING ONLY', PANEL, CREAM, ZONES.launch.color],
  bunker: ['LAUNCH CONTROL', 'PLEASE KNOCK. WE WILL NOT HEAR YOU.', '#5A5F5C', CREAM, PALETTE.hazard],
  lostfound: ['PARTS RECOVERY', 'LOST & FOUND (ROCKETS)', PALETTE.hazard, INK],
  breakarea: ['BREAK AREA', 'BREAKS ARE MANDATORY. FUN IS OPTIONAL.', ZONES.breakroom.color, INK],
  wetsince: ['WET SINCE 2019', 'DO NOT TEST', '#F1ECE0', INK, PALETTE.hazard],
  rndwaste: ['R&D WASTE', 'PROBABLY FINE', '#5DBB63', INK],
  banner: ['PRODUCTION SPINE', 'ROCKETS · ALLEGEDLY', '#1F2525', CREAM, PALETTE.rust],
  exec: ['EXECUTIVE OFFICE', 'AUTHORIZED SYNERGY ONLY', '#1C1F22', '#E8D9A8', '#8C6BB1'],
  pietitle: ['Q3 SYNERGY BREAKDOWN', 'CONFIDENTIAL · DO NOT UNDERSTAND', '#F4EFE2', INK],
  recgate: ['RECREATION YARD', 'HYDRATE · STRETCH · ARGUE ABOUT RULES', '#2B4A2C', '#EAF2E0', ZONES.rec.color],
  deck: ['KEEP OFF THE PAD', 'ROCKETS HAVE RIGHT OF WAY', '#C8302A', '#F7F1E6'],
  tower: ['TOWER PLAZA', 'MIND THE TRANSPORTER', PANEL, CREAM, ZONES.tower.color],
  water: ['McKEOWN', '', '#C9CBC4', '#2A3133'],
  hardhat: ['HARD HAT AREA', 'SOFT HATS TOLERATED', PALETTE.hazard, INK],
  tank1: ['NON-POTABLE', 'NOT FOR COFFEE', '#F1ECE0', INK, '#4F86A8'],
  tank2: ['FLAMMABLE', 'LIKE OUR ROCKETS', '#C8302A', '#F7F1E6'],
}

const BLADE_ZONES = Object.keys(BLADE_LABELS) as ZoneId[]

let cache: { scale: number; atlas: SignAtlas } | null = null

export function getSignAtlas(scale: number, anisotropy: number): SignAtlas {
  if (cache && cache.scale === scale) return cache.atlas
  cache?.atlas.texture.dispose()
  const items: AtlasItem[] = []
  // building signs + number stencils
  for (const b of BUILDINGS) {
    const t = buildingSignText(b.id)
    items.push({ key: `bldg:${b.id}`, w: 900, h: 164, bg: PANEL, draw: (c, w, h) => drawBuildingSign(c, w, h, t.title, t.tab, b.zone.color, b.style.number) })
    items.push({ key: `num:${b.id}`, w: 360, h: 180, bg: null, draw: (c, w, h) => drawStencil(c, w, h, `${b.style.number}`, 'rgba(236,230,214,0.92)') })
  }
  items.push({ key: 'arch', w: 1500, h: 216, bg: PANEL, draw: (c, w, h) => drawArch(c, w, h, WELCOME_TITLE, WELCOME_SUB) })
  items.push({ key: 'motto', w: 900, h: 150, bg: '#d8c48f', draw: (c, w, h) => drawMotto(c, w, h, MOTTO) })
  for (const g of GANTRY_PANELS) items.push({ key: g.key, w: 620, h: 228, bg: '#1F4B3A', draw: (c, w, h) => drawGantryPanel(c, w, h, g.arrow, g.items) })
  for (const z of BLADE_ZONES)
    for (const tip of ['left', 'right'] as const)
      items.push({ key: `blade:${z}:${tip}`, w: 420, h: 72, bg: null, draw: (c, w, h) => drawBlade(c, w, h, BLADE_LABELS[z], ZONES[z].color, tip) })
  POSTERS.forEach((p, i) => items.push({ key: `poster:${p.id}`, w: 190, h: 266, bg: '#efe6cf', draw: (c, w, h) => drawPoster(c, w, h, p, i * 7 + 3) }))
  for (const rz of RESTRICTED_ZONES) {
    const kind = rz.id === 'wet-paint' ? 'caution' : 'danger'
    const pict = rz.id === 'transformer-yard' ? 'bolt' : rz.id === 'blast-zone' ? 'rocket' : 'warning'
    items.push({ key: `restricted:${rz.id}`, w: 420, h: 300, bg: '#f2efe6', draw: (c, w, h) => drawRestricted(c, w, h, rz.label, rz.subLabel, kind, pict) })
  }
  items.push({
    key: 'bolt',
    w: 200,
    h: 200,
    bg: '#E9B63F',
    draw: (c, w, h) => {
      c.fillStyle = '#E9B63F'
      c.fillRect(0, 0, w, h)
      c.beginPath()
      c.moveTo(w / 2, 10)
      c.lineTo(w - 10, h - 14)
      c.lineTo(10, h - 14)
      c.closePath()
      c.fillStyle = INK
      c.fill()
      c.beginPath()
      c.moveTo(w / 2, 34)
      c.lineTo(w - 34, h - 28)
      c.lineTo(34, h - 28)
      c.closePath()
      c.fillStyle = '#E9B63F'
      c.fill()
      c.fillStyle = INK
      c.beginPath()
      c.moveTo(w * 0.54, h * 0.32)
      c.lineTo(w * 0.4, h * 0.62)
      c.lineTo(w * 0.5, h * 0.62)
      c.lineTo(w * 0.44, h * 0.82)
      c.lineTo(w * 0.62, h * 0.52)
      c.lineTo(w * 0.52, h * 0.52)
      c.closePath()
      c.fill()
    },
  })
  items.push({ key: 'incident', w: 460, h: 312, bg: '#f3efe4', draw: (c, w, h) => drawIncidentBoard(c, w, h) })
  items.push({ key: 'pie', w: 512, h: 512, bg: null, draw: (c, w) => drawPieFace(c, w) })
  ;[0, 1, 2].forEach((v) => items.push({ key: `vending:${v}`, w: 168, h: 320, bg: '#333', draw: (c, w, h) => drawVendingFront(c, w, h, v) }))
  items.push({ key: 'pegboard', w: 560, h: 200, bg: '#9a7b55', draw: (c, w, h) => drawPegboard(c, w, h) })
  items.push({ key: 'whiteboard', w: 420, h: 210, bg: '#f4f6f4', draw: (c, w, h) => drawWhiteboard(c, w, h) })
  items.push({ key: 'truck:red', w: 640, h: 220, bg: '#e9e6dc', draw: (c, w, h) => drawTruckSide(c, w, h, 'McKEOWN LOGISTICS', '#D9483B', 'WE DELIVER. EVENTUALLY.') })
  items.push({ key: 'truck:yellow', w: 640, h: 220, bg: '#e9e6dc', draw: (c, w, h) => drawTruckSide(c, w, h, 'PARTS & MORE PARTS', '#E9B63F', 'IF IT FELL OFF A ROCKET, WE HAVE IT.') })
  items.push({ key: 'trailer', w: 900, h: 200, bg: '#e9e6dc', draw: (c, w, h) => drawTruckSide(c, w, h, 'McKEOWN FREIGHT', '#638C88', 'SHIPPING ROCKET PARTS SINCE LAST TUESDAY') })
  items.push({ key: 'container:rust', w: 520, h: 224, bg: '#A95E39', draw: (c, w, h) => drawContainerSide(c, w, h, '#A95E39', 'MIWU 314159 2') })
  items.push({ key: 'container:blue', w: 520, h: 224, bg: '#4F86A8', draw: (c, w, h) => drawContainerSide(c, w, h, '#4F86A8', 'MIWU 271828 1') })
  items.push({ key: 'onair', w: 300, h: 110, bg: '#2a2d30', draw: (c, w, h) => drawOnAir(c, w, h) })
  items.push({
    key: 'watertower',
    w: 760,
    h: 170,
    bg: '#C9CBC4',
    draw: (c, w, h) => {
      c.fillStyle = '#C9CBC4'
      c.fillRect(0, 0, w, h)
      text(c, 'McKEOWN', w / 2, h * 0.55, { size: h * 0.82, color: '#2C4A5A', align: 'center', maxW: w * 0.96, spacing: 10 })
    },
  })
  for (const [key, [title, sub, bg, fg, accent]] of Object.entries(SIMPLE_SIGNS)) {
    const wide = key.startsWith('spawn:') || key === 'gantry:back' || key === 'banner' || key === 'recgate'
    items.push({ key: `s:${key}`, w: wide ? 640 : 420, h: wide ? 120 : 150, bg, draw: (c, w, h) => drawSimpleSign(c, w, h, title, sub, bg, fg, accent) })
  }
  const built = buildAtlas(items, 4096, scale, true, 6)
  const texture = atlasColorTexture(built, anisotropy)
  const atlas = { texture, cells: built.cells }
  cache = { scale, atlas }
  return atlas
}
