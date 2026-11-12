import { describe, expect, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import { Effect, Result, Schema } from 'effect'
import { DomainEventSchema, WorldPositionSchema } from '@nerima-games/mc-kernel'
import {
  COLOR_VISION_CORRECTIONS,
  DEFAULT_COLOR_FILTER_INPUT,
  ChunkMeshingWorkerFailureSchema,
  ChunkMeshingWorkerResponseSchema,
  ColorFilterInputSchema,
  ColorVisionCorrectionSchema,
  ColorVisionCoefficientSchema,
  UnderwaterColorStrengthSchema,
  ColorCorrectionShaderSourceSchema,
  PARTICLE_KIND_DEFAULTS,
  PARTICLE_KINDS,
  ChunkMeshingCauseTagSchema,
  LightningBoltInputSchema,
  LightningFlashSchema,
  LightningSeedSchema,
  LightningSequenceSchema,
  MeshingWorkerPoolFactoryOptionsSchema,
  MeshingWorkerPoolStartupError,
  HardwareConcurrencySchema,
  WorkerParallelismErrorSchema,
  WorkerParallelismInputSchema,
  WorkerCountSchema,
  WorkerFailureMessageSchema,
  WorkerIndexSchema,
  WorkerQueueCapacitySchema,
  AnimationSecondsSchema,
  AnimationClockInputErrorSchema,
  animationTimeSeconds,
  ParticleColorSchema,
  ParticleDirectionSchema,
  ParticleKindSchema,
  ParticleLifetimeSecondsSchema,
  ParticleRequestSchema,
  ParticleService,
  ParticleServiceLive,
  decodeColorFilterInput,
  decodeLightningBoltInput,
  decodeLightningFlash,
  makeHardwareConcurrency,
  makeWorkerCount,
  isColorFilterActive,
  makeColorCorrectionPass,
  makeColorCorrectionShader,
  planColorCorrection,
  planLightningBolt,
  particleRequestForDomainEvent,
  resolveWorkerParallelism,
  startMeshingWorkerPool,
  updateColorCorrectionPass,
  focusNavigationDirectionForCode,
  type BrowserInputOptions,
  type ClickLandingForTarget,
  type FocusNavigationDirection,
  type FocusNavigationHandler,
  type FocusTarget,
  type FocusTargetForElement,
  type ParticleColor,
  type ParticleDirection,
  type ParticleKind,
  type ParticleLifetimeSeconds,
  type ParticleRequest,
  type ParticleEventResult,
  type ParticleServiceApi,
  type ParticleServiceLiveOptions,
  type ColorCorrectionShader,
  type ColorCorrectionShaderSource,
  type ColorFilterInput,
  type ColorVisionCoefficient,
  type LightningBoltInput,
  type LightningFlash,
  type LightningSeed,
  type LightningSequence,
  type UnderwaterColorStrength,
  type MeshingWorkerPool,
  type MeshingWorkerPoolFactoryOptions,
  type ChunkMeshingCauseTag,
  type HardwareConcurrency,
  type WorkerCount,
  type WorkerFailureMessage,
  type WorkerIndex,
  type WorkerParallelismInput,
  type WorkerQueueCapacity,
  type ParticleEventContext,
} from '../src/index.js'

describe('public focus navigation and input DTO exports', () => {
  it('exports the focus DTO, host callbacks, and key-to-direction helper', () => {
    const focus = { group: 'hotbar', index: 3 } satisfies FocusTarget
    const direction: FocusNavigationDirection = 'right'
    const focusTargetForElement: FocusTargetForElement = (target) => {
      if (target === focus) {
        return focus
      }
      return undefined
    }
    const clickLandingForTarget: ClickLandingForTarget = (target) => {
      if (target === focus) {
        return 'ui'
      }
      return 'elsewhere'
    }
    const directions: Array<FocusNavigationDirection> = []
    const onFocusNavigationDirection: FocusNavigationHandler = (next) => directions.push(next)
    const browserOptions: Pick<
      BrowserInputOptions,
      'focusTargetForElement' | 'clickLandingForTarget' | 'onFocusNavigationDirection'
    > = { clickLandingForTarget, focusTargetForElement, onFocusNavigationDirection }

    expect(focusNavigationDirectionForCode('ArrowRight')).toBe(direction)
    expect(focusTargetForElement(focus)).toStrictEqual(focus)
    expect(clickLandingForTarget(focus)).toBe('ui')
    browserOptions.onFocusNavigationDirection?.('down')
    expect(directions).toStrictEqual(['down'])
  })
})

describe('public animation clock conversion', () => {
  it('exports the simulation-tick to seconds function', () => {
    expect(animationTimeSeconds({ partialTick: 0.5, simulationTick: 20, timeOfDayTicks: 100 })).toMatchObject({
      _tag: 'Success',
      success: 1.025,
    })
  })

  it('returns a finite time or a schema-checked failure for arbitrary input', () => {
    FastCheck.assert(
      FastCheck.property(FastCheck.anything(), (input) => {
        const result = animationTimeSeconds(input)
        if (Result.isFailure(result)) {
          return Result.isSuccess(Schema.decodeUnknownResult(AnimationClockInputErrorSchema)(result.failure))
        }
        return Result.isSuccess(Schema.decodeUnknownResult(AnimationSecondsSchema)(result.success))
      }),
    )
  })
})

describe('public particle request API', () => {
  it('exports the branded request DTOs and a usable Effect service layer', () => {
    const kind: ParticleKind = Schema.decodeUnknownSync(ParticleKindSchema)('explosion')
    const color: ParticleColor = Schema.decodeUnknownSync(ParticleColorSchema)({ red: 0.2, green: 0.4, blue: 0.6 })
    const direction: ParticleDirection = Schema.decodeUnknownSync(ParticleDirectionSchema)({ x: 2, y: 0, z: -1 })
    const lifetimeSeconds: ParticleLifetimeSeconds = Schema.decodeUnknownSync(ParticleLifetimeSecondsSchema)(0.4)
    const request: ParticleRequest = Schema.decodeUnknownSync(ParticleRequestSchema)({
      kind,
      position: { dimension: 'overworld', x: 1, y: 2, z: 3 },
      color,
      direction,
      lifetimeSeconds,
    })
    const options: ParticleServiceLiveOptions = { pool: { capacity: 32 } }
    const api: ParticleServiceApi = { spawn: () => Effect.succeed(1) }
    const accepted = Effect.runSync(
      Effect.gen(function* () {
        const particles = yield* ParticleService
        return yield* particles.spawn(request)
      }).pipe(Effect.provide(ParticleServiceLive(options))),
    )

    expect(PARTICLE_KIND_DEFAULTS[kind].particleCount).toBeGreaterThan(0)
    expect(PARTICLE_KINDS).toContain('fire')
    expect(PARTICLE_KINDS).toContain('smoke')
    expect(PARTICLE_KINDS).toContain('water-splash')
    expect(Effect.runSync(api.spawn(request))).toBe(1)
    expect(accepted).toBe(1)
  })

  it('exports the exhaustive C3 event mapper and entity-position context', () => {
    const pickedUp = Schema.decodeUnknownSync(DomainEventSchema)({
      _tag: 'ItemPickedUp',
      tick: 1,
      actor: 'player-1',
      source: { _tag: 'DroppedItem', id: 'drop-1' },
      item: 1,
      count: 1,
    })
    const position = Schema.decodeUnknownSync(WorldPositionSchema)({
      dimension: 'overworld',
      x: 1,
      y: 2,
      z: 3,
    })
    const context: ParticleEventContext = { positionOfEntity: () => position }

    const result: ParticleEventResult = particleRequestForDomainEvent(pickedUp, context)

    expect(result).toMatchObject({
      kind: 'level-up',
      position,
      followEntity: 'player-1',
    })
  })
})

describe('public color correction and lightning APIs', () => {
  it('decodes color settings strictly, plans the transform, and refreshes shader uniforms', () => {
    FastCheck.assert(FastCheck.property(
      FastCheck.constantFrom(...COLOR_VISION_CORRECTIONS),
      FastCheck.boolean(),
      (colorVisionCorrection, underwater) => {
        const input: ColorFilterInput = { colorVisionCorrection, underwater }
        const decoded = decodeColorFilterInput(input)
        return Result.isSuccess(decoded) &&
          isColorFilterActive(decoded.success) === (underwater || colorVisionCorrection !== 'off') &&
          planColorCorrection(decoded.success).underwaterStrength === Number(underwater)
      },
    ))

    expect(Schema.decodeUnknownSync(ColorVisionCorrectionSchema)('off')).toBe('off')
    expect(Result.isFailure(Schema.decodeUnknownResult(ColorVisionCorrectionSchema)('achromatopsia'))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(ColorFilterInputSchema, { onExcessProperty: 'error' })(
      { ...DEFAULT_COLOR_FILTER_INPUT, extra: true },
    ))).toBe(true)

    const input = { colorVisionCorrection: 'protanopia', underwater: true } as const
    const shader = makeColorCorrectionShader(input)
    class FakeShaderPass {
      readonly uniforms: ColorCorrectionShader['uniforms']
      constructor(value: ColorCorrectionShader) {
        this.uniforms = value.uniforms
      }
    }
    const pass = makeColorCorrectionPass(FakeShaderPass, input)
    updateColorCorrectionPass(pass, DEFAULT_COLOR_FILTER_INPUT)
    expect(shader.uniforms.uUnderwaterStrength.value).toBe(1)
    expect(pass.uniforms.uColorVisionRow0.value).toStrictEqual([1, 0, 0])
    expect(pass.uniforms.uUnderwaterStrength.value).toBe(0)

    const coefficient: ColorVisionCoefficient = Schema.decodeUnknownSync(ColorVisionCoefficientSchema)(1.25)
    const underwaterStrength: UnderwaterColorStrength = Schema.decodeUnknownSync(UnderwaterColorStrengthSchema)(1)
    const shaderSource: ColorCorrectionShaderSource = Schema.decodeUnknownSync(ColorCorrectionShaderSourceSchema)('void main() {}')
    expect(Number.isFinite(coefficient)).toBe(true)
    expect(underwaterStrength).toBe(1)
    expect(shaderSource).toContain('void main')
  })

  it('validates lightning input boundaries and preserves deterministic bolt endpoints', () => {
    const input: LightningBoltInput = Schema.decodeUnknownSync(LightningBoltInputSchema)({
      origin: { x: Number.MAX_VALUE, y: 0, z: -Number.MAX_VALUE },
      seed: 0,
      sequence: 1,
    })
    expect(Result.isSuccess(decodeLightningBoltInput(input))).toBe(true)
    expect(Result.isFailure(decodeLightningBoltInput({ ...input, origin: { ...input.origin, x: Infinity } }))).toBe(true)
    expect(Result.isFailure(decodeLightningBoltInput({ ...input, seed: 1.5 }))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(LightningBoltInputSchema, { onExcessProperty: 'error' })(
      { ...input, unexpected: true },
    ))).toBe(true)

    FastCheck.assert(FastCheck.property(FastCheck.integer(), FastCheck.nat(), (seed, sequence) => {
      const decodedInput = decodeLightningBoltInput({ origin: { x: 0, y: 0, z: 0 }, seed, sequence })
      if (Result.isFailure(decodedInput)) {
        return false
      }
      const plan = planLightningBolt(decodedInput.success)
      const [mainStrand] = plan.strands
      const mainStrandEnd = mainStrand?.[8]
      return plan.sequence === sequence &&
        plan.strands.length === 3 &&
        plan.strands.every((strand) => {
          const [first, ...tail] = strand
          const last = tail.at(-1)
          return strand.length === 9 &&
            first !== undefined && last !== undefined &&
            first.y === 32 && last.y === 0 &&
            strand.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z))
        }) &&
        mainStrandEnd !== undefined &&
        mainStrandEnd.x === 0 && mainStrandEnd.y === 0 && mainStrandEnd.z === 0
    }))

    const seed: LightningSeed = Schema.decodeUnknownSync(LightningSeedSchema)(0)
    const sequence: LightningSequence = Schema.decodeUnknownSync(LightningSequenceSchema)(0)
    const flash: LightningFlash = Schema.decodeUnknownSync(LightningFlashSchema)(1)
    expect(seed).toBe(0)
    expect(sequence).toBe(0)
    expect(Result.isSuccess(decodeLightningFlash(flash))).toBe(true)
  })
})

describe('public meshing worker APIs', () => {
  const workerCount = Schema.decodeUnknownSync(WorkerCountSchema)
  const hardwareConcurrency = Schema.decodeUnknownSync(HardwareConcurrencySchema)
  const queueCapacity = Schema.decodeUnknownSync(WorkerQueueCapacitySchema)
  const workerIndex = Schema.decodeUnknownSync(WorkerIndexSchema)

  it('exports strict worker schemas and resolves parallelism at its boundaries', () => {
    const oneWorkerCount: WorkerCount = workerCount(1)
    const concurrency: HardwareConcurrency = hardwareConcurrency(8)
    const capacity: WorkerQueueCapacity = queueCapacity(1)
    const index: WorkerIndex = workerIndex(0)
    const input: WorkerParallelismInput = {
      hardwareConcurrency: concurrency,
      workerCount: oneWorkerCount,
    }
    const causeTag: ChunkMeshingCauseTag = Schema.decodeUnknownSync(ChunkMeshingCauseTagSchema)('FiberFailure')
    const failureMessage: WorkerFailureMessage = Schema.decodeUnknownSync(WorkerFailureMessageSchema)('worker failed')

    expect(Schema.decodeUnknownResult(WorkerParallelismInputSchema, { onExcessProperty: 'error' })(input)).toMatchObject({
      _tag: 'Success',
      success: input,
    })
    expect(Result.isFailure(Schema.decodeUnknownResult(WorkerParallelismInputSchema, { onExcessProperty: 'error' })(
      { ...input, extra: true },
    ))).toBe(true)
    expect(Schema.decodeUnknownResult(ChunkMeshingCauseTagSchema)('FiberFailure')).toMatchObject({
      _tag: 'Success',
      success: causeTag,
    })
    expect(Result.isFailure(Schema.decodeUnknownResult(ChunkMeshingCauseTagSchema)(42))).toBe(true)
    expect(Schema.decodeUnknownResult(WorkerFailureMessageSchema)('worker failed')).toMatchObject({
      _tag: 'Success',
      success: failureMessage,
    })
    expect(Result.isFailure(Schema.decodeUnknownResult(WorkerFailureMessageSchema)(42))).toBe(true)

    expect(capacity).toBe(1)
    expect(Result.isFailure(Schema.decodeUnknownResult(WorkerQueueCapacitySchema)(0))).toBe(true)
    expect(index).toBe(0)
    expect(Result.isFailure(Schema.decodeUnknownResult(WorkerIndexSchema)(-1))).toBe(true)

    FastCheck.assert(FastCheck.property(FastCheck.integer({ min: 1, max: 64 }), (candidateCount) => {
      const madeCount = makeWorkerCount(candidateCount)
      const madeConcurrency = makeHardwareConcurrency(candidateCount)
      return Result.isSuccess(madeCount) && madeCount.success === workerCount(candidateCount) &&
        Result.isSuccess(madeConcurrency) && madeConcurrency.success === hardwareConcurrency(candidateCount)
    }))

    expect(Result.isSuccess(Schema.decodeUnknownResult(MeshingWorkerPoolFactoryOptionsSchema, {
      onExcessProperty: 'error',
    })({ workerCount: 1, maxQueued: 1 }))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(MeshingWorkerPoolFactoryOptionsSchema)(
      { workerCount: 0 },
    ))).toBe(true)
    expect(Result.isSuccess(Schema.decodeUnknownResult(ChunkMeshingWorkerFailureSchema)({
      _tag: 'ChunkMeshingWorkerFailure',
      reason: 'mesh-failed',
    }))).toBe(true)
    expect(Result.isSuccess(Schema.decodeUnknownResult(ChunkMeshingWorkerResponseSchema)({
      id: 1,
      result: {
        _tag: 'meshed',
        layers: { opaque: [], water: [], transparentSolid: [], crossPlants: [], fluids: [], specialBlocks: [] },
      },
    }))).toBe(true)
    expect(Result.isSuccess(Schema.decodeUnknownResult(WorkerParallelismErrorSchema)({
      _tag: 'WorkerParallelismError',
      reason: 'missing-hardware-concurrency',
    }))).toBe(true)

    FastCheck.assert(FastCheck.property(FastCheck.integer({ min: 1, max: 64 }), (candidateCount) => {
      const result = resolveWorkerParallelism({ workerCount: workerCount(candidateCount) })
      return Result.isSuccess(result) && result.success === candidateCount
    }))
    expect(resolveWorkerParallelism({ hardwareConcurrency: hardwareConcurrency(1) })).toMatchObject({
      _tag: 'Success', success: 1,
    })
    expect(makeWorkerCount(0)).toMatchObject({
      _tag: 'Failure', failure: { _tag: 'WorkerParallelismError', reason: 'invalid-worker-count' },
    })
    expect(makeWorkerCount(1.5)).toMatchObject({
      _tag: 'Failure', failure: { _tag: 'WorkerParallelismError', reason: 'invalid-worker-count' },
    })
    expect(makeHardwareConcurrency(0)).toMatchObject({
      _tag: 'Failure', failure: { _tag: 'WorkerParallelismError', reason: 'invalid-hardware-concurrency' },
    })
    expect(makeHardwareConcurrency(1.5)).toMatchObject({
      _tag: 'Failure', failure: { _tag: 'WorkerParallelismError', reason: 'invalid-hardware-concurrency' },
    })
    expect(Result.isSuccess(Schema.decodeUnknownResult(ChunkMeshingWorkerFailureSchema)({
      _tag: 'ChunkMeshingWorkerFailure',
      reason: 'mesh-failed',
      causeTag,
    }))).toBe(true)
    expect(MeshingWorkerPoolStartupError.name).toBe('MeshingWorkerPoolStartupError')
    expect(typeof startMeshingWorkerPool).toBe('function')
  })

  it('starts a host-provided pool without requiring browser globals in the root entry', () => {
    let terminated = false
    const options: MeshingWorkerPoolFactoryOptions = {
      workerCount: workerCount(1),
      createWorker: () => ({
        addEventListener: () => undefined,
        postMessage: () => undefined,
        terminate: () => { terminated = true },
      }),
    }
    const pool: MeshingWorkerPool = Effect.runSync(startMeshingWorkerPool(options))
    expect(pool.concurrency).toBe(1)
    Effect.runSync(pool.shutdown)
    expect(terminated).toBe(true)
  })
})
