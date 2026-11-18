/**
 * Recreation Yard score (session-only, in-world fun — not portfolio facts).
 * Tiny observable so the scoreboard redraws only when a number changes.
 */
type Listener = () => void

const listeners = new Set<Listener>()

export const recScore = {
  goals: 0,
  points: 0,
  addGoal(): number {
    this.goals++
    emit()
    return this.goals
  },
  addPoint(): number {
    this.points++
    emit()
    return this.points
  },
  reset(): void {
    this.goals = 0
    this.points = 0
    emit()
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
  get listenerCount(): number {
    return listeners.size
  },
}

function emit(): void {
  for (const fn of [...listeners]) {
    try {
      fn()
    } catch (err) {
      console.error('[stations-b] score listener threw', err)
    }
  }
}

/** Scoreboard text (pure; unit-tested). */
export function scoreLine(goals: number, points: number): string {
  const g = Math.max(0, Math.floor(goals))
  const p = Math.max(0, Math.floor(points))
  return `GOALS ${g} · POINTS ${p}`
}

/** Two-digit display value (99 max, like a real cheap scoreboard). */
export function digits(n: number): string {
  const v = Math.max(0, Math.min(99, Math.floor(n)))
  return v < 10 ? ` ${v}` : String(v)
}
