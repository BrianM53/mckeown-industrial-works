/**
 * Virtual joystick math (pure, unit-tested).
 *
 * dx / dy: pointer offset from the stick centre in CSS px, screen space (+y down).
 * Returns x = right, y = forward (screen up), each in -1..1 with a radial dead
 * zone (re-mapped so output starts at 0 just outside it) and the knob offset
 * clamped to the stick radius.
 */
export interface StickVector {
  x: number
  y: number
  magnitude: number
  knobX: number
  knobY: number
}

export const ZERO_STICK: StickVector = { x: 0, y: 0, magnitude: 0, knobX: 0, knobY: 0 }

export function stickVector(dx: number, dy: number, radius: number, deadZone = 0.12): StickVector {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !(radius > 0)) return ZERO_STICK
  const dist = Math.hypot(dx, dy)
  if (dist < 1e-6) return ZERO_STICK
  const ux = dx / dist
  const uy = dy / dist
  const clamped = Math.min(dist, radius)
  const raw = clamped / radius
  const magnitude = raw <= deadZone ? 0 : Math.min(1, (raw - deadZone) / (1 - deadZone))
  return { x: ux * magnitude, y: -uy * magnitude, magnitude, knobX: ux * clamped, knobY: uy * clamped }
}

/** Keep a floating stick (radius r) fully inside [minX..maxX] × [minY..maxY]. */
export function clampStickCenter(x: number, y: number, r: number, bounds: { minX: number; maxX: number; minY: number; maxY: number }): { x: number; y: number } {
  const cx = Math.min(Math.max(x, bounds.minX + r), Math.max(bounds.minX + r, bounds.maxX - r))
  const cy = Math.min(Math.max(y, bounds.minY + r), Math.max(bounds.minY + r, bounds.maxY - r))
  return { x: cx, y: cy }
}
