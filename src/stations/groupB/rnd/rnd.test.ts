import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { PROJECTS } from '@/content/projects'
import type { ProjectContent } from '@/content/types'
import { FURNITURE } from '@/environment/data/decor'
import { WAYPOINTS } from '@/world/layout'
import { colliderBounds, pointInCollider } from '../shared/colliders'
import { annexColliders, benchInteractPoint, buildAnnexStatic, localToWorld, rowRigRect, scannerPosts } from './annex'
import { DNP_TIMING, DoNotPressMachine } from './doNotPress'
import { assignBenches, BENCH_SLOTS, DNP, dnpInteractPoint, DOOR, genericStationProjects, INFO_INTERACT, INTERIOR, ROW_RIG, SCANNER } from './layout'
import { LAMP_ORDER, needleAngle, pickError, RowingModel } from './rowing'
import { sampleSplats, scanState } from './splats'

const fakeProject = (id: string): ProjectContent => ({ ...PROJECTS[0], id, name: `Project ${id}`, featured: true, station: 'rnd' })

function run(m: DoNotPressMachine, seconds: number, step = 1 / 30): void {
  for (let t = 0; t < seconds; t += step) m.update(step)
}

describe('DO NOT PRESS machine', () => {
  it('walks idle → rising → armed → thanks → sinking → idle', () => {
    const m = new DoNotPressMachine()
    expect(m.state).toBe('idle')
    expect(m.canPress2()).toBe(false)
    expect(m.press2()).toBe(false)
    expect(m.press1()).toBe(true)
    expect(m.state).toBe('rising')
    expect(m.press1()).toBe(false)
    expect(m.press2()).toBe(false) // not until the second button is fully up
    run(m, DNP_TIMING.rise + 0.1)
    expect(m.state).toBe('armed')
    const c = m.channels()
    expect(c.rise).toBe(1)
    expect(c.hatch).toBe(1)
    expect(m.press2()).toBe(true)
    expect(m.state).toBe('thanks')
    run(m, 1.2)
    expect(m.channels().sign).toBe(1)
    expect(m.presses).toBe(2)
  })

  it('resets 60 s after the last press and folds everything away', () => {
    const m = new DoNotPressMachine()
    m.press1()
    run(m, 2)
    m.press2()
    run(m, 59)
    expect(m.state).toBe('thanks')
    run(m, 1.2)
    expect(m.state).toBe('sinking')
    run(m, DNP_TIMING.sink + 0.1)
    expect(m.state).toBe('idle')
    expect(m.channels()).toEqual({ b1: 0, hatch: 0, rise: 0, b2: 0, sign: 0 })
    expect(m.press1()).toBe(true) // works again
  })

  it('also resets when only the first button was pressed', () => {
    const m = new DoNotPressMachine()
    m.press1()
    run(m, 61.5)
    expect(m.state).toBe('idle')
  })

  it('channels stay within 0..1 and survive huge / invalid dt', () => {
    const m = new DoNotPressMachine()
    m.press1()
    for (const dt of [0.5, 100, -3, Number.NaN, 0.01]) {
      const c = m.update(dt)
      for (const v of Object.values(c)) {
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('Row-Pergfect rowing model', () => {
  it('cycles strokes, lights lamps for flagged errors and keeps values bounded', () => {
    const m = new RowingModel(7)
    const seen = new Set<string>()
    let lit = 0
    for (let i = 0; i < 60 * 90; i++) {
      const p = m.update(1 / 60)
      seen.add(p.phase)
      for (const k of LAMP_ORDER) {
        expect(p.lamps[k]).toBeGreaterThanOrEqual(0)
        expect(p.lamps[k]).toBeLessThanOrEqual(1)
        if (p.lamps[k] > 0.5) lit++
      }
      expect(p.score).toBeGreaterThanOrEqual(0)
      expect(p.score).toBeLessThanOrEqual(1)
      expect(Number.isFinite(p.seat + p.body + p.arms + p.drift + p.flywheel)).toBe(true)
    }
    expect(seen.has('drive')).toBe(true)
    expect(seen.has('recovery')).toBe(true)
    expect(m.pose.stroke).toBeGreaterThan(20)
    expect(lit).toBeGreaterThan(0)
  })

  it('picks every error kind and sometimes a clean stroke', () => {
    let s = 0
    const rng = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
    const kinds = new Set<string | null>()
    for (let i = 0; i < 400; i++) kinds.add(pickError(rng))
    expect(kinds).toEqual(new Set([null, 'left', 'right', 'rush', 'pause']))
  })

  it('maps the form score onto the GOOD↔BAD dial', () => {
    expect(needleAngle(1)).toBeCloseTo(-1.05)
    expect(needleAngle(0)).toBeCloseTo(1.05)
    expect(needleAngle(5)).toBeCloseTo(-1.05)
  })
})

describe('Gaussian-SLAM scan cycle', () => {
  it('scans coarse-to-fine over ~20 s, holds at 100 %, dissolves, restarts', () => {
    const { cycle, hold, dissolve } = SCANNER
    expect(cycle).toBeGreaterThanOrEqual(18)
    expect(scanState(0, cycle, hold, dissolve).percent).toBe(0)
    const mid = scanState(cycle / 2, cycle, hold, dissolve)
    expect(mid.phase).toBe('scan')
    expect(mid.percent).toBeGreaterThan(50) // fast at first
    expect(scanState(cycle + 0.1, cycle, hold, dissolve).percent).toBe(100)
    const d = scanState(cycle + hold + dissolve / 2, cycle, hold, dissolve)
    expect(d.phase).toBe('dissolve')
    expect(d.dissolve).toBeCloseTo(0.5)
    expect(scanState(cycle + hold + dissolve + 0.01, cycle, hold, dissolve).phase).toBe('scan')
    let last = -1
    for (let t = 0; t < cycle; t += 0.25) {
      const p = scanState(t, cycle, hold, dissolve).progress
      expect(p).toBeGreaterThanOrEqual(last)
      last = p
    }
  })

  it('samples splats on the figurine surface deterministically', () => {
    const geo = new THREE.BoxGeometry(1, 2, 1)
    const a = sampleSplats(geo, 300, 9)
    const b = sampleSplats(geo, 300, 9)
    expect(a.count).toBe(300)
    expect(Array.from(a.pos.slice(0, 30))).toEqual(Array.from(b.pos.slice(0, 30)))
    for (let i = 0; i < a.count; i++) {
      expect(Math.abs(a.pos[i * 3])).toBeLessThanOrEqual(0.5001)
      expect(Math.abs(a.pos[i * 3 + 1])).toBeLessThanOrEqual(1.0001)
    }
  })
})

describe('R&D Annex layout', () => {
  const benchSet = assignBenches([fakeProject('a'), fakeProject('b'), fakeProject('c')])
  const colliders = annexColliders(benchSet)

  it('has no generic bench today (both featured projects have bespoke rigs) but supports future ones', () => {
    expect(genericStationProjects()).toEqual([])
    expect(genericStationProjects([...PROJECTS, fakeProject('new-thing')]).map((p) => p.id)).toEqual(['new-thing'])
    expect(benchSet).toHaveLength(BENCH_SLOTS.length)
    const geos = buildAnnexStatic({ info: [0, 0, 1, 1], scanner: [0, 0, 1, 1], 'bench:a': [0, 0, 1, 1], 'bench:b': [0, 0, 1, 1] }, benchSet)
    expect(geos.get('signLit')).toBeDefined()
    geos.forEach((g) => g.dispose())
  })

  it('keeps every collider inside the annex walls', () => {
    for (const c of colliders) {
      const r = colliderBounds(c)
      expect(r.minX, c.id).toBeGreaterThanOrEqual(INTERIOR.minX - 0.01)
      expect(r.maxX, c.id).toBeLessThanOrEqual(INTERIOR.maxX + 0.01)
      expect(r.minZ, c.id).toBeGreaterThanOrEqual(INTERIOR.minZ - 0.01)
      expect(r.maxZ, c.id).toBeLessThanOrEqual(INTERIOR.maxZ + 0.01)
    }
  })

  it('keeps the door span and the waypoint segment clear', () => {
    const a = WAYPOINTS.rndDoor.position
    const b = WAYPOINTS.rndInside.position
    for (let k = 0; k <= 30; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / 30
      const z = a[1] + ((b[1] - a[1]) * k) / 30
      for (const c of colliders) expect(pointInCollider(c, x, z, 0.45), `${c.id} blocks the rnd waypoint segment`).toBe(false)
    }
    for (let z = DOOR.z0; z <= DOOR.z1; z += 0.25)
      for (let x = DOOR.x - 2.5; x <= DOOR.x; x += 0.25) for (const c of colliders) expect(pointInCollider(c, x, z), `${c.id} blocks the door`).toBe(false)
  })

  it('leaves a walkable corridor from the door to the DO NOT PRESS buttons', () => {
    for (let x = -34; x >= DNP.interact.x; x -= 0.2) for (const c of colliders) expect(pointInCollider(c, x, DNP.interact.z, 0.36), `${c.id} at x=${x}`).toBe(false)
  })

  it('puts every interaction spot inside the annex, outside colliders and off the environment furniture', () => {
    const spots = [
      SCANNER.interact,
      { x: ROW_RIG.interact.x - 0.95, z: ROW_RIG.interact.z },
      dnpInteractPoint(1),
      dnpInteractPoint(2),
      { x: INFO_INTERACT[0], z: INFO_INTERACT[1] },
      ...benchSet.map((a) => benchInteractPoint(a.slot)),
    ]
    const annexFurniture = FURNITURE.filter((f) => f.rect.minX >= INTERIOR.minX - 1 && f.rect.maxX <= INTERIOR.maxX + 1 && f.rect.minZ >= INTERIOR.minZ - 1 && f.rect.maxZ <= INTERIOR.maxZ + 1)
    for (const p of spots) {
      expect(p.x).toBeGreaterThan(INTERIOR.minX + 0.4)
      expect(p.x).toBeLessThan(INTERIOR.maxX - 0.4)
      expect(p.z).toBeGreaterThan(INTERIOR.minZ + 0.4)
      expect(p.z).toBeLessThan(INTERIOR.maxZ - 0.4)
      for (const c of colliders) expect(pointInCollider(c, p.x, p.z, 0.3), `${c.id} covers spot ${p.x},${p.z}`).toBe(false)
      for (const f of annexFurniture) expect(p.x > f.rect.minX - 0.3 && p.x < f.rect.maxX + 0.3 && p.z > f.rect.minZ - 0.3 && p.z < f.rect.maxZ + 0.3).toBe(false)
    }
    // and no annex collider overlaps the environment's lab furniture
    for (const c of colliders) {
      const r = colliderBounds(c)
      for (const f of annexFurniture) {
        const overlap = r.minX < f.rect.maxX && r.maxX > f.rect.minX && r.minZ < f.rect.maxZ && r.maxZ > f.rect.minZ
        expect(overlap, `${c.id} overlaps environment ${f.kind}`).toBe(false)
      }
    }
  })

  it('derives machine footprints with the Object3D yaw convention', () => {
    const p = localToWorld({ x: 0, z: 0, yaw: -Math.PI / 2 }, 1, 0)
    const v = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2)
    expect(p.x).toBeCloseTo(v.x)
    expect(p.z).toBeCloseTo(v.z)
    const r = rowRigRect()
    expect(r.maxX - r.minX).toBeCloseTo(ROW_RIG.half.z * 2)
    expect(scannerPosts()).toHaveLength(2)
  })
})
