import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { DomainEventSchema, WorldPositionSchema } from '@nerima-games/mc-kernel'
import {
  PARTICLE_KIND_DEFAULTS,
  ParticleColorSchema,
  ParticleDirectionSchema,
  ParticleKindSchema,
  ParticleLifetimeSecondsSchema,
  ParticleRequestSchema,
  ParticleService,
  ParticleServiceLive,
  particleRequestForDomainEvent,
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
