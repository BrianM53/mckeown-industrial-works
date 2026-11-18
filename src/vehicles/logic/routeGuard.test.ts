import { describe, expect, it } from 'vitest'
import { EAST, NORTH, WAYPOINTS, ZONES } from '@/world/layout'
import { HOME, ROUTE_GUARD } from '../constants'
import { DOOR_ZONES, RouteGuard, blockedDoor, blockedSegment, isAtHome, type GuardInput } from './routeGuard'

const DT = 1 / 30

function run(g: RouteGuard, s: GuardInput, seconds: number): string[] {
  const out: string[] = []
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    const a = g.update(DT, s)
    if (a) out.push(a)
  }
  return out
}

const home: GuardInput = { x: HOME.x, z: HOME.z, yaw: HOME.yaw, occupied: false, upright: true }
/** Parked across the personnel office door opening (outside). */
const inDoor: GuardInput = { x: 5.4, z: 29, yaw: NORTH, occupied: false, upright: true }
/** On the main aisle, right on the aisleM→aisleN waypoint segment. */
const onAisle: GuardInput = { x: 0, z: 6, yaw: NORTH, occupied: false, upright: true }
/** Off every route: south-west back lot corner of the warehouse apron. */
const offRoute: GuardInput = { x: -43, z: 30, yaw: NORTH, occupied: false, upright: true }

describe('route guard geometry', () => {
  it('has a door zone for every building', () => {
    const buildings = Object.values(ZONES).filter((z) => z.building).map((z) => z.id)
    expect(DOOR_ZONES.map((d) => d.id).sort()).toEqual([...buildings].sort())
  })

  it('home is home, and home is never treated as blocking', () => {
    expect(isAtHome(home)).toBe(true)
    expect(isAtHome({ ...home, x: HOME.x + 3 })).toBe(false)
    expect(isAtHome({ ...home, yaw: HOME.yaw + 1.2 })).toBe(false)
    const g = new RouteGuard()
    expect(run(g, home, 600)).toEqual([])
  })

  it('detects door spans and waypoint segments', () => {
    expect(blockedDoor(inDoor)).toBe('personnel')
    expect(blockedSegment(onAisle)).not.toBeNull()
    expect(blockedDoor(offRoute)).toBeNull()
    expect(blockedSegment(offRoute)).toBeNull()
  })

  it('every waypoint itself would count as blocked', () => {
    for (const w of Object.values(WAYPOINTS)) {
      if (w.links.length === 0) continue
      const pose = { x: w.position[0], z: w.position[1], yaw: EAST }
      expect(blockedSegment(pose) ?? blockedDoor(pose), w.id).not.toBeNull()
    }
  })
})

describe('route guard timing', () => {
  it('returns a forklift left in a doorway after 30 s', () => {
    const g = new RouteGuard()
    expect(run(g, inDoor, ROUTE_GUARD.blockingAfter - 0.5)).toEqual([])
    expect(run(g, inDoor, 1)).toEqual(['return'])
    expect(g.reason).toBe('door')
  })

  it('returns a forklift left on a walking route after 30 s', () => {
    const g = new RouteGuard()
    expect(run(g, onAisle, ROUTE_GUARD.blockingAfter + 0.5)[0]).toBe('return')
    expect(g.reason).toBe('waypoint')
  })

  it('returns an idle forklift away from home after 3 minutes, not before', () => {
    const g = new RouteGuard()
    expect(run(g, offRoute, ROUTE_GUARD.idleAfter - 1)).toEqual([])
    expect(run(g, offRoute, 1.5)).toEqual(['return'])
    expect(g.reason).toBe('idle')
  })

  it('never acts while occupied, and occupancy resets the timers', () => {
    const g = new RouteGuard()
    run(g, inDoor, 25)
    expect(run(g, { ...inDoor, occupied: true }, 300)).toEqual([])
    expect(run(g, inDoor, 25)).toEqual([])
  })

  it('sets an abandoned overturned forklift back on its wheels after 8 s', () => {
    const g = new RouteGuard()
    const flipped = { ...offRoute, upright: false }
    expect(run(g, flipped, ROUTE_GUARD.overturnedAfter - 0.5)).toEqual([])
    expect(run(g, flipped, 1)).toEqual(['upright'])
  })

  it('a deferred return retries a few seconds later', () => {
    const g = new RouteGuard()
    expect(run(g, inDoor, ROUTE_GUARD.blockingAfter + 0.1)).toEqual(['return'])
    g.deferred()
    expect(run(g, inDoor, ROUTE_GUARD.retryAfter - 0.2)).toEqual([])
    expect(run(g, inDoor, 0.5)).toEqual(['return'])
    g.done()
    expect(g.blockingFor).toBe(0)
    expect(g.idleFor).toBe(0)
  })

  it('ignores non-finite poses', () => {
    const g = new RouteGuard()
    expect(run(g, { ...inDoor, x: Number.NaN }, 60)).toEqual([])
  })
})
