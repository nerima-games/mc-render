import {
  EntityIdSchema,
  WorldPositionSchema,
  type EntityId,
  type WorldPosition,
} from '@nerima-games/mc-kernel'
import { Brand, Context, Effect, Layer, Schema } from 'effect'
import {
  PARTICLE_LIFETIME_SECS,
  type ParticleFrameSnapshot,
  type ParticlePool,
  type ParticlePoolOptions,
  type ParticleSpawnSpec,
  spawnParticle,
  makeParticlePool,
} from '../domain/particle-pool.js'

export type ParticleKind = 'block-break' | 'entity-hit' | 'explosion' | 'level-up'

export const ParticleKindSchema: Schema.Codec<ParticleKind> = Schema.Literals([
  'block-break',
  'entity-hit',
  'explosion',
  'level-up',
])

export type ParticleColorChannel = Brand.Branded<number, 'ParticleColorChannel'>

export const ParticleColorChannelSchema: Schema.Codec<ParticleColorChannel, number> = Schema.Finite
  .check(Schema.isBetween({ minimum: 0, maximum: 1 }))
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
  red: ParticleColorChannelSchema,
  green: ParticleColorChannelSchema,
  blue: ParticleColorChannelSchema,
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
  .check(Schema.isGreaterThan(0))
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

export const ParticleRequestSchema: Schema.Codec<ParticleRequest, ParticleRequestEncoded> = Schema.Struct({
  kind: ParticleKindSchema,
  position: WorldPositionSchema,
  color: Schema.optional(ParticleColorSchema),
  lifetimeSeconds: Schema.optional(ParticleLifetimeSecondsSchema),
  direction: Schema.optional(ParticleDirectionSchema),
  followEntity: Schema.optional(EntityIdSchema),
})

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
  readonly spawn: (request: ParticleRequest) => Effect.Effect<0 | 1>
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

const EMPTY_RENDER_CONTEXT: ParticleFrameSnapshot = { dimension: 'overworld', entities: [] }

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

const makeParticleService = (
  pool: ParticlePool,
  readRenderContext: () => ParticleFrameSnapshot,
): ParticleServiceApi => ({
  spawn: (request) => Effect.sync(() => {
    const context = readRenderContext()
    if (request.position.dimension !== context.dimension) {
      return 0
    }

    const follow = followLinkFor(request, context)
    if (request.followEntity !== undefined && follow === undefined) {
      return 0
    }

    const defaults = PARTICLE_KIND_DEFAULTS[request.kind]
    const direction = request.direction
    const velocity = direction === undefined
      ? undefined
      : {
          x: direction.x * defaults.baseSpeedMPerSecond,
          y: direction.y * defaults.baseSpeedMPerSecond,
          z: direction.z * defaults.baseSpeedMPerSecond,
        }
    const spawn: ParticleSpawnSpec = {
      dimension: request.position.dimension,
      lifetimeSecs: request.lifetimeSeconds ?? defaults.lifetimeSeconds,
      positionX: request.position.x,
      positionY: request.position.y,
      positionZ: request.position.z,
      tint: request.color ?? defaults.color,
      uvU: 0,
      uvV: 0,
      ...(velocity === undefined ? {} : { velocity }),
      ...(follow === undefined ? {} : { follow }),
    }

    const count = Math.min(defaults.particleCount, pool.capacity)
    let accepted = false
    for (let particle = 0; particle < count; particle += 1) {
      accepted = spawnParticle(pool, spawn) || accepted
    }
    return accepted ? 1 : 0
  }),
})

export const ParticleServiceLive = (
  options: ParticleServiceLiveOptions = {},
): Layer.Layer<ParticleService | ParticleServicePoolAccess> =>
  Layer.effectContext(Effect.sync(() => {
    const pool = makeParticlePool(options.pool)
    const service = makeParticleService(
      pool,
      options.renderContext ?? (() => EMPTY_RENDER_CONTEXT),
    )
    return Context.make(ParticleService, service).pipe(
      Context.add(ParticleServicePoolAccess, pool),
    )
  }))
