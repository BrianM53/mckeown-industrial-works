import { burst, modes, spikes, thump, type Synth } from './core'
import type { LoopEnv, LoopParams, LoopVoice } from './types'

/**
 * FACTORY AMBIENCE — the non-positional bed under everything.
 *
 * Outdoors: a distant industrial bed (low brown-noise rumble, drifting air
 * band, a faint beating machine drone) plus randomized far-away events
 * (clanks, hammering, steam, reversing beeps, chains) panned around the
 * listener through an echo. Indoors (runtime.world.interior): the bed is
 * low-passed and quieter (heard through walls) and a per-room tone fades in
 * (office fluorescent hum, server-room air conditioning, control-room
 * electronics with console bleeps, a near-silent studio, a big hangar...).
 * During a power outage the machine layers fade with `env.power`.
 */
type Flavor = 'outdoor' | 'office' | 'server' | 'control' | 'studio' | 'hangar' | 'lab'

const INTERIOR_FLAVOR: Record<string, Flavor> = {
  personnel: 'office',
  breakroom: 'office',
  server: 'server',
  control: 'control',
  radio: 'studio',
  maintenance: 'hangar',
  warehouse: 'hangar',
  rnd: 'lab',
}

interface Preset {
  bedCut: number
  bedGain: number
  room: number
  acCut: number
  acGain: number
  humF: number
  humGain: number
  hum2F: number
  hum2Gain: number
  /** Console bleeps per second. */
  bleeps: number
  /** Distant-event rate multiplier. */
  distant: number
}

const PRESETS: Record<Flavor, Preset> = {
  outdoor: { bedCut: 9000, bedGain: 1, room: 0, acCut: 1200, acGain: 0, humF: 120, humGain: 0, hum2F: 240, hum2Gain: 0, bleeps: 0, distant: 1 },
  office: { bedCut: 420, bedGain: 0.5, room: 1, acCut: 1300, acGain: 0.06, humF: 120, humGain: 0.014, hum2F: 240, hum2Gain: 0.006, bleeps: 0, distant: 0.35 },
  server: { bedCut: 380, bedGain: 0.4, room: 1, acCut: 3200, acGain: 0.07, humF: 60, humGain: 0.012, hum2F: 180, hum2Gain: 0.006, bleeps: 0.05, distant: 0.25 },
  control: { bedCut: 450, bedGain: 0.45, room: 1, acCut: 1500, acGain: 0.05, humF: 880, humGain: 0.0025, hum2F: 1320, hum2Gain: 0.0018, bleeps: 0.35, distant: 0.3 },
  studio: { bedCut: 300, bedGain: 0.22, room: 1, acCut: 900, acGain: 0.02, humF: 120, humGain: 0.003, hum2F: 240, hum2Gain: 0.001, bleeps: 0, distant: 0.12 },
  hangar: { bedCut: 900, bedGain: 0.7, room: 1, acCut: 600, acGain: 0.05, humF: 100, humGain: 0.007, hum2F: 200, hum2Gain: 0.003, bleeps: 0, distant: 0.7 },
  lab: { bedCut: 420, bedGain: 0.45, room: 1, acCut: 2000, acGain: 0.045, humF: 2400, humGain: 0.0018, hum2F: 120, hum2Gain: 0.007, bleeps: 0.25, distant: 0.3 },
}

export function flavorFor(interior: string | null): Flavor {
  if (interior === null) return 'outdoor'
  return INTERIOR_FLAVOR[interior] ?? 'office'
}

const RUMBLE = 0.7
const DRONE = 0.05

export function createAmbience(s: Synth, p: LoopParams): LoopVoice {
  const ctx = s.ctx
  const t0 = ctx.currentTime
  const out = s.gain(1)

  // ---- industrial bed -------------------------------------------------------
  const bedMix = s.gain(1)
  const bedLp = s.lp(PRESETS.outdoor.bedCut, 0.5)
  const bedGain = s.gain(1)
  bedMix.connect(bedLp).connect(bedGain).connect(out)

  const rumble = s.gain(RUMBLE)
  s.chain(s.noise('brown', t0), s.lp(140, 0.7), rumble, bedMix)

  const airLevel = s.gain(0.16)
  const airMod = s.gain(1)
  s.wander(0.15, 0.35, airMod.gain, t0)
  s.chain(s.noise('pink', t0), s.bp(520, 0.5), airLevel, airMod, bedMix)

  const drone = s.gain(DRONE)
  const droneA = s.harmonics([1, 0.6, 0.3], 49, t0)
  const droneB = s.osc('sine', 49.4, t0)
  const droneBG = s.gain(0.6)
  droneA.connect(drone)
  droneB.connect(droneBG).connect(drone)
  drone.connect(bedMix)

  // distant events → lowpass → echo → bed
  const distBus = s.gain(1)
  const distLp = s.lp(1800, 0.6)
  distBus.connect(distLp).connect(bedMix)
  const echo = s.delay(1, 0.29)
  const echoFb = s.gain(0.3)
  const echoLp = s.lp(1100, 0.6)
  distLp.connect(echo)
  echo.connect(echoLp).connect(echoFb).connect(echo)
  echoLp.connect(bedMix)

  // ---- interior room tone ---------------------------------------------------
  const room = s.gain(0)
  room.connect(out)
  const acFilter = s.lp(1200, 0.6)
  const acGain = s.gain(0)
  s.chain(s.noise('pink', t0), acFilter, acGain, room)
  const hum1 = s.osc('sine', 120, t0)
  const hum1G = s.gain(0)
  hum1.connect(hum1G).connect(room)
  const hum2 = s.osc('sine', 240, t0)
  const hum2G = s.gain(0)
  hum2.connect(hum2G).connect(room)
  const bleepBus = s.gain(1)
  bleepBus.connect(room)

  let flavor: Flavor = 'outdoor'
  let interior: string | null | undefined = undefined
  let power = 1
  let nextDistant = t0 + 2 + s.rng() * 3
  let nextBleep = t0 + 1
  const pending: { synth: Synth; at: number }[] = []

  function apply(f: Flavor, t: number) {
    const pr = PRESETS[f]
    bedLp.frequency.setTargetAtTime(pr.bedCut, t, 0.35)
    bedGain.gain.setTargetAtTime(pr.bedGain, t, 0.45)
    room.gain.setTargetAtTime(pr.room, t, 0.5)
    acFilter.frequency.setTargetAtTime(pr.acCut, t, 0.3)
    acGain.gain.setTargetAtTime(pr.acGain, t, 0.5)
    hum1.frequency.setTargetAtTime(pr.humF, t, 0.05)
    hum1G.gain.setTargetAtTime(pr.humGain, t, 0.5)
    hum2.frequency.setTargetAtTime(pr.hum2F, t, 0.05)
    hum2G.gain.setTargetAtTime(pr.hum2Gain, t, 0.5)
  }

  function spawnDistant(t: number) {
    const h = s.spawn()
    const pan = h.pan(h.r(-0.85, 0.85))
    pan.connect(distBus)
    const kind = h.pick(['clank', 'clank', 'hammer', 'hiss', 'beeps', 'thud', 'chain'] as const)
    let end = t
    switch (kind) {
      case 'clank':
        end = modes(h, pan, t, { peak: h.r(0.05, 0.1), freq: h.r(200, 600), ratios: [1, 2.76, 5.4], decays: [0.6, 0.4, 0.2], strike: 0.03 })
        break
      case 'hammer': {
        const f = h.r(380, 700)
        const n = 2 + Math.floor(h.rng() * 3)
        for (let i = 0; i < n; i++) {
          end = Math.max(end, modes(h, pan, t + i * h.r(0.3, 0.42), { peak: 0.06, freq: f, ratios: [1, 2.6, 4.9], decays: [0.25, 0.15, 0.08], strike: 0.04 }))
        }
        break
      }
      case 'hiss':
        end = burst(h, pan, t, { peak: 0.05, decay: 0.6, hold: h.r(0.3, 0.8), freq: 2800, q: 0.7, attack: 0.08 })
        break
      case 'beeps':
        for (let i = 0; i < 2; i++) {
          const o = h.osc('sine', 1040, t + i * 0.55, t + i * 0.55 + 0.3)
          const g = h.gain(0)
          h.ahr(g.gain, t + i * 0.55, 0.025, 0.006, 0.25, 0.02)
          o.connect(g).connect(pan)
        }
        end = t + 1.2
        break
      case 'thud':
        end = thump(h, pan, t, { peak: 0.12, f0: 90, f1: 40, sweep: 0.15, decay: 0.5 })
        break
      case 'chain': {
        const n = h.noise('white', t, t + 0.75)
        const f = h.bp(2600, 1.6)
        const g = h.gain(0)
        end = spikes(h, g.gain, t, 0.6, { rate: 28, peak: 0.06, width: 0.012 })
        n.connect(f).connect(g).connect(pan)
        break
      }
    }
    pending.push({ synth: h, at: end + 0.3 })
  }

  function bleep(t: number) {
    const h = s.spawn()
    const f = h.pick([1046, 1318, 1568, 1760, 2093])
    const o = h.osc('sine', f, t, t + 0.14)
    const g = h.gain(0)
    h.ahr(g.gain, t, 0.006, 0.004, 0.06, 0.04)
    const pn = h.pan(h.r(-0.6, 0.6))
    o.connect(g).connect(pn).connect(bleepBus)
    pending.push({ synth: h, at: t + 0.4 })
  }

  return {
    output: out,
    setRate() {},
    update(env: LoopEnv, t: number) {
      if (env.interior !== interior) {
        interior = env.interior
        flavor = flavorFor(interior)
        apply(flavor, t)
      }
      if (Math.abs(env.power - power) > 0.02) {
        power = env.power
        rumble.gain.setTargetAtTime(RUMBLE * (0.45 + 0.55 * power), t, 0.4)
        drone.gain.setTargetAtTime(DRONE * (0.15 + 0.85 * power), t, 0.4)
      }
      const pr = PRESETS[flavor]
      if (t >= nextDistant) {
        if (power > 0.3 && !p.offline) spawnDistant(t + 0.05)
        nextDistant = t + (3.5 + s.rng() * 5.5) / Math.max(0.12, pr.distant)
      }
      if (pr.bleeps > 0 && t >= nextBleep) {
        if (power > 0.2) bleep(t + 0.02)
        nextBleep = t + (0.4 + s.rng() * 1.6) / pr.bleeps
      } else if (pr.bleeps === 0) nextBleep = Math.max(nextBleep, t)
      for (let i = pending.length - 1; i >= 0; i--) {
        if (t >= pending[i].at) {
          pending[i].synth.dispose()
          pending.splice(i, 1)
        }
      }
    },
    stop(t: number) {
      s.stopAll(t)
    },
  }
}
