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

/**
 * Dev/test-only visual override (set through `__MIW__.environment.setLighting`).
 * Only the environment's rendering reads it — runtime.lighting stays owned by
 * the safety module (single writer), so the real Night Shift is unaffected.
 */
let debugOverride: { level: number; emergency: number } | null = null

export function setLightingOverride(o: { level: number; emergency: number } | null): void {
  debugOverride = o
}

export function getLightingOverride(): { level: number; emergency: number } | null {
  return debugOverride
}

const clamp01 = (v: number, fallback: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback)

export function sampleLighting(dt: number): void {
  const src = debugOverride ?? runtime.lighting
  envLight.level = clamp01(src.level, 1)
  envLight.emergency = clamp01(src.emergency, 0)
  envLight.time += Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), 0.1)
}
