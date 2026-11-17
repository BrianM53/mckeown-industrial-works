import * as THREE from 'three'

/**
 * Selective occluder fading (spec §3 "fade obstructing props selectively").
 *
 * Solid things (walls, machinery) carry STATIC / camera-blocker colliders and
 * the spring arm simply pulls the camera in front of them. Thin decorative
 * props — pipes, signs, cable trays, railings — should NOT shove the camera
 * around, so modules may opt them in instead:
 *
 *     object.userData.cameraFade = true
 *
 * While such an object sits between the camera and the worker's head it is
 * hidden, and it reappears once the line of sight has been clear for a moment.
 * Cheap: flagged objects are collected at ~0.5 Hz and only they are raycast,
 * at 10 Hz.
 */
export const CAMERA_FADE_FLAG = 'cameraFade'

const SCAN_INTERVAL = 2
const RAY_INTERVAL = 0.1
const HIDE_AFTER = 0.12
const SHOW_AFTER = 0.35

interface Tracked {
  obj: THREE.Object3D
  blockedFor: number
  clearFor: number
  hiddenByUs: boolean
}

const _dir = new THREE.Vector3()

export class OccluderFader {
  private tracked = new Map<THREE.Object3D, Tracked>()
  private scanT = SCAN_INTERVAL
  private rayT = 0
  private readonly raycaster = new THREE.Raycaster()
  private readonly hits: THREE.Intersection[] = []
  private readonly blocked = new Set<THREE.Object3D>()

  update(dt: number, scene: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
    this.scanT += dt
    if (this.scanT >= SCAN_INTERVAL) {
      this.scanT = 0
      this.scan(scene)
    }
    if (this.tracked.size === 0) return
    this.rayT += dt
    if (this.rayT < RAY_INTERVAL) return
    const step = this.rayT
    this.rayT = 0

    this.blocked.clear()
    _dir.subVectors(to, from)
    const dist = _dir.length()
    if (dist > 0.3) {
      _dir.multiplyScalar(1 / dist)
      this.raycaster.set(from, _dir)
      this.raycaster.near = 0
      this.raycaster.far = dist - 0.25
      for (const t of this.tracked.values()) {
        this.hits.length = 0
        try {
          t.obj.raycast(this.raycaster, this.hits)
          if (this.hits.length === 0) t.obj.traverse((c) => c !== t.obj && c.raycast(this.raycaster, this.hits))
        } catch {
          /* exotic object without raycast support */
        }
        if (this.hits.length) this.blocked.add(t.obj)
      }
    }

    for (const t of this.tracked.values()) {
      if (this.blocked.has(t.obj)) {
        t.blockedFor += step
        t.clearFor = 0
        if (!t.hiddenByUs && t.blockedFor >= HIDE_AFTER && t.obj.visible) {
          t.obj.visible = false
          t.hiddenByUs = true
        }
      } else {
        t.clearFor += step
        t.blockedFor = 0
        if (t.hiddenByUs && t.clearFor >= SHOW_AFTER) {
          t.obj.visible = true
          t.hiddenByUs = false
        }
      }
    }
  }

  private scan(scene: THREE.Object3D): void {
    const seen = new Set<THREE.Object3D>()
    scene.traverse((o) => {
      if (o.userData && o.userData[CAMERA_FADE_FLAG] === true) seen.add(o)
    })
    // forget objects that left the scene or dropped the flag (restoring what we hid)
    for (const [obj, t] of this.tracked) {
      if (!seen.has(obj)) {
        if (t.hiddenByUs) obj.visible = true
        this.tracked.delete(obj)
      }
    }
    for (const obj of seen) if (!this.tracked.has(obj)) this.tracked.set(obj, { obj, blockedFor: 0, clearFor: 0, hiddenByUs: false })
  }

  /** Restore everything we hid (unmount). */
  restoreAll(): void {
    for (const t of this.tracked.values()) if (t.hiddenByUs) t.obj.visible = true
    this.tracked.clear()
  }

  get trackedCount(): number {
    return this.tracked.size
  }

  get hiddenCount(): number {
    let n = 0
    for (const t of this.tracked.values()) if (t.hiddenByUs) n++
    return n
  }
}
