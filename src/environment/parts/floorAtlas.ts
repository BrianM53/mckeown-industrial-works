import * as THREE from 'three'
import { icon, maskArrow, maskChevrons, maskFootprints, maskHatchBox, maskHatchDisc, maskPedestrian, maskSpawn, maskStain, maskText } from '../lib/signArt'
import { atlasMaskTexture, buildAtlas, type AtlasItem, type Cell } from '../lib/atlas'
import { STENCILS } from '../data/text'

/** Floor stencil mask atlas (white shapes; colored per decal via vertex colors). */
export interface FloorAtlas {
  texture: THREE.DataTexture
  cells: Record<string, Cell>
}

const TEXT_H = 160

export const SPUR_STENCILS: Record<string, string> = {
  personnel: 'RÉSUMÉ',
  maintenance: 'FORKLIFT',
  control: 'HARMONY AI',
  server: 'GITHUB',
  rnd: 'R&D ANNEX',
  radio: 'CODE STORY',
  rec: 'REC YARD',
  breakroom: 'BREAK ROOM',
  warehouse: 'WAREHOUSE',
}

export const JUNCTION_STENCILS: Record<string, string> = {
  toWest: 'CONTROL · SERVER · R&D',
  toEast: 'RADIO · REC YARD',
}

function textItem(key: string, str: string): AtlasItem {
  const w = Math.min(2000, Math.round(str.length * 72 + 90))
  return { key, w, h: TEXT_H, draw: (ctx, w2, h2) => maskText(ctx, w2, h2, str) }
}

let cache: { scale: number; atlas: FloorAtlas } | null = null

export function getFloorAtlas(scale: number, anisotropy: number): FloorAtlas {
  if (cache && cache.scale === scale) return cache.atlas
  cache?.atlas.texture.dispose()
  const items: AtlasItem[] = [
    textItem('intake', STENCILS.intake),
    textItem('mainAisle', STENCILS.mainAisle),
    textItem('production', STENCILS.production),
    textItem('towerPlaza', STENCILS.towerPlaza),
    textItem('launchView', STENCILS.launchView),
    textItem('ceo', STENCILS.ceo),
    textItem('practice', STENCILS.practice),
    textItem('keepClear', STENCILS.keepClear),
    textItem('blast', STENCILS.blast),
    textItem('slow', STENCILS.slow),
    textItem('walkway', STENCILS.walkway),
    textItem('loading', STENCILS.loading),
    textItem('lookUp', STENCILS.lookUp),
    ...Object.entries(SPUR_STENCILS).map(([k, v]) => textItem(`zone:${k}`, v)),
    ...Object.entries(JUNCTION_STENCILS).map(([k, v]) => textItem(`junction:${k}`, v)),
    { key: 'arrow', w: 220, h: 440, draw: (ctx, w, h) => maskArrow(ctx, w, h) },
    { key: 'chevrons', w: 240, h: 300, draw: (ctx, w, h) => maskChevrons(ctx, w, h) },
    { key: 'hatchDisc', w: 640, h: 640, draw: (ctx, w) => maskHatchDisc(ctx, w, 30) },
    { key: 'spawn', w: 448, h: 448, draw: (ctx, w) => maskSpawn(ctx, w) },
    { key: 'footprints', w: 180, h: 480, draw: (ctx, w, h) => maskFootprints(ctx, w, h) },
    { key: 'hatchBox', w: 240, h: 440, draw: (ctx, w, h) => maskHatchBox(ctx, w, h) },
    { key: 'ped', w: 220, h: 220, draw: (ctx, w) => maskPedestrian(ctx, w) },
    {
      key: 'forklift',
      w: 220,
      h: 220,
      draw: (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h)
        icon(ctx, 'forklift', w / 2, h / 2, w * 0.86, '#fff')
      },
    },
    ...[0, 1, 2, 3].map((i) => ({ key: `stain${i}`, w: 200, h: 200, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => maskStain(ctx, w, h, 17 + i * 13) })),
  ]
  const built = buildAtlas(items, 2048, scale, false, 6)
  const texture = atlasMaskTexture(built, 0.2, 7, anisotropy)
  const atlas = { texture, cells: built.cells }
  cache = { scale, atlas }
  return atlas
}
