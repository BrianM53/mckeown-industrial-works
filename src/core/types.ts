/**
 * Shared primitive types used across modules. Keep this file dependency-free
 * (no React, no three) so pure-logic modules and tests can import it cheaply.
 */

/** World-space position [x, y, z] in meters. Y is up. North is -Z, east is +X. */
export type Vec3 = [number, number, number]

/** Ground-plane position [x, z] in meters. */
export type Vec2 = [number, number]

/** Axis-aligned rectangle on the ground plane. */
export interface Rect {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** The five production lines that feed the rocket tower. */
export type LineId = 'smelt' | 'pipe' | 'circuit' | 'tank' | 'payload'

/** Seeded launch results. */
export type LaunchOutcome = 'success' | 'wobble' | 'breakup' | 'explosion'

/** Why the player was moved to a checkpoint. */
export type RespawnReason = 'tackle' | 'stuck' | 'manual' | 'bounds' | 'travel' | 'debug'

/** What the visitor is currently controlling. */
export type PlayerMode = 'foot' | 'forklift' | 'tackled' | 'travel'

/** Render quality tiers (resolved — never 'auto'). */
export type QualityTier = 'low' | 'medium' | 'high'

/**
 * One-shot sound effect names. The audio module implements all of these with
 * procedural WebAudio synthesis. Unknown names are ignored (no-op), so modules
 * may request a sound before it exists.
 */
export type SfxName =
  | 'ui-click'
  | 'ui-open'
  | 'ui-close'
  | 'footstep'
  | 'footstep-metal'
  | 'interact'
  | 'printer-whir'
  | 'print-stamp'
  | 'tube-whoosh'
  | 'press-thump'
  | 'steam-hiss'
  | 'weld-zap'
  | 'machine-clank'
  | 'machine-kick'
  | 'scanner-beep'
  | 'radio-jingle'
  | 'radio-static'
  | 'forklift-horn'
  | 'forklift-beep'
  | 'forklift-impact'
  | 'forklift-start'
  | 'crate-bump'
  | 'ball-kick'
  | 'ball-bounce'
  | 'goal-horn'
  | 'whistle'
  | 'tackle-thud'
  | 'boing'
  | 'countdown-beep'
  | 'ignition'
  | 'liftoff-roar'
  | 'explosion'
  | 'breakup-clank'
  | 'alarm'
  | 'power-down'
  | 'power-up'
  | 'pa-chime'
  | 'cheer'
  | 'achievement'
  | 'big-button'

/** Looping (continuous) sound names for positional emitters. */
export type LoopName =
  | 'ambience-factory'
  | 'music'
  | 'forklift-engine'
  | 'furnace-roar'
  | 'fan-hum'
  | 'server-hum'
  | 'belt-clatter'
  | 'transformer-hum'
  | 'launch-rumble'
  | 'radio-music'
  | 'steam-vent'
