/**
 * Builds the whole production spine once (per module instance) and drives it
 * every frame from factory.state. Owns every GPU resource it creates and
 * disposes them on unmount (StrictMode-safe: dispose → re-render re-uploads).
 *
 * Draw calls (medium): 3 static chunks + hazard + glass + belts + signs +
 * skinned machinery + skinned FX + lamps + console screen + ≤14 item meshes +
 * 2 particle pools (+ shadow passes of casters) — well under the ~90 budget.
 */
import * as THREE from 'three'
import { events } from '@/core/events'
import { runtime } from '@/core/runtime'
import type { LineId, QualityTier, SfxName, Vec3 } from '@/core/types'
import { factory } from '@/systems/factory'
import { mats } from '@/world/materials'
import { PLAQUES } from './config'
import { GeoBatch } from './build/builder'
import { buildCircuit } from './build/circuit'
import { buildCollector } from './build/collector'
import { buildConsole, type ConsoleAnimator } from './build/console'
import { buildItemGeometries } from './build/items'
import { BeltSet, type Animator, type Effects, type Frame, type Kit } from './build/kit'
import { COL, st } from './build/parts'
import { buildPayload, type PayloadAnimator } from './build/payload'
import { buildPipe } from './build/pipe'
import { Rig } from './build/rig'
import { createSignAtlas, type SignAtlas } from './build/signs'
import { buildSmelt } from './build/smelt'
import { buildTank } from './build/tank'
import { ItemRenderer } from './render/items'
import { LampSet } from './render/lamps'
import { CH, createMaterials, type LineMaterials } from './render/materials'
import { PuffPool, SparkPool } from './render/particles'

const PARTICLES: Record<QualityTier, { sparks: number; puffs: number; emit: number }> = {
  low: { sparks: 80, puffs: 50, emit: 0.45 },
  medium: { sparks: 200, puffs: 120, emit: 1 },
  high: { sparks: 300, puffs: 180, emit: 1.25 },
}

export interface ProductionWorld {
  group: THREE.Group
  payload: PayloadAnimator
  console: ConsoleAnimator
  items: ItemRenderer
  atlas: SignAtlas
  rig: Rig
  update(delta: number, reduced: boolean): void
  setQuality(q: QualityTier): void
  stats(): Record<string, unknown>
  dispose(): void
}

function plaques(k: Kit): void {
  const b = k.center
  for (const id of Object.keys(PLAQUES) as LineId[]) {
    const p = PLAQUES[id]
    const cell = k.atlas.cells[`plaque:${id}`]
    if (!cell) continue
    const w = 0.66
    const h = w / cell.aspect
    const y = 1.42
    if (p.post) {
      b.cylY(p.x, 0, p.z, 0.05, y + h / 2 + 0.05, st.paint(COL.gunmetal), 8)
      b.cylY(p.x, 0, p.z, 0.14, 0.05, st.paint(COL.charcoal), 10)
    }
    const fz = p.post ? p.z + 0.07 : p.z
    b.box([p.x, y, fz - 0.02], [w + 0.06, h + 0.06, 0.04], st.paint(COL.charcoal))
    k.sign.quad([p.x, y, fz + 0.002], w, h, Math.PI, st.white, cell.uv)
  }
}

export function buildProduction(tier: QualityTier): ProductionWorld {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0
  const atlas = createSignAtlas(tier === 'low' ? 0.5 : 1)
  const M: LineMaterials = createMaterials(atlas.texture)
  const kit: Kit = {
    detail: tier !== 'low',
    west: new GeoBatch({ tile: 1.6 }),
    east: new GeoBatch({ tile: 1.6 }),
    center: new GeoBatch({ tile: 1.6 }),
    hazard: new GeoBatch({ tile: 0.9 }),
    glass: new GeoBatch({ tile: 2 }),
    belt: new GeoBatch({ belt: true }),
    belts: new BeltSet(),
    sign: new GeoBatch(),
    atlas,
    skin: new GeoBatch({ skinned: true, tile: 1.2 }),
    fx: new GeoBatch({ skinned: true }),
    rig: new Rig(),
    lamps: new LampSet(),
  }

  const animators: Animator[] = [buildSmelt(kit), buildPipe(kit), buildCircuit(kit), buildTank(kit), buildCollector(kit)]
  const payload = buildPayload(kit)
  const consoleA = buildConsole(kit)
  plaques(kit)
  const skeleton = kit.rig.finalize()

  const group = new THREE.Group()
  group.name = 'production-spine'
  const geometries: THREE.BufferGeometry[] = []
  const casters: THREE.Mesh[] = []
  const add = (geo: THREE.BufferGeometry | null, material: THREE.Material, name: string, opts: { cast?: boolean; receive?: boolean; order?: number } = {}) => {
    if (!geo) return null
    geometries.push(geo)
    const mesh = new THREE.Mesh(geo, material)
    mesh.name = name
    mesh.receiveShadow = opts.receive ?? true
    mesh.castShadow = false
    if (opts.cast) casters.push(mesh)
    if (opts.order !== undefined) mesh.renderOrder = opts.order
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    group.add(mesh)
    return mesh
  }
  add(kit.west.build(), M.machine, 'lines:static-west', { cast: true })
  add(kit.east.build(), M.machine, 'lines:static-east', { cast: true })
  add(kit.center.build(), M.machine, 'lines:static-center', { cast: true })
  add(kit.hazard.build(), mats.hazardStripes(), 'lines:hazard', { cast: true })
  add(kit.belt.build(), M.belt, 'lines:belts')
  add(kit.sign.build(), M.sign, 'lines:signs')
  add(kit.glass.build(), mats.glass(), 'lines:glass', { receive: false, order: 1 })

  const bindIdentity = new THREE.Matrix4()
  const bounds = new THREE.Sphere(new THREE.Vector3(0, 4, 8), 30)
  const skinGeo = kit.skin.build()
  let skinMesh: THREE.SkinnedMesh | null = null
  if (skinGeo) {
    geometries.push(skinGeo)
    skinMesh = new THREE.SkinnedMesh(skinGeo, M.machine)
    skinMesh.name = 'lines:moving'
    skinMesh.bind(skeleton, bindIdentity)
    skinMesh.boundingSphere = bounds.clone()
    skinMesh.receiveShadow = true
    casters.push(skinMesh)
    group.add(skinMesh)
  }
  const fxGeo = kit.fx.build()
  if (fxGeo) {
    geometries.push(fxGeo)
    const fxMesh = new THREE.SkinnedMesh(fxGeo, M.fx)
    fxMesh.name = 'lines:fx'
    fxMesh.bind(skeleton, bindIdentity)
    fxMesh.boundingSphere = bounds.clone()
    fxMesh.renderOrder = 2
    group.add(fxMesh)
  }
  group.add(kit.rig.root)

  const lampMesh = kit.lamps.build(M.lamp)
  group.add(lampMesh)
  group.add(consoleA.screen)

  const itemGeos = buildItemGeometries()
  const items = new ItemRenderer(itemGeos, M.machine)
  for (const m of Object.values(items.meshes)) group.add(m)

  const sparks = new SparkPool(PARTICLES.high.sparks)
  const puffs = new PuffPool(PARTICLES.high.puffs)
  group.add(sparks.mesh, puffs.mesh)

  // two small warm lights of our own (no shadows): furnace mouth + welding arc
  const furnaceLight = new THREE.PointLight('#ff9a4a', 14, 10, 2)
  furnaceLight.position.set(-6.9, 2.4, 15.35)
  furnaceLight.castShadow = false
  furnaceLight.name = 'lines:furnace-light'
  const weldLight = new THREE.PointLight('#bfe2ff', 0, 6.5, 2)
  weldLight.position.set(15.7, 1.9, 12.5)
  weldLight.castShadow = false
  weldLight.name = 'lines:weld-light'
  group.add(furnaceLight, weldLight)

  kit.belts.bind(M.beltOffsets)

  let live = PARTICLES[tier]
  const sfx = (name: SfxName, position: Vec3, volume?: number) => events.emit('sfx', { name, position, volume })
  const effects: Effects = {
    sparks,
    puffs,
    lamps: kit.lamps,
    belts: kit.belts,
    rig: kit.rig,
    chan: M.chan,
    fxChan: M.fxChan,
    emit: live.emit,
    furnaceLight,
    weldLight,
    sfx,
  }
  const frame: Frame = { dt: 0, t: 0, s: factory.state, reduced: false, power: 1, fx: effects }
  let errors = 0

  const setQuality = (q: QualityTier) => {
    live = PARTICLES[q]
    effects.emit = live.emit
    sparks.cap = Math.min(sparks.max, live.sparks)
    puffs.cap = Math.min(puffs.max, live.puffs)
    const shadows = q !== 'low'
    for (const m of casters) m.castShadow = shadows
    items.setShadows(shadows)
  }
  setQuality(tier)

  const buildMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0

  return {
    group,
    payload,
    console: consoleA,
    items,
    atlas,
    rig: kit.rig,
    setQuality,
    update(delta: number, reduced: boolean) {
      const dt = Number.isFinite(delta) ? Math.min(Math.max(delta, 0), 0.1) : 0
      const s = factory.state
      const lvl = runtime.lighting.level
      const level = Number.isFinite(lvl) ? Math.min(1, Math.max(0, lvl)) : 1
      frame.dt = dt
      frame.t = Number.isFinite(s.t) ? s.t : 0
      frame.s = s
      frame.reduced = reduced
      frame.power = 0.15 + 0.85 * level
      M.chan[CH.POWER].setScalar(frame.power)
      kit.lamps.power = 0.3 + 0.7 * level
      try {
        for (const a of animators) a.update(frame)
        payload.update(frame)
        consoleA.update(frame)
        items.update(s, frame.t, dt, reduced, payload.rejects)
      } catch (err) {
        if (errors++ < 3) console.error('[lines] frame update failed', err)
      }
      kit.belts.advance(dt)
      sparks.update(dt)
      puffs.update(dt, 0.35 + 0.65 * level)
      kit.lamps.flush()
    },
    stats() {
      let calls = 0
      let shadowCalls = 0
      let triangles = 0
      group.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh || !m.visible) return
        const g = m.geometry as THREE.BufferGeometry & { instanceCount?: number }
        const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : g.instanceCount ?? 1
        if (inst === 0) return
        calls++
        if (m.castShadow) shadowCalls++
        const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3
        triangles += tris * (inst ?? 1)
      })
      return {
        drawCalls: calls,
        shadowCalls,
        triangles: Math.round(triangles),
        bones: kit.rig.count,
        lamps: kit.lamps.count,
        belts: kit.belts.count,
        items: { ...items.visible },
        particles: { sparks: sparks.count, puffs: puffs.count, caps: [sparks.cap, puffs.cap] },
        qc: payload.stats(),
        rejectsVisible: payload.rejects.count,
        buildTier: tier,
        buildMs: Math.round(buildMs),
        errors,
      }
    },
    dispose() {
      for (const g of geometries) g.dispose()
      for (const g of Object.values(itemGeos)) g.dispose()
      items.dispose()
      kit.lamps.dispose()
      sparks.dispose()
      puffs.dispose()
      consoleA.dispose()
      skeleton.dispose()
      M.dispose()
      atlas.dispose()
      furnaceLight.dispose()
      weldLight.dispose()
    },
  }
}
