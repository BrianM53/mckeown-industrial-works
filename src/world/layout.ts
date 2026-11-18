/**
 * WORLD LAYOUT — the single source of truth for where everything is.
 * Integrator-owned contract: modules READ this; propose changes instead of editing.
 *
 * Conventions (see core/math.ts): meters, Y up, north = -Z, east = +X,
 * forward(yaw) = (-sin yaw, 0, -cos yaw); models face -Z locally.
 * Yaw shortcuts: NORTH = 0, WEST = PI/2, SOUTH = PI, EAST = -PI/2.
 *
 *  z=-48 ┌──────────────────────────────────────────────────────────────────────────────┐
 *        │ R&D ANNEX      W│            LAUNCH YARD          pad (16,-34)  ◎ blast r7.5   │
 *        │ x-46..-30       │  obs deck (2,-27)                         counter sign (27,-26)
 *        │ z-40..-26      A│                                          ║ track x=16         │
 *  z=-22 │                V│═════════════════ NORTH ROAD z-22..-18 ═══╬═══════════════════│
 *        │ SERVER HALL    E│ [wet paint]   TOWER PLAZA x-14..14     ║   [transformer]    │ REC YARD
 *        │ x-46..-30       │      ROCKET TOWER (0,-10) ═══track═════╝                    │ x30..48
 *        │ z-16..-2        │      collector belt z=0 (elevated)          E AVENUE x20..26│ z-24..-4
 *  z=2   │                 │ PIPE x-16 │SMELT x-9│ MAIN │CIRCUIT x9│TANK x16│              │
 *        │ CONTROL ROOM    │           │         │AISLE │          │        │              │ RADIO BOOTH
 *        │ x-46..-30       │  lines run z=18 → 2 (flow north), QC arch over aisle z=11     │ x30..42 z6..16
 *  z=19.5│═════════════════════════ SOUTH CROSS AISLE z19.5..23.5 ═══════════════════════│
 *        │ WAREHOUSE       │ MAINT BAY x-18..-7 │ INTAKE spawn(0,32) │ PERSONNEL x7..17 │ BREAK ROOM
 *        │ x-46..-30       │ forklift (-11,29)  │ arch z=38.5        │ z24..34          │ x30..44 z24..36
 *  z=40  └──────────────────────────────────────────────────────────────────────────────┘
 *       x=-50                                  x=0                                    x=50
 */
import type { LineId, Rect, Vec2 } from '@/core/types'

export const NORTH = 0
export const WEST = Math.PI / 2
export const SOUTH = Math.PI
export const EAST = -Math.PI / 2

/** Walkable world bounds (a perimeter wall sits on these edges). */
export const WORLD_BOUNDS: Rect = { minX: -50, maxX: 50, minZ: -48, maxZ: 40 }
/** The player/forklift must be kept inside this inset rect. */
export const PLAYABLE_BOUNDS: Rect = { minX: -49, maxX: 49, minZ: -47, maxZ: 39 }

export const SPAWN = { position: [0, 32] as Vec2, yaw: NORTH }

export type ZoneId =
  | 'intake'
  | 'personnel'
  | 'maintenance'
  | 'production'
  | 'tower'
  | 'launch'
  | 'control'
  | 'server'
  | 'rnd'
  | 'radio'
  | 'rec'
  | 'breakroom'
  | 'warehouse'

export type DoorSide = 'N' | 'S' | 'E' | 'W'

export interface BuildingDef {
  /** Outer wall footprint. */
  footprint: Rect
  /** Eave height in meters. */
  height: number
  /** Which wall has the entrance opening. */
  doorSide: DoorSide
  /** Opening span along that wall (z range for E/W walls, x range for N/S walls). */
  doorSpan: [number, number]
  /** Usable interior floor area for station content (inside the walls). */
  interior: Rect
  roof: 'flat' | 'sawtooth' | 'gable'
}

export interface ZoneDef {
  id: ZoneId
  name: string
  shortName: string
  /** Wayfinding color (floor paint, sign accents, map). */
  color: string
  center: Vec2
  bounds: Rect
  /** Point just outside the entrance; fast travel drops the player here. */
  entrance: Vec2
  /** Yaw for the player/camera on arrival (facing the station). */
  entranceYaw: number
  /** Nav waypoint id nearest the entrance. */
  waypoint: string
  building?: BuildingDef
  /** Portfolio panel this zone's main station opens (ui store PanelId). */
  panel?: 'resume' | 'harmony' | 'codestory' | 'github' | 'rec' | 'rnd' | 'console'
  /** One of the five principal portfolio destinations. */
  principal: boolean
  /** One-line description for the directory. */
  blurb: string
}

export const ZONES: Record<ZoneId, ZoneDef> = {
  intake: {
    id: 'intake',
    name: 'Visitor Intake',
    shortName: 'Intake',
    color: '#EAE3D2',
    center: [0, 32],
    bounds: { minX: -7, maxX: 7, minZ: 24, maxZ: 39 },
    entrance: [0, 32],
    entranceYaw: NORTH,
    waypoint: 'intake',
    principal: false,
    blurb: 'Spawn point. Sign in, grab a hard hat, try not to touch anything.',
  },
  personnel: {
    id: 'personnel',
    name: 'Personnel Office',
    shortName: 'Résumé',
    color: '#E9B63F',
    center: [12, 29],
    bounds: { minX: 7, maxX: 17, minZ: 24, maxZ: 34 },
    entrance: [4.5, 29],
    entranceYaw: EAST,
    waypoint: 'personnelDoor',
    building: {
      footprint: { minX: 7, maxX: 17, minZ: 24, maxZ: 34 },
      height: 6,
      doorSide: 'W',
      doorSpan: [25.5, 32.5],
      interior: { minX: 7.5, maxX: 16.5, minZ: 24.5, maxZ: 33.5 },
      roof: 'flat',
    },
    panel: 'resume',
    principal: true,
    blurb: 'Résumé, experience and contact. Home of the Résumé-O-Matic 3000.',
  },
  maintenance: {
    id: 'maintenance',
    name: 'Maintenance Bay',
    shortName: 'Forklift',
    color: '#E57D35',
    center: [-12.5, 29],
    bounds: { minX: -18, maxX: -7, minZ: 24, maxZ: 34 },
    entrance: [-4.5, 29],
    entranceYaw: WEST,
    waypoint: 'maintDoor',
    building: {
      footprint: { minX: -18, maxX: -7, minZ: 24, maxZ: 34 },
      height: 6.5,
      doorSide: 'E',
      doorSpan: [25, 33],
      interior: { minX: -17.5, maxX: -7.5, minZ: 24.5, maxZ: 33.5 },
      roof: 'gable',
    },
    principal: false,
    blurb: 'Company forklift. The dents are company culture.',
  },
  production: {
    id: 'production',
    name: 'Production Spine',
    shortName: 'Production',
    color: '#A95E39',
    center: [0, 10],
    bounds: { minX: -18, maxX: 18, minZ: 1, maxZ: 19 },
    entrance: [0, 21.5],
    entranceYaw: NORTH,
    waypoint: 'aisleS',
    panel: 'console',
    principal: false,
    blurb: 'Five process lines feeding the rocket tower. Line Supervisor Console included.',
  },
  tower: {
    id: 'tower',
    name: 'Rocket Assembly Tower',
    shortName: 'Tower',
    color: '#FFB05A',
    center: [0, -10],
    bounds: { minX: -14, maxX: 14, minZ: -18, maxZ: -2 },
    entrance: [0, -1],
    entranceYaw: NORTH,
    waypoint: 'plazaS',
    principal: false,
    blurb: 'Where questionable rockets are assembled from questionable parts.',
  },
  launch: {
    id: 'launch',
    name: 'Launch Yard',
    shortName: 'Launch',
    color: '#D9483B',
    center: [16, -34],
    bounds: { minX: -18, maxX: 32, minZ: -47, maxZ: -23 },
    entrance: [5, -21],
    entranceYaw: -0.65,
    waypoint: 'northMid',
    principal: false,
    blurb: 'Countdowns, launches and a very honest disassembly counter.',
  },
  control: {
    id: 'control',
    name: 'Manufacturing Control Room',
    shortName: 'Harmony AI',
    color: '#638C88',
    center: [-38, 13],
    bounds: { minX: -46, maxX: -30, minZ: 6, maxZ: 20 },
    entrance: [-27, 13],
    entranceYaw: WEST,
    waypoint: 'ctrlDoor',
    building: {
      footprint: { minX: -46, maxX: -30, minZ: 6, maxZ: 20 },
      height: 7.5,
      doorSide: 'E',
      doorSpan: [11, 15],
      interior: { minX: -45.5, maxX: -30.5, minZ: 6.5, maxZ: 19.5 },
      roof: 'flat',
    },
    panel: 'harmony',
    principal: true,
    blurb: 'Harmony AI — software for manufacturing. Live (simulated) telemetry.',
  },
  server: {
    id: 'server',
    name: 'Server Hall',
    shortName: 'GitHub',
    color: '#4F86A8',
    center: [-38, -9],
    bounds: { minX: -46, maxX: -30, minZ: -16, maxZ: -2 },
    entrance: [-27, -9],
    entranceYaw: WEST,
    waypoint: 'serverDoor',
    building: {
      footprint: { minX: -46, maxX: -30, minZ: -16, maxZ: -2 },
      height: 8.5,
      doorSide: 'E',
      doorSpan: [-11, -7],
      interior: { minX: -45.5, maxX: -30.5, minZ: -15.5, maxZ: -2.5 },
      roof: 'sawtooth',
    },
    panel: 'github',
    principal: true,
    blurb: 'Code on GitHub: selected repositories, blinking racks, one enormous fan.',
  },
  rnd: {
    id: 'rnd',
    name: 'R&D Annex',
    shortName: 'R&D',
    color: '#8C6BB1',
    center: [-38, -33],
    bounds: { minX: -46, maxX: -30, minZ: -40, maxZ: -26 },
    entrance: [-27, -33],
    entranceYaw: WEST,
    waypoint: 'rndDoor',
    building: {
      footprint: { minX: -46, maxX: -30, minZ: -40, maxZ: -26 },
      height: 7.5,
      doorSide: 'E',
      doorSpan: [-35, -31],
      interior: { minX: -45.5, maxX: -30.5, minZ: -39.5, maxZ: -26.5 },
      roof: 'flat',
    },
    panel: 'rnd',
    principal: false,
    blurb: 'Featured projects: Gaussian-SLAM scanner and the Row-Pergfect test rig.',
  },
  radio: {
    id: 'radio',
    name: 'Broadcast Booth',
    shortName: 'Code Story',
    color: '#C8553D',
    center: [36, 11],
    bounds: { minX: 30, maxX: 42, minZ: 6, maxZ: 16 },
    entrance: [27, 11],
    entranceYaw: EAST,
    waypoint: 'radioDoor',
    building: {
      footprint: { minX: 30, maxX: 42, minZ: 6, maxZ: 16 },
      height: 6,
      doorSide: 'W',
      doorSpan: [9, 13],
      interior: { minX: 30.5, maxX: 41.5, minZ: 6.5, maxZ: 15.5 },
      roof: 'flat',
    },
    panel: 'codestory',
    principal: true,
    blurb: 'On the air: the Code Story podcast interview.',
  },
  rec: {
    id: 'rec',
    name: 'Recreation Yard',
    shortName: 'Rec Yard',
    color: '#6BA368',
    center: [39, -14],
    bounds: { minX: 30, maxX: 48, minZ: -24, maxZ: -4 },
    entrance: [27, -14],
    entranceYaw: EAST,
    waypoint: 'recGate',
    panel: 'rec',
    principal: true,
    blurb: 'Soccer, volleyball and strongly held opinions about the rules.',
  },
  breakroom: {
    id: 'breakroom',
    name: 'Break Room & Executive Wing',
    shortName: 'Break Room',
    color: '#B7A98B',
    center: [37, 30],
    bounds: { minX: 30, maxX: 44, minZ: 24, maxZ: 36 },
    entrance: [27, 30],
    entranceYaw: EAST,
    waypoint: 'breakroomDoor',
    building: {
      footprint: { minX: 30, maxX: 44, minZ: 24, maxZ: 36 },
      height: 6,
      doorSide: 'W',
      doorSpan: [28, 32],
      interior: { minX: 30.5, maxX: 43.5, minZ: 24.5, maxZ: 35.5 },
      roof: 'flat',
    },
    principal: false,
    blurb: 'Vending machines, motivational posters and a locked executive office.',
  },
  warehouse: {
    id: 'warehouse',
    name: 'Shipping Warehouse',
    shortName: 'Warehouse',
    color: '#7C6A55',
    center: [-38, 30],
    bounds: { minX: -46, maxX: -30, minZ: 24, maxZ: 36 },
    entrance: [-27, 30],
    entranceYaw: WEST,
    waypoint: 'warehouseDoor',
    building: {
      footprint: { minX: -46, maxX: -30, minZ: 24, maxZ: 36 },
      height: 8,
      doorSide: 'E',
      doorSpan: [25, 35],
      interior: { minX: -45.5, maxX: -30.5, minZ: 24.5, maxZ: 35.5 },
      roof: 'sawtooth',
    },
    principal: false,
    blurb: 'Pallets, crates and plenty of room to practise forklift etiquette.',
  },
}

export const ZONE_LIST: ZoneDef[] = Object.values(ZONES)
/** The five principal portfolio destinations, in directory order. */
export const PRINCIPAL_ZONES: ZoneId[] = ['personnel', 'control', 'radio', 'server', 'rec']

/** Painted roads / aisles (visual guidance; the whole yard is walkable). */
export interface PathDef {
  id: string
  rect: Rect
  kind: 'aisle' | 'avenue' | 'road' | 'plaza' | 'spur' | 'walkway'
  /** Direction of painted arrows: unit vector [x, z] or null. */
  arrow?: Vec2 | null
}

export const PATHS: PathDef[] = [
  { id: 'main-aisle', rect: { minX: -3.5, maxX: 3.5, minZ: -2, maxZ: 39 }, kind: 'aisle', arrow: [0, -1] },
  { id: 'cross-south', rect: { minX: -26, maxX: 26, minZ: 19.5, maxZ: 23.5 }, kind: 'avenue', arrow: null },
  { id: 'west-avenue', rect: { minX: -26, maxX: -20, minZ: -46, maxZ: 23.5 }, kind: 'avenue', arrow: [0, -1] },
  { id: 'east-avenue', rect: { minX: 20, maxX: 26, minZ: -22, maxZ: 23.5 }, kind: 'avenue', arrow: [0, -1] },
  { id: 'north-road', rect: { minX: -26, maxX: 32, minZ: -22, maxZ: -18 }, kind: 'road', arrow: null },
  { id: 'tower-plaza', rect: { minX: -14, maxX: 14, minZ: -18, maxZ: -2 }, kind: 'plaza', arrow: null },
  { id: 'intake-plaza', rect: { minX: -7, maxX: 7, minZ: 24, maxZ: 39 }, kind: 'plaza', arrow: null },
  { id: 'spur-personnel', rect: { minX: 3.5, maxX: 7, minZ: 25.5, maxZ: 32.5 }, kind: 'spur', arrow: [1, 0] },
  { id: 'spur-maintenance', rect: { minX: -7, maxX: -3.5, minZ: 25, maxZ: 33 }, kind: 'spur', arrow: [-1, 0] },
  { id: 'spur-control', rect: { minX: -30, maxX: -26, minZ: 11, maxZ: 15 }, kind: 'spur', arrow: [-1, 0] },
  { id: 'spur-server', rect: { minX: -30, maxX: -26, minZ: -11, maxZ: -7 }, kind: 'spur', arrow: [-1, 0] },
  { id: 'spur-rnd', rect: { minX: -30, maxX: -26, minZ: -35, maxZ: -31 }, kind: 'spur', arrow: [-1, 0] },
  { id: 'spur-warehouse', rect: { minX: -30, maxX: -26, minZ: 25, maxZ: 35 }, kind: 'spur', arrow: [-1, 0] },
  { id: 'spur-radio', rect: { minX: 26, maxX: 30, minZ: 9, maxZ: 13 }, kind: 'spur', arrow: [1, 0] },
  { id: 'spur-rec', rect: { minX: 26, maxX: 30, minZ: -16, maxZ: -12 }, kind: 'spur', arrow: [1, 0] },
  { id: 'spur-breakroom', rect: { minX: 26, maxX: 30, minZ: 28, maxZ: 32 }, kind: 'spur', arrow: [1, 0] },
  { id: 'walk-west', rect: { minX: -14, maxX: -11, minZ: 1, maxZ: 19.5 }, kind: 'walkway', arrow: null },
  { id: 'walk-east', rect: { minX: 11, maxX: 14, minZ: 1, maxZ: 19.5 }, kind: 'walkway', arrow: null },
  { id: 'obs-deck-path', rect: { minX: -1, maxX: 5, minZ: -25, maxZ: -22 }, kind: 'spur', arrow: null },
]

// ---------------------------------------------------------------------------
// Production spine & rocket
// ---------------------------------------------------------------------------

export interface LineDef {
  id: LineId
  name: string
  /** Center x of the line strip. */
  x: number
  /** Input end (south) and output end (north). Items flow from zStart to zEnd. */
  zStart: number
  zEnd: number
  /** Strip width in meters (machines must stay within x ± width/2). */
  width: number
  color: string
  /** Payload line is an overhead monorail above the main aisle. */
  overhead: boolean
  /** Rail height for overhead lines. */
  railHeight?: number
}

export const LINES: LineDef[] = [
  { id: 'smelt', name: 'Smelting & Sheet Stamping', x: -9, zStart: 18, zEnd: 2, width: 4, color: '#FF8A3D', overhead: false },
  { id: 'pipe', name: 'Pipe & Valve Machining', x: -16, zStart: 18, zEnd: 2, width: 4, color: '#B87333', overhead: false },
  { id: 'circuit', name: 'Electronics & Guidance', x: 9, zStart: 18, zEnd: 2, width: 4, color: '#4FC3A1', overhead: false },
  { id: 'tank', name: 'Fuel Tank Fabrication', x: 16, zStart: 18, zEnd: 2, width: 4, color: '#E57D35', overhead: false },
  // Overhead monorail runs just west of the aisle centerline so the view up the aisle to the rocket stays clear.
  { id: 'payload', name: 'Payload Packing & QC', x: -2.55, zStart: 19, zEnd: -4.5, width: 2, color: '#E9B63F', overhead: true, railHeight: 6.2 },
]

/** QC scanner arch spanning the main aisle (payload line inspection). Player walks through it. */
export const QC_ARCH = { position: [0, 11] as Vec2, width: 7.6, height: 5.4 }
/** Elevated collector belt carrying line output to the tower (visual only, no ground colliders in aisles). */
export const COLLECTOR = { z: 0, height: 4.8, fromX: -16, toX: 16, towerEntry: [0, -5] as Vec2 }

export const TOWER = {
  center: [0, -10] as Vec2,
  footprint: { minX: -5, maxX: 5, minZ: -15, maxZ: -5 } as Rect,
  height: 26,
  /** Rocket stands here (base) while being assembled, on the transporter deck. */
  rocketBase: [0, -10] as Vec2,
}

/** Rocket transporter path from tower to pad (polyline; round the corner with cornerRadius). */
export const TRACK = {
  points: [
    [0, -10],
    [16, -10],
    [16, -34],
  ] as Vec2[],
  cornerRadius: 4,
  gauge: 3.2,
}

export const PAD = { center: [16, -34] as Vec2, size: 12, blastRadius: 7.5 }
/** "TIME SINCE LAST UNSCHEDULED DISASSEMBLY" board. Faces the plaza / main aisle. */
export const COUNTER_SIGN = { position: [27, -26] as Vec2, yaw: 2.34 }
/** Optional raised viewing platform (keep it ramp-accessible). */
export const OBSERVATION_DECK = { position: [2, -27] as Vec2, size: [6, 5] as Vec2, height: 1.2 }

// ---------------------------------------------------------------------------
// Interactive anchors (stations put their machines here)
// ---------------------------------------------------------------------------

export interface AnchorDef {
  /** Where the machine/object stands. */
  position: Vec2
  /** Which way the object's front faces. */
  yaw: number
  /** Where the player stands to interact (interactable position). */
  interact: Vec2
}

export const ANCHORS = {
  resumePrinter: { position: [12, 29], yaw: WEST, interact: [9.6, 29] },
  contactMailbox: { position: [5.4, 35.2], yaw: WEST, interact: [4.3, 35.2] },
  directoryKiosk: { position: [-4.8, 35.2], yaw: EAST, interact: [-3.7, 35.2] },
  employeeWall: { position: [16.4, 29], yaw: WEST, interact: [14.5, 29] },
  controlConsole: { position: [-38, 13], yaw: EAST, interact: [-34.6, 13] },
  radioDesk: { position: [36.5, 11], yaw: WEST, interact: [33.4, 11] },
  radioMast: { position: [44.5, 17.5], yaw: WEST, interact: [44.5, 17.5] },
  serverTerminal: { position: [-38, -9], yaw: EAST, interact: [-34.6, -9] },
  serverFan: { position: [-45.5, -9], yaw: EAST, interact: [-43, -9] },
  slamScanner: { position: [-40, -30], yaw: EAST, interact: [-36.6, -30] },
  rowRig: { position: [-40, -36.5], yaw: EAST, interact: [-36.6, -36.5] },
  doNotPress: { position: [-44.5, -33], yaw: EAST, interact: [-43.2, -33] },
  soccerBall: { position: [38, -18], yaw: NORTH, interact: [38, -18] },
  soccerGoal: { position: [39, -23.3], yaw: SOUTH, interact: [39, -21.5] },
  volleyNet: { position: [41, -8], yaw: SOUTH, interact: [41, -10] },
  console: { position: [5.6, 19], yaw: WEST, interact: [4.2, 19] },
  nightShiftButton: { position: [-5.6, 19], yaw: EAST, interact: [-4.2, 19] },
  forklift: { position: [-11, 29], yaw: EAST, interact: [-11, 29] },
  executiveOffice: { position: [41, 33], yaw: WEST, interact: [37.5, 33] },
} satisfies Record<string, AnchorDef>

export type AnchorId = keyof typeof ANCHORS

// ---------------------------------------------------------------------------
// Checkpoints, restricted zones, navigation
// ---------------------------------------------------------------------------

export interface CheckpointDef {
  id: string
  position: Vec2
  yaw: number
}

export const CHECKPOINTS: CheckpointDef[] = [
  { id: 'intake', position: [0, 32], yaw: NORTH },
  ...(['personnel', 'maintenance', 'production', 'tower', 'launch', 'control', 'server', 'rnd', 'radio', 'rec', 'breakroom', 'warehouse'] as ZoneId[]).map(
    (id) => ({ id, position: ZONES[id].entrance, yaw: ZONES[id].entranceYaw }),
  ),
]

export function getCheckpoint(id: string): CheckpointDef {
  return CHECKPOINTS.find((c) => c.id === id) ?? CHECKPOINTS[0]
}

export type RestrictedShape = { kind: 'rect'; rect: Rect } | { kind: 'circle'; center: Vec2; radius: number }

export interface RestrictedZoneDef {
  id: string
  /** Sign text. */
  label: string
  /** Short comedic sub-line for signage. */
  subLabel: string
  shape: RestrictedShape
}

/** OSHA-style restricted areas. Clearly signed, never on a required route, never gating content. */
export const RESTRICTED_ZONES: RestrictedZoneDef[] = [
  {
    id: 'blast-zone',
    label: 'LAUNCH PAD — BLAST ZONE',
    subLabel: 'Authorized rockets only',
    shape: { kind: 'circle', center: [16, -34], radius: 7.5 },
  },
  {
    id: 'transformer-yard',
    label: 'HIGH VOLTAGE — KEEP OUT',
    subLabel: 'The transformer bites',
    shape: { kind: 'rect', rect: { minX: 15.5, maxX: 19.5, minZ: -6.5, maxZ: -2.5 } },
  },
  {
    id: 'wet-paint',
    label: 'WET FLOOR PAINT — KEEP OFF',
    subLabel: 'Wet since 2019',
    shape: { kind: 'rect', rect: { minX: -19.5, maxX: -15.5, minZ: -6.5, maxZ: -2.5 } },
  },
]

export function restrictedZoneAt(x: number, z: number): RestrictedZoneDef | null {
  for (const r of RESTRICTED_ZONES) {
    if (r.shape.kind === 'rect') {
      const b = r.shape.rect
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return r
    } else {
      const [cx, cz] = r.shape.center
      if (Math.hypot(x - cx, z - cz) <= r.shape.radius) return r
    }
  }
  return null
}

/** Which zone contains (x, z) — buildings/specific zones win over broad ones. */
export function zoneAt(x: number, z: number): ZoneId | null {
  const order: ZoneId[] = [
    'personnel',
    'maintenance',
    'control',
    'server',
    'rnd',
    'radio',
    'rec',
    'breakroom',
    'warehouse',
    'intake',
    'production',
    'tower',
    'launch',
  ]
  for (const id of order) {
    const b = ZONES[id].bounds
    if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return id
  }
  return null
}

export function clampToPlayable(x: number, z: number): Vec2 {
  const b = PLAYABLE_BOUNDS
  return [Math.min(b.maxX, Math.max(b.minX, x)), Math.min(b.maxZ, Math.max(b.minZ, z))]
}

/**
 * Navigation waypoint graph (NPC routes + directory assisted routes).
 * Links are bidirectional (declared once). Straight segments between linked
 * waypoints are guaranteed free of static obstacles.
 */
export interface WaypointDef {
  id: string
  position: Vec2
  links: string[]
}

const RAW_WAYPOINTS: Array<[string, Vec2, string[]]> = [
  ['intake', [0, 32], ['aisleS', 'personnelDoor', 'maintDoor', 'kiosk', 'mailbox']],
  ['kiosk', [-3.2, 35.2], []],
  ['mailbox', [3.6, 35.2], []],
  ['personnelDoor', [4.5, 29], ['aisleS', 'personnelInside']],
  ['personnelInside', [10, 29], []],
  ['maintDoor', [-4.5, 29], ['aisleS', 'maintInside']],
  ['maintInside', [-9, 31.5], []],
  ['aisleS', [0, 21.5], ['aisleM', 'crossW1', 'crossE1', 'consoleSpot', 'buttonSpot']],
  ['consoleSpot', [3.6, 19.8], []],
  ['buttonSpot', [-3.6, 19.8], []],
  ['crossW1', [-12.5, 21.5], ['crossW', 'walkW_s']],
  ['crossW', [-23, 21.5], ['westCtrl', 'westSouth']],
  ['westSouth', [-23, 30], ['warehouseDoor']],
  ['warehouseDoor', [-28, 30], ['warehouseInside']],
  ['warehouseInside', [-36, 30], []],
  ['crossE1', [12.5, 21.5], ['crossE', 'walkE_s']],
  ['crossE', [23, 21.5], ['eastRadio', 'eastSouth']],
  ['eastSouth', [23, 30], ['breakroomDoor']],
  ['breakroomDoor', [28, 30], ['breakroomInside']],
  ['breakroomInside', [34, 30], []],
  ['aisleM', [0, 11], ['aisleN']],
  ['aisleN', [0, 1], ['plazaS', 'walkW_n', 'walkE_n']],
  ['walkW_s', [-12.5, 18.5], ['walkW_n']],
  ['walkW_n', [-12.5, 0.5], ['plazaW']],
  ['walkE_s', [12.5, 18.5], ['walkE_n']],
  ['walkE_n', [12.5, 0.5], ['plazaE']],
  ['plazaS', [0, -2.5], ['plazaW', 'plazaE']],
  ['plazaW', [-9.5, -3.5], ['plazaNW']],
  ['plazaNW', [-9.5, -16], ['northW']],
  ['plazaE', [9.5, -4], ['plazaNE']],
  ['plazaNE', [9.5, -16], ['northE']],
  ['northW', [-12, -20], ['westNorth', 'northMid']],
  ['northMid', [0, -20], ['northE', 'obsDeck']],
  ['obsDeck', [2, -23.4], []],
  ['northE', [12, -20], ['eastNorth']],
  ['eastNorth', [23, -20], ['eastRec', 'signView']],
  ['signView', [25, -22.5], []],
  ['westCtrl', [-23, 13], ['westServer', 'ctrlDoor']],
  ['ctrlDoor', [-28, 13], ['ctrlInside']],
  ['ctrlInside', [-34, 13], []],
  ['westServer', [-23, -9], ['westNorth', 'serverDoor']],
  ['serverDoor', [-28, -9], ['serverInside']],
  ['serverInside', [-34, -9], []],
  ['westNorth', [-23, -20], ['westRnd']],
  ['westRnd', [-23, -33], ['rndDoor']],
  ['rndDoor', [-28, -33], ['rndInside']],
  ['rndInside', [-34, -33], []],
  ['eastRadio', [23, 11], ['eastRec', 'radioDoor']],
  ['radioDoor', [28, 11], ['radioInside']],
  ['radioInside', [33, 11], []],
  ['eastRec', [23, -14], ['recGate']],
  ['recGate', [28, -14], ['recInside']],
  ['recInside', [35, -14], []],
]

function buildWaypoints(): Record<string, WaypointDef> {
  const map: Record<string, WaypointDef> = {}
  for (const [id, position] of RAW_WAYPOINTS) map[id] = { id, position, links: [] }
  for (const [id, , links] of RAW_WAYPOINTS) {
    for (const other of links) {
      if (!map[other]) throw new Error(`waypoint ${id} links to unknown ${other}`)
      if (!map[id].links.includes(other)) map[id].links.push(other)
      if (!map[other].links.includes(id)) map[other].links.push(id)
    }
  }
  return map
}

export const WAYPOINTS: Record<string, WaypointDef> = buildWaypoints()
