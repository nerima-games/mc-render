import { describe, expect, it } from '@effect/vitest'
import {
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
    expect(planWitherVisual(state('airborne'))).toStrictEqual(
      planWitherVisual(state('airborne')),
    )
  })

  it('plans charging flashes and the armoured phase as deterministic visual differences', () => {
    const flashOff = planWitherVisual(state('charging', 1.125))
    const flashOn = planWitherVisual(state('charging', 1))
    const airborne = planWitherVisual(state('airborne'))
    const armoured = planWitherVisual(state('armoured'))

    expect(flashOff.chargingFlashOn).toBe(false)
    expect(flashOn.chargingFlashOn).toBe(true)
    expect(flashOn.parts[0]?.color).not.toStrictEqual(flashOff.parts[0]?.color)
    expect(armoured.parts.length).toBeGreaterThan(airborne.parts.length)
    expect(armoured.parts.filter(({ role }) => role === 'armour')).toHaveLength(3)
    expect(armoured.parts[0]?.color).not.toStrictEqual(airborne.parts[0]?.color)
  })

  it('hides the dead phase without losing its authoritative transform', () => {
    const dead = planWitherVisual(state('dead'))

    expect(dead.visible).toBe(false)
    expect(dead.parts).toStrictEqual([])
    expect(dead.position).toStrictEqual({ x: 4, y: 70, z: -2 })
    expect(dead.yawRadians).toBeCloseTo(-Math.PI / 2, 12)
  })

  it('folds a non-finite feet-position component to zero rather than propagating NaN', () => {
    const plan = planWitherVisual({
      ...state('airborne'),
      feetPosition: { x: Number.NaN, y: 70, z: -2 },
    })

    expect(plan.position).toStrictEqual({ x: 0, y: 70, z: -2 })
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
    const normal = planWitherSkullVisual(projectile('normal'))
    const blue = planWitherSkullVisual(projectile('blue'))

    expect(normal.position).toStrictEqual({ x: 8, y: 72, z: 3 })
    expect(normal.yawRadians).toBeCloseTo(-Math.PI / 2, 12)
    expect(normal.pitchRadians).toBeCloseTo(Math.PI / 4, 12)
    expect(normal.parts[0]?.rotation[0]).toBeCloseTo(Math.PI / 4, 12)
    expect(blue.variant).toBe('blue')
    expect(blue.parts.map(({ id }) => id)).not.toStrictEqual(normal.parts.map(({ id }) => id))
  })

  it('yaws and pitches to zero for a perfectly still projectile direction', () => {
    const plan = planWitherSkullVisual({
      ...projectile('normal'),
      direction: { x: 0, y: 0, z: 0 },
    })

    expect(plan.yawRadians).toBe(0)
    expect(plan.pitchRadians).toBe(0)
  })

  it('pitches straight up for a vertical-only direction, leaving yaw at zero', () => {
    const plan = planWitherSkullVisual({
      ...projectile('normal'),
      direction: { x: 0, y: 5, z: 0 },
    })

    expect(plan.yawRadians).toBe(0)
    expect(plan.pitchRadians).toBeCloseTo(Math.PI / 2, 12)
  })
})
