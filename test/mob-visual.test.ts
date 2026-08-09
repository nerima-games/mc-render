import { describe, expect, it } from '@effect/vitest'
import {
  MOB_VISUAL_KINDS,
  UNKNOWN_MOB_VISUAL,
  mobVisualDescriptor,
  planMobVisual,
} from '../src/domain/mob-visual'

const hostileKinds = [
  'zombie',
  'creeper',
  'enderman',
  'skeleton',
  'spider',
  'zombified_piglin',
  'blaze',
] as const

const passiveKinds = ['cow', 'pig', 'sheep', 'chicken'] as const

describe('mob visual descriptors', () => {
  it('covers the supported roster with distinct deterministic silhouettes', () => {
    expect(MOB_VISUAL_KINDS).toStrictEqual([...hostileKinds.slice(0, 3), 'skeleton', 'spider', ...passiveKinds, 'zombified_piglin', 'blaze'])

    const signatures = MOB_VISUAL_KINDS.map((kind) => {
      const descriptor = mobVisualDescriptor(kind)
      expect(descriptor.kind).toBe(kind)
      expect(descriptor.parts.length).toBeGreaterThan(0)
      expect(descriptor.parts.map(({ id }) => id)).toHaveLength(new Set(descriptor.parts.map(({ id }) => id)).size)
      for (const visualPart of descriptor.parts) {
        expect(visualPart.size.every((component) => component > 0)).toBe(true)
        expect(visualPart.color.every((component) => Number.isInteger(component) && component >= 0 && component <= 255)).toBe(true)
      }
      return JSON.stringify({ scale: descriptor.scale, parts: descriptor.parts })
    })

    expect(new Set(signatures).size).toBe(MOB_VISUAL_KINDS.length)
  })

  it('classifies hostile and passive mobs independently of the renderer', () => {
    expect(hostileKinds.map((kind) => mobVisualDescriptor(kind).temperament)).toStrictEqual(
      hostileKinds.map(() => 'hostile'),
    )
    expect(passiveKinds.map((kind) => mobVisualDescriptor(kind).temperament)).toStrictEqual(
      passiveKinds.map(() => 'passive'),
    )
  })

  it('models the spider and blaze special silhouettes explicitly', () => {
    expect(mobVisualDescriptor('spider').parts.filter(({ role }) => role === 'leg')).toHaveLength(8)
    expect(mobVisualDescriptor('blaze').parts.filter(({ role }) => role === 'blaze_rod')).toHaveLength(12)
  })

  it('uses one stable neutral fallback for unknown kinds', () => {
    expect(mobVisualDescriptor('warden-from-the-future')).toBe(UNKNOWN_MOB_VISUAL)
    expect(mobVisualDescriptor('')).toBe(UNKNOWN_MOB_VISUAL)
    expect(planMobVisual('unknown-kind').descriptorKind).toBe('unknown')
    expect(planMobVisual('unknown-kind').temperament).toBe('neutral')
  })
})

describe('mob animation planning', () => {
  it('returns the same plan for the same explicit animation sample', () => {
    const input = { state: 'walk', phaseRadians: 1.25, progress: 0.4 } as const
    expect(planMobVisual('blaze', input)).toStrictEqual(planMobVisual('blaze', input))
  })

  it('swings paired walking limbs in opposite directions', () => {
    const plan = planMobVisual('zombie', { state: 'walk', phaseRadians: Math.PI / 2 })
    const leftArm = plan.parts.find(({ id }) => id === 'left-arm')
    const rightArm = plan.parts.find(({ id }) => id === 'right-arm')

    expect(leftArm?.rotation[0]).toBeCloseTo(0.65, 12)
    expect(rightArm?.rotation[0]).toBeCloseTo(-0.65, 12)
  })

  it('produces distinct idle, hurt, and death poses without mutable runtime state', () => {
    const idleAtRest = planMobVisual('cow', { state: 'idle', phaseRadians: 0 })
    const idleAtPeak = planMobVisual('cow', { state: 'idle', phaseRadians: Math.PI })
    const hurt = planMobVisual('cow', { state: 'hurt', progress: 1 })
    const death = planMobVisual('cow', { state: 'death', progress: 1 })

    expect(idleAtPeak.parts[0]?.center[1]).toBeCloseTo((idleAtRest.parts[0]?.center[1] ?? 0) + 0.025, 12)
    expect(hurt.parts[0]?.rotation[2]).toBeCloseTo(0.24, 12)
    expect(death.parts[0]?.rotation[2]).toBeCloseTo(Math.PI / 2, 12)
  })

  it('normalises invalid phases and clamps transition progress', () => {
    expect(planMobVisual('zombie', { state: 'walk', phaseRadians: Number.NaN })).toStrictEqual(
      planMobVisual('zombie', { state: 'walk', phaseRadians: 0 }),
    )
    expect(planMobVisual('zombie', { state: 'death', progress: 99 })).toStrictEqual(
      planMobVisual('zombie', { state: 'death', progress: 1 }),
    )
    expect(planMobVisual('zombie', { state: 'hurt' }).animation.progress).toBe(1)
  })

  it('rotates spider legs per-row, mirrored left vs right', () => {
    // domain/mob-visual.ts's applyPartMotion, front row (motionIndex 0), at phase pi/2:
    //   rotationY = (0 - 1.5) * 0.18 = -0.27, mirrored to +0.27 on the right.
    //   rotationZ = -0.72 - sin(pi/2 + 0) * 0.12 = -0.84, mirrored to +0.84 on the right.
    const plan = planMobVisual('spider', { state: 'idle', phaseRadians: Math.PI / 2 })
    const leftLeg1 = plan.parts.find(({ id }) => id === 'left-leg-1')
    const rightLeg1 = plan.parts.find(({ id }) => id === 'right-leg-1')

    expect(leftLeg1?.rotation[1]).toBeCloseTo(-0.27, 12)
    expect(leftLeg1?.rotation[2]).toBeCloseTo(-0.84, 12)
    expect(rightLeg1?.rotation[1]).toBeCloseTo(0.27, 12)
    expect(rightLeg1?.rotation[2]).toBeCloseTo(0.84, 12)
  })

  it('flaps chicken wings symmetrically opposite, scaled by the phase', () => {
    // domain/mob-visual.ts's applyPartMotion at phase pi/2 (|sin| = 1):
    //   rotationZ = -0.18 - 1 * 0.65 = -0.83, mirrored to +0.83 on the right.
    const plan = planMobVisual('chicken', { state: 'idle', phaseRadians: Math.PI / 2 })
    const leftWing = plan.parts.find(({ id }) => id === 'left-wing')
    const rightWing = plan.parts.find(({ id }) => id === 'right-wing')

    expect(leftWing?.rotation[2]).toBeCloseTo(-0.83, 12)
    expect(rightWing?.rotation[2]).toBeCloseTo(0.83, 12)
  })
})
