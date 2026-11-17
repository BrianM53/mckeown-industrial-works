import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runtime } from '@/core/runtime'
import { useUIStore } from '@/state/ui'
import { InputManager, type LookInput, type MoveInput } from './input'
import type { ActionControl } from './inputMap'

const key = (type: 'keydown' | 'keyup', code: string, k: string, extra: KeyboardEventInit = {}, target: EventTarget = window) =>
  target.dispatchEvent(new KeyboardEvent(type, { code, key: k, bubbles: true, cancelable: true, ...extra }))

describe('player input manager', () => {
  let canvas: HTMLCanvasElement
  let detach: () => void
  let fired: ActionControl[]
  let im: InputManager
  const move = (): MoveInput => im.move({ x: 0, y: 0, run: false })
  const look = (): LookInput => im.consumeLook({ dx: 0, dy: 0, zoom: 0, keyYaw: 0, keyPitch: 0, keyZoom: 0 })

  beforeEach(() => {
    canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    fired = []
    im = new InputManager((a) => fired.push(a))
    detach = im.attach(canvas)
    useUIStore.setState({ panel: null, dialogue: null })
    runtime.input.touchMove.x = 0
    runtime.input.touchMove.y = 0
    runtime.input.touchRun = false
  })
  afterEach(() => {
    detach()
    canvas.remove()
    useUIStore.setState({ panel: null, dialogue: null })
  })

  it('WASD / arrows produce camera-space axes; Shift runs', () => {
    key('keydown', 'KeyW', 'w')
    expect(move()).toEqual({ x: 0, y: 1, run: false })
    key('keydown', 'ShiftLeft', 'Shift')
    key('keydown', 'KeyD', 'd')
    const m = move()
    expect(m.run).toBe(true)
    expect(Math.hypot(m.x, m.y)).toBeCloseTo(1, 9) // diagonal normalized
    key('keyup', 'KeyW', 'W')
    key('keyup', 'KeyD', 'D')
    key('keyup', 'ShiftLeft', 'Shift')
    expect(move()).toEqual({ x: 0, y: 0, run: false })
    key('keydown', 'ArrowLeft', 'ArrowLeft')
    expect(move().x).toBe(-1)
  })

  it('arrow keys do not scroll the page; game keys never fire with modifiers', () => {
    const ev = new KeyboardEvent('keydown', { code: 'ArrowDown', key: 'ArrowDown', bubbles: true, cancelable: true })
    window.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    key('keydown', 'KeyR', 'r', { ctrlKey: true })
    expect(fired).toEqual([])
  })

  it('E / R / C fire actions once (no auto-repeat)', () => {
    key('keydown', 'KeyE', 'e')
    key('keydown', 'KeyE', 'e', { repeat: true })
    key('keydown', 'KeyR', 'r')
    key('keydown', 'KeyC', 'c')
    expect(fired).toEqual(['interact', 'recover', 'recenter'])
  })

  it('ignores keys typed into form fields', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    key('keydown', 'KeyW', 'w', {}, input)
    key('keydown', 'KeyE', 'e', {}, input)
    expect(move().y).toBe(0)
    expect(fired).toEqual([])
    input.remove()
  })

  it('movement is zero while a panel or dialogue is open, and keys pressed then are ignored', () => {
    key('keydown', 'KeyW', 'w')
    useUIStore.setState({ panel: { id: 'help' } })
    expect(move().y).toBe(0)
    key('keydown', 'KeyE', 'e')
    expect(fired).toEqual([])
    useUIStore.setState({ panel: null, dialogue: { npcId: 'n', name: 'N', role: 'r', lines: ['hi'], index: 0 } })
    expect(move().y).toBe(0)
  })

  it('clears held keys on window blur (no stuck walking)', () => {
    key('keydown', 'KeyW', 'w')
    window.dispatchEvent(new Event('blur'))
    expect(move().y).toBe(0)
  })

  it('a key released after Shift changed its printed character still releases', () => {
    key('keydown', 'Comma', ',')
    key('keydown', 'ShiftLeft', 'Shift')
    key('keyup', 'Comma', '<')
    expect(look().keyYaw).toBe(0)
  })

  it('keyboard orbit / zoom keys feed the look axes', () => {
    key('keydown', 'KeyJ', 'j')
    key('keydown', 'KeyK', 'k')
    key('keydown', 'Minus', '-')
    const l = look()
    expect([l.keyYaw, l.keyPitch, l.keyZoom]).toEqual([1, 1, 1])
  })

  it('touch: joystick moves (analog), drag/pinch accumulators are consumed and zeroed', () => {
    runtime.input.touchMove.x = 0.3
    runtime.input.touchMove.y = 0.4
    runtime.input.touchRun = true
    const m = move()
    expect(m.x).toBeCloseTo(0.3, 9)
    expect(m.y).toBeCloseTo(0.4, 9)
    expect(m.run).toBe(true)
    runtime.input.touchLook.dx = 100
    runtime.input.touchLook.dy = -20
    runtime.input.touchZoom = 50
    const l = look()
    expect(l.dx).toBeGreaterThan(100) // touch is a bit more sensitive
    expect(l.dy).toBeLessThan(0)
    expect(l.zoom).toBeGreaterThan(0)
    expect(runtime.input.touchLook).toEqual({ dx: 0, dy: 0 })
    expect(runtime.input.touchZoom).toBe(0)
    runtime.input.touchMove.x = 0
    runtime.input.touchMove.y = 0
    runtime.input.touchRun = false
  })

  it('wheel on the canvas zooms and is prevented; context menu suppressed on the canvas only', () => {
    const w = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
    canvas.dispatchEvent(w)
    expect(w.defaultPrevented).toBe(true)
    expect(look().zoom).toBeGreaterThan(0)
    const cm = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    canvas.dispatchEvent(cm)
    expect(cm.defaultPrevented).toBe(true)
    const other = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    document.body.dispatchEvent(other)
    expect(other.defaultPrevented).toBe(false)
  })

  it('test override input wins temporarily', () => {
    im.setTestInput({ y: 1, run: true, ms: 10_000 })
    expect(move()).toEqual({ x: 0, y: 1, run: true })
    im.setTestInput(null)
    expect(move()).toEqual({ x: 0, y: 0, run: false })
  })

  it('detach removes every listener', () => {
    detach()
    key('keydown', 'KeyW', 'w')
    expect(move().y).toBe(0)
    detach = () => {}
  })
})
