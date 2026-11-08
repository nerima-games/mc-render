import { describe, expect, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import { Effect, Result, Schema } from 'effect'
import {
  BlockSelectionShapeSchema,
  CrackStagePlanSchema,
  DamageFeedbackPlanSchema,
  FirstPersonPoseSchema,
  InteractionVisualInputErrorSchema,
  SelectionOutlinePlanSchema,
  planCrackStage,
  planDamageFeedback,
  planFirstPersonPose,
  planSelectionOutline,
} from '../src/domain/interaction-visuals'

const FULL_CUBE = {
  boxes: [{ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }],
} as const

const LOWER_HALF = {
  boxes: [{ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 0.5, z: 1 } }],
} as const

const STAIR = {
  boxes: [
    { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 0.5, z: 1 } },
    { min: { x: 0, y: 0.5, z: 0 }, max: { x: 1, y: 1, z: 0.5 } },
  ],
} as const

const UNIT_ACTION = {
  action: 'idle',
  actionProgress: 0,
  movementIntensity: 1,
  gaitPhaseRadians: Math.PI / 4,
  reducedMotion: false,
} as const

const assertSchemaValid = (schema: Schema.Codec<unknown>, value: unknown): void => {
  const decoded = Schema.decodeUnknownResult(schema, { onExcessProperty: 'error' })(value)
  expect(Result.isSuccess(decoded)).toBe(true)
}

const assertResultValid = <A, E>(schema: Schema.Codec<A>, result: Result.Result<A, E>): void => {
  if (Result.isSuccess(result)) {
    assertSchemaValid(schema, result.success)
  } else {
    assertSchemaValid(InteractionVisualInputErrorSchema, result.failure)
  }
}

const expectSuccess = <A, E>(result: Result.Result<A, E>): A => {
  expect(Result.isSuccess(result)).toBe(true)
  if (Result.isFailure(result)) {
    throw new Error('expected a successful interaction plan')
  }
  return result.success
}

describe('interaction visual planning', () => {
  it.effect('makes selection outlines follow full, half, and composite stair shapes', () =>
    Effect.sync(() => {
      const full = expectSuccess(planSelectionOutline(FULL_CUBE, { x: 4, y: 20, z: -2 }))
      const half = expectSuccess(planSelectionOutline(LOWER_HALF, { x: 4, y: 20, z: -2 }))
      const stair = expectSuccess(planSelectionOutline(STAIR, { x: 4, y: 20, z: -2 }))

      expect(full.segments).toHaveLength(12)
      expect(half.segments).toHaveLength(12)
      expect(half.segments.every(({ start, end }) => start.y <= 20.5 && end.y <= 20.5)).toBe(true)
      expect(stair.segments.length).toBeGreaterThan(12)
      expect(stair.segments.some(({ start, end }) => start.y === 20.5 && end.y === 20.5)).toBe(true)
      expect(stair.segments.every(({ start, end }) => start.y >= 20 && start.y <= 21 && end.y >= 20 && end.y <= 21)).toBe(true)
    }),
  )

  it.effect('rejects malformed selection bounds and coordinates with a typed failure', () =>
    Effect.sync(() => {
      const outside = { boxes: [{ min: { x: 0, y: 0, z: 0 }, max: { x: 1.1, y: 1, z: 1 } }] }
      const reversed = { boxes: [{ min: { x: 0.7, y: 0, z: 0 }, max: { x: 0.5, y: 1, z: 1 } }] }
      const empty = { boxes: [] }

      const outsideResult = planSelectionOutline(outside, { x: 0, y: 0, z: 0 })
      expect(Result.isFailure(outsideResult)).toBe(true)
      if (Result.isFailure(outsideResult)) {
        expect(outsideResult.failure).toStrictEqual({
          _tag: 'InteractionVisualInputError',
          operation: 'selection-outline',
          reason: 'out-of-range',
        })
      }
      expect(planSelectionOutline(reversed, { x: 0, y: 0, z: 0 })._tag).toBe('Failure')
      expect(planSelectionOutline(empty, { x: 0, y: 0, z: 0 })._tag).toBe('Failure')
      expect(planSelectionOutline(FULL_CUBE, { x: 0.5, y: 0, z: 0 })._tag).toBe('Failure')
      expect(Schema.decodeUnknownResult(BlockSelectionShapeSchema)(STAIR)._tag).toBe('Success')
    }),
  )

  it.effect('maps mining progress to ten crack stages with explicit endpoints', () =>
    Effect.sync(() => {
      const empty = expectSuccess(planCrackStage(0))
      const first = expectSuccess(planCrackStage(0.01))
      const complete = expectSuccess(planCrackStage(1))

      expect(empty).toStrictEqual({ stage: 0, opacity: 0 })
      expect(first.stage).toBe(1)
      expect(complete.stage).toBe(10)
      expect(complete.opacity).toBeGreaterThan(first.opacity)
      expect(planCrackStage(-0.01)._tag).toBe('Failure')
      expect(planCrackStage(1.01)._tag).toBe('Failure')
      expect(planCrackStage(Number.NaN)._tag).toBe('Failure')
    }),
  )

  it.effect('turns off walking bob under reduced motion and keeps action movement smaller', () =>
    Effect.sync(() => {
      const moving = expectSuccess(planFirstPersonPose(UNIT_ACTION))
      const reduced = expectSuccess(planFirstPersonPose({ ...UNIT_ACTION, reducedMotion: true }))
      const attacking = expectSuccess(
        planFirstPersonPose({ ...UNIT_ACTION, action: 'attack', actionProgress: 0.5 }),
      )
      const reducedAttack = expectSuccess(
        planFirstPersonPose({ ...UNIT_ACTION, action: 'attack', actionProgress: 0.5, reducedMotion: true }),
      )
      const rest = expectSuccess(planFirstPersonPose({ ...UNIT_ACTION, movementIntensity: 0 }))

      expect(reduced.offset.x).toBe(rest.offset.x)
      expect(reduced.offset.y).toBe(rest.offset.y)
      expect(moving.offset.x).not.toBe(rest.offset.x)
      expect(Math.abs(reducedAttack.rotation.x)).toBeLessThan(Math.abs(attacking.rotation.x))
      expect(planFirstPersonPose({ ...UNIT_ACTION, actionProgress: 1.1 })._tag).toBe('Failure')
    }),
  )

  it.effect('shows hit strength and tilts away from the attack direction', () =>
    Effect.sync(() => {
      const rightHit = expectSuccess(
        planDamageFeedback({ intensity: 1, attackDirection: { x: 1, y: 0 }, reducedMotion: false }),
      )
      const reducedHit = expectSuccess(
        planDamageFeedback({ intensity: 1, attackDirection: { x: 1, y: 0 }, reducedMotion: true }),
      )
      const noHit = expectSuccess(
        planDamageFeedback({ intensity: 0, attackDirection: { x: 0, y: 0 }, reducedMotion: false }),
      )

      expect(rightHit.flashOpacity).toBeGreaterThan(0)
      expect(rightHit.cameraRollRadians).toBeLessThan(0)
      expect(Math.abs(reducedHit.cameraRollRadians)).toBeLessThan(Math.abs(rightHit.cameraRollRadians))
      expect(reducedHit.flashOpacity).toBe(rightHit.flashOpacity)
      expect(noHit).toStrictEqual({ flashOpacity: 0, cameraRollRadians: 0, directionAngleRadians: 0 })
      expect(planDamageFeedback({ intensity: 0.5, attackDirection: { x: 0, y: 0 }, reducedMotion: false })).toMatchObject({
        _tag: 'Failure',
        failure: { operation: 'damage-feedback', reason: 'invalid-input' },
      })
      expect(planDamageFeedback({ intensity: 1.1, attackDirection: { x: 1, y: 0 }, reducedMotion: false })._tag).toBe(
        'Failure',
      )
    }),
  )

  it.effect('property-checks that arbitrary public inputs return schema-valid results without throwing', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(FastCheck.anything(), (input) => {
          assertResultValid(CrackStagePlanSchema, planCrackStage(input))
          assertResultValid(FirstPersonPoseSchema, planFirstPersonPose(input))
          assertResultValid(DamageFeedbackPlanSchema, planDamageFeedback(input))
          assertResultValid(SelectionOutlinePlanSchema, planSelectionOutline(input, input))
        }),
      )
    }),
  )
})
