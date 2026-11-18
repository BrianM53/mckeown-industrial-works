/**
 * Broadcast Booth "ON AIR" logic (pure; unit-tested).
 *
 * The light is ON while the Code Story panel is open, while the station
 * jingle plays, and during periodic "live segment" bursts driven by sim time
 * (deterministic: the same sim time always gives the same answer). The light
 * fades rather than snapping (and fades slower with reduced motion).
 */
export const BURST = {
  /** Seconds between the starts of two live segments. */
  period: 46,
  /** Length of a live segment. */
  length: 13,
  /** Offset so the first segment starts a little after load. */
  offset: 9,
}

/** Is a periodic live segment running at sim time t? */
export function inBurst(t: number): boolean {
  if (!Number.isFinite(t) || t < 0) return false
  const k = (t + BURST.period - BURST.offset) % BURST.period
  return k < BURST.length
}

export interface OnAirInput {
  /** Sim time (s). */
  t: number
  /** The codestory panel is open. */
  panelOpen: boolean
  /** Jingle playing until this sim time (or -Infinity). */
  jingleUntil: number
}

export function onAirTarget(i: OnAirInput): boolean {
  return i.panelOpen || i.t < i.jingleUntil || inBurst(i.t)
}

/** Smoothly approach the target brightness (0..1). */
export function stepLight(cur: number, on: boolean, dt: number, reduced: boolean): number {
  const target = on ? 1 : 0
  if (!Number.isFinite(cur)) return target
  if (!Number.isFinite(dt) || dt <= 0) return cur
  const rate = reduced ? 2.5 : 9
  const k = 1 - Math.exp(-rate * Math.min(dt, 0.25))
  const next = cur + (target - cur) * k
  return Math.abs(next - target) < 0.002 ? target : next
}

/**
 * Equalizer bar level 0..1 for bar `i` at time `t` (pseudo-music: a beat, a
 * bass hump and per-bar wobble). `energy` scales it: ~0.35 idle music,
 * 1 when on air / jingle.
 */
export function eqLevel(i: number, n: number, t: number, energy: number): number {
  const x = i / Math.max(1, n - 1)
  const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 2.05)), 6)
  const bass = Math.exp(-x * 3.2) * (0.55 + 0.45 * beat)
  const mids = 0.35 + 0.3 * Math.sin(t * 5.3 + i * 1.7) * Math.sin(t * 1.9 + i * 0.6)
  const hiss = 0.25 * Math.abs(Math.sin(t * 13.7 + i * 2.9))
  const v = (bass * 0.9 + mids * (1 - x * 0.4) + hiss * x) * energy
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Tuning-dial needle position 0..1 across the band (88–108 MHz). 101.3 FM = the station. */
export const STATION_MHZ = 101.3
export function dialFraction(mhz: number): number {
  return Math.max(0, Math.min(1, (mhz - 88) / (108 - 88)))
}

/** Idle dial: drifts between stations; when tuned it settles on the station. */
export function dialMhz(t: number, tuned: number): number {
  const drift = 98 + 8 * Math.sin(t * 0.21) + 2.5 * Math.sin(t * 0.67)
  const k = Math.max(0, Math.min(1, tuned))
  return drift + (STATION_MHZ - drift) * k
}
