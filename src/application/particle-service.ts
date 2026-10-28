import { Brand, Context, Effect, Layer, Result, Schema } from 'effect'
import {
  type EntityId,
  EntityIdSchema,
  type WorldPosition,
  WorldPositionSchema,
} from '@nerima-games/mc-kernel'
import {
  PARTICLE_LIFETIME_SECS,
  type ParticleFrameSnapshot,
  type ParticlePool,
  type ParticlePoolInputError,
  type ParticlePoolOptions,
  type ParticleSpawnSpec,
  ParticleFrameSnapshotSchema,
  makeParticlePool,
  spawnParticle,
} from '../domain/particle-pool.js'

export type ParticleKind = 'block-break' | 'entity-hit' | 'explosion' | 'level-up'

const MINIMUM_PARTICLE_LIFETIME_SECONDS = 0
const PARTICLE_REQUEST_REJECTED = 0
const PARTICLE_REQUEST_ACCEPTED = 1
const PARTICLE_LOOP_STEP = 1
const MAX_PARTICLE_FLOAT32_VALUE = 3.4028234663852886e38

const isParticleFloat32Vector = (x: number, y: number, z: number): boolean =>
  Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= MAX_PARTICLE_FLOAT32_VALUE

export const ParticleKindSchema: Schema.Codec<ParticleKind> = Schema.Literals([
  'block-break',
  'entity-hit',
  'explosion',
  'level-up',
])

export type ParticleColorChannel = Brand.Branded<number, 'ParticleColorChannel'>

export const ParticleColorChannelSchema: Schema.Codec<ParticleColorChannel, number> = Schema.Finite
  .check(Schema.isBetween({ maximum: 1, minimum: 0 }))
  .pipe(Schema.brand('ParticleColorChannel'))

export type ParticleColor = Readonly<{
  readonly red: ParticleColorChannel
  readonly green: ParticleColorChannel
  readonly blue: ParticleColorChannel
}>

export const ParticleColorSchema: Schema.Codec<ParticleColor, Readonly<{
  readonly red: number
  readonly green: number
  readonly blue: number
}>> = Schema.Struct({
  blue: ParticleColorChannelSchema,
  green: ParticleColorChannelSchema,
  red: ParticleColorChannelSchema,
})

export type ParticleDirection = Brand.Branded<Readonly<{
  readonly x: number
  readonly y: number
  readonly z: number
}>, 'ParticleDirection'>

export const ParticleDirectionSchema: Schema.Codec<ParticleDirection, Readonly<{
  readonly x: number
  readonly y: number
  readonly z: number
}>> = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  z: Schema.Finite,
}).pipe(Schema.brand('ParticleDirection'))

export type ParticleLifetimeSeconds = Brand.Branded<number, 'ParticleLifetimeSeconds'>

export const ParticleLifetimeSecondsSchema: Schema.Codec<ParticleLifetimeSeconds, number> = Schema.Finite
  .check(Schema.isGreaterThan(MINIMUM_PARTICLE_LIFETIME_SECONDS))
  .pipe(Schema.brand('ParticleLifetimeSeconds'))

export type ParticleRequest = Readonly<{
  readonly kind: ParticleKind
  readonly position: WorldPosition
  readonly color?: ParticleColor | undefined
  readonly lifetimeSeconds?: ParticleLifetimeSeconds | undefined
  readonly direction?: ParticleDirection | undefined
  readonly followEntity?: EntityId | undefined
}>

type ParticleRequestEncoded = Readonly<{
  readonly kind: ParticleKind
  readonly position: Schema.Codec.Encoded<typeof WorldPositionSchema>
  readonly color?: Schema.Codec.Encoded<typeof ParticleColorSchema> | undefined
  readonly lifetimeSeconds?: Schema.Codec.Encoded<typeof ParticleLifetimeSecondsSchema> | undefined
  readonly direction?: Schema.Codec.Encoded<typeof ParticleDirectionSchema> | undefined
  readonly followEntity?: Schema.Codec.Encoded<typeof EntityIdSchema> | undefined
}>

export type ParticleKindDefaults = Readonly<{
  readonly color: Readonly<{ readonly red: number; readonly green: number; readonly blue: number }>
  readonly baseSpeedMPerSecond: number
  readonly particleCount: number
  readonly lifetimeSeconds: number
}>

export const PARTICLE_KIND_DEFAULTS: Readonly<Record<ParticleKind, ParticleKindDefaults>> = {
  'block-break': {
    baseSpeedMPerSecond: 2,
    color: { blue: 1, green: 1, red: 1 },
    lifetimeSeconds: PARTICLE_LIFETIME_SECS,
    particleCount: 6,
  },
  'entity-hit': {
    baseSpeedMPerSecond: 1.5,
    color: { blue: 0.25, green: 0.35, red: 1 },
    lifetimeSeconds: PARTICLE_LIFETIME_SECS,
    particleCount: 4,
  },
  explosion: {
    baseSpeedMPerSecond: 3,
    color: { blue: 0.2, green: 0.55, red: 1 },
    lifetimeSeconds: PARTICLE_LIFETIME_SECS,
    particleCount: 16,
  },
  'level-up': {
    baseSpeedMPerSecond: 1,
    color: { blue: 0.4, green: 1, red: 0.45 },
    lifetimeSeconds: PARTICLE_LIFETIME_SECS,
    particleCount: 8,
  },
}

export type ParticleServiceApi = {
  readonly spawn: (request: ParticleRequest) => Effect.Effect<
    typeof PARTICLE_REQUEST_REJECTED | typeof PARTICLE_REQUEST_ACCEPTED,
    ParticlePoolInputError
  >
}

const ParticleServiceBase: Context.ServiceClass<
  ParticleService,
  'mc-render/application/ParticleService',
  ParticleServiceApi
> = Context.Service<ParticleService, ParticleServiceApi>()('mc-render/application/ParticleService')

export class ParticleService extends ParticleServiceBase {}

const ParticleServicePoolAccessBase: Context.ServiceClass<
  ParticleServicePoolAccess,
  'mc-render/application/ParticlePoolAccess',
  ParticlePool
> = Context.Service<ParticleServicePoolAccess, ParticlePool>()('mc-render/application/ParticlePoolAccess')

/** Internal companion service so production composition shares the layer-owned pool. */
export class ParticleServicePoolAccess extends ParticleServicePoolAccessBase {}

export type ParticleServiceLiveOptions = Readonly<{
  readonly pool?: ParticlePoolOptions | undefined
  readonly renderContext?: (() => ParticleFrameSnapshot) | undefined
}>

const isParticleRequestFloat32Safe = (request: ParticleRequest): boolean => {
  const { direction, position } = request
  if (!isParticleFloat32Vector(position.x, position.y, position.z)) {
    return false
  }
  if (direction === undefined) {
    return true
  }
  const speed = PARTICLE_KIND_DEFAULTS[request.kind].baseSpeedMPerSecond
  return isParticleFloat32Vector(direction.x, direction.y, direction.z) &&
    isParticleFloat32Vector(direction.x * speed, direction.y * speed, direction.z * speed)
}

export const ParticleRequestSchema: Schema.Codec<ParticleRequest, ParticleRequestEncoded> = Schema.Struct({
  color: Schema.optional(ParticleColorSchema),
  direction: Schema.optional(ParticleDirectionSchema),
  followEntity: Schema.optional(EntityIdSchema),
  kind: ParticleKindSchema,
  lifetimeSeconds: Schema.optional(ParticleLifetimeSecondsSchema),
  position: WorldPositionSchema,
}).check(Schema.makeFilter<ParticleRequest>((request) =>
  isParticleRequestFloat32Safe(request) || 'Particle positions and velocities must fit Float32 buffers'
))

const EMPTY_RENDER_CONTEXT: ParticleFrameSnapshot = { dimension: 'overworld', entities: [] }
const decodeParticleFrameSnapshot = Schema.decodeUnknownResult(ParticleFrameSnapshotSchema, {
  onExcessProperty: 'error',
})

const followLinkFor = (
  request: ParticleRequest,
  context: ParticleFrameSnapshot,
): ParticleSpawnSpec['follow'] => {
  const entityId: EntityId | undefined = request.followEntity
  if (entityId === undefined) {
    return undefined
  }
  for (const entity of context.entities) {
    if (entity.id === entityId) {
      return {
        id: entity.id,
        x: entity.feetPosition.x,
        y: entity.feetPosition.y,
        z: entity.feetPosition.z,
      }
    }
  }
  return undefined
}

const velocityFor = (
  direction: ParticleDirection | undefined,
  speed: number,
): ParticleSpawnSpec['velocity'] => {
  if (direction === undefined) {
    return undefined
  }
  return {
    x: direction.x * speed,
    y: direction.y * speed,
    z: direction.z * speed,
  }
}

const particleSpawnSpecFor = (
  request: ParticleRequest,
  defaults: ParticleKindDefaults,
  follow: ParticleSpawnSpec['follow'],
): ParticleSpawnSpec => {
  const { direction, position } = request
  const velocity = velocityFor(direction, defaults.baseSpeedMPerSecond)
  return {
    dimension: position.dimension,
    follow,
    lifetimeSecs: request.lifetimeSeconds ?? defaults.lifetimeSeconds,
    positionX: position.x,
    positionY: position.y,
    positionZ: position.z,
    tint: request.color ?? defaults.color,
    uvU: 0,
    uvV: 0,
    velocity,
  }
}

const spawnParticles = (
  pool: ParticlePool,
  spawn: ParticleSpawnSpec,
  requestedCount: number,
): Result.Result<
  typeof PARTICLE_REQUEST_REJECTED | typeof PARTICLE_REQUEST_ACCEPTED,
  ParticlePoolInputError
> => {
  const count = Math.min(requestedCount, pool.capacity)
  let accepted = false
  for (let particle = 0; particle < count; particle += PARTICLE_LOOP_STEP) {
    const result = spawnParticle(pool, spawn)
    if (Result.isFailure(result)) {
      return Result.fail(result.failure)
    }
    accepted = result.success || accepted
  }
  return Result.succeed(accepted ? PARTICLE_REQUEST_ACCEPTED : PARTICLE_REQUEST_REJECTED)
}

const spawnParticleRequest = (
  pool: ParticlePool,
  request: ParticleRequest,
  context: ParticleFrameSnapshot,
): Result.Result<
  typeof PARTICLE_REQUEST_REJECTED | typeof PARTICLE_REQUEST_ACCEPTED,
  ParticlePoolInputError
> => {
  if (request.position.dimension !== context.dimension) {
    return Result.succeed(PARTICLE_REQUEST_REJECTED)
  }

  const follow = followLinkFor(request, context)
  if (request.followEntity !== undefined && follow === undefined) {
    return Result.succeed(PARTICLE_REQUEST_REJECTED)
  }

  const defaults = PARTICLE_KIND_DEFAULTS[request.kind]
  const spawn = particleSpawnSpecFor(request, defaults, follow)
  return spawnParticles(pool, spawn, defaults.particleCount)
}

const makeParticleService = (
  pool: ParticlePool,
  readRenderContext: () => ParticleFrameSnapshot,
): ParticleServiceApi => ({
  spawn: (request) => Effect.suspend(() => {
    const decoded = Schema.decodeUnknownResult(ParticleRequestSchema, {
      onExcessProperty: 'error',
    })(request)
    if (Result.isFailure(decoded)) {
      return Effect.fail({
        _tag: 'ParticlePoolInputError',
        operation: 'request',
        reason: 'invalid-request',
      } satisfies ParticlePoolInputError)
    }
    return Effect.try({
      try: () => decodeParticleFrameSnapshot(readRenderContext()),
      catch: () => ({
        _tag: 'ParticlePoolInputError',
        operation: 'render-context',
        reason: 'render-context-failed',
      } satisfies ParticlePoolInputError),
    }).pipe(Effect.flatMap((context) => {
      if (Result.isFailure(context)) {
        return Effect.fail({
          _tag: 'ParticlePoolInputError',
          operation: 'render-context',
          reason: 'invalid-frame',
        } satisfies ParticlePoolInputError)
      }
      return Effect.fromResult(spawnParticleRequest(pool, decoded.success, context.success))
    }))
  }),
})

export const ParticleServiceLive = (
  options: ParticleServiceLiveOptions = {},
): Layer.Layer<ParticleService | ParticleServicePoolAccess, ParticlePoolInputError> =>
  Layer.effectContext(Effect.gen(function* () {
    const pool = yield* Effect.fromResult(makeParticlePool(options.pool))
    const service = makeParticleService(
      pool,
      options.renderContext ?? (() => EMPTY_RENDER_CONTEXT),
    )
    return Context.make(ParticleService, service).pipe(
      Context.add(ParticleServicePoolAccess, pool),
    )
  }))
