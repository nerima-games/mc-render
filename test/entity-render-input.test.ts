import { describe, expect, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import { Result, Schema } from 'effect'
import { AnimationSecondsSchema } from '../src/domain/animation-clock.js'
import {
  EntityRenderEntityInputSchema,
  EntityRenderFrameInputSchema,
  decodeEntityRenderEntityInput,
  decodeEntityRenderFrameInput,
  sampleEntityRenderFrame,
  type EntityRenderEntityInput,
} from '../src/domain/entity-render-input.js'

type EntityRenderEntityInputEncoded = Schema.Codec.Encoded<typeof EntityRenderEntityInputSchema>
type EntityRenderFrameInputEncoded = Schema.Codec.Encoded<typeof EntityRenderFrameInputSchema>

const VALID_ENTITY: EntityRenderEntityInputEncoded = {
  id: 'mob-1',
  kind: 'zombie',
  position: { dimension: 'overworld', x: 4, y: 10, z: -2 },
  bodyYawRadians: Math.PI / 2,
  headYawRadians: -Math.PI / 4,
  pitchRadians: Math.PI / 8,
  blockLight: 7,
  skyLight: 14,
  walkPhaseRadians: Math.PI / 2,
  walkAmount: 0.75,
  attackProgress: 0.25,
  hurtProgress: 0.5,
  deathProgress: 0,
}

const validFrame = (patch: Partial<EntityRenderFrameInputEncoded> = {}): EntityRenderFrameInputEncoded => ({
  simulationTick: 37,
  partialTick: 0.25,
  timeOfDayTicks: 6000,
  entities: [VALID_ENTITY],
  ...patch,
})

const validEntityWith = (patch: Record<string, unknown>) => ({ ...VALID_ENTITY, ...patch })
const YAW_OUTSIDE_DELTA = 1e-12

const entityFieldValues = (
  entity: EntityRenderEntityInput | EntityRenderEntityInputEncoded,
): ReadonlyArray<unknown> => [
  entity.id,
  entity.kind,
  entity.position.dimension,
  entity.position.x,
  entity.position.y,
  entity.position.z,
  entity.bodyYawRadians,
  entity.headYawRadians,
  entity.pitchRadians,
  entity.blockLight,
  entity.skyLight,
  entity.walkPhaseRadians,
  entity.walkAmount,
  entity.attackProgress,
  entity.hurtProgress,
  entity.deathProgress,
]

const preservesEntityFields = (decoded: EntityRenderEntityInput, encoded: EntityRenderEntityInputEncoded): boolean => {
  const encodedValues = entityFieldValues(encoded)
  return entityFieldValues(decoded).every((value, index) => value === encodedValues[index])
}

const angleArbitrary = FastCheck.double({ min: -Math.PI, max: Math.PI, noNaN: true, noDefaultInfinity: true })
const pitchArbitrary = FastCheck.double({ min: -Math.PI / 2, max: Math.PI / 2, noNaN: true, noDefaultInfinity: true })
const phaseArbitrary = FastCheck.double({ min: 0, max: 2 * Math.PI - 1e-12, noNaN: true, noDefaultInfinity: true })
const progressArbitrary = FastCheck.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true })

const entityArbitrary = FastCheck.record({
  id: FastCheck.constant('mob-1'),
  kind: FastCheck.constantFrom('zombie', 'cow', 'player'),
  position: FastCheck.record({
    dimension: FastCheck.constantFrom('overworld', 'nether', 'end'),
    x: FastCheck.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
    y: FastCheck.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
    z: FastCheck.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
  }),
  bodyYawRadians: angleArbitrary,
  headYawRadians: angleArbitrary,
  pitchRadians: pitchArbitrary,
  blockLight: FastCheck.integer({ min: 0, max: 15 }),
  skyLight: FastCheck.integer({ min: 0, max: 15 }),
  walkPhaseRadians: phaseArbitrary,
  walkAmount: progressArbitrary,
  attackProgress: progressArbitrary,
  hurtProgress: progressArbitrary,
  deathProgress: progressArbitrary,
})

describe('entity render input schemas', () => {
  it('accepts host entity samples and preserves dimension, light, pose, and animation values', () => {
    FastCheck.assert(
      FastCheck.property(entityArbitrary, (entity) => {
        const decoded = decodeEntityRenderEntityInput(entity)
        if (Result.isFailure(decoded)) {
          return false
        }
        return preservesEntityFields(decoded.success, entity)
      }),
    )
  })

  it('returns a typed failure or a schema-valid entity for arbitrary input without throwing', () => {
    FastCheck.assert(
      FastCheck.property(FastCheck.anything(), (input) => {
        const decoded = decodeEntityRenderEntityInput(input)
        if (Result.isFailure(decoded)) {
          return true
        }
        return Result.isSuccess(
          Schema.decodeUnknownResult(EntityRenderEntityInputSchema, { onExcessProperty: 'error' })(decoded.success),
        )
      }),
    )
  })

  it('rejects invalid and excess entity fields instead of defaulting them', () => {
    expect(Result.isFailure(decodeEntityRenderEntityInput(null))).toBe(true)
    expect(Result.isFailure(decodeEntityRenderEntityInput({ ...VALID_ENTITY, extra: true }))).toBe(true)
    expect(Result.isFailure(decodeEntityRenderEntityInput({ ...VALID_ENTITY, position: { ...VALID_ENTITY.position, extra: 1 } }))).toBe(true)
    expect(Result.isFailure(decodeEntityRenderEntityInput({ ...VALID_ENTITY, id: '' }))).toBe(true)
    expect(Result.isFailure(decodeEntityRenderEntityInput({ ...VALID_ENTITY, kind: '' }))).toBe(true)
  })

  it.each([
    { field: 'bodyYawRadians', lower: -Math.PI, lowerOutside: -Math.PI - YAW_OUTSIDE_DELTA, upper: Math.PI, upperOutside: Math.PI + YAW_OUTSIDE_DELTA },
    { field: 'headYawRadians', lower: -Math.PI, lowerOutside: -Math.PI - YAW_OUTSIDE_DELTA, upper: Math.PI, upperOutside: Math.PI + YAW_OUTSIDE_DELTA },
  ])('accepts yaw limits and rejects values just outside for $field', ({ field, lower, lowerOutside, upper, upperOutside }) => {
    expect(Result.isSuccess(decodeEntityRenderEntityInput(validEntityWith({ [field]: lower })))).toBe(true)
    expect(Result.isSuccess(decodeEntityRenderEntityInput(validEntityWith({ [field]: upper })))).toBe(true)
    expect(Result.isFailure(decodeEntityRenderEntityInput(validEntityWith({ [field]: lowerOutside })))).toBe(true)
    expect(Result.isFailure(decodeEntityRenderEntityInput(validEntityWith({ [field]: upperOutside })))).toBe(true)
  })

  it('accepts pitch limits and rejects values just outside', () => {
    expect(Result.isSuccess(decodeEntityRenderEntityInput(validEntityWith({ pitchRadians: -Math.PI / 2 })))).toBe(true)
    expect(Result.isSuccess(decodeEntityRenderEntityInput(validEntityWith({ pitchRadians: Math.PI / 2 })))).toBe(true)
    expect(Result.isFailure(decodeEntityRenderEntityInput(validEntityWith({ pitchRadians: -Math.PI / 2 - Number.EPSILON })))).toBe(true)
    expect(Result.isFailure(decodeEntityRenderEntityInput(validEntityWith({ pitchRadians: Math.PI / 2 + Number.EPSILON })))).toBe(true)
  })

  it('accepts the gait cycle start and rejects its exclusive endpoint and negative phase', () => {
    expect(Result.isSuccess(decodeEntityRenderEntityInput(validEntityWith({ walkPhaseRadians: 0 })))).toBe(true)
    expect(Result.isSuccess(decodeEntityRenderEntityInput(validEntityWith({ walkPhaseRadians: 2 * Math.PI - 1e-12 })))).toBe(true)
    expect(Result.isFailure(decodeEntityRenderEntityInput(validEntityWith({ walkPhaseRadians: 2 * Math.PI })))).toBe(true)
    expect(Result.isFailure(decodeEntityRenderEntityInput(validEntityWith({ walkPhaseRadians: -Number.EPSILON })))).toBe(true)
  })

  it('accepts light and progress limits and rejects out-of-range inputs', () => {
    for (const field of ['blockLight', 'skyLight'] as const) {
      for (const level of [0, 15]) {
        expect(Result.isSuccess(decodeEntityRenderEntityInput(validEntityWith({ [field]: level })))).toBe(true)
      }
      for (const level of [-1, 16, 1.5]) {
        expect(Result.isFailure(decodeEntityRenderEntityInput(validEntityWith({ [field]: level })))).toBe(true)
      }
    }

    for (const field of ['walkAmount', 'attackProgress', 'hurtProgress', 'deathProgress'] as const) {
      for (const progress of [0, 1]) {
        expect(Result.isSuccess(decodeEntityRenderEntityInput(validEntityWith({ [field]: progress })))).toBe(true)
      }
      for (const progress of [-Number.EPSILON, 1 + Number.EPSILON, Number.NaN]) {
        expect(Result.isFailure(decodeEntityRenderEntityInput(validEntityWith({ [field]: progress })))).toBe(true)
      }
    }
  })
})

describe('entity render frame clock', () => {
  it('derives animation seconds from the simulation tick and partial tick', () => {
    const sampled = sampleEntityRenderFrame(validFrame())

    expect(Result.isSuccess(sampled)).toBe(true)
    if (Result.isSuccess(sampled)) {
      expect(sampled.success.animationSeconds).toBe((37 + 0.25) / 20)
      expect(sampled.success.frame.entities[0]).toStrictEqual({
        id: 'mob-1',
        kind: 'zombie',
        position: { dimension: 'overworld', x: 4, y: 10, z: -2 },
        bodyYawRadians: Math.PI / 2,
        headYawRadians: -Math.PI / 4,
        pitchRadians: Math.PI / 8,
        blockLight: 7,
        skyLight: 14,
        walkPhaseRadians: Math.PI / 2,
        walkAmount: 0.75,
        attackProgress: 0.25,
        hurtProgress: 0.5,
        deathProgress: 0,
      })
    }
  })

  it('keeps the sampled clock fixed for the same frame and does not use time of day as animation time', () => {
    const atMidday = sampleEntityRenderFrame(validFrame({ timeOfDayTicks: 6000 }))
    const nearDawn = sampleEntityRenderFrame(validFrame({ timeOfDayTicks: 23_999 }))

    expect(Result.isSuccess(atMidday) && Result.isSuccess(nearDawn)).toBe(true)
    if (Result.isSuccess(atMidday) && Result.isSuccess(nearDawn)) {
      expect(atMidday.success.animationSeconds).toBe((37 + 0.25) / 20)
      expect(nearDawn.success.animationSeconds).toBe((37 + 0.25) / 20)
    }
  })

  it('property-checks complete frame decoding and the independent tick-to-seconds rule', () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.integer({ min: 0, max: 1_000_000 }),
        FastCheck.integer({ min: 0, max: 999_999 }).map((value) => value / 1_000_000),
        FastCheck.integer({ min: 0, max: 23_999 }),
        entityArbitrary,
        (simulationTick, partialTick, timeOfDayTicks, entity) => {
          const sampled = sampleEntityRenderFrame({
            simulationTick,
            partialTick,
            timeOfDayTicks,
            entities: [entity],
          })
          if (Result.isFailure(sampled)) {
            return false
          }
          const [sampledEntity] = sampled.success.frame.entities
          if (sampledEntity === undefined) {
            return false
          }
          return sampled.success.animationSeconds === (simulationTick + partialTick) / 20 &&
            preservesEntityFields(sampledEntity, entity)
        },
      ),
    )
  })

  it('returns a typed failure or schema-valid sampled frame for arbitrary input without throwing', () => {
    FastCheck.assert(
      FastCheck.property(FastCheck.anything(), (input) => {
        const sampled = sampleEntityRenderFrame(input)
        if (Result.isFailure(sampled)) {
          return true
        }
        return Result.isSuccess(
          Schema.decodeUnknownResult(EntityRenderFrameInputSchema, { onExcessProperty: 'error' })(sampled.success.frame),
        ) && Result.isSuccess(Schema.decodeUnknownResult(AnimationSecondsSchema)(sampled.success.animationSeconds))
      }),
    )
  })

  it('accepts clock endpoints and rejects values just outside them', () => {
    for (const partialTick of [0, 1 - Number.EPSILON]) {
      expect(Result.isSuccess(decodeEntityRenderFrameInput(validFrame({ partialTick })))).toBe(true)
    }
    expect(Result.isFailure(decodeEntityRenderFrameInput(validFrame({ partialTick: 1 })))).toBe(true)
    expect(Result.isFailure(decodeEntityRenderFrameInput(validFrame({ partialTick: -Number.EPSILON })))).toBe(true)

    expect(Result.isSuccess(decodeEntityRenderFrameInput(validFrame({ timeOfDayTicks: 0 })))).toBe(true)
    expect(Result.isSuccess(decodeEntityRenderFrameInput(validFrame({ timeOfDayTicks: 23_999 })))).toBe(true)
    expect(Result.isFailure(decodeEntityRenderFrameInput(validFrame({ timeOfDayTicks: 24_000 })))).toBe(true)

    for (const simulationTick of [0, Number.MAX_SAFE_INTEGER]) {
      expect(Result.isSuccess(decodeEntityRenderFrameInput(validFrame({ simulationTick })))).toBe(true)
    }
    for (const simulationTick of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(Result.isFailure(decodeEntityRenderFrameInput(validFrame({ simulationTick })))).toBe(true)
    }
  })

  it('rejects missing and excess frame properties with a schema failure', () => {
    expect(Result.isFailure(decodeEntityRenderFrameInput(null))).toBe(true)
    expect(Result.isFailure(decodeEntityRenderFrameInput({ ...validFrame(), extra: true }))).toBe(true)
    expect(Result.isFailure(decodeEntityRenderFrameInput({ ...validFrame(), entities: [{ ...VALID_ENTITY, extra: true }] }))).toBe(true)
    expect(Result.isFailure(decodeEntityRenderFrameInput({ simulationTick: 37, partialTick: 0.25, entities: [] }))).toBe(true)
    const sampled = sampleEntityRenderFrame(validFrame({ partialTick: 1 }))
    expect(Result.isFailure(sampled)).toBe(true)
    if (Result.isFailure(sampled)) {
      expect(sampled.failure).toStrictEqual({
        _tag: 'AnimationClockInputError',
        reason: 'invalid-partial-tick',
      })
    }
    expect(Result.isFailure(sampleEntityRenderFrame({ ...validFrame(), extra: true }))).toBe(true)

    expect(Result.isSuccess(Schema.decodeUnknownResult(EntityRenderEntityInputSchema, { onExcessProperty: 'error' })(VALID_ENTITY))).toBe(true)
    expect(Result.isSuccess(Schema.decodeUnknownResult(EntityRenderFrameInputSchema, { onExcessProperty: 'error' })(validFrame()))).toBe(true)
  })
})
