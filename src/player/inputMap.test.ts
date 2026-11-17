import { describe, expect, it } from 'vitest'
import { combineMove, controlForKey, isActionControl, moveAxes, orbitAxes, preventsDefault, type Control } from './inputMap'

describe('key → control mapping', () => {
  it('maps WASD and arrows by physical code', () => {
    expect(controlForKey('KeyW', 'w')).toBe('forward')
    expect(controlForKey('KeyW', 'W')).toBe('forward') // shift held
    expect(controlForKey('KeyW', 'z')).toBe('forward') // AZERTY physical position
    expect(controlForKey('ArrowUp', 'ArrowUp')).toBe('forward')
    expect(controlForKey('KeyS', 's')).toBe('back')
    expect(controlForKey('ArrowDown', 'ArrowDown')).toBe('back')
    expect(controlForKey('KeyA', 'a')).toBe('left')
    expect(controlForKey('ArrowLeft', 'ArrowLeft')).toBe('left')
    expect(controlForKey('KeyD', 'd')).toBe('right')
    expect(controlForKey('ArrowRight', 'ArrowRight')).toBe('right')
  })
  it('maps run, actions and orbit/zoom keys', () => {
    expect(controlForKey('ShiftLeft', 'Shift')).toBe('run')
    expect(controlForKey('ShiftRight', 'Shift')).toBe('run')
    expect(controlForKey('KeyE', 'e')).toBe('interact')
    expect(controlForKey('KeyR', 'r')).toBe('recover')
    expect(controlForKey('KeyC', 'c')).toBe('recenter')
    expect(controlForKey('Comma', ',')).toBe('yawLeft')
    expect(controlForKey('Period', '.')).toBe('yawRight')
    expect(controlForKey('KeyJ', 'j')).toBe('yawLeft')
    expect(controlForKey('KeyL', 'l')).toBe('yawRight')
    expect(controlForKey('KeyI', 'i')).toBe('pitchUp')
    expect(controlForKey('KeyK', 'k')).toBe('pitchDown')
    expect(controlForKey('Minus', '-')).toBe('zoomOut')
    expect(controlForKey('Equal', '=')).toBe('zoomIn')
    expect(controlForKey('Equal', '+')).toBe('zoomIn')
    expect(controlForKey('NumpadAdd', '+')).toBe('zoomIn')
    expect(controlForKey('NumpadSubtract', '-')).toBe('zoomOut')
  })
  it('maps punctuation by printed character on other layouts', () => {
    expect(controlForKey('KeyM', ',')).toBe('yawLeft') // AZERTY comma
    expect(controlForKey('Digit6', '-')).toBe('zoomOut') // AZERTY minus
  })
  it('ignores keys owned by other modules', () => {
    expect(controlForKey('KeyM', 'm')).toBeNull() // directory (ui)
    expect(controlForKey('KeyH', 'h')).toBeNull() // horn (vehicles)
    expect(controlForKey('Space', ' ')).toBeNull()
    expect(controlForKey('Escape', 'Escape')).toBeNull()
    expect(controlForKey('Slash', '?')).toBeNull()
    expect(controlForKey('KeyP', 'p')).toBeNull()
  })
  it('falls back to key when code is unavailable', () => {
    expect(controlForKey('', 'w')).toBe('forward')
    expect(controlForKey('', 'E')).toBe('interact')
  })
  it('classifies one-shot actions and default-prevented keys', () => {
    expect(isActionControl('interact')).toBe(true)
    expect(isActionControl('recover')).toBe(true)
    expect(isActionControl('recenter')).toBe(true)
    expect(isActionControl('forward')).toBe(false)
    expect(preventsDefault('ArrowUp')).toBe(true)
    expect(preventsDefault('KeyW')).toBe(false)
  })
})

describe('movement axes', () => {
  const set = (...c: Control[]) => new Set<Control>(c)
  it('builds digital axes and cancels opposites', () => {
    expect(moveAxes(set('forward'))).toEqual({ x: 0, y: 1 })
    expect(moveAxes(set('back', 'left'))).toEqual({ x: -1, y: -1 })
    expect(moveAxes(set('forward', 'back'))).toEqual({ x: 0, y: 0 })
    expect(moveAxes(set('left', 'right', 'forward'))).toEqual({ x: 0, y: 1 })
  })
  it('orbit axes: yawLeft turns left (+), pitchDown tilts down (+), zoomOut (+)', () => {
    expect(orbitAxes(set('yawLeft'))).toEqual({ yaw: 1, pitch: 0, zoom: 0 })
    expect(orbitAxes(set('yawRight', 'pitchUp', 'zoomIn'))).toEqual({ yaw: -1, pitch: -1, zoom: -1 })
  })
  it('combines keyboard and stick, larger magnitude wins, clamped to the unit circle', () => {
    expect(combineMove({ x: 0, y: 1 }, { x: 0.3, y: 0 })).toEqual({ x: 0, y: 1 })
    expect(combineMove({ x: 0, y: 0 }, { x: 0.3, y: 0.4 })).toEqual({ x: 0.3, y: 0.4 })
    const d = combineMove({ x: 1, y: 1 }, { x: 0, y: 0 })
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 9)
    expect(combineMove({ x: 0, y: 0 }, { x: Number.NaN, y: 2 })).toEqual({ x: 0, y: 1 })
  })
})
