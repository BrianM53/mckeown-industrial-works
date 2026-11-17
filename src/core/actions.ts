/**
 * Input ACTIONS — discrete player intents that may originate from the keyboard,
 * the touch-control buttons, or on-screen HUD buttons. Exactly one module owns
 * the handling of each action:
 *
 *   interact, recover, recenter  -> player module (src/player)
 *   map, menu, help, quicklinks  -> ui module (src/ui)
 *   horn                         -> vehicles module (when driving)
 *
 * Keyboard bindings are implemented by the owning module; touch buttons call
 * `actions.trigger(name)`.
 */
export type ActionName =
  | 'interact'
  | 'recover'
  | 'recenter'
  | 'map'
  | 'menu'
  | 'help'
  | 'quicklinks'
  | 'horn'

type ActionHandler = () => void
const actionHandlers = new Map<ActionName, Set<ActionHandler>>()

export const actions = {
  on(name: ActionName, fn: ActionHandler): () => void {
    let set = actionHandlers.get(name)
    if (!set) {
      set = new Set()
      actionHandlers.set(name, set)
    }
    set.add(fn)
    return () => {
      set!.delete(fn)
    }
  },
  trigger(name: ActionName): void {
    const set = actionHandlers.get(name)
    if (!set) return
    for (const fn of [...set]) {
      try {
        fn()
      } catch (err) {
        console.error(`[actions] handler for "${name}" threw`, err)
      }
    }
  },
}

/**
 * True when keyboard focus is inside an editable control or a dialog, i.e. game
 * keys must be ignored. Modules handling global keydown MUST check this.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return false
}
