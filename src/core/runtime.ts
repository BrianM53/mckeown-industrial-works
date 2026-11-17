import { Vector3 } from 'three'
import type { PlayerMode } from './types'

/**
 * Mutable per-frame shared state. NOT reactive — read it inside useFrame or
 * timers. Each field documents its single WRITER; everyone else only reads.
 * Never replace the Vector3 instances (copy into them instead).
 */
export const runtime = {
  player: {
    /** Feet position of the worker (or of the forklift seat while driving). writer: player */
    position: new Vector3(0, 0, 32),
    /** Smoothed velocity m/s. writer: player */
    velocity: new Vector3(),
    /** Worker body yaw (radians; forward = (-sin, 0, -cos)). writer: player */
    facing: 0,
    /** Horizontal speed m/s. writer: player */
    speed: 0,
    grounded: true,
    /** Current control mode. writer: player (forklift module asks via services) */
    mode: 'foot' as PlayerMode,
  },
  camera: {
    /** Orbit yaw/pitch (radians) and boom length (m). writer: player (camera rig) */
    yaw: 0,
    pitch: 0.18,
    distance: 5.5,
    /** Actual camera world position after collision. writer: player (camera rig) */
    position: new Vector3(0, 2.5, 37.5),
  },
  forklift: {
    position: new Vector3(-11, 0, 29),
    yaw: -Math.PI / 2,
    /** Signed forward speed m/s. */
    speed: 0,
    occupied: false,
    upright: true,
  },
  input: {
    /** Virtual joystick (written by ui touch controls). x: right, y: forward, each -1..1. */
    touchMove: { x: 0, y: 0 },
    /** Accumulated touch-drag look delta in CSS px since last consumed (ui writes, player consumes & zeroes). */
    touchLook: { dx: 0, dy: 0 },
    /** Accumulated pinch zoom delta (positive = zoom out). ui writes, player consumes & zeroes. */
    touchZoom: 0,
    /** Run toggle from touch UI. */
    touchRun: false,
  },
  lighting: {
    /** 1 = normal factory lighting, 0 = full blackout. writer: safety (night shift). readers: environment lights */
    level: 1,
    /** 0..1 strength of red rotating emergency lights. writer: safety */
    emergency: 0,
  },
  world: {
    /** Zone id of the building interior the player is inside, or null. writer: environment */
    interior: null as string | null,
  },
  frame: {
    /** Smoothed frames per second. writer: world/GameCanvas perf monitor */
    fps: 60,
  },
}

export type Runtime = typeof runtime
