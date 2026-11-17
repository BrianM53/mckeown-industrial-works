import type { ZoneId } from '@/world/layout'
import type { Batch } from '../lib/batch'
import type { SignAtlas } from './signAtlas'
import type { QualityConfig } from '../config'
import type { KitInstance, KitName } from './kits'

/** Rotating parts rendered as instanced meshes (fans, whirlybirds, radar). */
export interface Spinner {
  kind: 'fan' | 'turbine' | 'radar'
  x: number
  y: number
  z: number
  /** Facing yaw of the rotor axis for wall fans; ignored for vertical rotors. */
  yaw: number
  /** true: rotor spins around the vertical axis (rooftop / condenser fans). */
  vertical: boolean
  radius: number
  /** rad/s */
  speed: number
  /** Building whose roof carries it (hidden with the roof during cutaway). */
  building?: ZoneId
}

export type SteamKind = 'vent' | 'stack' | 'valve' | 'cooling' | 'smoke' | 'exhaust'

export interface SteamEmitter {
  kind: SteamKind
  x: number
  y: number
  z: number
  building?: ZoneId
}

/** Shared build context for the static world. */
export interface BuildCtx {
  b: Batch
  atlas: SignAtlas
  q: QualityConfig
  spinners: Spinner[]
  steam: SteamEmitter[]
  /** Per-building roof batches (cutaway). */
  roofs: Map<ZoneId, Batch>
  /** Instanced decor kits. */
  kits: Map<KitName, KitInstance[]>
}
