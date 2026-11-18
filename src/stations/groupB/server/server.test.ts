import { describe, expect, it } from 'vitest'
import { GITHUB_PROFILE_URL, PROJECTS } from '@/content/projects'
import { WAYPOINTS } from '@/world/layout'
import { colliderBounds, pointInCollider } from '../shared/colliders'
import { serverColliders } from './colliders'
import { githubHandle, indexScreen, projectScreen, terminalScreens } from './crt'
import { DOOR, FAN, INTERIOR, kioskInteractPoint, kioskLayout, RACK_ROWS, TERMINAL } from './layout'

describe('Server Hall layout', () => {
  const kiosks = kioskLayout()
  const colliders = serverColliders()

  it('gives every project its own CRT kiosk (plus a repository index when a slot is free)', () => {
    const ids = kiosks.filter((k) => k.content.kind === 'project').map((k) => (k.content.kind === 'project' ? k.content.projectId : ''))
    expect(ids).toEqual(PROJECTS.map((p) => p.id))
    expect(new Set(kiosks.map((k) => k.id)).size).toBe(kiosks.length)
    // future-proof: a longer list still gets one kiosk each (overflow slots)
    const many = kioskLayout(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
    expect(many.filter((k) => k.content.kind === 'project')).toHaveLength(8)
  })

  it('keeps the door span and the waypoint segment clear', () => {
    const a = WAYPOINTS.serverDoor.position
    const b = WAYPOINTS.serverInside.position
    for (let k = 0; k <= 30; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / 30
      const z = a[1] + ((b[1] - a[1]) * k) / 30
      for (const c of colliders) expect(pointInCollider(c, x, z, 0.45), `${c.id} blocks the server waypoint segment`).toBe(false)
    }
    for (let z = DOOR.z0; z <= DOOR.z1; z += 0.25)
      for (let x = DOOR.x - 2; x <= DOOR.x; x += 0.25) for (const c of colliders) expect(pointInCollider(c, x, z), `${c.id} blocks the door`).toBe(false)
  })

  it('places colliders inside the hall and every interaction spot in reachable floor', () => {
    for (const c of colliders) {
      const r = colliderBounds(c)
      expect(r.minX, c.id).toBeGreaterThanOrEqual(INTERIOR.minX - 0.01)
      expect(r.maxX, c.id).toBeLessThanOrEqual(INTERIOR.maxX + 0.01)
      expect(r.minZ, c.id).toBeGreaterThanOrEqual(INTERIOR.minZ - 0.01)
      expect(r.maxZ, c.id).toBeLessThanOrEqual(INTERIOR.maxZ + 0.01)
    }
    const spots = [...kiosks.map((k) => kioskInteractPoint(k)), TERMINAL.interact, FAN.interact]
    for (const p of spots) for (const c of colliders) expect(pointInCollider(c, p.x, p.z, 0.3), `${c.id} covers ${p.x},${p.z}`).toBe(false)
  })

  it('leaves a ≥ 2.5 m central aisle between the rack blocks', () => {
    const north = Math.max(...RACK_ROWS.filter((r) => r.block === 'N').map((r) => r.z1))
    const south = Math.min(...RACK_ROWS.filter((r) => r.block === 'S').map((r) => r.z0))
    expect(south - north).toBeGreaterThanOrEqual(2.5)
  })
})

describe('Server Hall CRT content', () => {
  it('uses only project facts: name, one-liner, tech — no fake stats or activity', () => {
    PROJECTS.forEach((p, i) => {
      const s = projectScreen(p, i, PROJECTS.length)
      const text = s.lines.map((l) => l.text).join(' ')
      expect(text).toContain(p.name.toUpperCase().split(' ')[0])
      expect(s.prompt.toUpperCase()).toContain('E')
      expect(text).not.toMatch(/\b(stars?|commits?|forks?|contributions?)\b/i)
    })
    const all = [indexScreen(), ...terminalScreens()].flatMap((s) => s.lines.map((l) => l.text)).join(' ')
    expect(all).not.toMatch(/\b(stars?|commits?|forks?|contributions?)\b/i)
    expect(githubHandle(GITHUB_PROFILE_URL)).toMatch(/^github\.com\//)
  })
})
