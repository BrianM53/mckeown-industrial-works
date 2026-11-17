/**
 * TEST DOUBLE for the Web Audio API (jsdom has none). Only imported by tests.
 *
 * Enforces the invariants real browsers enforce, so bugs fail loudly here:
 *   - AudioParam automation with non-finite values → TypeError
 *   - exponentialRampToValueAtTime to ≤ 0 → RangeError; negative times → RangeError
 *   - start() twice / stop() before start() → InvalidStateError
 * and records what happened (param events, source start/stop times,
 * connections, created node counts) for assertions.
 */

export type ParamEvent = { type: string; value: number; time: number; extra?: number }

export class FakeParam {
  private v: number
  readonly events: ParamEvent[] = []
  inputs = 0
  constructor(
    readonly defaultValue: number,
    readonly name = 'param',
  ) {
    this.v = defaultValue
  }
  get value(): number {
    return this.v
  }
  set value(x: number) {
    if (!Number.isFinite(x)) throw new TypeError(`${this.name}.value = ${x}`)
    this.v = x
  }
  private check(v: number, t: number) {
    if (!Number.isFinite(v) || !Number.isFinite(t)) throw new TypeError(`${this.name}: non-finite automation (${v} @ ${t})`)
    if (t < 0) throw new RangeError(`${this.name}: negative time ${t}`)
  }
  setValueAtTime(v: number, t: number) {
    this.check(v, t)
    this.events.push({ type: 'set', value: v, time: t })
    return this
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.check(v, t)
    this.events.push({ type: 'linear', value: v, time: t })
    return this
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.check(v, t)
    if (v <= 0) throw new RangeError(`${this.name}: exponential ramp to ${v}`)
    this.events.push({ type: 'exp', value: v, time: t })
    return this
  }
  setTargetAtTime(v: number, t: number, tc: number) {
    this.check(v, t)
    if (!Number.isFinite(tc) || tc < 0) throw new RangeError(`${this.name}: bad time constant ${tc}`)
    this.events.push({ type: 'target', value: v, time: t, extra: tc })
    return this
  }
  setValueCurveAtTime(values: ArrayLike<number>, t: number, d: number) {
    this.check(values[values.length - 1] ?? 0, t)
    this.events.push({ type: 'curve', value: values[values.length - 1] ?? 0, time: t, extra: d })
    return this
  }
  cancelScheduledValues(t: number) {
    this.check(0, t)
    this.events.push({ type: 'cancel', value: Number.NaN, time: t })
    return this
  }
  cancelAndHoldAtTime(t: number) {
    return this.cancelScheduledValues(t)
  }
  /** Most recent scheduled target value (ignores cancels). */
  lastValue(): number {
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].type !== 'cancel') return this.events[i].value
    return this.value
  }
}

let nodeSerial = 0

export class FakeNode {
  readonly id = ++nodeSerial
  readonly outputs: (FakeNode | FakeParam)[] = []
  inputs = 0
  disconnected = false
  channelCount = 2
  constructor(
    readonly context: FakeAudioContext,
    readonly kind: string,
  ) {
    context.created[kind] = (context.created[kind] ?? 0) + 1
    context.allNodes.push(this)
  }
  connect<T extends FakeNode | FakeParam>(dest: T): T {
    if (!(dest instanceof FakeNode) && !(dest instanceof FakeParam)) throw new TypeError('connect: invalid destination')
    if (dest instanceof FakeNode && dest.context !== this.context) throw new Error('connect: different context')
    this.outputs.push(dest)
    dest.inputs++
    return dest
  }
  disconnect() {
    this.disconnected = true
    for (const o of this.outputs) o.inputs--
    this.outputs.length = 0
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1, 'gain')
  constructor(c: FakeAudioContext) {
    super(c, 'gain')
  }
}

export class FakeSource extends FakeNode {
  startTime: number | null = null
  stopTime: number | null = null
  onended: (() => void) | null = null
  start(when = 0) {
    if (this.startTime !== null) throw new Error('InvalidStateError: start() called twice')
    if (!Number.isFinite(when) || when < 0) throw new RangeError(`start(${when})`)
    this.startTime = when
    this.context.sources.push(this)
  }
  stop(when = 0) {
    if (this.startTime === null) throw new Error('InvalidStateError: stop() before start()')
    if (!Number.isFinite(when) || when < 0) throw new RangeError(`stop(${when})`)
    this.stopTime = when
  }
}

export class FakeOscillator extends FakeSource {
  type: OscillatorType = 'sine'
  frequency = new FakeParam(440, 'frequency')
  detune = new FakeParam(0, 'detune')
  periodicWave: unknown = null
  constructor(c: FakeAudioContext) {
    super(c, 'oscillator')
  }
  setPeriodicWave(w: unknown) {
    this.periodicWave = w
    this.type = 'custom'
  }
}

export class FakeBuffer {
  readonly numberOfChannels: number
  readonly length: number
  readonly sampleRate: number
  private data: Float32Array[]
  constructor(channels: number, length: number, sampleRate: number) {
    if (sampleRate < 3000 || sampleRate > 768000) throw new Error(`NotSupportedError: sampleRate ${sampleRate}`)
    if (!(length > 0)) throw new Error(`NotSupportedError: length ${length}`)
    this.numberOfChannels = channels
    this.length = length
    this.sampleRate = sampleRate
    this.data = Array.from({ length: channels }, () => new Float32Array(length))
  }
  get duration() {
    return this.length / this.sampleRate
  }
  getChannelData(c: number) {
    return this.data[c]
  }
}

export class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null
  loop = false
  loopStart = 0
  loopEnd = 0
  playbackRate = new FakeParam(1, 'playbackRate')
  detune = new FakeParam(0, 'detune')
  offset = 0
  constructor(c: FakeAudioContext) {
    super(c, 'bufferSource')
  }
  override start(when = 0, offset = 0) {
    if (!Number.isFinite(offset) || offset < 0) throw new RangeError(`start offset ${offset}`)
    this.offset = offset
    super.start(when)
  }
}

export class FakeBiquad extends FakeNode {
  type: BiquadFilterType = 'lowpass'
  frequency = new FakeParam(350, 'frequency')
  Q = new FakeParam(1, 'Q')
  gain = new FakeParam(0, 'gain')
  detune = new FakeParam(0, 'detune')
  constructor(c: FakeAudioContext) {
    super(c, 'biquad')
  }
}

export class FakePanner extends FakeNode {
  panningModel: PanningModelType = 'equalpower'
  distanceModel: DistanceModelType = 'inverse'
  refDistance = 1
  rolloffFactor = 1
  maxDistance = 10000
  coneInnerAngle = 360
  coneOuterAngle = 360
  coneOuterGain = 0
  positionX = new FakeParam(0, 'positionX')
  positionY = new FakeParam(0, 'positionY')
  positionZ = new FakeParam(0, 'positionZ')
  orientationX = new FakeParam(1, 'orientationX')
  orientationY = new FakeParam(0, 'orientationY')
  orientationZ = new FakeParam(0, 'orientationZ')
  constructor(c: FakeAudioContext) {
    super(c, 'panner')
  }
}

export class FakeStereoPanner extends FakeNode {
  pan = new FakeParam(0, 'pan')
  constructor(c: FakeAudioContext) {
    super(c, 'stereoPanner')
  }
}

export class FakeCompressor extends FakeNode {
  threshold = new FakeParam(-24, 'threshold')
  knee = new FakeParam(30, 'knee')
  ratio = new FakeParam(12, 'ratio')
  attack = new FakeParam(0.003, 'attack')
  release = new FakeParam(0.25, 'release')
  reduction = 0
  constructor(c: FakeAudioContext) {
    super(c, 'compressor')
  }
}

export class FakeShaper extends FakeNode {
  curve: Float32Array | null = null
  oversample: OverSampleType = 'none'
  constructor(c: FakeAudioContext) {
    super(c, 'waveShaper')
  }
}

export class FakeConvolver extends FakeNode {
  buffer: FakeBuffer | null = null
  normalize = true
  constructor(c: FakeAudioContext) {
    super(c, 'convolver')
  }
}

export class FakeDelay extends FakeNode {
  delayTime: FakeParam
  constructor(
    c: FakeAudioContext,
    readonly maxDelayTime: number,
  ) {
    super(c, 'delay')
    this.delayTime = new FakeParam(0, 'delayTime')
  }
}

export class FakeListener {
  positionX = new FakeParam(0, 'listener.positionX')
  positionY = new FakeParam(0, 'listener.positionY')
  positionZ = new FakeParam(0, 'listener.positionZ')
  forwardX = new FakeParam(0, 'listener.forwardX')
  forwardY = new FakeParam(0, 'listener.forwardY')
  forwardZ = new FakeParam(-1, 'listener.forwardZ')
  upX = new FakeParam(0, 'listener.upX')
  upY = new FakeParam(1, 'listener.upY')
  upZ = new FakeParam(0, 'listener.upZ')
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  state: AudioContextState = 'suspended'
  currentTime = 0
  readonly sampleRate: number
  readonly created: Record<string, number> = {}
  readonly allNodes: FakeNode[] = []
  readonly sources: FakeSource[] = []
  readonly destination: FakeNode
  readonly listener = new FakeListener()
  resumeCalls = 0
  suspendCalls = 0
  closeCalls = 0
  onstatechange: (() => void) | null = null

  constructor(opts?: { sampleRate?: number }) {
    this.sampleRate = opts?.sampleRate ?? 48000
    this.destination = new FakeNode(this, 'destination')
    FakeAudioContext.instances.push(this)
  }

  resume(): Promise<void> {
    this.resumeCalls++
    if (this.state !== 'closed') this.state = 'running'
    return Promise.resolve()
  }
  suspend(): Promise<void> {
    this.suspendCalls++
    if (this.state !== 'closed') this.state = 'suspended'
    return Promise.resolve()
  }
  close(): Promise<void> {
    this.closeCalls++
    this.state = 'closed'
    return Promise.resolve()
  }
  addEventListener() {}
  removeEventListener() {}

  createGain() {
    return new FakeGain(this)
  }
  createOscillator() {
    return new FakeOscillator(this)
  }
  createBufferSource() {
    return new FakeBufferSource(this)
  }
  createBiquadFilter() {
    return new FakeBiquad(this)
  }
  createPanner() {
    return new FakePanner(this)
  }
  createStereoPanner() {
    return new FakeStereoPanner(this)
  }
  createDynamicsCompressor() {
    return new FakeCompressor(this)
  }
  createWaveShaper() {
    return new FakeShaper(this)
  }
  createConvolver() {
    return new FakeConvolver(this)
  }
  createDelay(max = 1) {
    return new FakeDelay(this, max)
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new FakeBuffer(channels, length, sampleRate)
  }
  createPeriodicWave(real: Float32Array, imag: Float32Array) {
    if (real.length !== imag.length) throw new Error('IndexSizeError: periodic wave arrays differ')
    return { real, imag }
  }

  /** Advance the clock (tests). */
  advance(seconds: number) {
    if (this.state === 'running') this.currentTime += seconds
  }

  liveSources(at = this.currentTime): FakeSource[] {
    return this.sources.filter((s) => s.stopTime === null || s.stopTime > at)
  }
}

/** Cast helper: use the fake where a real BaseAudioContext / AudioContext is expected. */
export function asCtx(c: FakeAudioContext): AudioContext {
  return c as unknown as AudioContext
}
