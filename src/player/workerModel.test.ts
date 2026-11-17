import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DEFAULT_LOOK, WORKER_BONE_COUNT, getWorkerGeometry, type WorkerLook } from '@/world/WorkerModel'
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
})
