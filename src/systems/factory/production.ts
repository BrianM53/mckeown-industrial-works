/**
 * Production lines: how the console settings become visible machine rates,
 * belt motion and parts delivered to the tower. Deterministic, allocation-free
 * per tick (items arrays are mutated in place).
 *
 * Each line runs a simple 1-D belt:
 *  - the line's machine completes a cycle every 60/rate seconds and ejects one
 *    part onto the belt at position 0 (if the belt entry is clear);
 *  - parts ride the belt at the conveyor speed towards position 1 (the tower);
 *  - at position 1 the tower takes the part — for the current rocket while it
 *    is being assembled, otherwise into a one-rocket hopper for the next one;
 *  - when the hopper is full, parts queue at the belt end; once the queue packs
 *    the belt back to the machine, the machine waits and the line is 'blocked'.
 */
import type { LineId } from '@/core/types'
import { DEFAULT_PARAMS, LINE_IDS, WORLD } from './config'
import { evaluate, inspectionFactor, lineCapacities } from './model'
import { partHash } from './outcomes'
import type { LineState, OptimizationParams } from './types'

/**
 * LineState plus fields beyond the integrator contract (present at runtime on
 * every `factory.state.lines[id]`). Proposed for types.ts — see report.
 */
export interface LineStateWithBelt extends LineState {
  /** Current belt surface speed in normalized belt lengths per second (0 while the belt is stopped). */
  beltSpeed: number
}

export interface LineTargets {
  /** Machine cycles (= parts) per minute. */
  rate: number
  /** Belt speed in normalized belt lengths per second. */
  belt: number
}

const BASELINE_THROUGHPUT = evaluate(DEFAULT_PARAMS).throughputPerHour

function minCapacity(caps: Record<LineId, number>): number {
  let m = Infinity
  for (const id of LINE_IDS) m = Math.min(m, caps[id])
  return m
}

/**
 * Steady-state seconds per rocket in the world for these settings (tower
 * assembly + the launch sequence). Follows the model's throughput, compressed
 * (see WORLD.cycleExponent) so launches stay every few minutes.
 */
export function worldCycleSeconds(p: OptimizationParams): number {
  const caps = lineCapacities(p)
  const throughput = minCapacity(caps) * inspectionFactor(p.inspection)
  return WORLD.baseCycleSeconds * Math.pow(BASELINE_THROUGHPUT / Math.max(throughput, 1e-6), WORLD.cycleExponent)
}

/** Target machine rate and belt speed for every line at these settings. */
export function lineTargets(p: OptimizationParams): Record<LineId, LineTargets> {
  const caps = lineCapacities(p)
  const minCap = minCapacity(caps)
  const cycle = worldCycleSeconds(p)
  const out = {} as Record<LineId, LineTargets>
  for (const id of LINE_IDS) {
    // The bottleneck line makes exactly one rocket's worth per cycle; the others
    // have surplus capacity (compressed) and back up while they wait.
    const surplus = Math.pow(caps[id] / minCap, WORLD.surplusExponent)
    out[id] = {
      rate: ((60 * WORLD.requiredParts[id]) / cycle) * surplus,
      belt: p.conveyorSpeed / WORLD.beltTransitSeconds[id],
    }
  }
  return out
}

export function createLineState(id: LineId): LineStateWithBelt {
  return {
    id,
    rate: 0,
    phase: 0,
    cycles: 0,
    items: [],
    delivered: 0,
    required: WORLD.requiredParts[id],
    status: 'running',
    defectFlash: 0,
    beltSpeed: 0,
  }
}

export interface LineStepContext {
  /** The tower is assembling (parts go to the current rocket until it has enough). */
  assembling: boolean
  /** Probability that a freshly made part is a defect that QC catches (flash). */
  caughtDefectChance: number
  seed: number
  /** Called for every part the tower accepts. */
  onDeliver: (line: ProductionLine, toRocket: boolean) => void
}

export class ProductionLine {
  readonly state: LineStateWithBelt
  readonly index: number
  /** Parts waiting in the tower hopper for the next rocket. */
  stock = 0
  /** Parts delivered to the tower by this line since the session started. */
  totalDelivered = 0
  private targetRate = 0
  private targetBelt = 0
  private rate = 0
  private belt = 0
  /** A finished part is waiting inside the machine for room on the belt. */
  private held = false

  constructor(id: LineId) {
    this.state = createLineState(id)
    this.index = LINE_IDS.indexOf(id)
  }

  get id(): LineId {
    return this.state.id
  }

  get hopperCapacity(): number {
    return WORLD.hopperParts[this.state.id]
  }

  setTargets(t: LineTargets, immediate: boolean): void {
    this.targetRate = t.rate
    this.targetBelt = t.belt
    if (immediate) {
      this.rate = t.rate
      this.belt = t.belt
    }
  }

  /** Nominal (smoothed) machine rate, parts per minute — even while the machine waits. */
  get nominalRate(): number {
    return this.rate
  }

  /** Nominal (smoothed) belt speed, belt lengths per second — even while the belt is stopped. */
  get nominalBelt(): number {
    return this.belt
  }

  /** Empty the belt and hopper (hard reset). */
  clear(): void {
    const s = this.state
    s.items.length = 0
    s.phase = 0
    s.cycles = 0
    s.delivered = 0
    s.status = 'running'
    s.defectFlash = 0
    s.rate = 0
    s.beltSpeed = 0
    this.stock = 0
    this.totalDelivered = 0
    this.held = false
  }

  /** A new rocket starts: whatever waits in the hopper goes straight into it. */
  startRocket(): void {
    const take = Math.min(this.state.required, this.stock)
    this.state.delivered = take
    this.stock -= take
  }

  /** Can the tower accept one more part from this line right now? */
  accepts(assembling: boolean): boolean {
    return (assembling && this.state.delivered < this.state.required) || this.stock < this.hopperCapacity
  }

  private receive(assembling: boolean): boolean {
    this.totalDelivered++
    if (assembling && this.state.delivered < this.state.required) {
      this.state.delivered++
      return true
    }
    this.stock++
    return false
  }

  private get gap(): number {
    return WORLD.itemGap[this.state.id]
  }

  private entryClear(): boolean {
    const items = this.state.items
    if (items.length >= WORLD.maxItems) return false
    return items.length === 0 || items[items.length - 1] >= this.gap
  }

  private eject(ctx: LineStepContext): void {
    const s = this.state
    s.items.push(0)
    s.cycles++
    if (ctx.caughtDefectChance > 0 && partHash(ctx.seed, this.index, s.cycles) < ctx.caughtDefectChance) {
      s.defectFlash = WORLD.defectFlashSeconds
    }
  }

  /** Advance this line by dt seconds. Returns true when its status changed. */
  step(dt: number, ctx: LineStepContext): boolean {
    const s = this.state
    const k = 1 - Math.exp(-WORLD.rateSmoothing * dt)
    this.rate += (this.targetRate - this.rate) * k
    this.belt += (this.targetBelt - this.belt) * k
    if (s.defectFlash > 0) s.defectFlash = Math.max(0, s.defectFlash - dt)

    // Belt: items are sorted descending (index 0 is nearest the tower).
    const items = s.items
    const gap = this.gap
    const accepting = this.accepts(ctx.assembling)
    const advance = this.belt * dt
    let moved = items.length === 0
    for (let i = 0; i < items.length; i++) {
      const limit = i === 0 ? (accepting ? Infinity : 1) : items[i - 1] - gap
      let pos = items[i] + advance
      if (pos > limit) pos = limit
      if (pos > items[i] + 1e-7) moved = true
      if (pos > items[i]) items[i] = pos
    }
    while (items.length > 0 && items[0] >= 1) {
      if (!this.accepts(ctx.assembling)) {
        items[0] = 1
        break
      }
      items.shift()
      ctx.onDeliver(this, this.receive(ctx.assembling))
    }

    // Machine: one part per cycle; waits (phase 0) while the belt entry is packed.
    if (this.held && this.entryClear()) {
      this.held = false
      this.eject(ctx)
    }
    if (!this.held) {
      s.phase += (dt * this.rate) / 60
      while (s.phase >= 1) {
        s.phase -= 1
        if (this.entryClear()) {
          this.eject(ctx)
        } else {
          this.held = true
          s.phase = 0
          break
        }
      }
    }

    s.rate = this.held ? 0 : this.rate
    s.beltSpeed = moved ? this.belt : 0
    // 'blocked' = backed up all the way: the tower hopper is full and the packed
    // belt leaves the machine nowhere to put its part.
    const status: LineState['status'] = this.held && !this.accepts(ctx.assembling) ? 'blocked' : 'running'
    const changed = status !== s.status
    s.status = status
    return changed
  }
}
