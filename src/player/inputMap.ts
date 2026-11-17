/**
 * Pure keyboard → control mapping (unit-tested). Letters and arrows map by
 * physical key (`KeyboardEvent.code`, so WASD works on AZERTY too); punctuation
 * maps by the printed character (`KeyboardEvent.key`) so ',' '.' '-' '=' work on
 * any layout. Bindings mirror src/content/controls.ts.
 */
export type Control =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'run'
  | 'interact'
  | 'recover'
  | 'recenter'
  | 'yawLeft'
  | 'yawRight'
  | 'pitchUp'
  | 'pitchDown'
  | 'zoomIn'
  | 'zoomOut'

/** One-shot controls (fire on keydown, never "held"). */
export type ActionControl = 'interact' | 'recover' | 'recenter'

const BY_CODE: Record<string, Control> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'run',
  ShiftRight: 'run',
  KeyE: 'interact',
  KeyR: 'recover',
  KeyC: 'recenter',
  KeyJ: 'yawLeft',
  KeyL: 'yawRight',
  KeyI: 'pitchUp',
  KeyK: 'pitchDown',
  NumpadAdd: 'zoomIn',
  NumpadSubtract: 'zoomOut',
}

const BY_KEY: Record<string, Control> = {
  ',': 'yawLeft',
  '<': 'yawLeft',
  '.': 'yawRight',
  '>': 'yawRight',
  '-': 'zoomOut',
  _: 'zoomOut',
  '=': 'zoomIn',
  '+': 'zoomIn',
  // Letter fallbacks for environments that don't report `code` (old/embedded browsers).
  w: 'forward',
  s: 'back',
  a: 'left',
  d: 'right',
  e: 'interact',
  r: 'recover',
  c: 'recenter',
  j: 'yawLeft',
  l: 'yawRight',
  i: 'pitchUp',
  k: 'pitchDown',
}

const ACTIONS: ReadonlySet<Control> = new Set<Control>(['interact', 'recover', 'recenter'])

/** Map a key event's (code, key) to a control, or null when the key isn't ours. */
export function controlForKey(code: string, key: string): Control | null {
  const k = key.length === 1 ? key.toLowerCase() : key
  // Punctuation first (layout-dependent printed character).
  if (k.length === 1 && BY_KEY[k] && !/[a-z]/.test(k)) return BY_KEY[k]
  if (code && BY_CODE[code]) return BY_CODE[code]
  if (!code && BY_KEY[k]) return BY_KEY[k]
  if (code === 'Minus') return 'zoomOut'
  if (code === 'Equal') return 'zoomIn'
  if (code === 'Comma') return 'yawLeft'
  if (code === 'Period') return 'yawRight'
  return null
}

export function isActionControl(c: Control): c is ActionControl {
  return ACTIONS.has(c)
}

/** Keys whose browser default (page scroll) must be suppressed while playing. */
export function preventsDefault(code: string): boolean {
  return code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight'
}

export interface MoveAxes {
  /** Strafe: +1 right, -1 left. */
  x: number
  /** Forward: +1 forward, -1 back. */
  y: number
}

/** Digital movement axes from held controls (opposites cancel). */
export function moveAxes(held: ReadonlySet<Control>): MoveAxes {
  return {
    x: (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0),
    y: (held.has('forward') ? 1 : 0) - (held.has('back') ? 1 : 0),
  }
}

/** Keyboard orbit axes: yaw +1 = turn view left, pitch +1 = tilt view down, zoom +1 = zoom out. */
export function orbitAxes(held: ReadonlySet<Control>): { yaw: number; pitch: number; zoom: number } {
  return {
    yaw: (held.has('yawLeft') ? 1 : 0) - (held.has('yawRight') ? 1 : 0),
    pitch: (held.has('pitchDown') ? 1 : 0) - (held.has('pitchUp') ? 1 : 0),
    zoom: (held.has('zoomOut') ? 1 : 0) - (held.has('zoomIn') ? 1 : 0),
  }
}

/**
 * Combine keyboard axes with an analog stick (touch joystick). The larger
 * magnitude wins so a half-pushed stick never overrides a held key; the result
 * is clamped to the unit circle.
 */
export function combineMove(kb: MoveAxes, stick: MoveAxes): MoveAxes {
  const sx = Number.isFinite(stick.x) ? stick.x : 0
  const sy = Number.isFinite(stick.y) ? stick.y : 0
  const kl = Math.hypot(kb.x, kb.y)
  const sl = Math.hypot(sx, sy)
  let x = kl >= sl ? kb.x : sx
  let y = kl >= sl ? kb.y : sy
  const l = Math.hypot(x, y)
  if (l > 1) {
    x /= l
    y /= l
  }
  return { x, y }
}
