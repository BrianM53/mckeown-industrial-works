import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRng } from '@/core/rng'
import type { LoopName, SfxName } from '@/core/types'
import { createMixer } from './mixer'
import { flavorFor } from './synth/ambience'
import { clatterBuffer, impulse, makeLoopable, noiseBank, softClipCurve } from './synth/buffers'
import { Synth } from './synth/core'
import { LOOP_LIBRARY, LOOP_META, LOOP_NAMES } from './synth/loops'
import { createMusic, voiceLead } from './synth/music'
import { RAW_PEAK, SFX_LIBRARY, SFX_META, SFX_NAMES, sfxLevel } from './synth/sfx'
import type { LoopFn, LoopMeta, SfxFn, SfxMeta } from './synth/types'
import { asCtx, FakeAudioContext, type FakeGain, type FakeNode } from './testing/fakeAudio'

// ---- type-level exhaustiveness: these fail to compile if a name is missing ----
const _sfxFns: Record<SfxName, SfxFn> = SFX_LIBRARY
const _sfxMeta: Record<SfxName, SfxMeta> = SFX_META
const _loopFns: Record<LoopName, LoopFn> = LOOP_LIBRARY
const _loopMeta: Record<LoopName, LoopMeta> = LOOP_META
void [_sfxFns, _sfxMeta, _loopFns, _loopMeta]

/** Union members of `export type <name> = | 'a' | 'b'` parsed from the contract source. */
function unionMembers(typeName: string): string[] {
  const src = readFileSync(resolve(process.cwd(), 'src/core/types.ts'), 'utf8')
  const m = src.match(new RegExp(`export type ${typeName} =([\\s\\S]*?)(?:\\n\\s*\\n|\\nexport |$)`))
  if (!m) throw new Error(`type ${typeName} not found`)
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('every contract name has an implementation (runtime check against src/core/types.ts)', () => {
  it('SfxName', () => {
    const names = unionMembers('SfxName')
    expect(names.length).toBeGreaterThan(30)
    expect([...SFX_NAMES].sort()).toEqual(names)
    expect(Object.keys(SFX_META).sort()).toEqual(names)
    for (const n of names) expect(typeof SFX_LIBRARY[n as SfxName]).toBe('function')
  })
  it('LoopName', () => {
    const names = unionMembers('LoopName')
    expect([...LOOP_NAMES].sort()).toEqual(names)
    expect(Object.keys(LOOP_META).sort()).toEqual(names)
    for (const n of names) expect(typeof LOOP_LIBRARY[n as LoopName]).toBe('function')
  })
})

describe('mixing metadata', () => {
  it('rate limits, voice caps and levels are sane', () => {
    expect(SFX_META.footstep.minInterval).toBeGreaterThanOrEqual(0.18)
    expect(SFX_META['footstep-metal'].minInterval).toBeGreaterThanOrEqual(0.18)
    for (const n of ['forklift-impact', 'crate-bump', 'ball-bounce', 'tackle-thud', 'machine-clank'] as SfxName[]) {
      expect(SFX_META[n].minInterval).toBeGreaterThanOrEqual(0.1)
    }
    for (const n of SFX_NAMES) {
      const m = SFX_META[n]
      expect(m.maxVoices, n).toBeGreaterThanOrEqual(1)
      expect(m.peakDb, n).toBeLessThanOrEqual(-2)
      expect(m.max, n).toBeGreaterThan(m.ref)
      const lvl = sfxLevel(n)
      expect(Number.isFinite(lvl) && lvl > 0 && lvl < 2, n).toBe(true)
      expect(RAW_PEAK[n], `RAW_PEAK calibration for ${n}`).toBeGreaterThan(0)
    }
    for (const n of LOOP_NAMES) expect(LOOP_META[n].level, n).toBeGreaterThan(0)
  })
})

describe('one-shot synthesis', () => {
  for (const name of SFX_NAMES) {
    it(`${name}: builds, connects, and schedules a stop for every source`, () => {
      const ctx = new FakeAudioContext()
      const s = new Synth(asCtx(ctx), createRng(1))
      const out = s.gain(1)
      out.connect(asCtx(ctx).destination)
      const t = 0.5
      const end = SFX_LIBRARY[name](s, out, t, { rate: 1 })
      expect(end).toBeGreaterThan(t)
      expect(end - t).toBeLessThan(10)
      expect((out as unknown as FakeGain).inputs).toBeGreaterThan(0)
      expect(ctx.sources.length).toBeGreaterThan(0)
      for (const src of ctx.sources) {
        expect(src.startTime!).toBeGreaterThanOrEqual(t - 1e-9)
        expect(src.stopTime, `${name}: a source has no stop time`).not.toBeNull()
        expect(src.stopTime!).toBeLessThanOrEqual(end + 0.5)
      }
      // every node created by the voice feeds somewhere (no dangling branches)
      const own = ctx.allNodes.filter((n) => n.kind !== 'destination')
      for (const n of own) expect(n.outputs.length, `${name}: dangling ${n.kind}`).toBeGreaterThan(0)
      // pitch/speed variants and different seeds are safe
      for (const rate of [0.25, 0.8, 1.5, 4]) SFX_LIBRARY[name](new Synth(asCtx(ctx), createRng(rate * 10)), out, t, { rate })
      s.dispose()
      expect(s.nodes.length).toBe(0)
    })
  }
})

describe('loop synthesis', () => {
  for (const name of LOOP_NAMES) {
    it(`${name}: builds, re-rates, updates and stops cleanly`, async () => {
      vi.useFakeTimers()
      const ctx = new FakeAudioContext()
      ctx.state = 'running'
      const s = new Synth(asCtx(ctx), createRng(3))
      const v = LOOP_LIBRARY[name](s, { rate: 1, quality: 'medium' })
      v.output.connect(asCtx(ctx).destination)
      for (const r of [2, 0.5, Number.NaN, 0, 10]) v.setRate(r, 0.1)
      v.update?.({ interior: 'server', power: 0.2 }, 0.5)
      v.update?.({ interior: null, power: 1 }, 1)
      ctx.currentTime = 1
      vi.advanceTimersByTime(250)
      v.stop(2)
      expect(ctx.sources.filter((src) => src.stopTime === null)).toEqual([])
      const n = ctx.sources.length
      ctx.currentTime = 30
      vi.advanceTimersByTime(2000)
      await Promise.resolve()
      expect(ctx.sources.length, 'nothing is scheduled after stop').toBe(n)
      s.dispose()
    })
  }

  it('music is generative, deterministic per seed, and keeps evolving', () => {
    const run = (seed: number) => {
      const ctx = new FakeAudioContext()
      const s = new Synth(asCtx(ctx), createRng(seed))
      const m = createMusic(s, { rate: 1, quality: 'medium', offline: true })
      m.output.connect(asCtx(ctx).destination)
      m.pump(120)
      return ctx.sources.map((x) => `${x.kind}@${x.startTime!.toFixed(3)}`)
    }
    const a = run(11)
    expect(a.length).toBeGreaterThan(150)
    expect(run(11)).toEqual(a)
    expect(run(12)).not.toEqual(a)
  })

  it('pad voice leading moves smoothly between chords and never drifts', () => {
    const chords = [
      [50, 53, 57, 64],
      [46, 53, 57, 62],
      [53, 57, 60, 67],
      [48, 55, 62, 64],
      [43, 53, 58, 62],
      [45, 52, 55, 60],
    ]
    let cur = [50, 53, 57, 64]
    let worst = 0
    for (let i = 0; i < 300; i++) {
      const ch = chords[(i * 7 + (i >> 2)) % chords.length]
      const next = voiceLead(cur, ch)
      const pcs = new Set(ch.map((n) => n % 12))
      for (let v = 0; v < 4; v++) {
        expect(pcs.has(next[v] % 12)).toBe(true)
        expect(next[v]).toBeGreaterThanOrEqual(45)
        expect(next[v]).toBeLessThanOrEqual(72)
        worst = Math.max(worst, Math.abs(next[v] - cur[v]))
      }
      expect(new Set(next.map((n) => n % 12)).size).toBeGreaterThanOrEqual(3)
      cur = next
    }
    expect(worst).toBeLessThanOrEqual(5)
  })

  it('ambience maps interiors to room flavours', () => {
    expect(flavorFor(null)).toBe('outdoor')
    expect(flavorFor('server')).toBe('server')
    expect(flavorFor('radio')).toBe('studio')
    expect(flavorFor('warehouse')).toBe('hangar')
    expect(flavorFor('somewhere-new')).toBe('office')
  })
})

describe('buffers and mixer', () => {
  it('noise buffers are normalized and loop seamlessly', () => {
    const ctx = new FakeAudioContext()
    const bank = noiseBank(asCtx(ctx))
    for (const k of ['white', 'pink', 'brown'] as const) {
      const d = bank[k].getChannelData(0)
      let sum = 0
      for (let i = 0; i < d.length; i++) sum += d[i] * d[i]
      expect(Math.sqrt(sum / d.length)).toBeCloseTo(0.25, 1)
    }
    expect(noiseBank(asCtx(ctx)).pink).toBe(bank.pink)
    const brown = bank.brown.getChannelData(0)
    expect(Math.abs(brown[brown.length - 1] - brown[0])).toBeLessThan(0.1)
    const seam = makeLoopable(Float32Array.from({ length: 200 }, (_, i) => i), 100, 50)
    expect(seam[0]).toBeCloseTo(100)
    expect(seam[99]).toBe(99)
  })

  it('impulse responses decay; clatter loop is bounded', () => {
    const ctx = new FakeAudioContext()
    const ir = impulse(asCtx(ctx), 'hall').getChannelData(0)
    const energy = (a: number, b: number) => {
      let e = 0
      for (let i = a; i < b; i++) e += ir[i] * ir[i]
      return e
    }
    const n = ir.length
    expect(energy(0, n / 10)).toBeGreaterThan(energy(n - n / 10, n) * 50)
    const cl = clatterBuffer(asCtx(ctx)).getChannelData(0)
    let p = 0
    for (let i = 0; i < cl.length; i++) p = Math.max(p, Math.abs(cl[i]))
    expect(p).toBeCloseTo(0.8, 2)
  })

  it('the safety clipper is transparent below its knee and never reaches 0 dBFS', () => {
    const c = softClipCurve(0.8, 0.97)
    expect(c.length % 2).toBe(1)
    expect(c[(c.length - 1) / 2]).toBe(0)
    let max = 0
    for (let i = 0; i < c.length; i++) {
      max = Math.max(max, Math.abs(c[i]))
      expect(c[i]).toBeCloseTo(-c[c.length - 1 - i], 6)
      const x = (i / (c.length - 1)) * 2 - 1
      if (Math.abs(x) <= 0.8) expect(c[i]).toBeCloseTo(x, 6)
    }
    expect(max).toBeLessThan(0.97)
  })

  it('mixer wires buses → master → compressor → clipper → destination', () => {
    const ctx = new FakeAudioContext()
    const mx = createMixer(asCtx(ctx), { reverb: true, master: 0 })
    const chain: string[] = []
    let node = mx.master as unknown as FakeNode
    while (node && chain.length < 6) {
      chain.push(node.kind)
      node = node.outputs[0] as FakeNode
    }
    expect(chain).toEqual(['gain', 'compressor', 'waveShaper', 'destination'])
    expect(mx.input('music')).toBe(mx.musicDuck)
    expect(mx.input('ambience')).toBe(mx.ambienceDuck)
    expect(mx.input('sfx')).toBe(mx.sfx)
    mx.dispose()
  })
})
