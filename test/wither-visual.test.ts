import { describe, expect, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import { Result, Schema } from 'effect'
import {
  WitherSkullVisualInputSchema,
  WitherVisualStateInputSchema,
  planWitherSkullVisual,
  planWitherVisual,
  WITHER_SKULL_VISUAL_DESCRIPTORS,
  WITHER_VISUAL_DESCRIPTOR,
  type WitherSkullVisualInput,
  type WitherVisualStateInput,
} from '../src'

const ARMOURED_HEALTH_POINTS = 140
const UNARMOURED_HEALTH_POINTS = 300

const healthPointsFor = (phase: WitherVisualStateInput['phase']): number => {
  if (phase === 'armoured') {
    return ARMOURED_HEALTH_POINTS
  }
  return UNARMOURED_HEALTH_POINTS
}

const state = (
  phase: WitherVisualStateInput['phase'],
  chargeRemainingSecs = 0,
): WitherVisualStateInput => ({
  phase,
  healthPoints: healthPointsFor(phase),
  chargeRemainingSecs,
  feetPosition: { x: 4, y: 70, z: -2 },
  velocity: { x: 1, y: 0, z: 0 },
})

const projectile = (
  variant: WitherSkullVisualInput['variant'],
): WitherSkullVisualInput => ({
  kind: 'wither_skull',
  variant,
  origin: { x: 8, y: 72, z: 3 },
  direction: { x: 1, y: 1, z: 0 },
  speed: 20,
  explosivePower: 1,
  destroysResistantBlocks: variant === 'blue',
})

const resolvedWitherPlan = (input: unknown) => Result.getOrThrow(planWitherVisual(input))
const resolvedSkullPlan = (input: unknown) => Result.getOrThrow(planWitherSkullVisual(input))

describe('Wither visual descriptors', () => {
  it('publishes a stable three-headed body, rib cage, and tail silhouette', () => {
    const roles = WITHER_VISUAL_DESCRIPTOR.parts.map(({ role }) => role)
    const ids = WITHER_VISUAL_DESCRIPTOR.parts.map(({ id }) => id)

    expect(WITHER_VISUAL_DESCRIPTOR.kind).toBe('wither')
    expect(roles.filter((role) => role === 'head')).toHaveLength(3)
    expect(roles.filter((role) => role === 'body')).toHaveLength(2)
    expect(roles.filter((role) => role === 'rib')).toHaveLength(3)
    expect(roles.filter((role) => role === 'tail')).toHaveLength(2)
    expect(new Set(ids)).toHaveLength(ids.length)
    expect(resolvedWitherPlan(state('airborne'))).toStrictEqual(
      resolvedWitherPlan(state('airborne')),
    )
  })

  it('plans charging flashes and the armoured phase as deterministic visual differences', () => {
    const flashOff = resolvedWitherPlan(state('charging', 1.125))
    const flashOn = resolvedWitherPlan(state('charging', 1))
    const airborne = resolvedWitherPlan(state('airborne'))
    const armoured = resolvedWitherPlan(state('armoured'))

    expect(flashOff.chargingFlashOn).toBe(false)
    expect(flashOn.chargingFlashOn).toBe(true)
    expect(flashOn.parts[0]?.color).not.toStrictEqual(flashOff.parts[0]?.color)
    expect(armoured.parts.length).toBeGreaterThan(airborne.parts.length)
    expect(armoured.parts.filter(({ role }) => role === 'armour')).toHaveLength(3)
    expect(armoured.parts[0]?.color).not.toStrictEqual(airborne.parts[0]?.color)
  })

  it('hides the dead phase without losing its authoritative transform', () => {
    const dead = resolvedWitherPlan(state('dead'))

    expect(dead.visible).toBe(false)
    expect(dead.parts).toStrictEqual([])
    expect(dead.position).toStrictEqual({ x: 4, y: 70, z: -2 })
    expect(dead.yawRadians).toBeCloseTo(-Math.PI / 2, 12)
  })

  it('rejects invalid state numbers with typed Schema failures', () => {
    const invalidStates = [
      { ...state('airborne'), feetPosition: { x: Number.NaN, y: 70, z: -2 } },
      { ...state('airborne'), velocity: { x: 1, y: Number.POSITIVE_INFINITY, z: 0 } },
      { ...state('airborne'), healthPoints: -Number.MIN_VALUE },
      { ...state('airborne'), chargeRemainingSecs: Number.NaN },
      { ...state('airborne'), unexpected: true },
    ]

    for (const input of invalidStates) {
      const result = planWitherVisual(input)
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(Schema.isSchemaError(result.failure)).toBe(true)
      }
    }
  })

  it('accepts zero and finite position limits, and rejects values just outside state limits', () => {
    const boundary = {
      ...state('charging', 0),
      healthPoints: 0,
      feetPosition: { x: Number.MAX_VALUE, y: -Number.MAX_VALUE, z: 0 },
    }
    expect(Result.isSuccess(Schema.decodeUnknownResult(WitherVisualStateInputSchema)(boundary))).toBe(true)
    expect(Result.isSuccess(planWitherVisual(boundary))).toBe(true)

    for (const input of [
      { ...boundary, healthPoints: -Number.MIN_VALUE },
      { ...boundary, chargeRemainingSecs: -Number.MIN_VALUE },
      { ...boundary, feetPosition: { ...boundary.feetPosition, z: Number.POSITIVE_INFINITY } },
      { ...boundary, velocity: { x: 0, y: Number.NEGATIVE_INFINITY, z: 0 } },
    ]) {
      expect(Result.isFailure(planWitherVisual(input))).toBe(true)
    }
  })

  it('plans generated finite positions and nonnegative state values', () => {
    const finite = FastCheck.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true })
    const nonNegative = FastCheck.double({ min: 0, max: 1000, noNaN: true, noDefaultInfinity: true })
    const validState = FastCheck.record({
      chargeRemainingSecs: nonNegative,
      feetX: finite,
      feetY: finite,
      feetZ: finite,
      healthPoints: nonNegative,
      velocityX: finite,
      velocityY: finite,
      velocityZ: finite,
    })

    FastCheck.assert(FastCheck.property(validState, (sample) => Result.isSuccess(planWitherVisual({
      chargeRemainingSecs: sample.chargeRemainingSecs,
      feetPosition: { x: sample.feetX, y: sample.feetY, z: sample.feetZ },
      healthPoints: sample.healthPoints,
      phase: 'airborne',
      velocity: { x: sample.velocityX, y: sample.velocityY, z: sample.velocityZ },
    }))))
  })
})

describe('Wither skull visual descriptors', () => {
  it('publishes distinct normal and blue projectile silhouettes', () => {
    const {normal} = WITHER_SKULL_VISUAL_DESCRIPTORS
    const {blue} = WITHER_SKULL_VISUAL_DESCRIPTORS

    expect(normal.variant).toBe('normal')
    expect(blue.variant).toBe('blue')
    expect(blue.parts.length).toBeGreaterThan(normal.parts.length)
    expect(blue.parts[0]?.color).not.toStrictEqual(normal.parts[0]?.color)
  })

  it('derives position, yaw, and pitch from the projectile descriptor', () => {
    const normal = resolvedSkullPlan(projectile('normal'))
    const blue = resolvedSkullPlan(projectile('blue'))

    expect(normal.position).toStrictEqual({ x: 8, y: 72, z: 3 })
    expect(normal.yawRadians).toBeCloseTo(-Math.PI / 2, 12)
    expect(normal.pitchRadians).toBeCloseTo(Math.PI / 4, 12)
    expect(normal.parts[0]?.rotation[0]).toBeCloseTo(Math.PI / 4, 12)
    expect(blue.variant).toBe('blue')
    expect(blue.parts.map(({ id }) => id)).not.toStrictEqual(normal.parts.map(({ id }) => id))
  })

  it('yaws and pitches to zero for a perfectly still projectile direction', () => {
    const plan = resolvedSkullPlan({
      ...projectile('normal'),
      direction: { x: 0, y: 0, z: 0 },
    })

    expect(plan.yawRadians).toBe(0)
    expect(plan.pitchRadians).toBe(0)
  })

  it('pitches straight up for a vertical-only direction, leaving yaw at zero', () => {
    const plan = resolvedSkullPlan({
      ...projectile('normal'),
      direction: { x: 0, y: 5, z: 0 },
    })

    expect(plan.yawRadians).toBe(0)
    expect(plan.pitchRadians).toBeCloseTo(Math.PI / 2, 12)
  })

  it('rejects invalid projectile numeric values with typed Schema failures', () => {
    const invalidProjectiles = [
      { ...projectile('normal'), origin: { x: 0, y: Number.NaN, z: 0 } },
      { ...projectile('normal'), direction: { x: 0, y: 0, z: Number.POSITIVE_INFINITY } },
      { ...projectile('normal'), speed: Number.POSITIVE_INFINITY },
      { ...projectile('normal'), explosivePower: -Number.MIN_VALUE },
      { ...projectile('normal'), extra: true },
    ]

    for (const input of invalidProjectiles) {
      const result = planWitherSkullVisual(input)
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(Schema.isSchemaError(result.failure)).toBe(true)
      }
    }
  })

  it('accepts zero projectile limits and rejects values just outside them', () => {
    const boundary = {
      ...projectile('blue'),
      origin: { x: Number.MAX_VALUE, y: -Number.MAX_VALUE, z: 0 },
      direction: { x: 0, y: 0, z: 0 },
      speed: 0,
      explosivePower: 0,
    }
    expect(Result.isSuccess(Schema.decodeUnknownResult(WitherSkullVisualInputSchema)(boundary))).toBe(true)
    expect(Result.isSuccess(planWitherSkullVisual(boundary))).toBe(true)

    for (const input of [
      { ...boundary, speed: -Number.MIN_VALUE },
      { ...boundary, explosivePower: -Number.MIN_VALUE },
      { ...boundary, direction: { x: Number.NaN, y: 0, z: 0 } },
      { ...boundary, origin: { x: 0, y: 0, z: Number.NEGATIVE_INFINITY } },
    ]) {
      expect(Result.isFailure(planWitherSkullVisual(input))).toBe(true)
    }
  })

  it('plans generated finite projectiles with nonnegative speed and power', () => {
    const finite = FastCheck.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true })
    const nonNegative = FastCheck.double({ min: 0, max: 1000, noNaN: true, noDefaultInfinity: true })
    FastCheck.assert(FastCheck.property(
      FastCheck.record({
        directionX: finite,
        directionY: finite,
        directionZ: finite,
        originX: finite,
        originY: finite,
        originZ: finite,
        explosivePower: nonNegative,
        speed: nonNegative,
        variant: FastCheck.constantFrom('normal' as const, 'blue' as const),
      }),
      (sample) => Result.isSuccess(planWitherSkullVisual({
        destroysResistantBlocks: false,
        direction: { x: sample.directionX, y: sample.directionY, z: sample.directionZ },
        explosivePower: sample.explosivePower,
        kind: 'wither_skull',
        origin: { x: sample.originX, y: sample.originY, z: sample.originZ },
        speed: sample.speed,
        variant: sample.variant,
      })),
    ))
  })
})
