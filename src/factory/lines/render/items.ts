/**
 * Item renderer: one InstancedMesh per item model, rebuilt every frame from
 * factory.state (no independent timers):
 *  - belt items: lines[id].items (0 = south input, 1 = north output), with the
 *    model chosen by belt position (ingot → sheet → panel …) and stable
 *    per-item variety from the cycle that made it;
 *  - transit items: parts the tower accepted ride the elevator, the head
 *    bridge and the collector into the tower (visual continuation);
 *  - payload pods on the monorail + rejected pods (chute / bin).
 */
import * as THREE from 'three'
import type { LineId } from '@/core/types'
import type { FactoryState, LineState } from '@/systems/factory'
import { BELT, GROUND_LINES, MONORAIL, POD, lineDef, zAt, type GroundLineId, type ItemKind } from '../config'
import { DeliveryCounter, hash01, itemKindFor, samplePath, transitPath, type TransitPath } from '../logic'
import { ITEM_LIFT } from '../build/items'
import type { RejectState } from '../build/payload'

const KINDS: ItemKind[] = [
  'ingot',
  'sheet',
  'panel',
  'fin',
  'pipeStraight',
  'pipeElbow',
  'pipeValve',
  'pipeBundle',
  'boardBlank',
  'boardPopulated',
  'tankShell',
  'tankFuel',
  'podCapsule',
  'podCrate',
]

const BELT_CAP = 20
const TRANSIT_CAP = 14
const REJECT_CAP = 8

const OUTPUT_KINDS: Record<GroundLineId, ItemKind[]> = {
  smelt: ['panel', 'fin'],
  pipe: ['pipeBundle'],
  circuit: ['boardPopulated'],
  tank: ['tankFuel'],
}

interface Transit {
  s: number
  cycle: number
  kind: ItemKind
  path: TransitPath
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3(1, 1, 1)
const _o = new THREE.Vector3()
const _c = new THREE.Color()
const _pt: [number, number, number, number] = [0, 0, 0, 0]

export class ItemRenderer {
  readonly meshes: Record<ItemKind, THREE.InstancedMesh>
  private readonly n = {} as Record<ItemKind, number>
  /** Pooled transit records per line; the first `transitCount[id]` are live. */
  private readonly transits = {} as Record<GroundLineId, Transit[]>
  private readonly transitCount = {} as Record<GroundLineId, number>
  private readonly counters = {} as Record<GroundLineId, DeliveryCounter>
  private readonly paths = new Map<string, TransitPath>()
  /** Visible items last frame (debug stats). */
  readonly visible = { belt: 0, transit: 0, pods: 0, rejects: 0 }

  constructor(geos: Record<ItemKind, THREE.BufferGeometry>, material: THREE.Material) {
    const meshes = {} as Record<ItemKind, THREE.InstancedMesh>
    const outputs = new Set(Object.values(OUTPUT_KINDS).flat())
    for (const kind of KINDS) {
      const cap = BELT_CAP + (outputs.has(kind) ? TRANSIT_CAP : 0) + (kind === 'podCapsule' || kind === 'podCrate' ? REJECT_CAP : 0)
      const mesh = new THREE.InstancedMesh(geos[kind], material, cap)
      mesh.count = 0
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.name = `lines:item:${kind}`
      // the spine is ~40 m across: a fixed sphere keeps culling without per-frame bounds
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3, 8), 30)
      mesh.receiveShadow = true
      meshes[kind] = mesh
      this.n[kind] = 0
    }
    // hot ingots cool down along the belt (instance color drives the glow)
    meshes.ingot.setColorAt(0, _c.setRGB(1, 1, 1))
    meshes.ingot.instanceColor?.setUsage(THREE.DynamicDrawUsage)
    this.meshes = meshes
    for (const id of GROUND_LINES) {
      const kind = OUTPUT_KINDS[id][0]
      this.transits[id] = Array.from({ length: TRANSIT_CAP }, () => ({ s: 0, cycle: 0, kind, path: this.path(id, kind) }))
      this.transitCount[id] = 0
      this.counters[id] = new DeliveryCounter()
    }
  }

  setShadows(on: boolean): void {
    for (const kind of KINDS) this.meshes[kind].castShadow = on && kind !== 'sheet' && kind !== 'boardBlank'
  }

  private path(line: GroundLineId, kind: ItemKind): TransitPath {
    const key = `${line}:${kind}`
    let p = this.paths.get(key)
    if (!p) {
      p = transitPath(lineDef(line).x, ITEM_LIFT[kind])
      this.paths.set(key, p)
    }
    return p
  }

  private put(kind: ItemKind, x: number, y: number, z: number, rx: number, ry: number, rz: number): number {
    const mesh = this.meshes[kind]
    const i = this.n[kind]
    if (i >= mesh.instanceMatrix.count) return -1
    _e.set(rx, ry, rz, 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_p.set(x, y, z), _q, _s)
    mesh.setMatrixAt(i, _m)
    this.n[kind] = i + 1
    return i
  }

  update(s: FactoryState, t: number, dt: number, reduced: boolean, rejects: RejectState | null): void {
    for (const kind of KINDS) this.n[kind] = 0
    const v = this.visible
    v.belt = v.transit = v.pods = v.rejects = 0
    const speed = Number.isFinite(s.params.conveyorSpeed) ? s.params.conveyorSpeed : 1

    // ---- ground belts + transit
    for (const id of GROUND_LINES) {
      const L = s.lines[id] as LineState
      const def = lineDef(id)
      const items = L.items
      const len = items.length
      const li = GROUND_LINES.indexOf(id)
      for (let i = 0; i < len; i++) {
        const p = items[i]
        if (!Number.isFinite(p)) continue
        const cycle = L.cycles - (len - 1 - i)
        const kind = itemKindFor(id, p, cycle)
        const h = hash01(cycle, li + 11)
        const jitterYaw = kind === 'tankShell' || kind === 'tankFuel' ? 0 : (hash01(cycle, li + 23) - 0.5) * 0.14
        const idx = this.put(kind, def.x + (h - 0.5) * 0.08, BELT.top, zAt(def, Math.min(1, Math.max(0, p))), 0, jitterYaw, 0)
        if (idx >= 0 && kind === 'ingot') {
          const heat = 0.55 + 0.45 * Math.max(0, Math.min(1, 1 - (p - 0.22) / 0.16))
          this.meshes.ingot.setColorAt(idx, _c.setRGB(heat, heat * 0.92, heat * 0.85))
        }
        v.belt++
      }
      // parts the tower accepted continue up the elevator and along the collector
      const counter = this.counters[id]
      const delivered = counter.update(L.cycles, len)
      const list = this.transits[id]
      let count = this.transitCount[id]
      if (delivered > 0) {
        const first = counter.total - delivered + 1
        const spawn = Math.min(delivered, 3)
        for (let j = delivered - spawn; j < delivered && count < TRANSIT_CAP; j++) {
          const it = list[count++]
          it.s = 0
          it.cycle = first + j
          it.kind = itemKindFor(id, 1, it.cycle)
          it.path = this.path(id, it.kind)
        }
      }
      for (let i = count - 1; i >= 0; i--) {
        const it = list[i]
        const path = it.path
        const seg = it.s < path.cum[1] ? 0 : it.s < path.cum[2] ? 1 : it.s < path.cum[3] ? 2 : it.s < path.cum[4] ? 3 : 4
        const sp = seg === 0 ? Math.max(0.5, L.beltSpeed * 16) : seg === 1 ? 0.8 : seg === 2 ? 1.2 : seg === 3 ? 3.0 : 1.1 * speed
        it.s += sp * dt
        if (it.s >= path.length) {
          // swap-remove (keep the pooled record)
          const last = list[--count]
          list[count] = it
          list[i] = last
        }
      }
      this.transitCount[id] = count
      for (let i = 0; i < count; i++) {
        const it = list[i]
        samplePath(it.path, it.s, _pt)
        const yaw = _pt[3] === 1 ? (def.x < 0 ? -Math.PI / 2 : Math.PI / 2) : 0
        this.put(it.kind, _pt[0], _pt[1] - ITEM_LIFT[it.kind], _pt[2], 0, yaw, 0)
        v.transit++
      }
    }

    // ---- payload pods on the monorail
    const P = s.lines.payload
    const pdef = lineDef('payload' as LineId)
    for (let i = 0; i < P.items.length; i++) {
      const p = P.items[i]
      if (!Number.isFinite(p)) continue
      const cycle = P.cycles - (P.items.length - 1 - i)
      const kind = itemKindFor('payload', p, cycle)
      const sway = reduced ? 0 : 1
      const roll = sway * 0.035 * Math.sin(t * 1.7 + cycle * 1.3)
      const pitch = sway * 0.03 * Math.sin(t * 1.1 + cycle * 0.7)
      this.put(kind, 0, MONORAIL.y, zAt(pdef, p), pitch, (hash01(cycle, 77) - 0.5) * 0.5, roll)
      v.pods++
    }
    // ---- rejected pods (falling / in the bin): rotate about the body center
    if (rejects) {
      for (let i = 0; i < rejects.count; i++) {
        const r = rejects.poses[i]
        const kind = itemKindFor('payload', 0, rejects.cycles[i])
        _e.set(r.rx, 0.3 * i, r.rz, 'YXZ')
        _q.setFromEuler(_e)
        _o.set(0, POD.hang, 0).applyQuaternion(_q)
        const mesh = this.meshes[kind]
        const n = this.n[kind]
        if (n >= mesh.instanceMatrix.count) continue
        _m.compose(_p.set(r.x + _o.x, r.y + _o.y, r.z + _o.z), _q, _s)
        mesh.setMatrixAt(n, _m)
        this.n[kind] = n + 1
        v.rejects++
      }
    }

    for (const kind of KINDS) {
      const mesh = this.meshes[kind]
      const n = this.n[kind]
      if (mesh.count !== n) mesh.count = n
      if (n > 0) {
        mesh.instanceMatrix.clearUpdateRanges()
        mesh.instanceMatrix.addUpdateRange(0, n * 16)
        mesh.instanceMatrix.needsUpdate = true
      }
    }
    const ic = this.meshes.ingot.instanceColor
    if (ic && this.n.ingot > 0) ic.needsUpdate = true
  }

  /** Forget transit state (e.g. after a hard factory reset). */
  reset(): void {
    for (const id of GROUND_LINES) {
      this.transitCount[id] = 0
      this.counters[id] = new DeliveryCounter()
    }
  }

  dispose(): void {
    for (const kind of KINDS) this.meshes[kind].dispose()
  }
}
