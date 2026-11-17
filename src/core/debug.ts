/**
 * Dev/test-only debug hooks exposed as `window.__MIW__`.
 * Enabled in `vite dev` and in the test build (`npm run build:test`,
 * VITE_TEST_HOOKS=true). Stripped from the production build: in production
 * `registerDebug` is a no-op and `window.__MIW__` is never defined.
 *
 * Each module registers its own namespace, e.g.
 *   registerDebug('factory', { getState, advance, forceOutcome })
 * Playwright tests and scripts/shot.mjs drive the game through these.
 */
export const DEBUG_ENABLED: boolean = import.meta.env.DEV || import.meta.env.VITE_TEST_HOOKS === 'true'

type DebugNamespace = Record<string, unknown>

interface DebugRoot {
  ready: boolean
  errors: string[]
  modules: Record<string, 'loading' | 'ready' | 'error'>
  [ns: string]: unknown
}

function root(): DebugRoot | null {
  if (!DEBUG_ENABLED || typeof window === 'undefined') return null
  const w = window as unknown as { __MIW__?: DebugRoot }
  if (!w.__MIW__) w.__MIW__ = { ready: false, errors: [], modules: {} }
  return w.__MIW__
}

export function registerDebug(ns: string, api: DebugNamespace): () => void {
  const r = root()
  if (!r) return () => {}
  const existing = (r[ns] as DebugNamespace | undefined) ?? {}
  const merged = { ...existing, ...api }
  r[ns] = merged
  return () => {
    const cur = r[ns] as DebugNamespace | undefined
    if (!cur) return
    for (const k of Object.keys(api)) if (cur[k] === api[k]) delete cur[k]
  }
}

export function setDebugFlag(key: 'ready', value: boolean): void {
  const r = root()
  if (r) r[key] = value
}

export function setModuleStatus(name: string, status: 'loading' | 'ready' | 'error'): void {
  const r = root()
  if (!r) return
  // 'loading' never overwrites a final status (child effects can run before the slot's own effect).
  if (status === 'loading' && r.modules[name] !== undefined) return
  r.modules[name] = status
}

export function recordDebugError(message: string): void {
  const r = root()
  if (r) {
    r.errors.push(message)
    if (r.errors.length > 200) r.errors.shift()
  }
}
