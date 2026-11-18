import { afterEach, describe, expect, it } from 'vitest'
import { DriveInput, driveControlForKey, type DriveIntent } from './input'

const intent = (): DriveIntent => ({ throttle: 0, steer: 0, held: false })
const key = (type: 'keydown' | 'keyup', code: string, k: string) => window.dispatchEvent(new KeyboardEvent(type, { code, key: k, bubbles: true }))

describe('forklift drive input', () => {
  const inputs: Array<() => void> = []
  afterEach(() => {
    for (const off of inputs.splice(0)) off()
  })

  it('maps WASD / arrows / H / Space by physical key', () => {
    expect(driveControlForKey('KeyW', 'z')).toBe('fwd') // AZERTY: physical W position
    expect(driveControlForKey('ArrowDown', 'ArrowDown')).toBe('back')
    expect(driveControlForKey('KeyA', 'q')).toBe('left')
    expect(driveControlForKey('ArrowRight', 'ArrowRight')).toBe('right')
    expect(driveControlForKey('KeyH', 'h')).toBe('horn')
    expect(driveControlForKey('Space', ' ')).toBe('horn')
    expect(driveControlForKey('KeyE', 'e')).toBeNull() // exit stays with the player module
    expect(driveControlForKey('KeyR', 'r')).toBeNull() // recover stays with the player module
    expect(driveControlForKey('', 'd')).toBe('right')
  })

  it('programmatic drive counts down in physics time (frame-rate independent)', () => {
    const inp = new DriveInput()
    inp.setTest(1, -0.5, 500)
    const out = intent()
    let steps = 0
    while (inp.testActive && steps < 1000) {
      inp.read(out, false)
      expect(out.throttle).toBe(1)
      expect(out.steer).toBe(-0.5)
      expect(out.held).toBe(true)
      inp.advance(1 / 60)
      steps++
    }
    expect(steps).toBe(30)
    expect(inp.testLeft).toBe(0)
    inp.read(out, false)
    expect(out.throttle).toBe(0)
    // garbage is clamped / ignored; 0 ms cancels
    inp.setTest(Number.NaN, 7, 100)
    inp.read(out, false)
    expect(out.throttle).toBe(0)
    expect(out.steer).toBe(1)
    inp.setTest(1, 0, 0)
    expect(inp.testActive).toBe(false)
  })

  it('keys drive only while seated, and keys held when climbing in are ignored until released', () => {
    const inp = new DriveInput()
    inputs.push(inp.attach())
    const out = intent()
    key('keydown', 'KeyW', 'w')
    inp.read(out, true)
    expect(out.throttle).toBe(1)
    inp.read(out, false)
    expect(out.throttle).toBe(0)
    inp.suppressHeld() // climbing in with W still down → no lurch
    inp.read(out, true)
    expect(out.throttle).toBe(0)
    key('keyup', 'KeyW', 'w')
    key('keydown', 'KeyW', 'w')
    key('keydown', 'KeyD', 'd')
    inp.read(out, true)
    expect(out.throttle).toBe(1)
    expect(out.steer).toBe(1)
    window.dispatchEvent(new Event('blur')) // alt-tab drops everything
    inp.read(out, true)
    expect(out.throttle).toBe(0)
    expect(out.steer).toBe(0)
  })

  it('horn fires on H / Space only while somebody is driving', () => {
    const inp = new DriveInput()
    inputs.push(inp.attach())
    let honks = 0
    inp.onHorn = () => honks++
    key('keydown', 'KeyH', 'h')
    expect(honks).toBe(0)
    inp.isActive = () => true
    key('keydown', 'KeyH', 'h')
    key('keyup', 'KeyH', 'h')
    key('keydown', 'Space', ' ')
    expect(honks).toBe(2)
  })
})
