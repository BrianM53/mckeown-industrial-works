import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RocketState } from '@/systems/factory/types'
import { ROCKET_STAGES } from '@/systems/factory/types'
import { PRINCIPAL_ZONES, ZONES, restrictedZoneAt, PLAYABLE_BOUNDS } from '@/world/layout'
import { contrastRatio, over } from './contrast'
import { DESTINATIONS } from './destinations'
import { MAX_CAPTIONS, MAX_TOASTS, clearFeed, normalizeDuration, pushCaption, pushToast, useFeed } from './feed'
import { clampStickCenter, stickVector } from './joystick'
import { describeCounters, describeLaunch } from './launchStatus'
import { assetHref, hostLabel, portfolioHref, repoPath } from './links'

afterEach(() => {
  clearFeed()
  vi.useRealTimers()
})

describe('joystick math', () => {
  it('returns zero at the centre and inside the dead zone', () => {
    expect(stickVector(0, 0, 56)).toMatchObject({ x: 0, y: 0, magnitude: 0 })
    expect(stickVector(5, 0, 56).magnitude).toBe(0)
  })
  it('maps screen up to forward and right to right, clamped to 1', () => {
    const up = stickVector(0, -56, 56)
    expect(up.y).toBeCloseTo(1)
    expect(up.x).toBeCloseTo(0)
    const right = stickVector(200, 0, 56)
    expect(right.x).toBeCloseTo(1)
    expect(right.knobX).toBeCloseTo(56)
    const diag = stickVector(100, 100, 56)
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(1)
    expect(diag.y).toBeLessThan(0) // screen down = backwards
  })
  it('is NaN-safe', () => {
    expect(stickVector(Number.NaN, 4, 56)).toMatchObject({ x: 0, y: 0 })
    expect(stickVector(10, 10, 0)).toMatchObject({ x: 0, y: 0 })
  })
  it('keeps a floating stick on screen', () => {
    expect(clampStickCenter(5, 5, 60, { minX: 0, maxX: 300, minY: 0, maxY: 400 })).toEqual({ x: 60, y: 60 })
    expect(clampStickCenter(299, 399, 60, { minX: 0, maxX: 300, minY: 0, maxY: 400 })).toEqual({ x: 240, y: 340 })
  })
})

describe('launch strip text', () => {
  const base: RocketState = {
    id: 4,
    seed: 1,
    phase: 'assembling',
    phaseTime: 0,
    phaseDuration: Infinity,
    stagesComplete: 3,
    stageProgress: 0.72,
    countdown: null,
    transport: 0,
    outcome: null,
    stowaway: false,
  }
  it('formats assembly progress and stage', () => {
    const s = describeLaunch(base)
    const pct = Math.floor(((3 + 0.72) / ROCKET_STAGES.length) * 100)
    expect(s.label).toBe(`ROCKET #4 · ASSEMBLY ${pct}%`)
    expect(s.detail).toBe('Guidance')
    expect(s.progress).toBeCloseTo((3 + 0.72) / ROCKET_STAGES.length)
    expect(describeLaunch({ ...base, stagesComplete: 6, stageProgress: 0 }).label).toBe('ROCKET #4 · ASSEMBLY 100%')
  })
  it('makes the countdown prominent', () => {
    const s = describeLaunch({ ...base, phase: 'countdown', countdown: 6.2 })
    expect(s.label).toBe('LAUNCH IN 7')
    expect(s.countdown).toBe(7)
    expect(s.tone).toBe('alert')
  })
  it('covers every phase and outcome', () => {
    expect(describeLaunch({ ...base, phase: 'rollout', transport: 0.5 }).label).toBe('ROCKET #4 · ROLLOUT 50%')
    expect(describeLaunch({ ...base, phase: 'pad' }).label).toContain('ON THE PAD')
    expect(describeLaunch({ ...base, phase: 'ignition' }).label).toContain('IGNITION')
    expect(describeLaunch({ ...base, phase: 'flight' }).label).toContain('LIFTOFF')
    expect(describeLaunch({ ...base, phase: 'aftermath', outcome: 'success' }).tone).toBe('good')
    expect(describeLaunch({ ...base, phase: 'aftermath', outcome: 'wobble' }).tone).toBe('good')
    expect(describeLaunch({ ...base, phase: 'aftermath', outcome: 'breakup' }).label).toContain('UNSCHEDULED DISASSEMBLY')
    expect(describeLaunch({ ...base, phase: 'aftermath', outcome: 'explosion' }).tone).toBe('bad')
    expect(describeLaunch({ ...base, phase: 'reset' }).label).toContain('CLEARING THE PAD')
  })
  it('survives garbage numbers', () => {
    const s = describeLaunch({ ...base, stagesComplete: Number.NaN, stageProgress: Number.NaN })
    expect(s.label).toBe('ROCKET #4 · ASSEMBLY 0%')
    expect(describeLaunch({ ...base, phase: 'countdown', countdown: null }).countdown).toBe(0)
    expect(describeCounters({ successes: 3, disassemblies: 41, lastDisassemblyT: 0 })).toBe('3 launched · 41 disassembled')
  })
})

describe('directory destinations', () => {
  it('lead with the five principal zones in layout order', () => {
    expect(DESTINATIONS.slice(0, 5).map((d) => d.key)).toEqual(PRINCIPAL_ZONES)
    expect(DESTINATIONS.slice(0, 5).every((d) => d.principal && d.panel)).toBe(true)
  })
  it('take names, colours, blurbs and entrances from layout.ts', () => {
    for (const d of DESTINATIONS.filter((x) => x.key !== 'contact')) {
      const z = ZONES[d.zoneId]
      expect(d.color).toBe(z.color)
      expect(d.blurb).toBe(z.blurb)
      expect([d.travel.x, d.travel.z]).toEqual(z.entrance)
      expect(d.travel.yaw).toBe(z.entranceYaw)
    }
  })
  it('send every travel point somewhere safe and playable', () => {
    for (const d of DESTINATIONS) {
      const b = PLAYABLE_BOUNDS
      expect(d.travel.x).toBeGreaterThanOrEqual(b.minX)
      expect(d.travel.x).toBeLessThanOrEqual(b.maxX)
      expect(d.travel.z).toBeGreaterThanOrEqual(b.minZ)
      expect(d.travel.z).toBeLessThanOrEqual(b.maxZ)
      expect(restrictedZoneAt(d.travel.x, d.travel.z)).toBeNull()
      expect(Number.isFinite(d.travel.yaw)).toBe(true)
    }
  })
  it('contact faces the intake mailbox; launch and maintenance have no panel', () => {
    const contact = DESTINATIONS.find((d) => d.key === 'contact')!
    expect(contact.panel).toBe('contact')
    expect(contact.zoneId).toBe('intake')
    expect(contact.travel.yaw).toBeCloseTo(-Math.PI / 2) // mailbox is east of the stand point
    expect(DESTINATIONS.find((d) => d.key === 'launch')!.panel).toBeNull()
    expect(DESTINATIONS.find((d) => d.key === 'maintenance')!.panel).toBeNull()
    expect(DESTINATIONS.find((d) => d.key === 'production')!.panel).toBe('console')
  })
})

describe('toast / caption feed', () => {
  it('dedupes identical text, caps the stack and expires', () => {
    vi.useFakeTimers()
    pushToast({ text: 'Hello', duration: 2 })
    pushToast({ text: 'Hello', duration: 2 })
    expect(useFeed.getState().toasts).toHaveLength(1)
    for (let i = 0; i < 10; i++) pushToast({ text: `t${i}` })
    expect(useFeed.getState().toasts).toHaveLength(MAX_TOASTS)
    for (let i = 0; i < 10; i++) pushCaption({ text: `c${i}` })
    expect(useFeed.getState().captions).toHaveLength(MAX_CAPTIONS)
    vi.advanceTimersByTime(20_000)
    expect(useFeed.getState().toasts).toHaveLength(0)
    expect(useFeed.getState().captions).toHaveLength(0)
  })
  it('treats large durations as milliseconds and ignores empty text', () => {
    expect(normalizeDuration(3000, 4)).toBe(3)
    expect(normalizeDuration(2.5, 4)).toBe(2.5)
    expect(normalizeDuration(undefined, 4)).toBe(4)
    expect(normalizeDuration(-1, 4)).toBe(4)
    expect(pushToast({ text: '   ' })).toBe(-1)
  })
})

describe('links', () => {
  it('builds base-relative URLs', () => {
    expect(portfolioHref()).toBe('/portfolio/')
    expect(assetHref('resume/cv.pdf')).toBe('/resume/cv.pdf')
    expect(assetHref('/resume/cv.pdf')).toBe('/resume/cv.pdf')
    expect(assetHref('https://example.com/cv.pdf')).toBe('https://example.com/cv.pdf')
    expect(repoPath('https://github.com/BrianM53/Gaussian-SLAM')).toBe('BrianM53/Gaussian-SLAM')
    expect(hostLabel('https://www.codestory.co/episodes/x/')).toBe('codestory.co')
  })
})

describe('colour contrast (WCAG AA, 4.5:1 for text)', () => {
  const paper = '#f3ecdc'
  const hmi = '#1a1e1f'
  const plate = '#2a3133'
  const pairs: [string, string, string][] = [
    ['paper ink', '#2a2622', paper],
    ['paper dim', '#5c5348', paper],
    ['paper link', '#245d72', paper],
    ['source note', '#6b6155', paper],
    ['stamp red', '#a8382c', paper],
    ['hmi text', '#e9e4d6', hmi],
    ['hmi dim', '#aab3b1', hmi],
    ['hmi link', '#9fd4e0', hmi],
    ['kicker on plate', '#e9b63f', plate],
    ['dim on plate', '#aab3b1', '#2c3436'],
    ['primary button', '#1b1d1d', '#e9b63f'],
    ['top bar text', '#e9e4d6', '#20272a'],
    ['skip link', '#e9b63f', '#20272a'],
    ['dest blurb', '#d5d0c3', '#20272a'],
    ['toast', '#e9e4d6', '#1d2324'],
    ['caption', '#ffffff', over('#080a0a', 0.86, '#ffffff')],
    ['HUD plate over white sky', '#e9e4d6', over('#141819', 0.88, '#ffffff')],
    ['loading log', '#b4e0b1', '#0e1112'],
    ['zone chip text (radio)', '#000000', '#c8553d'],
    ['zone chip text (r&d)', '#000000', '#8c6bb1'],
    ['feature rig label', '#5b4a73', '#ebe2cc'],
    ['on-air sign', '#ff8a78', '#3a1410'],
  ]
  it.each(pairs)('%s', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5)
  })
})
