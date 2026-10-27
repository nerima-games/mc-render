import {
  type BlockAddress,
  type DomainEvent,
  type EntityId,
  type ExplosionSource,
  type WorldPosition,
  WorldPositionSchema,
} from '@nerima-games/mc-kernel'
import {
  type ParticleColor,
  ParticleColorSchema,
  ParticleDirectionSchema,
  type ParticleKind,
  type ParticleRequest,
} from './particle-service.js'
import { Schema } from 'effect'

/** Resolve entities for event variants whose payload has no world position. */
export type ParticleEventContext = Readonly<{
  readonly positionOfEntity?: ((entity: EntityId) => WorldPosition | undefined) | undefined
}>

/** An event tag the adapter does not recognize; callers must handle this result. */
export type UnhandledParticleEvent = Readonly<{
  readonly _tag: 'UnhandledParticleEvent'
  readonly eventTag: string
}>

export type ParticleEventResult = ParticleRequest | UnhandledParticleEvent | undefined

type RequestOptions = Pick<ParticleRequest, 'color' | 'direction' | 'followEntity'>

const BLOCK_CENTER_OFFSET = 0.5
type NotHandled = Readonly<{ readonly _tag: 'NotHandled' }>
const NOT_HANDLED: NotHandled = { _tag: 'NotHandled' }

type RoutedParticleEvent = ParticleRequest | NotHandled | undefined
type ParticleEventMapper = (event: DomainEvent, context: ParticleEventContext) => RoutedParticleEvent

const creeperExplosionColor = Schema.decodeUnknownSync(ParticleColorSchema)({
  blue: 0.25,
  green: 0.9,
  red: 0.35,
})

const tntExplosionColor = Schema.decodeUnknownSync(ParticleColorSchema)({
  blue: 0.05,
  green: 0.35,
  red: 1,
})

const placementColor = Schema.decodeUnknownSync(ParticleColorSchema)({
  blue: 1,
  green: 0.75,
  red: 0.25,
})

const lightningColor = Schema.decodeUnknownSync(ParticleColorSchema)({
  blue: 0.95,
  green: 0.85,
  red: 1,
})

const transformationColor = Schema.decodeUnknownSync(ParticleColorSchema)({
  blue: 1,
  green: 0.25,
  red: 0.75,
})

const shieldColor = Schema.decodeUnknownSync(ParticleColorSchema)({
  blue: 1,
  green: 0.9,
  red: 0.25,
})

const explosionColorFor = (source: ExplosionSource): ParticleColor | undefined => {
  switch (source) {
    case 'creeper':
      return creeperExplosionColor
    case 'tnt':
      return tntExplosionColor
    default:
      return undefined
  }
}

const requestAt = (
  kind: ParticleKind,
  position: WorldPosition,
  options: RequestOptions = {},
): ParticleRequest => ({ kind, position, ...options })

type EntityRequestInput = Readonly<{
  readonly kind: ParticleKind
  readonly entity: EntityId
  readonly context: ParticleEventContext
  readonly options?: Omit<RequestOptions, 'followEntity'> | undefined
}>

const requestForEntity = ({ kind, entity, context, options = {} }: EntityRequestInput): ParticleRequest | undefined => {
  const position = context.positionOfEntity?.(entity)
  if (position === undefined) {
    return undefined
  }
  return requestAt(kind, position, { ...options, followEntity: entity })
}

const blockCenter = (address: BlockAddress): WorldPosition => Schema.decodeUnknownSync(WorldPositionSchema)({
  dimension: address.dimension,
  x: address.position.x + BLOCK_CENTER_OFFSET,
  y: address.position.y + BLOCK_CENTER_OFFSET,
  z: address.position.z + BLOCK_CENTER_OFFSET,
})

const particleRequestForExplosion: ParticleEventMapper = (event) => {
  if (event._tag === 'Explosion') {
    const color = explosionColorFor(event.source)
    if (color === undefined) {
      return NOT_HANDLED
    }
    return requestAt('explosion', event.position, {
      color,
    })
  }
  return NOT_HANDLED
}

const particleRequestForBlockEvent: ParticleEventMapper = (event) => {
  switch (event._tag) {
    case 'BlockBroken':
      return requestAt('block-break', blockCenter(event.address))
    case 'BlockPlaced':
      return requestAt('level-up', blockCenter(event.address), { color: placementColor })
    case 'BlockChangedByWorld':
      return requestAt('block-break', blockCenter(event.address))
    case 'ItemDropped':
      return requestAt('block-break', event.position)
    default:
      return NOT_HANDLED
  }
}

const particleRequestForEntityEvent: ParticleEventMapper = (event, context) => {
  switch (event._tag) {
    case 'EntityDamaged':
      return requestAt('entity-hit', event.position, { followEntity: event.entity })
    case 'LevelUp':
      return requestAt('level-up', event.position, { followEntity: event.entity })
    case 'EntityDied':
      return requestAt('entity-hit', event.position)
    case 'EntityHealed':
      return requestForEntity({ context, entity: event.entity, kind: 'level-up' })
    case 'EntitySpawned':
      return requestAt('level-up', event.position, { followEntity: event.entity })
    case 'EntityTeleported':
      return requestAt('level-up', event.to, { followEntity: event.entity })
    default:
      return NOT_HANDLED
  }
}

const particleRequestForItemEvent: ParticleEventMapper = (event, context) => {
  switch (event._tag) {
    case 'ItemPickedUp':
      return requestForEntity({ context, entity: event.actor, kind: 'level-up' })
    case 'ItemConsumed':
      return requestForEntity({ context, entity: event.actor, kind: 'level-up' })
    case 'ExperienceCollected':
      return requestForEntity({ context, entity: event.player, kind: 'level-up' })
    default:
      return NOT_HANDLED
  }
}

const particleRequestForWeatherEvent: ParticleEventMapper = (event, context) => {
  switch (event._tag) {
    case 'WeatherGameplayEffect':
      switch (event.effect._tag) {
        case 'LightningStrike':
          return requestAt('explosion', event.effect.position, { color: lightningColor })
        case 'CreeperCharged':
          return requestForEntity({
            context,
            entity: event.effect.entity,
            kind: 'explosion',
            options: { color: creeperExplosionColor },
          })
        case 'EntityTransformed':
          return requestForEntity({
            context,
            entity: event.effect.entity,
            kind: 'level-up',
            options: { color: transformationColor },
          })
        default:
          return NOT_HANDLED
      }
    default:
      return NOT_HANDLED
  }
}

const particleRequestForProjectileEvent: ParticleEventMapper = (event) => {
  switch (event._tag) {
    case 'ProjectileLaunched':
      return requestAt('entity-hit', event.origin, {
        direction: Schema.decodeUnknownSync(ParticleDirectionSchema)(event.initialVelocity),
        followEntity: event.shooter,
      })
    case 'ProjectileImpacted':
      if (event.hit._tag === 'Entity') {
        return requestAt('entity-hit', event.position, { followEntity: event.hit.entity })
      }
      return requestAt('entity-hit', event.position)
    case 'ShieldBlocked':
      return requestAt('entity-hit', event.position, {
        color: shieldColor,
        followEntity: event.defender,
      })
    default:
      return NOT_HANDLED
  }
}

const particleRequestForNoParticleEvent: ParticleEventMapper = (event) => {
  switch (event._tag) {
    case 'AchievementUnlocked':
      // Achievement feedback belongs to the UI notification surface.
      return undefined
    case 'VehicleTransition':
      // Mount state has no matching C6 particle effect.
      return undefined
    default:
      return NOT_HANDLED
  }
}

const PARTICLE_EVENT_MAPPERS: ReadonlyArray<ParticleEventMapper> = [
  particleRequestForExplosion,
  particleRequestForBlockEvent,
  particleRequestForEntityEvent,
  particleRequestForItemEvent,
  particleRequestForWeatherEvent,
  particleRequestForProjectileEvent,
  particleRequestForNoParticleEvent,
]

/** Convert one kernel event to a request or an explicit no-particle/unhandled result. */
export const particleRequestForDomainEvent = (
  event: DomainEvent,
  context: ParticleEventContext = {},
): ParticleEventResult => {
  for (const mapEvent of PARTICLE_EVENT_MAPPERS) {
    const result = mapEvent(event, context)
    if (result === undefined) {
      return undefined
    }
    if (!('_tag' in result)) {
      return result
    }
  }
  return { _tag: 'UnhandledParticleEvent', eventTag: event._tag }
}
