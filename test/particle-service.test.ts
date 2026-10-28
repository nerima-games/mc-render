import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import { afterEach, vi } from 'vitest'
import {
  EntityIdSchema,
  WorldPositionSchema,
} from '@nerima-games/mc-kernel'
import {
  ParticleColorSchema,
  ParticleDirectionSchema,
  ParticleKindSchema,
  ParticleLifetimeSecondsSchema,
  ParticleRequestSchema,
  ParticleService,
  ParticleServiceLive,
  ParticleServicePoolAccess,
  type ParticleRequest,
  type ParticleKindDefaults,
  PARTICLE_KIND_DEFAULTS,
} from '../src/application/particle-service.js'
import {
  advanceParticles as advanceParticlesTypedResult,
  ParticleDeltaSecsSchema,
  ParticleFrameSnapshotSchema,
  ParticlePoolInputErrorSchema,
  readSlot,
  type ParticleFrameSnapshot,
  type ParticlePool,
} from '../src/domain/particle-pool.js'

const particlePoolMock = vi.hoisted(() => {
  const spawnOutcomes: Array<boolean | 'invalid-pool'> = []
  return { spawnOutcomes }
})

vi.mock('../src/domain/particle-pool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/domain/particle-pool.js')>()
  const effectModule = await import('effect')

  return {
    ...actual,
    spawnParticle: (...args: Parameters<typeof actual.spawnParticle>) => {
      const outcome = particlePoolMock.spawnOutcomes.shift()
      if (outcome === false) {
        return effectModule.Result.succeed(false)
      }
      if (outcome === 'invalid-pool') {
        return effectModule.Result.fail({
          _tag: 'ParticlePoolInputError',
          operation: 'spawn',
          reason: 'invalid-pool',
        })
      }
      return actual.spawnParticle(...args)
    },
  }
})

afterEach(() => {
  particlePoolMock.spawnOutcomes.length = 0
})

const FAST_CHECK_OPTIONS = { numRuns: 100, seed: 0x5eed }
const decodeParticleRequest = Schema.decodeUnknownResult(ParticleRequestSchema, {
  onExcessProperty: 'error',
})
const decodeDelta = Schema.decodeUnknownSync(ParticleDeltaSecsSchema)
const advanceParticlesResult = (
  pool: ParticlePool,
  dtSecs: number,
  frame?: ParticleFrameSnapshot,
): ReturnType<typeof advanceParticlesTypedResult> =>
  Function.prototype.apply.call(advanceParticlesTypedResult, undefined, [pool, dtSecs, frame])
const advanceParticles = (pool: ParticlePool, dtSecs: number, frame?: ParticleFrameSnapshot) =>
  Result.getOrThrow(advanceParticlesTypedResult(pool, decodeDelta(dtSecs), frame))

const isParticlePoolInputFailure = (
  error: unknown,
  operation: 'pool' | 'spawn' | 'request' | 'render-context',
  reason: 'invalid-capacity' | 'invalid-pool' | 'invalid-spawn' | 'invalid-request' | 'invalid-frame' | 'render-context-failed',
): boolean => {
  const decoded = Schema.decodeUnknownResult(ParticlePoolInputErrorSchema, {
    onExcessProperty: 'error',
  })(error)
  return Result.isSuccess(decoded) && decoded.success.operation === operation &&
    decoded.success.reason === reason
}

const position = (dimension: 'overworld' | 'nether' | 'end', x: number, y: number, z: number) =>
  Schema.decodeUnknownSync(WorldPositionSchema)({ dimension, x, y, z })

const particleRequest = (overrides: Partial<ParticleRequest> = {}): ParticleRequest => ({
  kind: 'block-break',
  position: position('overworld', 1, 2, 3),
  ...overrides,
})

describe('ParticleRequestSchema', () => {
  it.effect('accepts finite render-space request values and rejects invalid values', () =>
    Effect.sync(() => {
      const decodeKind = Schema.decodeUnknownResult(ParticleKindSchema)
      const decodeColor = Schema.decodeUnknownResult(ParticleColorSchema)
      const decodeDirection = Schema.decodeUnknownResult(ParticleDirectionSchema)
      const decodeLifetime = Schema.decodeUnknownResult(ParticleLifetimeSecondsSchema)
      const decodeRequest = decodeParticleRequest

      expect(Result.isSuccess(decodeKind('explosion'))).toBe(true)
      expect(Result.isFailure(decodeKind('smoke'))).toBe(true)
      expect(Result.isSuccess(decodeColor({ red: 0, green: 0.5, blue: 1 }))).toBe(true)
      expect(Result.isFailure(decodeColor({ red: 1.1, green: 0.5, blue: 1 }))).toBe(true)
      expect(Result.isSuccess(decodeDirection({ x: 0, y: -2, z: 1 }))).toBe(true)
      expect(Result.isFailure(decodeDirection({ x: Number.NaN, y: 0, z: 0 }))).toBe(true)
      expect(Result.isSuccess(decodeLifetime(0.25))).toBe(true)
      expect(Result.isFailure(decodeLifetime(0))).toBe(true)
      expect(Result.isFailure(decodeLifetime(10.1))).toBe(true)
      expect(Result.isFailure(decodeRequest({ kind: 'block-break', position: { x: 1, y: 2, z: 3 } }))).toBe(true)
    }),
  )

  it.effect('accepts the supported world and speed bounds, and rejects values outside them', () =>
    Effect.sync(() => {
      const maximumWorldCoordinate = 30_000_000
      const decodeRequest = decodeParticleRequest
      const base = { dimension: 'overworld', y: 0, z: 0 }

      expect(Result.isSuccess(decodeRequest({
        kind: 'block-break',
        position: { ...base, x: maximumWorldCoordinate },
        direction: { x: 32, y: 0, z: 0 },
        lifetimeSeconds: 10,
      }))).toBe(true)
      expect(Result.isFailure(decodeRequest({
        kind: 'block-break',
        position: { ...base, x: maximumWorldCoordinate + 1 },
      }))).toBe(true)
      expect(Result.isFailure(decodeRequest({
        kind: 'block-break',
        position: { ...base, x: 3.4028234663852886e38 },
        direction: { x: 1.7014117331926443e38, y: 0, z: 0 },
      }))).toBe(true)
      expect(Result.isFailure(decodeRequest({
        kind: 'block-break',
        position: { ...base, x: 0 },
        direction: { x: 32.01, y: 0, z: 0 },
      }))).toBe(true)
      expect(Result.isFailure(decodeRequest({
        kind: 'block-break',
        position: { ...base, x: 0 },
        lifetimeSeconds: 10.1,
      }))).toBe(true)
      expect(Result.isFailure(decodeRequest({
        kind: 'explosion',
        position: { ...base, x: 0 },
        direction: { x: 1.2e38, y: 0, z: 0 },
      }))).toBe(true)
    }),
  )

  it.effect('property: invalid request fields and extra fields fail the decoded Result', () =>
    Effect.sync(() => {
      const decode = decodeParticleRequest
      const validPosition = { dimension: 'overworld', x: 1, y: 2, z: 3 }

      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom<unknown>('spark', 'unknown', null, undefined, 3, {}),
          (kind) => Result.isFailure(decode({ kind, position: validPosition })),
        ),
        FAST_CHECK_OPTIONS,
      )

      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom<unknown>(
            Number.NaN,
            Number.POSITIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
            Number.MAX_VALUE,
            '1',
            null,
          ),
          (x) => Result.isFailure(decode({ kind: 'block-break', position: { ...validPosition, x } })),
        ),
        FAST_CHECK_OPTIONS,
      )

      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom<unknown>(Number.NaN, -0.01, 1.01, Number.POSITIVE_INFINITY, 'red'),
          (red) => Result.isFailure(decode({
            kind: 'block-break',
            position: validPosition,
            color: { red, green: 0.5, blue: 0.5 },
          })),
        ),
        FAST_CHECK_OPTIONS,
      )

      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom<unknown>(0, -1, Number.NaN, Number.POSITIVE_INFINITY, '0.2'),
          (lifetimeSeconds) => Result.isFailure(decode({
            kind: 'block-break',
            position: validPosition,
            lifetimeSeconds,
          })),
        ),
        FAST_CHECK_OPTIONS,
      )

      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom<unknown>(
            { x: Number.NaN, y: 0, z: 0 },
            { x: Number.POSITIVE_INFINITY, y: 0, z: 0 },
            { x: 1.2e38, y: 0, z: 0 },
            { x: 1, y: 0, z: 0, extra: 1 },
            'north',
          ),
          (direction) => Result.isFailure(decode({ kind: 'explosion', position: validPosition, direction })),
        ),
        FAST_CHECK_OPTIONS,
      )

      FastCheck.assert(
        FastCheck.property(FastCheck.integer(), (extra) =>
          Result.isFailure(decode({ kind: 'block-break', position: validPosition, extra }))
        ),
        FAST_CHECK_OPTIONS,
      )

      FastCheck.assert(
        FastCheck.property(FastCheck.integer(), (extra) =>
          Result.isFailure(decode({
            kind: 'block-break',
            position: { ...validPosition, extra },
          }))
        ),
        FAST_CHECK_OPTIONS,
      )
    }),
  )
})

describe('ParticleServiceLive', () => {
  it.effect('returns rejected when the pool declines the only spawn attempt', () =>
    Effect.gen(function* () {
      const service = yield* ParticleService
      const pool = yield* ParticleServicePoolAccess
      particlePoolMock.spawnOutcomes.push(false)

      expect(yield* service.spawn(particleRequest())).toBe(0)
      expect(pool.activeCount()).toBe(0)
      expect(particlePoolMock.spawnOutcomes).toStrictEqual([])
    }).pipe(Effect.provide(ParticleServiceLive({ pool: { capacity: 1 } }))),
  )

  it.effect('propagates a typed spawn failure from the pool', () =>
    Effect.gen(function* () {
      const service = yield* ParticleService
      particlePoolMock.spawnOutcomes.push('invalid-pool')

      const result = yield* Effect.result(service.spawn(particleRequest()))
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(isParticlePoolInputFailure(result.failure, 'spawn', 'invalid-pool')).toBe(true)
      }
    }).pipe(Effect.provide(ParticleServiceLive({ pool: { capacity: 1 } }))),
  )

  it.effect('keeps an accepted request when a later spawn attempt is declined', () =>
    Effect.gen(function* () {
      const service = yield* ParticleService
      const pool = yield* ParticleServicePoolAccess
      particlePoolMock.spawnOutcomes.push(true, false)

      expect(yield* service.spawn(particleRequest())).toBe(1)
      expect(pool.activeCount()).toBe(1)
      expect(readSlot(pool, 0)).toBeDefined()
      expect(readSlot(pool, 1)).toBeUndefined()
      expect(particlePoolMock.spawnOutcomes).toStrictEqual([])
    }).pipe(Effect.provide(ParticleServiceLive({ pool: { capacity: 2 } }))),
  )

  it.effect('fixes each kind default and applies unnormalized direction, lifetime, and tint overrides', () =>
    Effect.gen(function* () {
      const service = yield* ParticleService
      const pool = yield* ParticleServicePoolAccess
      const direction = Schema.decodeUnknownSync(ParticleDirectionSchema)({ x: 2, y: 0, z: -1 })
      const color = Schema.decodeUnknownSync(ParticleColorSchema)({ red: 0.2, green: 0.4, blue: 0.6 })
      const lifetimeSeconds = Schema.decodeUnknownSync(ParticleLifetimeSecondsSchema)(0.4)

      expect(PARTICLE_KIND_DEFAULTS).toStrictEqual({
        'block-break': {
          baseSpeedMPerSecond: 2,
          color: { blue: 1, green: 1, red: 1 },
          lifetimeSeconds: 0.5,
          particleCount: 6,
        },
        'entity-hit': {
          baseSpeedMPerSecond: 1.5,
          color: { blue: 0.25, green: 0.35, red: 1 },
          lifetimeSeconds: 0.5,
          particleCount: 4,
        },
        explosion: {
          baseSpeedMPerSecond: 3,
          color: { blue: 0.2, green: 0.55, red: 1 },
          lifetimeSeconds: 0.5,
          particleCount: 16,
        },
        'level-up': {
          baseSpeedMPerSecond: 1,
          color: { blue: 0.4, green: 1, red: 0.45 },
          lifetimeSeconds: 0.5,
          particleCount: 8,
        },
      } satisfies Readonly<Record<Schema.Schema.Type<typeof ParticleKindSchema>, ParticleKindDefaults>>)

      expect(yield* service.spawn(particleRequest({
        kind: 'explosion',
        position: position('overworld', 4, 5, 6),
        direction,
        color,
        lifetimeSeconds,
      }))).toBe(1)
      expect(pool.activeCount()).toBe(16)
      const spawned = readSlot(pool, 0)
      expect(spawned?.colorBlue).toBeCloseTo(0.6, 7)
      expect(spawned?.colorGreen).toBeCloseTo(0.4, 7)
      expect(spawned?.colorRed).toBeCloseTo(0.2, 7)
      expect(spawned?.initialLifetimeSecs).toBeCloseTo(0.4, 8)
      expect(spawned?.positionX).toBe(4)
      expect(spawned?.positionY).toBe(5)
      expect(spawned?.positionZ).toBe(6)
      expect(spawned?.velocityX).toBe(6)
      expect(spawned?.velocityY).toBe(0)
      expect(spawned?.velocityZ).toBe(-3)

      advanceParticles(pool, 0.1)
      expect(readSlot(pool, 0)?.remainingSecs).toBeCloseTo(0.3, 8)
      expect(readSlot(pool, 0)?.scale).toBeCloseTo(0.75, 8)
    }).pipe(Effect.provide(ParticleServiceLive({ pool: { capacity: 32 } }))),
  )

  it.effect('returns zero for dimension mismatch or a missing followed entity', () =>
    Effect.gen(function* () {
      const service = yield* ParticleService
      const pool = yield* ParticleServicePoolAccess
      const entityId = Schema.decodeUnknownSync(EntityIdSchema)('mob-1')

      expect(yield* service.spawn(particleRequest({
        position: position('nether', 1, 2, 3),
      }))).toBe(0)
      expect(yield* service.spawn(particleRequest({ followEntity: entityId }))).toBe(0)
      expect(pool.activeCount()).toBe(0)
    }).pipe(Effect.provide(ParticleServiceLive({ pool: { capacity: 8 } }))),
  )

  it.effect('property: invalid render contexts fail through the public typed error schema', () => {
    let frame: unknown = { dimension: 'overworld', entities: [] }
    return Effect.gen(function* () {
      const service = yield* ParticleService
      const pool = yield* ParticleServicePoolAccess
      const decodeFrame = Schema.decodeUnknownResult(ParticleFrameSnapshotSchema, {
        onExcessProperty: 'error',
      })
      const rejectsFrame = (candidate: unknown): boolean => {
        frame = candidate
        const decodedFrame = decodeFrame(candidate)
        const result = Effect.runSync(Effect.result(service.spawn(particleRequest())))
        return Result.isFailure(decodedFrame) && Result.isFailure(result) &&
          isParticlePoolInputFailure(result.failure, 'render-context', 'invalid-frame')
      }

      FastCheck.assert(
        FastCheck.property(FastCheck.integer(), (extra) => rejectsFrame({
          dimension: 'overworld',
          entities: [],
          extra,
        })),
        FAST_CHECK_OPTIONS,
      )

      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom<unknown>(
            { dimension: 'invalid', entities: [] },
            { dimension: 'overworld' },
            { dimension: 'overworld', entities: [{ id: 'mob-1', feetPosition: { x: Number.NaN, y: 0, z: 0 } }] },
          ),
          rejectsFrame,
        ),
        FAST_CHECK_OPTIONS,
      )
      expect(pool.activeCount()).toBe(0)
    }).pipe(Effect.provide(ParticleServiceLive({
      pool: { capacity: 4 },
      renderContext: () => frame as ParticleFrameSnapshot,
    })))
  })

  it.effect('maps a render-context callback exception to a typed failure', () =>
    Effect.gen(function* () {
      const service = yield* ParticleService
      const result = yield* Effect.result(service.spawn(particleRequest()))
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(isParticlePoolInputFailure(result.failure, 'render-context', 'render-context-failed')).toBe(true)
      }
    }).pipe(Effect.provide(ParticleServiceLive({
      pool: { capacity: 4 },
      renderContext: () => { throw new Error('snapshot unavailable') },
    }))),
  )

  it.effect('fails invalid request positions and computed velocities before writing buffers', () =>
    Effect.gen(function* () {
      const service = yield* ParticleService
      const pool = yield* ParticleServicePoolAccess
      const maximum = 30_000_000
      const justAbove = maximum + 1
      const accepted = yield* service.spawn(particleRequest({
        position: position('overworld', maximum, 0, 0),
      }))
      expect(accepted).toBe(1)
      expect(pool.positions[0]).toBe(maximum)
      const activeBeforeRejectedRequests = pool.activeCount()

      const invalidRequests = [
        particleRequest({
          position: position('overworld', justAbove, 0, 0),
        }),
        particleRequest({
          position: position('overworld', Number.MAX_VALUE, 0, 0),
        }),
        particleRequest({
          position: position('overworld', 1e39, 0, 0),
        }),
        particleRequest({
          kind: 'explosion',
          direction: Schema.decodeUnknownSync(ParticleDirectionSchema)({ x: 1e39, y: 0, z: 0 }),
        }),
        particleRequest({
          kind: 'explosion',
          direction: Schema.decodeUnknownSync(ParticleDirectionSchema)({ x: 1.2e38, y: 0, z: 0 }),
        }),
      ]
      for (const request of invalidRequests) {
        const result = yield* Effect.result(service.spawn(request))
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) {
          expect(isParticlePoolInputFailure(result.failure, 'request', 'invalid-request')).toBe(true)
        }
      }

      expect(pool.activeCount()).toBe(activeBeforeRejectedRequests)
      expect(Array.from(pool.positions).every(Number.isFinite)).toBe(true)
      expect(Array.from(pool.velocities).every(Number.isFinite)).toBe(true)
    }).pipe(Effect.provide(ParticleServiceLive({ pool: { capacity: 32 } }))),
  )

  it.effect('property: accepted requests stay finite across arbitrary advances', () =>
    Effect.sync(() => {
      const buffersStayFinite = (pool: ParticlePool): boolean =>
        [
          pool.colors,
          pool.initialLifetimesSecs,
          pool.lifetimesSecs,
          pool.positions,
          pool.scales,
          pool.uvOffsets,
          pool.velocities,
        ].every((buffer) => Array.from(buffer).every(Number.isFinite))

      FastCheck.assert(
        FastCheck.property(
          FastCheck.record({
            kind: FastCheck.constantFrom('block-break', 'entity-hit', 'explosion', 'level-up'),
            positionX: FastCheck.double({ min: -30_000_000, max: 30_000_000, noNaN: true }),
            positionY: FastCheck.double({ min: -30_000_000, max: 30_000_000, noNaN: true }),
            positionZ: FastCheck.double({ min: -30_000_000, max: 30_000_000, noNaN: true }),
            directionX: FastCheck.double({ min: -1, max: 1, noNaN: true }),
            directionY: FastCheck.double({ min: -1, max: 1, noNaN: true }),
            directionZ: FastCheck.double({ min: -1, max: 1, noNaN: true }),
            speed: FastCheck.double({ min: 0, max: 63.9, noNaN: true }),
            lifetimeSeconds: FastCheck.double({ min: 0.0001, max: 10, noNaN: true }),
            advanceSteps: FastCheck.array(
              FastCheck.double({ min: 0, max: 1e100, noNaN: true }),
              { maxLength: 256 },
            ),
          }),
          (candidate) => {
            const baseSpeed = PARTICLE_KIND_DEFAULTS[candidate.kind].baseSpeedMPerSecond
            const directionMagnitude = Math.hypot(
              candidate.directionX,
              candidate.directionY,
              candidate.directionZ,
            )
            let scale = 0
            if (directionMagnitude !== 0) {
              scale = candidate.speed / (directionMagnitude * baseSpeed)
            }
            const request = decodeParticleRequest({
              kind: candidate.kind,
              position: {
                dimension: 'overworld',
                x: candidate.positionX,
                y: candidate.positionY,
                z: candidate.positionZ,
              },
              direction: {
                x: candidate.directionX * scale,
                y: candidate.directionY * scale,
                z: candidate.directionZ * scale,
              },
              lifetimeSeconds: candidate.lifetimeSeconds,
            })
            if (Result.isFailure(request)) {
              return false
            }

            return Effect.runSync(Effect.gen(function* () {
              const service = yield* ParticleService
              const pool = yield* ParticleServicePoolAccess
              const spawned = yield* service.spawn(request.success)
              if (spawned === 0 || !buffersStayFinite(pool)) {
                return false
              }

              for (const dt of candidate.advanceSteps) {
                const advanced = advanceParticlesResult(pool, dt)
                if (Result.isFailure(advanced) || !buffersStayFinite(pool)) {
                  return false
                }
              }
              return true
            }).pipe(Effect.provide(ParticleServiceLive({ pool: { capacity: 32 } }))))
          },
        ),
        FAST_CHECK_OPTIONS,
      )
    }),
  )

  it.effect('invalid mutable request data fails before a pool slot is written', () =>
    Effect.gen(function* () {
      const service = yield* ParticleService
      const pool = yield* ParticleServicePoolAccess
      const request = particleRequest({
        color: Schema.decodeUnknownSync(ParticleColorSchema)({ red: 1, green: 0, blue: 0 }),
      })
      expect(Reflect.set(request, 'color', { red: 2, green: 0, blue: 0 })).toBe(true)

      const result = yield* Effect.result(service.spawn(request))
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(isParticlePoolInputFailure(result.failure, 'request', 'invalid-request')).toBe(true)
      }
      expect(pool.activeCount()).toBe(0)
    }).pipe(Effect.provide(ParticleServiceLive({ pool: { capacity: 4 } }))),
  )

  it.effect('rejects followed frames outside the supported world range', () =>
    Effect.gen(function* () {
      const service = yield* ParticleService
      const pool = yield* ParticleServicePoolAccess
      const entityId = Schema.decodeUnknownSync(EntityIdSchema)('mob-1')
      const result = yield* Effect.result(service.spawn(particleRequest({ followEntity: entityId })))

      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(isParticlePoolInputFailure(result.failure, 'render-context', 'invalid-frame')).toBe(true)
      }
      expect(pool.activeCount()).toBe(0)
    }).pipe(Effect.provide(ParticleServiceLive({
      pool: { capacity: 4 },
      renderContext: () => ({
        dimension: 'overworld',
        entities: [{ id: 'mob-1', feetPosition: { x: 30_000_001, y: 0, z: 0 } }],
      }),
    }))),
  )

  it.effect('propagates invalid pool construction as a typed layer failure', () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(Effect.provide(ParticleService, ParticleServiceLive({
        pool: { capacity: 0 },
      })))
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(isParticlePoolInputFailure(result.failure, 'pool', 'invalid-capacity')).toBe(true)
      }
    }),
  )

  it.effect('follows a render entity, then detaches at its last position and lives out its lifetime', () => {
    let frame: ParticleFrameSnapshot = {
      dimension: 'overworld',
      entities: [
        { id: 'mob-2', feetPosition: { x: 1, y: 2, z: 3 } },
        { id: 'mob-1', feetPosition: { x: 10, y: 20, z: 30 } },
      ],
    }
    const layer = ParticleServiceLive({
      pool: { capacity: 4 },
      renderContext: () => frame,
    })
    return Effect.gen(function* () {
      const service = yield* ParticleService
      const pool = yield* ParticleServicePoolAccess
      const entityId = Schema.decodeUnknownSync(EntityIdSchema)('mob-1')
      const direction = Schema.decodeUnknownSync(ParticleDirectionSchema)({ x: 1, y: 0, z: 0 })

      expect(yield* service.spawn(particleRequest({
        kind: 'entity-hit',
        followEntity: entityId,
        direction,
        position: position('overworld', 12, 22, 32),
        lifetimeSeconds: Schema.decodeUnknownSync(ParticleLifetimeSecondsSchema)(0.4),
      }))).toBe(1)
      expect(readSlot(pool, 0)?.followEntity).toBe('mob-1')

      frame = {
        dimension: 'overworld',
        entities: [{ id: 'mob-1', feetPosition: { x: 11, y: 21, z: 31 } }],
      }
      advanceParticles(pool, 0.1, frame)
      expect(readSlot(pool, 0)).toMatchObject({ positionX: 13, positionY: 23, positionZ: 33 })

      frame = { dimension: 'overworld', entities: [] }
      advanceParticles(pool, 0.1, frame)
      expect(readSlot(pool, 0)?.followEntity).toBeUndefined()
      expect(readSlot(pool, 0)?.positionX).toBe(13)
      advanceParticles(pool, 0.1, frame)
      expect(readSlot(pool, 0)?.positionX).toBeCloseTo(13.15, 6)
      expect(readSlot(pool, 0)?.remainingSecs).toBeCloseTo(0.1, 8)
    }).pipe(Effect.provide(layer))
  })

  it.effect('treats an accepted request as one and preserves oldest-live eviction at capacity', () =>
    Effect.gen(function* () {
      const service = yield* ParticleService
      const pool = yield* ParticleServicePoolAccess

      expect(yield* service.spawn(particleRequest())).toBe(1)
      expect(pool.activeCount()).toBe(1)
      expect(pool.evictionCount()).toBe(0)
      expect(readSlot(pool, 0)?.positionX).toBe(1)

      expect(yield* service.spawn(particleRequest({ position: position('overworld', 9, 8, 7) }))).toBe(1)
      expect(pool.activeCount()).toBe(1)
      expect(pool.evictionCount()).toBe(1)
      expect(readSlot(pool, 0)?.positionX).toBe(9)
    }).pipe(Effect.provide(ParticleServiceLive({ pool: { capacity: 1 } }))),
  )
})
