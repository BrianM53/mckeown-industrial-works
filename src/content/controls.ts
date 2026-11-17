/**
 * Canonical control bindings. The player module implements these; the ui help
 * panel and onboarding hint display them. Change bindings here AND in the
 * implementing module together.
 */
export interface ControlBinding {
  action: string
  keys: string[]
  touch?: string
  owner: 'player' | 'ui' | 'vehicles'
}

export const CONTROLS: ControlBinding[] = [
  { action: 'Walk', keys: ['W A S D', 'Arrow keys'], touch: 'Left joystick', owner: 'player' },
  { action: 'Run', keys: ['Shift (hold)'], touch: 'Run button', owner: 'player' },
  { action: 'Look around (orbit camera)', keys: ['Drag with mouse', ', and . (or J / L)'], touch: 'Drag on the right side', owner: 'player' },
  { action: 'Tilt camera', keys: ['Drag up/down', 'I / K'], touch: 'Drag up/down', owner: 'player' },
  { action: 'Zoom camera', keys: ['Mouse wheel', '- and ='], touch: 'Pinch', owner: 'player' },
  { action: 'Recenter camera', keys: ['C'], touch: 'Recenter button', owner: 'player' },
  { action: 'Interact / talk / drive', keys: ['E'], touch: 'Interact button', owner: 'player' },
  { action: 'Recover / unstick', keys: ['R'], touch: 'Recover button', owner: 'player' },
  { action: 'Site directory & map', keys: ['M'], touch: 'Map button', owner: 'ui' },
  { action: 'Portfolio quick links', keys: ['P'], touch: 'Menu button', owner: 'ui' },
  { action: 'Help / controls', keys: ['?'], owner: 'ui' },
  { action: 'Close panel / menu', keys: ['Esc'], owner: 'ui' },
  { action: 'Forklift horn', keys: ['H', 'Space'], touch: 'Horn button (while driving)', owner: 'vehicles' },
]

/** Short hint shown briefly at spawn. */
export const SPAWN_HINT = {
  desktop: ['W A S D to walk · Shift to run', 'Drag to look around · Wheel to zoom', 'E to interact · M for the directory'],
  touch: ['Left stick to walk', 'Drag right side to look', 'Tap Interact near glowing things'],
}
