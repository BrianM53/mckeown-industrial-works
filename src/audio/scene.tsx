import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Quaternion, Vector3 } from 'three'
import { registerDebug } from '@/core/debug'
import { damp } from '@/core/math'
import { runtime } from '@/core/runtime'
import type { LineId, SfxName, Vec3 } from '@/core/types'
import { useGameStore } from '@/state/game'
import { useUIStore, type PanelState } from '@/state/ui'
import { factory } from '@/systems/factory'
import { audio, liveLoopCount, type LoopHandle, type PlayOptions } from './api'
import {
  estimateRocketAltitude,
  PAD_POSITION,
  PIPE_MACHINE_POSITION,
  PRESS_POSITION,
  SeededTimer,
  STEAM_SPOTS,
  WELD_SPOTS,
  WORLD_EMITTERS,
  type WorldEmitterDef,
} from './emitters'
import { engine } from './engine'
import { clamp01, phaseCrossed } from './logic'
import { wireAudioEvents } from './wiring'

/**
 * AUDIO MODULE ROOT (rendered inside <Canvas><Physics> by world/Scene.tsx).
 * - acquires the engine (refcounted; StrictMode / HMR safe)
 * - listener follows the real three.js camera every frame
 * - positional machinery emitters from world/layout.ts, driven by the factory sim
 * - maps game events → sounds (captions are emitted by the event owners)
 * - registers the `audio` debug namespace
 */

const _pos = new Vector3()
const _quat = new Quaternion()
const _fwd = new Vector3()
const _up = new Vector3()

interface WorldHandle {
  def: WorldEmitterDef
  handle: LoopHandle
  volume: number
  rate: number
}

/** Rocket flight: a positional rumble that climbs with the (estimated) rocket. */
class FlightSound {
  private handle: LoopHandle | null = null
  private t = 0
  private ending = -1
  private endTotal = 1

  start(): void {
    this.stop()
    this.t = 0
    this.ending = -1
    this.handle = audio.loop('launch-rumble', { position: [PAD_POSITION[0], 3, PAD_POSITION[2]], volume: 1, refDistance: 18, maxDistance: 160 })
  }

  /** Fade the rumble out (fast after a failure, slow as a healthy rocket leaves). */
  end(fast: boolean): void {
    if (!this.handle || this.ending >= 0) return
    this.ending = this.endTotal = fast ? 1.2 : 5
  }

  position(): Vec3 {
    return [PAD_POSITION[0], this.handle ? estimateRocketAltitude(this.t) : PAD_POSITION[1] + 4, PAD_POSITION[2]]
  }

  tick(dt: number): void {
    const h = this.handle
    if (!h) return
    this.t += dt
    h.setPosition(PAD_POSITION[0], estimateRocketAltitude(this.t), PAD_POSITION[2])
    if (this.ending >= 0) {
      this.ending -= dt
      h.setVolume(Math.max(0, this.ending / this.endTotal))
      if (this.ending <= 0) this.stop()
      return
    }
    // the sim leaving 'flight' (or a long-lost rocket) ends the rumble
    const phase = factory?.state?.rocket?.phase
    if ((this.t > 1 && phase !== undefined && phase !== 'flight' && phase !== 'ignition') || this.t > 18) this.end(false)
  }

  stop(): void {
    this.handle?.stop()
    this.handle = null
    this.ending = -1
  }
}

/** Machinery one-shots synced to the factory sim + seeded ambient bursts. */
class WorldMachines {
  world: WorldHandle[] = []
  private prevSmelt = Number.NaN
  private prevPipe = Number.NaN
  private acc = 0
  private readonly weld = new SeededTimer('audio:weld', 2.5, 7, { chance: 0.6, min: 0.25, max: 0.9 })
  private readonly steam = STEAM_SPOTS.map((_, i) => new SeededTimer(`audio:steam:${i}`, 7, 18))

  tick(dt: number, power: number): void {
    const lines = factory?.state?.lines
    const smelt = lines?.smelt
    if (smelt && Number.isFinite(smelt.phase)) {
      if (smelt.status === 'running' && power > 0.35 && phaseCrossed(this.prevSmelt, smelt.phase, 0.5)) {
        audio.play('press-thump', { position: PRESS_POSITION })
      }
      this.prevSmelt = smelt.phase
    }
    const pipe = lines?.pipe
    if (pipe && Number.isFinite(pipe.phase)) {
      if (pipe.status === 'running' && power > 0.35 && phaseCrossed(this.prevPipe, pipe.phase, 0.3)) {
        audio.play('machine-clank', { position: PIPE_MACHINE_POSITION, volume: 0.4 })
      }
      this.prevPipe = pipe.phase
    }
    if (this.weld.tick(dt) && (lines?.tank?.status ?? 'running') === 'running' && power > 0.35) {
      audio.play('weld-zap', { position: WELD_SPOTS[this.weld.next() < 0.5 ? 0 : 1] })
    }
    for (let i = 0; i < this.steam.length; i++) {
      if (this.steam[i].tick(dt) && power > 0.3) audio.play('steam-hiss', { position: STEAM_SPOTS[i], volume: 0.75 })
    }

    // belts follow line status and conveyor speed (5 Hz is plenty)
    this.acc += dt
    if (this.acc < 0.2) return
    this.acc = 0
    const speed = factory?.state?.params?.conveyorSpeed
    const conveyor = Number.isFinite(speed) ? (speed as number) : 1
    for (const w of this.world) {
      if (w.def.loop !== 'belt-clatter') continue
      const st = w.def.line ? lines?.[w.def.line as LineId]?.status : 'running'
      const vol = st === 'idle' ? 0 : st === 'blocked' ? w.def.volume * 0.25 : w.def.volume
      const rate = st === 'blocked' ? conveyor * 0.5 : conveyor
      if (vol !== w.volume) {
        w.volume = vol
        w.handle.setVolume(vol)
      }
      if (Math.abs(rate - w.rate) > 0.01) {
        w.rate = rate
        w.handle.setRate(rate)
      }
    }
  }
}

/** World attenuation while a panel is open; the settings panel stays true so sliders can be judged. */
function panelFocus(panel: PanelState | null): number {
  return panel && panel.id !== 'settings' ? 0.35 : 0
}

function play(name: SfxName, opts?: PlayOptions) {
  audio.play(name, opts)
}

export default function AudioScene() {
  const camera = useThree((s) => s.camera)
  const machines = useRef<WorldMachines>(null!)
  if (!machines.current) machines.current = new WorldMachines()
  const flight = useRef<FlightSound>(null!)
  if (!flight.current) flight.current = new FlightSound()
  const power = useRef(1)

  // Engine lifecycle (refcounted) + render quality → panning model / voice caps
  // + panel focus (the world is lowered ~4 dB while a portfolio panel is open).
  useEffect(() => {
    const release = engine.acquire()
    engine.setQuality(useGameStore.getState().quality)
    engine.setFocus(panelFocus(useUIStore.getState().panel))
    const unsubQ = useGameStore.subscribe((s) => engine.setQuality(s.quality))
    const unsubP = useUIStore.subscribe((s) => engine.setFocus(panelFocus(s.panel)))
    return () => {
      unsubQ()
      unsubP()
      engine.setFocus(0)
      release()
    }
  }, [])

  // Continuous world emitters + soundtrack + ambience bed.
  useEffect(() => {
    const m = machines.current
    m.world = WORLD_EMITTERS.map((def) => ({
      def,
      volume: def.volume,
      rate: 1,
      handle: audio.loop(def.loop, { position: def.position, volume: def.volume, refDistance: def.refDistance, maxDistance: def.maxDistance }),
    }))
    const music = audio.loop('music')
    const bed = audio.loop('ambience-factory')
    const fl = flight.current
    return () => {
      for (const w of m.world) w.handle.stop()
      m.world = []
      music.stop()
      bed.stop()
      fl.stop()
    }
  }, [])

  // Game events → sounds. (Event owners emit the captions.)
  useEffect(() => wireAudioEvents({ play, duck: (a, sec) => audio.duck(a, sec), flight: flight.current }), [])

  // Debug / test hooks (dev + test builds only).
  useEffect(
    () =>
      registerDebug('audio', {
        getState: () => engine.getState(),
        getLoops: () => engine.getLoops(),
        enableForTest: () => engine.enableForTest(),
        play: (name: SfxName, opts?: PlayOptions) => audio.play(name, opts),
        duck: (amount: number, seconds: number) => audio.duck(amount, seconds),
        setListenerOverride: (p: Vec3 | null) => engine.setListenerOverride(p),
        liveHandles: () => liveLoopCount(),
        perf: () => engine.takePerf(),
        measure: (what?: string) => import('./measure').then((m) => m.runMeasurement(what)),
      }),
    [],
  )

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 0.25) : 0
    // listener = the actual three.js camera
    camera.getWorldPosition(_pos)
    camera.getWorldQuaternion(_quat)
    _fwd.set(0, 0, -1).applyQuaternion(_quat)
    _up.set(0, 1, 0).applyQuaternion(_quat)
    engine.setListenerPose(_pos.x, _pos.y, _pos.z, _fwd.x, _fwd.y, _fwd.z, _up.x, _up.y, _up.z)
    engine.setInterior(runtime.world.interior)

    // machinery power: follows the lighting level, pulled down by Night Shift
    const level = Number.isFinite(runtime.lighting.level) ? runtime.lighting.level : 1
    const target = Math.min(clamp01((level - 0.15) / 0.7), useGameStore.getState().nightShift ? 0.12 : 1)
    power.current = damp(power.current, target, 2.2, dt)
    engine.setPower(Math.max(0.06, power.current))

    machines.current.tick(dt, power.current)
    flight.current.tick(dt)
    engine.update(dt)
  })

  return null
}
