import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
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
  advanceParticles,
  readSlot,
  type ParticleFrameSnapshot,
} from '../src/domain/particle-pool.js'

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
      const decodeRequest = Schema.decodeUnknownResult(ParticleRequestSchema)

      expect(Result.isSuccess(decodeKind('explosion'))).toBe(true)
      expect(Result.isFailure(decodeKind('smoke'))).toBe(true)
      expect(Result.isSuccess(decodeColor({ red: 0, green: 0.5, blue: 1 }))).toBe(true)
      expect(Result.isFailure(decodeColor({ red: 1.1, green: 0.5, blue: 1 }))).toBe(true)
      expect(Result.isSuccess(decodeDirection({ x: 0, y: -2, z: 1 }))).toBe(true)
      expect(Result.isFailure(decodeDirection({ x: Number.NaN, y: 0, z: 0 }))).toBe(true)
      expect(Result.isSuccess(decodeLifetime(0.25))).toBe(true)
      expect(Result.isFailure(decodeLifetime(0))).toBe(true)
      expect(Result.isFailure(decodeRequest({ kind: 'block-break', position: { x: 1, y: 2, z: 3 } }))).toBe(true)
    }),
  )
})

describe('ParticleServiceLive', () => {
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

  it.effect('returns zero when finite followed positions produce an overflowing offset', () =>
    Effect.gen(function* () {
      const service = yield* ParticleService
      const pool = yield* ParticleServicePoolAccess
      const maximum = Number.MAX_VALUE
      const request = Schema.decodeUnknownSync(ParticleRequestSchema)({
        kind: 'entity-hit',
        position: { dimension: 'overworld', x: maximum, y: 0, z: 0 },
        followEntity: 'mob-1',
      })
      const target = { x: -maximum, y: 0, z: 0 }

      expect(Number.isFinite(request.position.x)).toBe(true)
      expect(Number.isFinite(target.x)).toBe(true)
      expect(Number.isFinite(request.position.x - target.x)).toBe(false)
      expect(yield* service.spawn(request)).toBe(0)
      expect(pool.activeCount()).toBe(0)
    }).pipe(Effect.provide(ParticleServiceLive({
      pool: { capacity: 4 },
      renderContext: () => ({
        dimension: 'overworld',
        entities: [{ id: 'mob-1', feetPosition: { x: -Number.MAX_VALUE, y: 0, z: 0 } }],
      }),
    }))),
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
