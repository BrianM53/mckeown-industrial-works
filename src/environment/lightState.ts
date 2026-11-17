import { runtime } from '@/core/runtime'

/**
 * Sanitized lighting state shared by environment parts within a frame.
 * Written once per frame by <Lighting> (from runtime.lighting, owned by the
 * safety module); read by sky, beacons, particles.
 */
export const envLight = {
  /** 1 = normal, 0 = blackout (clamped, NaN-safe). */
  level: 1,
  /** 0..1 emergency beacon strength. */
  emergency: 0,
  /** Seconds, monotonic (for beacon rotation / pulses). */
  time: 0,
}

export function sampleLighting(dt: number): void {
  const l = runtime.lighting.level
  const e = runtime.lighting.emergency
  envLight.level = Number.isFinite(l) ? Math.min(1, Math.max(0, l)) : 1
  envLight.emergency = Number.isFinite(e) ? Math.min(1, Math.max(0, e)) : 0
  envLight.time += Math.min(Math.max(dt, 0), 0.1)
}
