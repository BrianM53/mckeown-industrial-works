import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DEFAULT_LOOK, WORKER_BONE_COUNT, WORKER_LOD, getWorkerGeometry, workerLodState, type WorkerAnim, type WorkerLook } from '@/world/WorkerModel'
import { PLAYER_LOOK } from './constants'

const playerLook: WorkerLook = { ...DEFAULT_LOOK, ...PLAYER_LOOK }

describe('shared worker geometry', () => {
  it('is a ~1.9 m figure standing on y=0, facing -Z', () => {
    const g = getWorkerGeometry(playerLook)
    g.computeBoundingBox()
    const bb = g.boundingBox!
    expect(bb.min.y).toBeGreaterThan(-0.01)
    expect(bb.min.y).toBeLessThan(0.02)
    expect(bb.max.y).toBeGreaterThan(1.85)
    expect(bb.max.y).toBeLessThan(1.97)
    expect(bb.max.x - bb.min.x).toBeLessThan(0.9) // chunky but not wider than a doorway-friendly capsule
    expect(-bb.min.z).toBeGreaterThan(bb.max.z) // boots/nose/brim stick out toward -Z (front)
  })

  it('is rigidly skinned to the 13-bone skeleton with per-vertex material channels', () => {
    const g = getWorkerGeometry(playerLook)
    const si = g.getAttribute('skinIndex')
    const sw = g.getAttribute('skinWeight')
    const n = g.getAttribute('position').count
    expect(si.count).toBe(n)
    for (let i = 0; i < n; i++) {
      expect(si.getX(i)).toBeLessThan(WORKER_BONE_COUNT)
      expect(sw.getX(i)).toBe(1)
    }
    for (const a of ['normal', 'color', 'aRough', 'aEmis']) expect(g.getAttribute(a).count).toBe(n)
    const emis = g.getAttribute('aEmis')
    let glowing = 0
    for (let i = 0; i < n; i++) if (emis.getX(i) > 0.3) glowing++
    expect(glowing).toBeGreaterThan(0) // reflective stripes
  })

  it('stays within a modest triangle budget (one draw call per worker)', () => {
    for (const accessory of ['none', 'clipboard', 'wrench', 'headset', 'whistle', 'mug', 'tablet'] as const) {
      const g = getWorkerGeometry({ ...DEFAULT_LOOK, accessory, face: 'glasses' })
      const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3
      expect(tris).toBeLessThan(6500)
    }
  })

  it('caches by look (identical looks share one geometry)', () => {
    const a = getWorkerGeometry({ ...DEFAULT_LOOK })
    const b = getWorkerGeometry({ ...DEFAULT_LOOK })
    const c = getWorkerGeometry({ ...DEFAULT_LOOK, helmet: '#ffffff' })
    expect(a).toBe(b)
    expect(c).not.toBe(a)
    expect(a).toBeInstanceOf(THREE.BufferGeometry)
  })

  it('has a distant LOD of ~1k triangles with the same skeleton, channels and silhouette', () => {
    const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3
    for (const accessory of ['none', 'clipboard', 'wrench', 'headset', 'whistle', 'mug', 'tablet'] as const) {
      const look = { ...DEFAULT_LOOK, accessory, face: 'beard' as const, helmetStripe: '#E57D35' }
      const full = getWorkerGeometry(look)
      const lod = getWorkerGeometry(look, 1)
      expect(lod).not.toBe(full)
      expect(getWorkerGeometry(look, 1)).toBe(lod) // cached
      expect(tris(lod)).toBeLessThan(1100)
      expect(tris(lod)).toBeLessThan(tris(full) / 4)
      for (const a of ['position', 'normal', 'color', 'aRough', 'aEmis', 'skinIndex', 'skinWeight']) expect(lod.getAttribute(a)).toBeTruthy()
      const si = lod.getAttribute('skinIndex')
      for (let i = 0; i < si.count; i++) expect(si.getX(i)).toBeLessThan(WORKER_BONE_COUNT)
      full.computeBoundingBox()
      lod.computeBoundingBox()
      expect(Math.abs(lod.boundingBox!.max.y - full.boundingBox!.max.y)).toBeLessThan(0.03) // same hard-hat height
      expect(Math.abs(lod.boundingBox!.min.y - full.boundingBox!.min.y)).toBeLessThan(0.01)
    }
  })

  it('LOD and shadow switch with hysteresis (no flicker at the boundary)', () => {
    const st = { far: false, shadowOff: false }
    const at = (d: number, k = 1) => workerLodState(d * d, st, k)
    at(10)
    expect(st).toEqual({ far: false, shadowOff: false })
    at(WORKER_LOD.lodOut + 0.5)
    expect(st.far).toBe(true)
    at(WORKER_LOD.lodIn + 0.5) // inside the out-threshold but outside the in-threshold: stays far
    expect(st.far).toBe(true)
    at(WORKER_LOD.lodIn - 0.5)
    expect(st.far).toBe(false)
    at(WORKER_LOD.shadowOut + 1)
    expect(st).toEqual({ far: true, shadowOff: true })
    at(WORKER_LOD.shadowIn + 0.5)
    expect(st.shadowOff).toBe(true)
    at(WORKER_LOD.shadowIn - 0.5)
    expect(st.shadowOff).toBe(false)
    // the high tier keeps full detail farther out
    const hi = { far: false, shadowOff: false }
    workerLodState((WORKER_LOD.lodOut + 2) ** 2, hi, WORKER_LOD.highScale)
    expect(hi.far).toBe(false)
    workerLodState(Number.NaN, hi)
    expect(hi.far).toBe(false)
  })

  it('offers the facepalm and thumbs-up gestures (npc dismay / robot-arm finish)', () => {
    const extra: WorkerAnim[] = ['facepalm', 'thumbsup']
    expect(extra).toHaveLength(2)
  })
})
