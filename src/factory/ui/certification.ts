/**
 * Session-scoped "line certified" flag for the Line Supervisor Console, so the
 * achievement + toast fire only the first time the visitor hits the target.
 */
let certified = false

/** Returns true exactly once per session (the first certification). */
export function markCertified(): boolean {
  if (certified) return false
  certified = true
  return true
}

export function wasCertified(): boolean {
  return certified
}

/** Tests only. */
export function resetCertification(): void {
  certified = false
}
