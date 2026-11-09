import { describe, expect, it } from '@effect/vitest'
import { Result, Schema } from 'effect'
import { EntityRenderProgressSchema } from '../src/domain/entity-render-input'
import { planMobVisual } from '../src/domain/mob-visual'
import { itemIconUvForItemId } from '../src/domain/item-icon-map'
import { planWitherSkullVisual, planWitherVisual } from '../src/domain/wither-visual'
import { copyRenderEntity, planEntityVisual } from '../src/application/entity-visual-plan'

const position = { x: 4, y: 70, z: -2 }
const entityRenderProgress = Schema.decodeUnknownSync(EntityRenderProgressSchema)
const resolvedMobPlan = (kind: string, animation: unknown) =>
  Result.getOrThrow(planMobVisual(kind, animation))
const resolvedWitherPlan = (input: unknown) => Result.getOrThrow(planWitherVisual(input))
const resolvedSkullPlan = (input: unknown) => Result.getOrThrow(planWitherSkullVisual(input))
type RenderEntity = Parameters<typeof planEntityVisual>[0]

const entity = (overrides: Partial<RenderEntity> = {}): RenderEntity => ({
  feetPosition: position,
  id: 'entity-1',
  kind: 'zombie',
  ...overrides,
})

const expectVisualShape = (source: RenderEntity, expected: unknown): void => {
  const planned = planEntityVisual(source)
  expect(Result.isSuccess(planned)).toBe(true)
  if (Result.isSuccess(planned)) {
    const { textureCoordinates, ...visualShape } = planned.success
    expect(visualShape).toStrictEqual(expected)
    expect(textureCoordinates).toHaveLength(4)
  }
}

describe('entity visual planning', () => {
  it('plans an item as a small gold cube at the entity position', () => {
    expectVisualShape(entity({ category: 'item', facingRadians: Math.PI / 2 }), {
      facingRadians: Math.PI / 2,
      parts: [
        {
          center: [0, 0.15, 0],
          color: [225, 165, 65],
          id: 'item',
          role: 'body',
          rotation: [0, 0, 0],
          size: [0.3, 0.3, 0.3],
        },
      ],
      position,
    })
  })

  it('plans a registered dropped-item ID as an atlas card', () => {
    const bounds = itemIconUvForItemId('bookshelf')
    expect(Result.isSuccess(bounds)).toBe(true)
    if (Result.isFailure(bounds)) {
      return
    }
    const planned = planEntityVisual(entity({ category: 'item', itemId: 'bookshelf', kind: 'dropped_item' }), true)
    expect(Result.isSuccess(planned)).toBe(true)
    if (Result.isSuccess(planned)) {
      expect(planned.success.parts).toStrictEqual([{
        center: [0, 0.2, 0],
        color: [255, 255, 255],
        iconUv: bounds.success,
        id: 'item-icon',
        role: 'body',
        rotation: [0, 0, 0],
        size: [0.34, 0.34, 0.01],
      }])
    }
  })

  it('keeps a dropped item on the fallback cube path when its identity is missing', () => {
    expectVisualShape(entity({ category: 'item', kind: 'dropped_item' }), {
      facingRadians: 0,
      parts: [{
        center: [0, 0.15, 0],
        color: [225, 165, 65],
        id: 'item',
        role: 'body',
        rotation: [0, 0, 0],
        size: [0.3, 0.3, 0.3],
      }],
      position,
    })
  })

  it('plans arrows and ender eyes with distinct multi-part geometry', () => {
    const arrow = planEntityVisual(entity({ category: 'item', kind: 'arrow' }))
    const eye = planEntityVisual(entity({ category: 'item', kind: 'eye_of_ender' }))

    expect(Result.isSuccess(arrow)).toBe(true)
    expect(Result.isSuccess(eye)).toBe(true)
    if (Result.isFailure(arrow) || Result.isFailure(eye)) {
      return
    }
    expect(arrow.success.parts.map(({ id }) => id)).toStrictEqual(['arrow-shaft', 'arrow-head', 'arrow-fletching'])
    expect(eye.success.parts.map(({ id }) => id)).toStrictEqual(['eye-shell', 'eye-iris', 'eye-pupil'])
    expect(arrow.success.parts).not.toStrictEqual(eye.success.parts)
  })

  it('adapts the wither domain plan without duplicating its state rules', () => {
    const witherState = {
      chargeRemainingSecs: 0,
      feetPosition: position,
      healthPoints: 300,
      phase: 'airborne' as const,
      velocity: { x: 1, y: 0, z: 0 },
    }
    const visual = resolvedWitherPlan(witherState)

    expectVisualShape(entity({ kind: 'wither', witherState }), {
      facingRadians: visual.yawRadians,
      parts: visual.parts,
      position: visual.position,
    })
  })

  it('adapts the wither-skull domain plan without duplicating projectile rules', () => {
    const projectile = {
      destroysResistantBlocks: false,
      direction: { x: 1, y: 1, z: 0 },
      explosivePower: 1,
      kind: 'wither_skull' as const,
      origin: position,
      speed: 20,
      variant: 'normal' as const,
    }
    const visual = resolvedSkullPlan(projectile)

    expectVisualShape(entity({ kind: 'wither_skull', witherSkullProjectile: projectile }), {
      facingRadians: visual.yawRadians,
      parts: visual.parts,
      position: visual.position,
    })
  })

  it('plans a wither with no reported state as a freshly spawned, airborne one', () => {
    // `entity.witherState` is `undefined` for a wither this repository has
    // not yet received a state update for — a spawn frame, most plausibly.
    // The fallback must still produce a real plan rather than throwing, and
    // its velocity must follow the facing this caller reports.
    const facingRadians = Math.PI
    const visual = resolvedWitherPlan({
      chargeRemainingSecs: 0,
      feetPosition: position,
      healthPoints: 300,
      phase: 'airborne',
      velocity: { x: -Math.sin(facingRadians), y: 0, z: -Math.cos(facingRadians) },
    })

    expectVisualShape(entity({ facingRadians, kind: 'wither' }), {
      facingRadians: visual.yawRadians,
      parts: visual.parts,
      position: visual.position,
    })
  })

  it('plans a wither skull with no reported projectile as a freshly spawned, harmless one', () => {
    // Same fallback shape as the wither case above, for the projectile
    // instead of the boss state.
    const facingRadians = Math.PI / 4
    const visual = resolvedSkullPlan({
      destroysResistantBlocks: false,
      direction: { x: -Math.sin(facingRadians), y: 0, z: -Math.cos(facingRadians) },
      explosivePower: 0,
      kind: 'wither_skull',
      origin: position,
      speed: 0,
      variant: 'normal',
    })

    expectVisualShape(entity({ facingRadians, kind: 'wither_skull' }), {
      facingRadians: visual.yawRadians,
      parts: visual.parts,
      position: visual.position,
    })
  })

  it('uses the default facing only when the ordinary mob omits orientation', () => {
    const animation = { phaseRadians: Math.PI / 2, state: 'walk' as const }

    expectVisualShape(entity({ animation }), {
      facingRadians: 0,
      parts: resolvedMobPlan('zombie', animation).parts,
      position,
    })
  })

  it('uses catalog models for generic kinds and animates role parts from frame inputs', () => {
    const planned = planEntityVisual(entity({
      animation: {
        attackProgress: entityRenderProgress(0.5),
        phaseRadians: Math.PI / 2,
        progress: 0.5,
        state: 'walk',
        walkAmount: entityRenderProgress(0.5),
      },
      bodyYawRadians: Math.PI / 2,
      kind: 'horse',
    }))

    expect(Result.isSuccess(planned)).toBe(true)
    if (Result.isFailure(planned)) {
      return
    }
    expect(planned.success.facingRadians).toBe(Math.PI / 2)
    const legRotations = planned.success.parts
      .filter((part) => part.role === 'leg')
      .map((part) => part.rotation[0])
    expect(legRotations.length).toBeGreaterThanOrEqual(2)
    expect(legRotations[0]).toBeCloseTo(0.65 * 0.5, 12)
    expect(legRotations[1]).toBeCloseTo(-0.65 * 0.5, 12)
  })

  it('animates armor-stand arms from a zero base rotation', () => {
    const planned = Result.getOrThrow(planEntityVisual(entity({
      animation: { phaseRadians: Math.PI / 2, state: 'walk' },
      kind: 'armor_stand',
    })))
    const armRotations = planned.parts
      .filter((part) => part.role === 'arm')
      .map((part) => part.rotation)

    expect(armRotations).toStrictEqual([[0.45, 0, 0], [-0.45, 0, 0]])
  })

  it('animates unnamed bee wings in opposite directions when progress is omitted', () => {
    const staticPlan = Result.getOrThrow(planEntityVisual(entity({ kind: 'bee' })))
    const animatedPlan = Result.getOrThrow(planEntityVisual(entity({
      animation: { phaseRadians: Math.PI / 2, state: 'idle' },
      kind: 'bee',
    })))
    const staticWings = staticPlan.parts.filter((part) => part.role === 'wing')
    const animatedWings = animatedPlan.parts.filter((part) => part.role === 'wing')
    const rotationChanges = animatedWings.map((part, index) => part.rotation[2] - staticWings[index]!.rotation[2])

    expect(animatedWings).toHaveLength(2)
    expect(rotationChanges[0]).toBeLessThan(0)
    expect(rotationChanges[1]).toBeGreaterThan(0)
  })

  it('applies the default hurt progress to generic catalog models', () => {
    const planned = Result.getOrThrow(planEntityVisual(entity({
      animation: { phaseRadians: 0, state: 'hurt' },
      kind: 'piglin',
    })))
    const torso = planned.parts.find((part) => part.role === 'torso')

    expect(torso?.rotation[2]).toBeCloseTo(0.24, 12)
  })

  it('uses walk state as the default amount for generic catalog models', () => {
    const planned = Result.getOrThrow(planEntityVisual(entity({
      animation: { phaseRadians: Math.PI / 2, state: 'walk' },
      kind: 'piglin',
    })))
    const legRotations = planned.parts
      .filter((part) => part.role === 'leg')
      .map((part) => part.rotation[0])

    expect(legRotations).toHaveLength(2)
    expect(legRotations.some((rotation) => rotation !== 0)).toBe(true)
  })

  it('reports invalid and unknown generic kinds as typed planning failures', () => {
    const empty = planEntityVisual(entity({ kind: '' }))
    const unknown = planEntityVisual(entity({ kind: 'future_entity' }))

    expect(Result.isFailure(empty)).toBe(true)
    if (Result.isFailure(empty)) {
      expect(empty.failure).toStrictEqual({ _tag: 'InvalidEntityModelKind', reason: 'empty' })
    }
    expect(Result.isFailure(unknown)).toBe(true)
    if (Result.isFailure(unknown)) {
      expect(unknown.failure).toStrictEqual({
        _tag: 'UnsupportedEntityModel',
        kind: 'future_entity',
      })
    }
  })

  it('propagates invalid public animation and Wither inputs as Schema failures', () => {
    const invalidMob = planEntityVisual(entity({
      animation: { phaseRadians: 2 * Math.PI, state: 'walk' },
    }))
    const invalidWither = planEntityVisual(entity({
      kind: 'wither',
      witherState: {
        chargeRemainingSecs: -Number.MIN_VALUE,
        feetPosition: position,
        healthPoints: 300,
        phase: 'airborne',
        velocity: { x: 0, y: 0, z: -1 },
      },
    }))

    for (const result of [invalidMob, invalidWither]) {
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(Schema.isSchemaError(result.failure)).toBe(true)
      }
    }
  })

  it('copies a minimal entity without inventing any of the optional fields', () => {
    // The counterpart to the fully-populated case below: every optional
    // field's `copied*` helper has an "absent" branch (`return {}`) that a
    // fully-populated source never exercises. `id`/`kind`/`feetPosition` are
    // the only fields `RenderEntity` requires.
    const source: RenderEntity = {
      feetPosition: position,
      id: 'minimal-1',
      kind: 'zombie',
    }

    const copy = copyRenderEntity(source)

    expect(copy).toStrictEqual({ feetPosition: position, id: 'minimal-1', kind: 'zombie' })
    expect('category' in copy).toBe(false)
    expect('facingRadians' in copy).toBe(false)
    expect('animation' in copy).toBe(false)
    expect('witherState' in copy).toBe(false)
    expect('witherSkullProjectile' in copy).toBe(false)
    expect(copy.feetPosition).not.toBe(source.feetPosition)
  })

  it('copies nested entity projections without retaining source references', () => {
    const source: RenderEntity = {
      animation: { phaseRadians: 1, state: 'walk' },
      bodyYawRadians: 0.5,
      category: 'hostile',
      facingRadians: 2,
      feetPosition: position,
      headYawRadians: -0.5,
      id: 'wither-skull-1',
      kind: 'wither_skull',
      pitchRadians: 0.25,
      witherSkullProjectile: {
        destroysResistantBlocks: true,
        direction: { x: 1, y: 2, z: 3 },
        explosivePower: 2,
        kind: 'wither_skull',
        origin: position,
        speed: 20,
        variant: 'blue',
      },
      witherState: {
        chargeRemainingSecs: 1,
        feetPosition: position,
        healthPoints: 300,
        phase: 'airborne',
        velocity: { x: 4, y: 5, z: 6 },
      },
    }

    const copy = copyRenderEntity(source)

    expect(copy).toStrictEqual(source)
    expect(copy).not.toBe(source)
    expect(copy.feetPosition).not.toBe(source.feetPosition)
    expect(copy.animation).not.toBe(source.animation)
    expect(copy.witherState).not.toBe(source.witherState)
    expect(copy.witherState?.feetPosition).not.toBe(source.witherState?.feetPosition)
    expect(copy.witherState?.velocity).not.toBe(source.witherState?.velocity)
    expect(copy.witherSkullProjectile).not.toBe(source.witherSkullProjectile)
    expect(copy.witherSkullProjectile?.direction).not.toBe(source.witherSkullProjectile?.direction)
    expect(copy.witherSkullProjectile?.origin).not.toBe(source.witherSkullProjectile?.origin)
  })
})
