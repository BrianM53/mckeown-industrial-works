import { useEffect, useRef } from 'react'
import type { LaunchOutcome, LineId, RespawnReason, SfxName, Vec3 } from './types'

/**
 * Global typed event bus — NOTIFICATIONS ("this happened"). Modules subscribe
 * to react (audio plays sounds, UI shows captions/toasts, NPCs react, camera
 * shakes). For COMMANDS ("do this") use `services` or `actions` instead.
 *
 * Contract: payloads are plain data. Handlers must be cheap and must not throw
 * (exceptions are caught and logged so one bad subscriber cannot break others).
 */
export interface GameEvents {
  // ---- UI ----
  'panel:open': { id: string }
  'panel:close': { id: string }

  // ---- Player ----
  'player:interact': { id: string }
  'player:respawned': { reason: RespawnReason; checkpointId: string }
  'player:footstep': { position: Vec3; run: boolean; surface: 'concrete' | 'metal' | 'dirt' }
  'player:stuck': {}

  // ---- Forklift ----
  'forklift:enter': {}
  'forklift:exit': {}
  'forklift:horn': { position: Vec3 }
  'forklift:impact': { position: Vec3; strength: number }
  'forklift:overturned': { position: Vec3 }
  'forklift:recovered': { position: Vec3 }

  // ---- Factory / rocket ----
  'factory:part': { line: LineId; total: number }
  'factory:params': {}
  'rocket:stage': { rocketId: number; stage: number; stageName: string }
  'rocket:complete': { rocketId: number }
  'rocket:rollout': { rocketId: number }
  'rocket:countdown': { rocketId: number; secondsLeft: number }
  'rocket:ignition': { rocketId: number }
  'rocket:liftoff': { rocketId: number }
  'rocket:outcome': { rocketId: number; outcome: LaunchOutcome; stowaway: boolean }
  'rocket:reset': { rocketId: number }

  // ---- Safety / ambient events ----
  'osha:warning': { zoneId: string }
  'osha:whistle': { position: Vec3; zoneId: string }
  'osha:tackle': { zoneId: string }
  'nightshift:start': {}
  'nightshift:end': {}
  'gag:start': { id: string; position: Vec3 }
  'gag:end': { id: string }
  'pa:announce': { text: string }

  // ---- Generic feedback channels (anyone may emit) ----
  /** One-shot sound. Positional if `position` given. */
  sfx: { name: SfxName; position?: Vec3; volume?: number; rate?: number }
  /** Camera shake request. Ignored when reduced motion is on. intensity ~0..1. */
  shake: { intensity: number; duration: number }
  /** Caption for an important sound-only cue (whistle, alarm, countdown, PA). */
  caption: { text: string; duration?: number; kind?: 'sound' | 'pa' | 'info' | 'warning' }
  /** Short non-blocking toast. */
  toast: { text: string; kind?: 'info' | 'success' | 'warning'; duration?: number }
  /** Unlock an achievement by id (see content/achievements.ts). */
  achievement: { id: string }
  /** Player entered/left a building interior (null = outdoors). */
  'world:interior': { zoneId: string | null }
}

export type GameEventName = keyof GameEvents
type Handler<K extends GameEventName> = (payload: GameEvents[K]) => void

const handlers = new Map<GameEventName, Set<Handler<GameEventName>>>()

export const events = {
  on<K extends GameEventName>(name: K, handler: Handler<K>): () => void {
    let set = handlers.get(name)
    if (!set) {
      set = new Set()
      handlers.set(name, set)
    }
    set.add(handler as Handler<GameEventName>)
    return () => {
      set!.delete(handler as Handler<GameEventName>)
    }
  },
  emit<K extends GameEventName>(name: K, payload: GameEvents[K]): void {
    const set = handlers.get(name)
    if (!set) return
    for (const h of [...set]) {
      try {
        ;(h as Handler<K>)(payload)
      } catch (err) {
        console.error(`[events] handler for "${name}" threw`, err)
      }
    }
  },
  /** Number of subscribers (used by leak tests). */
  count(name?: GameEventName): number {
    if (name) return handlers.get(name)?.size ?? 0
    let n = 0
    handlers.forEach((s) => (n += s.size))
    return n
  },
  /** Test helper: remove every subscriber. */
  _reset(): void {
    handlers.clear()
  },
}

/** React hook: subscribe for the lifetime of the component. Handler may change freely. */
export function useGameEvent<K extends GameEventName>(name: K, handler: Handler<K>): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => events.on(name, (p) => ref.current(p)), [name])
}
