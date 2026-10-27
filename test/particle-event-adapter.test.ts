import { describe, expect, it } from '@effect/vitest'
import { Schema } from 'effect'
import {
  DomainEventSchema,
  WorldPositionSchema,
  type DomainEvent,
  type WorldPosition,
} from '@nerima-games/mc-kernel'
import {
  particleRequestForDomainEvent,
  type ParticleEventContext,
  type ParticleEventResult,
} from '../src/application/particle-event-adapter.js'
import type { ParticleRequest } from '../src/application/particle-service.js'

const event = (value: unknown): DomainEvent => Schema.decodeUnknownSync(DomainEventSchema)(value)

const worldPosition = (x: number, y: number, z: number, dimension = 'overworld'): WorldPosition =>
  Schema.decodeUnknownSync(WorldPositionSchema)({ dimension, x, y, z })

const resolvedEntityPosition = worldPosition(9, 10, 11)

const entityContext: ParticleEventContext = {
  positionOfEntity: () => resolvedEntityPosition,
}

const expectParticleRequest = (result: ParticleEventResult): ParticleRequest => {
  if (result === undefined || !('kind' in result)) {
    throw new Error('Expected a particle request')
  }
  return result
}

const expectedWorldPosition = (x: number, y: number, z: number, dimension = 'overworld') => ({
  dimension,
  x,
  y,
  z,
})

const mappedEvents: ReadonlyArray<Readonly<{
  readonly name: string
  readonly value: unknown
  readonly kind: string
  readonly position: ReturnType<typeof expectedWorldPosition>
  readonly followEntity?: string | undefined
}>> = [
  {
    name: 'damage',
    value: { _tag: 'EntityDamaged', tick: 1, entity: 'mob-1', position: { dimension: 'overworld', x: 1, y: 2, z: 3 }, amount: 2, cause: 'mob' },
    kind: 'entity-hit',
    position: expectedWorldPosition(1, 2, 3),
    followEntity: 'mob-1',
  },
  {
    name: 'block break',
    value: { _tag: 'BlockBroken', tick: 1, actor: 'player-1', address: { dimension: 'overworld', position: { x: 1, y: 2, z: 3 } }, block: 1 },
    kind: 'block-break',
    position: expectedWorldPosition(1.5, 2.5, 3.5),
  },
  {
    name: 'creeper explosion',
    value: { _tag: 'Explosion', tick: 1, position: { dimension: 'nether', x: 4, y: 5, z: 6 }, power: 3, source: 'creeper' },
    kind: 'explosion',
    position: expectedWorldPosition(4, 5, 6, 'nether'),
  },
  {
    name: 'TNT explosion',
    value: { _tag: 'Explosion', tick: 1, position: { dimension: 'nether', x: 4, y: 5, z: 6 }, power: 3, source: 'tnt' },
    kind: 'explosion',
    position: expectedWorldPosition(4, 5, 6, 'nether'),
  },
  {
    name: 'level up',
    value: { _tag: 'LevelUp', tick: 1, entity: 'player-1', position: { dimension: 'overworld', x: 1, y: 2, z: 3 }, level: 2 },
    kind: 'level-up',
    position: expectedWorldPosition(1, 2, 3),
    followEntity: 'player-1',
  },
  {
    name: 'block placement',
    value: { _tag: 'BlockPlaced', tick: 1, actor: 'player-1', address: { dimension: 'overworld', position: { x: 1, y: 2, z: 3 } }, block: 1 },
    kind: 'level-up',
    position: expectedWorldPosition(1.5, 2.5, 3.5),
  },
  {
    name: 'world block change',
    value: { _tag: 'BlockChangedByWorld', tick: 1, address: { dimension: 'overworld', position: { x: 1, y: 2, z: 3 } }, cause: 'fire' },
    kind: 'block-break',
    position: expectedWorldPosition(1.5, 2.5, 3.5),
  },
  {
    name: 'entity death',
    value: { _tag: 'EntityDied', tick: 1, entity: 'mob-1', kind: 'zombie', position: { dimension: 'overworld', x: 1, y: 2, z: 3 }, cause: 'mob' },
    kind: 'entity-hit',
    position: expectedWorldPosition(1, 2, 3),
  },
  {
    name: 'entity healed',
    value: { _tag: 'EntityHealed', tick: 1, entity: 'player-1', amount: 2, cause: 'regeneration' },
    kind: 'level-up',
    position: expectedWorldPosition(9, 10, 11),
    followEntity: 'player-1',
  },
  {
    name: 'entity spawned',
    value: { _tag: 'EntitySpawned', tick: 1, entity: 'mob-1', kind: 'zombie', position: { dimension: 'overworld', x: 1, y: 2, z: 3 } },
    kind: 'level-up',
    position: expectedWorldPosition(1, 2, 3),
    followEntity: 'mob-1',
  },
  {
    name: 'entity teleported',
    value: { _tag: 'EntityTeleported', tick: 1, entity: 'player-1', from: { dimension: 'overworld', x: 1, y: 2, z: 3 }, to: { dimension: 'nether', x: 4, y: 5, z: 6 }, cause: 'ender-pearl' },
    kind: 'level-up',
    position: expectedWorldPosition(4, 5, 6, 'nether'),
    followEntity: 'player-1',
  },
  {
    name: 'item dropped',
    value: { _tag: 'ItemDropped', tick: 1, droppedItem: 'drop-1', item: 1, count: 2, position: { dimension: 'overworld', x: 1, y: 2, z: 3 } },
    kind: 'block-break',
    position: expectedWorldPosition(1, 2, 3),
  },
  {
    name: 'item picked up',
    value: { _tag: 'ItemPickedUp', tick: 1, actor: 'player-1', source: { _tag: 'DroppedItem', id: 'drop-1' }, item: 1, count: 2 },
    kind: 'level-up',
    position: expectedWorldPosition(9, 10, 11),
    followEntity: 'player-1',
  },
  {
    name: 'item consumed',
    value: { _tag: 'ItemConsumed', tick: 1, actor: 'player-1', item: 1, count: 1, use: 'food' },
    kind: 'level-up',
    position: expectedWorldPosition(9, 10, 11),
    followEntity: 'player-1',
  },
  {
    name: 'lightning strike',
    value: { _tag: 'WeatherGameplayEffect', tick: 1, effect: { _tag: 'LightningStrike', position: { dimension: 'overworld', x: 1, y: 2, z: 3 } } },
    kind: 'explosion',
    position: expectedWorldPosition(1, 2, 3),
  },
  {
    name: 'charged creeper',
    value: { _tag: 'WeatherGameplayEffect', tick: 1, effect: { _tag: 'CreeperCharged', entity: 'mob-1' } },
    kind: 'explosion',
    position: expectedWorldPosition(9, 10, 11),
    followEntity: 'mob-1',
  },
  {
    name: 'entity transformation',
    value: { _tag: 'WeatherGameplayEffect', tick: 1, effect: { _tag: 'EntityTransformed', entity: 'mob-1', kind: 'zombie' } },
    kind: 'level-up',
    position: expectedWorldPosition(9, 10, 11),
    followEntity: 'mob-1',
  },
  {
    name: 'projectile launch',
    value: { _tag: 'ProjectileLaunched', tick: 1, projectile: 'arrow-1', shooter: 'player-1', origin: { dimension: 'overworld', x: 1, y: 2, z: 3 }, initialVelocity: { x: 0, y: 1, z: 2 } },
    kind: 'entity-hit',
    position: expectedWorldPosition(1, 2, 3),
    followEntity: 'player-1',
  },
  {
    name: 'projectile impact on entity',
    value: { _tag: 'ProjectileImpacted', tick: 1, projectile: 'arrow-1', position: { dimension: 'overworld', x: 1, y: 2, z: 3 }, hit: { _tag: 'Entity', entity: 'mob-1' } },
    kind: 'entity-hit',
    position: expectedWorldPosition(1, 2, 3),
    followEntity: 'mob-1',
  },
  {
    name: 'projectile impact on block',
    value: { _tag: 'ProjectileImpacted', tick: 1, projectile: 'arrow-1', position: { dimension: 'overworld', x: 1, y: 2, z: 3 }, hit: { _tag: 'Block', address: { dimension: 'overworld', position: { x: 1, y: 2, z: 3 } } } },
    kind: 'entity-hit',
    position: expectedWorldPosition(1, 2, 3),
  },
  {
    name: 'shield block',
    value: { _tag: 'ShieldBlocked', tick: 1, defender: 'player-1', position: { dimension: 'overworld', x: 1, y: 2, z: 3 }, blockedAmount: 2 },
    kind: 'entity-hit',
    position: expectedWorldPosition(1, 2, 3),
    followEntity: 'player-1',
  },
  {
    name: 'experience collected',
    value: { _tag: 'ExperienceCollected', tick: 1, player: 'player-1', orb: 'orb-1', amount: 2 },
    kind: 'level-up',
    position: expectedWorldPosition(9, 10, 11),
    followEntity: 'player-1',
  },
]

describe('particleRequestForDomainEvent', () => {
  for (const mappedEvent of mappedEvents) {
    it(`maps ${mappedEvent.name}`, () => {
      const request = expectParticleRequest(particleRequestForDomainEvent(event(mappedEvent.value), entityContext))

      expect(request).toMatchObject({
        kind: mappedEvent.kind,
        position: mappedEvent.position,
      })
      if (mappedEvent.followEntity !== undefined) {
        expect(request?.followEntity).toBe(mappedEvent.followEntity)
      }
    })
  }

  it('uses distinct colors for creeper and TNT explosions', () => {
    const creeper = expectParticleRequest(particleRequestForDomainEvent(event(mappedEvents[2]?.value), entityContext))
    const tnt = expectParticleRequest(particleRequestForDomainEvent(event(mappedEvents[3]?.value), entityContext))

    expect(creeper?.color).not.toStrictEqual(tnt?.color)
    expect(creeper?.color?.green).toBeGreaterThan(tnt?.color?.green ?? 1)
    expect(tnt?.color?.red).toBeGreaterThan(creeper?.color?.red ?? 1)
  })

  it('preserves projectile launch direction', () => {
    const request = expectParticleRequest(particleRequestForDomainEvent(event(mappedEvents[17]?.value), entityContext))

    expect(request?.direction).toMatchObject({ x: 0, y: 1, z: 2 })
  })

  it('maps every explicit no-particle event even when an entity resolver is available', () => {
    const noParticleEvents = [
      event({ _tag: 'AchievementUnlocked', tick: 1, player: 'player-1', achievement: 'first-step' }),
      event({ _tag: 'VehicleTransition', tick: 1, actor: 'player-1', vehicle: 'boat-1', transition: 'mounted' }),
    ]

    for (const noParticleEvent of noParticleEvents) {
      expect(particleRequestForDomainEvent(noParticleEvent, entityContext)).toBeUndefined()
    }
  })

  it('does not invent a position for ItemPickedUp when the actor cannot be resolved', () => {
    const itemPickedUp = event(mappedEvents[12]?.value)

    expect(particleRequestForDomainEvent(itemPickedUp)).toBeUndefined()
    expect(particleRequestForDomainEvent(itemPickedUp, { positionOfEntity: () => undefined })).toBeUndefined()
  })

  it('maps weather effects to no request when the effect entity cannot be resolved', () => {
    const chargedCreeper = event(mappedEvents[15]?.value)
    const transformedEntity = event(mappedEvents[16]?.value)
    const noEntityPosition: ParticleEventContext = { positionOfEntity: () => undefined }

    expect(particleRequestForDomainEvent(chargedCreeper, noEntityPosition)).toBeUndefined()
    expect(particleRequestForDomainEvent(transformedEntity, noEntityPosition)).toBeUndefined()
  })

  it('returns an explicit result for an unrecognized outer event tag', () => {
    const recognizedEvent = event({
      _tag: 'AchievementUnlocked',
      tick: 1,
      player: 'player-1',
      achievement: 'first-step',
    })
    Object.defineProperty(recognizedEvent, '_tag', { value: 'FutureDomainEvent' })

    expect(particleRequestForDomainEvent(recognizedEvent)).toStrictEqual({
      _tag: 'UnhandledParticleEvent',
      eventTag: 'FutureDomainEvent',
    })
  })

  it('returns an explicit result for an unrecognized explosion source', () => {
    const explosion = event(mappedEvents[2]?.value)
    Object.defineProperty(explosion, 'source', { value: 'meteor' })

    expect(particleRequestForDomainEvent(explosion)).toStrictEqual({
      _tag: 'UnhandledParticleEvent',
      eventTag: 'Explosion',
    })
  })

  it('returns an explicit result for an unrecognized weather effect tag', () => {
    const weatherEvent = event({
      _tag: 'WeatherGameplayEffect',
      tick: 1,
      effect: { _tag: 'LightningStrike', position: { dimension: 'overworld', x: 1, y: 2, z: 3 } },
    })
    Object.defineProperty(weatherEvent, 'effect', { value: { _tag: 'FutureWeatherEffect' } })

    expect(particleRequestForDomainEvent(weatherEvent)).toStrictEqual({
      _tag: 'UnhandledParticleEvent',
      eventTag: 'WeatherGameplayEffect',
    })
  })
})
