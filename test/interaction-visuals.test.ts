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

const unitBoundsArbitrary = FastCheck.integer({ max: 9, min: 0 }).chain((min) =>
  FastCheck.integer({ max: 10 - min, min: 1 }).map((size) => ({ max: (min + size) / 10, min: min / 10 })),
)

const pointKey = (point: Readonly<{ x: number; y: number; z: number }>): string =>
  `${point.x.toFixed(1)},${point.y.toFixed(1)},${point.z.toFixed(1)}`

const expectedCuboidEdges = (
  bounds: Readonly<{ x: Readonly<{ min: number; max: number }>; y: Readonly<{ min: number; max: number }>; z: Readonly<{ min: number; max: number }> }>,
  position: Readonly<{ x: number; y: number; z: number }>,
): ReadonlyArray<string> => {
  const corners = Array.from({ length: 8 }, (_unused, index) => ({
    x: position.x + ((index & 1) === 0 ? bounds.x.min : bounds.x.max),
    y: position.y + ((index & 2) === 0 ? bounds.y.min : bounds.y.max),
    z: position.z + ((index & 4) === 0 ? bounds.z.min : bounds.z.max),
  }))
  const edges: Array<string> = []
  for (let first = 0; first < corners.length; first += 1) {
    for (let second = first + 1; second < corners.length; second += 1) {
      const start = corners[first]
      const end = corners[second]
      const changedAxes = Number(start.x !== end.x) + Number(start.y !== end.y) + Number(start.z !== end.z)
      if (changedAxes === 1) {
        edges.push([pointKey(start), pointKey(end)].sort().join('|'))
      }
    }
  }
  return edges.sort()
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

  it.effect('matches independent expected values for generated selection, crack, hand, and damage plans', () =>
    Effect.sync(() => {
      const selectionInput = FastCheck.record({
        bounds: FastCheck.record({ x: unitBoundsArbitrary, y: unitBoundsArbitrary, z: unitBoundsArbitrary }),
        position: FastCheck.record({
          x: FastCheck.integer({ max: 20, min: -20 }),
          y: FastCheck.integer({ max: 20, min: -20 }),
          z: FastCheck.integer({ max: 20, min: -20 }),
        }),
      })
      FastCheck.assert(FastCheck.property(selectionInput, ({ bounds, position }) => {
        const actual = expectSuccess(planSelectionOutline({
          boxes: [{ min: { x: bounds.x.min, y: bounds.y.min, z: bounds.z.min }, max: { x: bounds.x.max, y: bounds.y.max, z: bounds.z.max } }],
        }, position))
        const actualEdges = actual.segments.map(({ start, end }) => [pointKey(start), pointKey(end)].sort().join('|')).sort()
        expect(actualEdges).toStrictEqual(expectedCuboidEdges(bounds, position))
      }))

      const progress = FastCheck.integer({ max: 1000, min: 0 }).map((value) => value / 1000)
      FastCheck.assert(FastCheck.property(progress, (miningProgress) => {
        const actual = expectSuccess(planCrackStage(miningProgress))
        const stage = miningProgress === 0 ? 0 : Math.ceil(miningProgress * 10)
        const opacity = stage === 0 ? 0 : 0.16 + (stage / 10) * 0.64
        expect(actual).toStrictEqual({ stage, opacity })
      }))

      const motionInput = FastCheck.record({
        action: FastCheck.constantFrom('idle', 'attack', 'mine', 'place'),
        actionProgress: FastCheck.integer({ max: 100, min: 0 }).map((value) => value / 100),
        gaitPhaseRadians: FastCheck.integer({ max: 628, min: -628 }).map((value) => value / 100),
        movementIntensity: FastCheck.integer({ max: 100, min: 0 }).map((value) => value / 100),
        reducedMotion: FastCheck.boolean(),
      })
      FastCheck.assert(FastCheck.property(motionInput, (input) => {
        const actual = expectSuccess(planFirstPersonPose(input))
        const actionProfile = {
          attack: { drop: 0.12, forward: 0.12, swing: 0.85, twist: 0.15 },
          idle: { drop: 0, forward: 0, swing: 0, twist: 0 },
          mine: { drop: 0.18, forward: 0.07, swing: 1.1, twist: 0 },
          place: { drop: 0.025, forward: 0.11, swing: 0.28, twist: -0.08 },
        }[input.action]
        const movement = input.reducedMotion ? 0 : input.movementIntensity
        const gaitX = Math.cos(input.gaitPhaseRadians) * movement
        const gaitY = Math.sin(input.gaitPhaseRadians * 2) * movement
        const actionSwing = Math.sin(input.actionProgress * Math.PI) * (input.reducedMotion ? 0.5 : 1)
        const expected = {
          offset: {
            x: 0.42 + gaitX * 0.018,
            y: -0.38 + gaitY * 0.035 - actionSwing * actionProfile.drop,
            z: -0.72 - actionSwing * actionProfile.forward,
          },
          rotation: {
            x: actionSwing * actionProfile.swing,
            y: gaitX * 0.025,
            z: gaitX * 0.025 + actionSwing * actionProfile.twist,
          },
        }
        expect(actual.offset.x).toBeCloseTo(expected.offset.x, 10)
        expect(actual.offset.y).toBeCloseTo(expected.offset.y, 10)
        expect(actual.offset.z).toBeCloseTo(expected.offset.z, 10)
        expect(actual.rotation.x).toBeCloseTo(expected.rotation.x, 10)
        expect(actual.rotation.y).toBeCloseTo(expected.rotation.y, 10)
        expect(actual.rotation.z).toBeCloseTo(expected.rotation.z, 10)
      }))

      const direction = FastCheck.tuple(
        FastCheck.integer({ max: 20, min: -20 }),
        FastCheck.integer({ max: 20, min: -20 }),
      ).filter(([x, y]) => x !== 0 || y !== 0).map(([x, y]) => ({ x, y }))
      const damageInput = FastCheck.record({
        attackDirection: direction,
        intensity: FastCheck.integer({ max: 100, min: 0 }).map((value) => value / 100),
        reducedMotion: FastCheck.boolean(),
      })
      FastCheck.assert(FastCheck.property(damageInput, (input) => {
        const actual = expectSuccess(planDamageFeedback(input))
        const magnitude = Math.hypot(input.attackDirection.x, input.attackDirection.y)
        const normalizedX = input.attackDirection.x / magnitude
        const expectedRollMagnitude = normalizedX * 0.14 * input.intensity * (input.reducedMotion ? 0.25 : 1)
        const expected = {
          cameraRollRadians: expectedRollMagnitude === 0 ? 0 : -expectedRollMagnitude,
          directionAngleRadians: Math.atan2(input.attackDirection.y, input.attackDirection.x),
          flashOpacity: 0.48 * input.intensity,
        }
        expect(actual.cameraRollRadians).toBeCloseTo(expected.cameraRollRadians, 10)
        expect(actual.directionAngleRadians).toBeCloseTo(expected.directionAngleRadians, 10)
        expect(actual.flashOpacity).toBeCloseTo(expected.flashOpacity, 10)
      }))
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
