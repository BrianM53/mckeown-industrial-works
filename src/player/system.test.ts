import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { GROUPS } from '@/core/collision'
import { events } from '@/core/events'
import { runtime } from '@/core/runtime'
import { useGameStore } from '@/state/game'
import { useUIStore } from '@/state/ui'
import { CHECKPOINTS, SPAWN } from '@/world/layout'
import { PARK_Y } from './controller'
import { PlayerSystem, initialSpawn, interiorAt, nearestCheckpoint } from './system'

/** Minimal stand-in for the kinematic body + capsule collider (records what the controller does). */
function fakePhysics(x: number, z: number) {
  const t = { x, y: 0.04, z }
  let enabled = true
  let groups: number = GROUPS.player
  const body = {
    translation: () => ({ ...t }),
    setTranslation: (p: { x: number; y: number; z: number }) => Object.assign(t, p),
    setNextKinematicTranslation: (p: { x: number; y: number; z: number }) => Object.assign(t, p),
  }
  const collider = {
    isEnabled: () => enabled,
    setEnabled: (v: boolean) => {
      enabled = v
    },
    collisionGroups: () => groups,
    setCollisionGroups: (g: number) => {
      groups = g
    },
  }
  return { body, collider, state: () => ({ enabled, groups, ...t }) }
}

describe('player system helpers', () => {
  it('spawns at visitor intake facing north by default', () => {
    expect(initialSpawn()).toEqual({ x: SPAWN.position[0], z: SPAWN.position[1], yaw: SPAWN.yaw })
  })
  it('interiorAt resolves building interiors from the layout', () => {
    expect(interiorAt(12, 29)).toBe('personnel')
    expect(interiorAt(-38, -9)).toBe('server')
    expect(interiorAt(0, 32)).toBeNull()
  })
  it('nearestCheckpoint honours the acceptance filter', () => {
    expect(nearestCheckpoint(0, 31).id).toBe('intake')
    expect(nearestCheckpoint(-37, -9).id).toBe('server')
    expect(nearestCheckpoint(-37, -9, (c) => c.id !== 'server').id).not.toBe('server')
    expect(nearestCheckpoint(0, 0, () => false).id).toBe(CHECKPOINTS[0].id)
  })
})

describe('player system (no physics attached)', () => {
  const subs: Array<() => void> = []
  afterEach(() => {
    subs.splice(0).forEach((f) => f())
    useUIStore.setState({ panel: null, dialogue: null, prompt: null, fade: { opacity: 0 } })
  })

  it('writes the shared runtime and game mode', () => {
    const sys = new PlayerSystem({ x: 4, z: 5, yaw: 1 })
    sys.setMode('foot')
    expect(runtime.player.position.x).toBe(4)
    expect(runtime.player.position.z).toBe(5)
    expect(runtime.player.facing).toBe(1)
    expect(useGameStore.getState().mode).toBe('foot')
  })

  it('teleport without fade moves instantly; NaN is ignored', () => {
    const sys = new PlayerSystem({ x: 0, z: 32, yaw: 0 })
    sys.playerService().teleport(10, -5, 0.5)
    expect(sys.ctrl.pos.x).toBe(10)
    expect(sys.ctrl.pos.z).toBe(-5)
    expect(sys.ctrl.facing).toBe(0.5)
    sys.playerService().teleport(Number.NaN, 3)
    expect(sys.ctrl.pos.x).toBe(10)
  })

  it('teleport is clamped to the playable bounds', () => {
    const sys = new PlayerSystem({ x: 0, z: 32, yaw: 0 })
    sys.playerService().teleport(500, -500)
    expect(sys.ctrl.pos.x).toBeLessThanOrEqual(49)
    expect(sys.ctrl.pos.z).toBeGreaterThanOrEqual(-47)
  })

  it('setLocked stacks reasons; a forklift lock enters vehicle mode and its release leaves it', () => {
    const sys = new PlayerSystem({ x: 0, z: 32, yaw: 0 })
    const svc = sys.playerService()
    svc.setLocked(true, 'cutscene')
    svc.setLocked(true, 'other')
    svc.setLocked(false, 'cutscene')
    expect(sys.ctrl.locked).toBe(true)
    svc.setLocked(false, 'other')
    expect(sys.ctrl.locked).toBe(false)
    svc.setLocked(true, 'forklift')
    expect(sys.ctrl.mode).toBe('forklift')
    expect(runtime.player.mode).toBe('forklift')
    expect(sys.rig.follow).toBe('forklift')
    svc.setLocked(false, 'forklift')
    expect(sys.ctrl.mode).toBe('foot')
    expect(sys.ctrl.locked).toBe(false)
    expect(sys.rig.follow).toBe('player')
  })

  it('camera.follow and forklift events toggle vehicle mode idempotently, and a stale vehicle lock never survives exit', () => {
    const sys = new PlayerSystem({ x: 0, z: 32, yaw: 0 })
    sys.setMode('foot')
    subs.push(events.on('forklift:enter', () => sys.enterVehicle()))
    subs.push(events.on('forklift:exit', () => sys.exitVehicle()))
    sys.playerService().setLocked(true, 'driving-forklift')
    sys.cameraService().follow('forklift')
    events.emit('forklift:enter', {})
    expect(sys.ctrl.mode).toBe('forklift')
    events.emit('forklift:exit', {})
    sys.cameraService().follow('player')
    expect(sys.ctrl.mode).toBe('foot')
    expect(sys.ctrl.locked).toBe(false)
  })

  it('every discontinuous move bumps teleportSeq together with the published position', () => {
    const sys = new PlayerSystem({ x: 0, z: 32, yaw: 0 })
    sys.setMode('foot')
    const s0 = runtime.player.teleportSeq
    sys.playerService().teleport(5, 10, 0)
    expect(runtime.player.teleportSeq).toBe(s0 + 1)
    expect(runtime.player.position.x).toBeCloseTo(5)
    expect(runtime.player.position.z).toBeCloseTo(10)
    sys.respawn('intake', 'debug')
    expect(runtime.player.teleportSeq).toBe(s0 + 2)
    expect(runtime.player.position.z).toBeCloseTo(32)
    sys.debugPlayer().teleport(-3, 20)
    expect(runtime.player.teleportSeq).toBe(s0 + 3)
  })

  it('driving parks the capsule (disabled, no groups, far below); exit after a long drive stands it up without a camera snap', () => {
    const sys = new PlayerSystem({ x: -11.3, z: 27.3, yaw: Math.PI })
    sys.setMode('foot')
    const ph = fakePhysics(-11.3, 27.3)
    sys.ctrl.body = ph.body as never
    sys.ctrl.collider = ph.collider as never
    const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500)
    runtime.forklift.position.set(-11, 0, 29)
    runtime.forklift.yaw = -Math.PI / 2
    const s0 = runtime.player.teleportSeq
    sys.playerService().setLocked(true, 'forklift')
    expect(sys.ctrl.mode).toBe('forklift')
    expect(ph.state()).toMatchObject({ enabled: false, groups: 0 })
    expect(ph.state().y).toBeLessThan(PARK_Y + 1)
    expect(runtime.player.teleportSeq).toBe(s0 + 1) // jumped to the seat
    expect(runtime.player.position.x).toBeCloseTo(-11)
    // a long drive east
    runtime.forklift.position.set(30, 0, 21)
    sys.frame(1 / 60, cam)
    expect(runtime.player.position.x).toBeCloseTo(30)
    const yaw = sys.rig.yaw
    // vehicles places the worker beside the seat (no fade), then releases the lock
    sys.playerService().teleport(30, 22.4, 1.2)
    expect(sys.ctrl.mode).toBe('forklift')
    expect(ph.state().y).toBeLessThan(PARK_Y + 1) // still parked: no contacts while seated
    expect(runtime.player.position.x).toBeCloseTo(30) // still the seat
    sys.playerService().setLocked(false, 'forklift')
    expect(sys.ctrl.mode).toBe('foot')
    expect(ph.state()).toMatchObject({ enabled: true, groups: GROUPS.player })
    expect(ph.state().x).toBeCloseTo(30)
    expect(ph.state().z).toBeCloseTo(22.4)
    expect(ph.state().y).toBeGreaterThan(0)
    expect(runtime.player.position.z).toBeCloseTo(22.4)
    expect(runtime.player.teleportSeq).toBe(s0 + 2)
    expect(sys.rig.yaw).toBe(yaw) // measured from the seat (1.4 m), not the capsule (41 m): no snap
    sys.frame(1 / 60, cam)
    expect(ph.state().y).toBeGreaterThan(0)
  })

  it('anim getter: point after interacting, walk/run by speed, tumble while tackled', () => {
    const sys = new PlayerSystem({ x: 0, z: 32, yaw: 0 })
    expect(sys.anim()).toBe('idle')
    sys.visualSpeed = 3
    expect(sys.anim()).toBe('walk')
    sys.visualSpeed = 7
    expect(sys.anim()).toBe('run')
    sys.tackleAnim = 'tumble'
    expect(sys.anim()).toBe('tumble')
  })

  it('interaction: selects, fires once, never through an open overlay', () => {
    const sys = new PlayerSystem({ x: 0, z: 0, yaw: 0 })
    sys.setMode('foot')
    let hits = 0
    const ids: string[] = []
    subs.push(events.on('player:interact', (p) => ids.push(p.id)))
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return import('@/core/interaction').then(({ registerInteractable }) => {
      subs.push(
        registerInteractable({ id: 'unit:valve', label: 'Valve', verb: 'Turn', getPosition: () => ({ x: 0, y: 0, z: -1.5 }), onInteract: () => hits++ }),
      )
      subs.push(registerInteractable({ id: 'unit:far', label: 'Far', verb: 'Turn', getPosition: () => ({ x: 0, y: 0, z: -9 }), onInteract: () => hits++ }))
      sys.refreshTarget()
      expect(useUIStore.getState().prompt).toEqual({ id: 'unit:valve', verb: 'Turn', label: 'Valve' })
      sys.interact()
      expect(hits).toBe(1)
      expect(ids).toEqual(['unit:valve'])
      expect(sys.anim()).toBe('point')
      useUIStore.setState({ panel: { id: 'help' } })
      sys.refreshTarget()
      expect(useUIStore.getState().prompt).toBeNull()
      sys.interact()
      expect(hits).toBe(1)
    })
  })

  it('tackle locks the player, respawns at intake and resolves in under 3.5 s', async () => {
    const sys = new PlayerSystem({ x: 10, z: 10, yaw: 0 })
    sys.setMode('foot')
    const respawns: string[] = []
    subs.push(events.on('player:respawned', (p) => respawns.push(`${p.reason}:${p.checkpointId}`)))
    const t0 = performance.now()
    const p = sys.tackle([10, 0, 8])
    expect(sys.ctrl.mode).toBe('tackled')
    expect(sys.ctrl.locked).toBe(true)
    expect(sys.tackle([0, 0, 0])).toBe(p) // re-entrant
    await p
    const ms = performance.now() - t0
    expect(ms).toBeLessThan(3500)
    expect(sys.ctrl.mode).toBe('foot')
    expect(sys.ctrl.locked).toBe(false)
    expect(sys.ctrl.pos.x).toBe(0)
    expect(sys.ctrl.pos.z).toBe(32)
    expect(respawns).toEqual(['tackle:intake'])
    expect(useUIStore.getState().fade.opacity).toBe(0)
  }, 6000)

  it('dispose never leaves the screen faded or the player locked', () => {
    const sys = new PlayerSystem({ x: 0, z: 32, yaw: 0 })
    useUIStore.getState().setFade({ opacity: 1 })
    sys.ctrl.setLocked(true, 'travel#9')
    sys.dispose()
    expect(useUIStore.getState().fade.opacity).toBe(0)
    expect(sys.ctrl.locked).toBe(false)
  })
})
