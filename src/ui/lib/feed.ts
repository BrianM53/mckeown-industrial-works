import { create } from 'zustand'

/**
 * Transient HUD feed: toasts (short notifications, both modes) and captions
 * (sound/PA cues, game mode). Items auto-expire; identical text already on
 * screen is refreshed instead of stacked.
 */
export type ToastKind = 'info' | 'success' | 'warning'
export type CaptionKind = 'sound' | 'pa' | 'info' | 'warning'

/** A link rendered as a small button under the toast text (same-tab navigation). */
export interface ToastAction {
  label: string
  href: string
  primary?: boolean
}

export interface ToastItem {
  id: number
  text: string
  kind: ToastKind
  /** Optional small heading, e.g. "Achievement unlocked". */
  title?: string
  variant?: 'achievement'
  actions?: ToastAction[]
}

export interface CaptionItem {
  id: number
  text: string
  kind: CaptionKind
}

interface FeedState {
  toasts: ToastItem[]
  captions: CaptionItem[]
}

export const useFeed = create<FeedState>(() => ({ toasts: [], captions: [] }))

export const MAX_TOASTS = 4
export const MAX_CAPTIONS = 3

const timers = new Map<string, ReturnType<typeof setTimeout>>()
let seq = 0

/** Reading-time based default, in seconds. */
function readingTime(text: string, min: number, max: number): number {
  return Math.min(max, Math.max(min, 1.4 + text.length * 0.05))
}

/**
 * Event payload durations are seconds. Values > 60 are assumed to be
 * milliseconds (defensive: the contract does not state the unit).
 */
export function normalizeDuration(d: number | undefined, fallback: number): number {
  if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) return fallback
  const s = d > 60 ? d / 1000 : d
  return Math.min(20, Math.max(1, s))
}

function schedule(key: string, seconds: number, fn: () => void): void {
  const prev = timers.get(key)
  if (prev) clearTimeout(prev)
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      fn()
    }, seconds * 1000),
  )
}

function unschedule(key: string): void {
  const t = timers.get(key)
  if (t) clearTimeout(t)
  timers.delete(key)
}

export interface ToastInput {
  text: string
  kind?: ToastKind
  /** Seconds on screen (default: reading time). Ignored when `sticky`. */
  duration?: number
  title?: string
  variant?: 'achievement'
  actions?: ToastAction[]
  /** Stay until dismissed (offers with actions: a timed-out choice is no choice for slow readers). */
  sticky?: boolean
}

export function pushToast(input: ToastInput): number {
  const text = String(input.text ?? '').trim()
  if (!text) return -1
  const seconds = normalizeDuration(input.duration, readingTime(text, 3.2, 9))
  const current = useFeed.getState().toasts
  const existing = current.find((t) => t.text === text && t.title === input.title)
  if (existing) {
    if (!input.sticky) schedule(`t${existing.id}`, seconds, () => removeToast(existing.id))
    return existing.id
  }
  const id = ++seq
  const actions = input.actions?.filter((a) => a && a.label && a.href)
  const item: ToastItem = { id, text, kind: input.kind ?? 'info', title: input.title, variant: input.variant, actions: actions?.length ? actions : undefined }
  const next = [...current, item]
  for (const dropped of next.slice(0, Math.max(0, next.length - MAX_TOASTS))) unschedule(`t${dropped.id}`)
  useFeed.setState({ toasts: next.slice(-MAX_TOASTS) })
  if (!input.sticky) schedule(`t${id}`, seconds, () => removeToast(id))
  return id
}

export function removeToast(id: number): void {
  unschedule(`t${id}`)
  const toasts = useFeed.getState().toasts
  if (toasts.some((t) => t.id === id)) useFeed.setState({ toasts: toasts.filter((t) => t.id !== id) })
}

export function pushCaption(input: { text: string; kind?: CaptionKind; duration?: number }): number {
  const text = String(input.text ?? '').trim()
  if (!text) return -1
  const seconds = normalizeDuration(input.duration, readingTime(text, 2.6, 8))
  const current = useFeed.getState().captions
  const existing = current.find((c) => c.text === text)
  if (existing) {
    schedule(`c${existing.id}`, seconds, () => removeCaption(existing.id))
    return existing.id
  }
  const id = ++seq
  const item: CaptionItem = { id, text, kind: input.kind ?? 'sound' }
  const next = [...current, item]
  for (const dropped of next.slice(0, Math.max(0, next.length - MAX_CAPTIONS))) unschedule(`c${dropped.id}`)
  useFeed.setState({ captions: next.slice(-MAX_CAPTIONS) })
  schedule(`c${id}`, seconds, () => removeCaption(id))
  return id
}

export function removeCaption(id: number): void {
  unschedule(`c${id}`)
  const captions = useFeed.getState().captions
  if (captions.some((c) => c.id === id)) useFeed.setState({ captions: captions.filter((c) => c.id !== id) })
}

/** Remove everything (unmount / tests). */
export function clearFeed(): void {
  timers.forEach((t) => clearTimeout(t))
  timers.clear()
  useFeed.setState({ toasts: [], captions: [] })
}
