import { describe, expect, it } from 'vitest'
import { lineDef, REJECT, zAt } from './config'
import {
  benderSwing,
  DeliveryCounter,
  gantryTarget,
  gaugePressure,
  ik2,
  itemKindFor,
  lineU,
  phaseCrossed,
  pourFlow,
  pressRam,
  QcArchMonitor,
  rejectPose,
  REJECT_TIMES,
  samplePath,
  sheetCurl,
  skipHoist,
  transitPath,
  valveRobot,
  weldCap,
  weldSeam,
  type RejectPose,
  type ToolPose,
} from './logic'

const steps = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n)

describe('machine motion curves (driven by the sim phase)', () => {
  it('press ram hits bottom exactly at phase 0.5 (audio thump), not before', () => {
    expect(pressRam(0)).toBe(0)
    expect(pressRam(0.19)).toBe(0)
    expect(pressRam(0.4999)).toBeLessThan(1)
    expect(pressRam(0.4999)).toBeGreaterThan(0.99)
    expect(pressRam(0.5)).toBe(1)
    expect(pressRam(0.55)).toBe(1)
    expect(pressRam(0.9)).toBe(0)
    // accelerating stroke: strictly increasing on the way down
    let prev = -1
    for (let p = 0.2; p < 0.5; p += 0.01) {
      const v = pressRam(p)
      expect(v).toBeGreaterThan(prev)
      prev = v
    }
    // retract is monotone and returns to the top
    prev = 2
    for (let p = 0.6; p <= 0.88; p += 0.01) {
      const v = pressRam(p)
      expect(v).toBeLessThanOrEqual(prev + 1e-9)
      prev = v
    }
  })

  it('every curve stays within 0..1 and is finite for any phase (incl. wraps)', () => {
    for (const p of [...steps(200), 1.37, -0.25, 7.9]) {
      for (const v of [pressRam(p), pourFlow(p), benderSwing(p), sheetCurl(p), gaugePressure(p)]) {
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
      const s = weldSeam(p)
      const c = weldCap(p)
      for (const v of [s.s, s.lift, c.s, c.lift]) {
        expect(v).toBeGreaterThanOrEqual(-1e-9)
        expect(v).toBeLessThanOrEqual(1 + 1e-9)
      }
      const h = skipHoist(p * 4)
      expect(h.lift).toBeGreaterThanOrEqual(0)
      expect(h.lift).toBeLessThanOrEqual(1)
      expect(h.tip).toBeGreaterThanOrEqual(0)
      expect(h.tip).toBeLessThanOrEqual(1)
    }
  })

  it('welders only strike an arc while the torch is on the work', () => {
    for (const p of steps(400)) {
      const s = weldSeam(p)
      if (s.arc) expect(s.lift).toBe(0)
      const c = weldCap(p)
      if (c.arc) expect(c.lift).toBe(0)
    }
    expect(weldSeam(0.4).arc).toBe(true)
    expect(weldSeam(0.9).arc).toBe(false)
  })

  it('gauge climbs into the test zone and vents back to zero at the end of the cycle', () => {
    expect(gaugePressure(0)).toBe(0)
    expect(gaugePressure(0.6)).toBeGreaterThan(0.6)
    expect(gaugePressure(0.97)).toBeLessThan(0.02)
  })

  it('valve robot holds the wheel only between pick and place and returns to park', () => {
    const pose: ToolPose = { f: 0, u: 0, r: 0, holding: false }
    expect(valveRobot(0.1, pose).holding).toBe(false)
    expect(valveRobot(0.3, pose).holding).toBe(true)
    expect(valveRobot(0.7, pose).holding).toBe(false)
    const park = { ...valveRobot(0.95, pose) }
    const start = { ...valveRobot(0, pose) }
    expect(park.f).toBeCloseTo(start.f, 6)
    expect(park.u).toBeCloseTo(start.u, 6)
    // continuous: no teleporting tool between consecutive samples
    let prev = { ...valveRobot(0, pose) }
    for (const p of steps(500)) {
      const cur = { ...valveRobot(p, pose) }
      expect(Math.hypot(cur.f - prev.f, cur.u - prev.u, cur.r - prev.r)).toBeLessThan(0.08)
      prev = cur
    }
  })

  it('two-link IK reaches reachable targets and clamps unreachable ones without NaN', () => {
    const l1 = 0.9
    const l2 = 0.8
    const out: [number, number] = [0, 0]
    for (const [d, h] of [
      [0.6, 0.5],
      [1.2, -0.3],
      [0.3, 1.2],
      [1.0, 0.0],
    ]) {
      const [a, b] = ik2(d, h, l1, l2, out)
      // forward kinematics: angles measured from vertical, positive leaning forward
      const ex = l1 * Math.sin(a) + l2 * Math.sin(a + b)
      const ey = l1 * Math.cos(a) + l2 * Math.cos(a + b)
      expect(ex).toBeCloseTo(d, 3)
      expect(ey).toBeCloseTo(h, 3)
    }
    const [a, b] = ik2(10, 10, l1, l2, out)
    expect(Number.isFinite(a) && Number.isFinite(b)).toBe(true)
    const [c, d] = ik2(Number.NaN, 0, l1, l2, out)
    expect(Number.isFinite(c) && Number.isFinite(d)).toBe(true)
  })

  it('pick-and-place gantry zips without jumps and stays in its travel range', () => {
    const o = { x: 0, z: 0, dip: 0 }
    let px = gantryTarget(0, o).x
    let pz = o.z
    for (let u = 0; u <= 6; u += 0.002) {
      gantryTarget(u, o)
      expect(o.x).toBeGreaterThanOrEqual(0)
      expect(o.x).toBeLessThanOrEqual(1)
      expect(o.z).toBeGreaterThanOrEqual(0)
      expect(o.z).toBeLessThanOrEqual(1)
      expect(Math.hypot(o.x - px, o.z - pz)).toBeLessThan(0.1)
      // only dips while parked over a target (not mid-move)
      if (o.dip > 0) expect((u * 4) % 1).toBeGreaterThan(0.38)
      px = o.x
      pz = o.z
    }
  })
})

describe('sim plumbing', () => {
  it('lineU never steps backwards while a machine waits (rate 0 parks phase at 0)', () => {
    expect(lineU({ cycles: 4, phase: 0.6, rate: 1 })).toBeCloseTo(4.6)
    expect(lineU({ cycles: 5, phase: 0, rate: 0 })).toBe(6)
    expect(lineU({ cycles: Number.NaN, phase: Number.NaN, rate: 1 })).toBe(0)
  })

  it('phaseCrossed detects marks across the 1 → 0 wrap', () => {
    expect(phaseCrossed(0.45, 0.55, 0.5)).toBe(true)
    expect(phaseCrossed(0.5, 0.6, 0.5)).toBe(false)
    expect(phaseCrossed(0.49, 0.5, 0.5)).toBe(true)
    expect(phaseCrossed(0.9, 0.1, 0.95)).toBe(true)
    expect(phaseCrossed(0.9, 0.1, 0.05)).toBe(true)
    expect(phaseCrossed(0.9, 0.1, 0.5)).toBe(false)
    expect(phaseCrossed(0.2, 0.2, 0.5)).toBe(false)
    expect(phaseCrossed(Number.NaN, 0.6, 0.5)).toBe(false)
  })

  it('DeliveryCounter counts parts taken by the tower and resyncs after a reset', () => {
    const c = new DeliveryCounter()
    expect(c.update(10, 4)).toBe(0) // first sample syncs
    expect(c.update(11, 4)).toBe(1)
    expect(c.update(11, 4)).toBe(0)
    expect(c.update(13, 3)).toBe(3)
    expect(c.update(0, 0)).toBe(0) // sim reset
    expect(c.update(2, 1)).toBe(1)
    expect(c.update(Number.NaN, 1)).toBe(0)
  })

  it('item looks progress through each line and are stable per item', () => {
    const p = (z: number) => (z - 18) / (2 - 18)
    expect(itemKindFor('smelt', 0.02, 1)).toBe('ingot')
    expect(itemKindFor('smelt', p(11.5), 1)).toBe('sheet')
    expect(['panel', 'fin']).toContain(itemKindFor('smelt', 0.95, 1))
    const fins = steps(200).filter((_, i) => itemKindFor('smelt', 0.95, i) === 'fin').length
    expect(fins).toBeGreaterThan(20) // a healthy mix of fins and panels
    expect(fins).toBeLessThan(150)
    expect(itemKindFor('pipe', 0.02, 1)).toBe('pipeStraight')
    expect(itemKindFor('pipe', 0.99, 1)).toBe('pipeBundle')
    expect(itemKindFor('circuit', 0.02, 1)).toBe('boardBlank')
    expect(itemKindFor('circuit', 0.99, 1)).toBe('boardPopulated')
    expect(itemKindFor('tank', 0.02, 1)).toBe('tankShell')
    expect(itemKindFor('tank', 0.99, 1)).toBe('tankFuel')
    for (let c = 0; c < 20; c++) expect(itemKindFor('payload', 0.5, c)).toBe(itemKindFor('payload', 0.1, c))
    const order = ['pipeStraight', 'pipeElbow', 'pipeValve', 'pipeBundle']
    let last = 0
    for (const q of steps(100)) {
      const i = order.indexOf(itemKindFor('pipe', q, 3))
      expect(i).toBeGreaterThanOrEqual(last)
      last = i
    }
  })

  it('transit path climbs the elevator and ends at the tower feed on the collector', () => {
    for (const x of [-16, -9, 9, 16]) {
      const path = transitPath(x, 0.1)
      const out: [number, number, number, number] = [0, 0, 0, 0]
      samplePath(path, 0, out)
      expect(out[0]).toBe(x)
      expect(out[2]).toBeCloseTo(2.0)
      samplePath(path, path.length, out)
      expect(Math.abs(out[0])).toBeCloseTo(1.5)
      expect(out[2]).toBeLessThan(-4)
      expect(out[1]).toBeGreaterThan(4.5)
      // monotone along the path
      let prevS = -1
      for (const s of path.cum) {
        expect(s).toBeGreaterThanOrEqual(prevS)
        prevS = s
      }
    }
  })
})

describe('QC scanner arch', () => {
  const mk = () => new QcArchMonitor(11, 3.6, { beepGap: 1.2, toastGap: 60 })

  it('walking north through the opening rejects the visitor (toast + beep)', () => {
    const m = mk()
    expect(m.step(0.5, 11.4, true, 0).pass).toBe(false)
    const r = m.step(0.5, 10.9, true, 0.1)
    expect(r.pass).toBe(true)
    expect(r.beep).toBe(true)
    expect(r.toast).toBe(true)
  })

  it('walking south through it counts too; outside the legs does not', () => {
    const m = mk()
    m.step(-2, 10.8, true, 0)
    expect(m.step(-2, 11.2, true, 0.1).pass).toBe(true)
    const o = mk()
    o.step(4.0, 11.4, true, 0)
    expect(o.step(4.0, 10.6, true, 0.1).pass).toBe(false)
  })

  it('ignores teleports, the forklift and NaN positions', () => {
    const m = mk()
    m.step(0, 20, true, 0)
    expect(m.step(0, 2, true, 0.1).pass).toBe(false) // fast travel
    const f = mk()
    f.step(0, 11.4, false, 0)
    expect(f.step(0, 10.6, false, 0.1).pass).toBe(false) // driving
    const n = mk()
    n.step(Number.NaN, 11.4, true, 0)
    expect(n.step(0, 10.6, true, 0.1).pass).toBe(false)
  })

  it('toast at most once per 60 s, beeps rate limited', () => {
    const m = mk()
    let toasts = 0
    let beeps = 0
    let z = 11.3
    for (let t = 0; t < 130; t += 0.5) {
      z = z > 11 ? 10.7 : 11.3 // walk back and forth through the arch
      const r = m.step(0, z, true, t)
      if (r.toast) {
        toasts++
        m.commitToast(t)
      }
      if (r.beep) beeps++
    }
    expect(toasts).toBe(3) // t = 0, 60, 120
    expect(beeps).toBeLessThanOrEqual(Math.ceil(130 / 1.2) + 1)
    expect(beeps).toBeGreaterThan(40)
  })

  it('a toast the director refused is retried on the next pass (not committed)', () => {
    const m = mk()
    m.step(0, 11.3, true, 0)
    expect(m.step(0, 10.7, true, 0.1).toast).toBe(true) // not committed
    expect(m.step(0, 11.3, true, 2).toast).toBe(true)
  })
})

describe('rejected payload pod', () => {
  const inBin = (p: RejectPose) => p.x > REJECT.bin.minX && p.x < REJECT.bin.maxX && p.z > REJECT.bin.minZ && p.z < REJECT.bin.maxZ
  it('drops from under the arch ring, slides down the chute and settles in the bin', () => {
    const out: RejectPose = { x: 0, y: 0, z: 0, rx: 0, rz: 0 }
    const fromY = 6.2 - 0.95
    rejectPose(0, fromY, 11, 0, out)
    expect(out.y).toBeCloseTo(fromY)
    expect(out.z).toBe(11)
    let settled = false
    for (let t = 0; t <= REJECT_TIMES.settle + 0.1; t += 1 / 30) {
      settled = rejectPose(t, fromY, 11, 0, out)
      for (const v of [out.x, out.y, out.z, out.rx, out.rz]) expect(Number.isFinite(v)).toBe(true)
      expect(out.y).toBeGreaterThan(0)
    }
    expect(settled).toBe(true)
    for (let slot = 0; slot < 6; slot++) {
      expect(rejectPose(99, fromY, 11, slot, out)).toBe(true)
      expect(inBin(out)).toBe(true)
    }
  })

  it('payload items are positioned along the monorail from z 19 to the tower', () => {
    const l = lineDef('payload')
    expect(zAt(l, 0)).toBe(19)
    expect(zAt(l, 1)).toBe(-4.5)
  })
})
