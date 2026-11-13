import { describe, expect, it } from '@effect/vitest'
import { Result, Schema } from 'effect'
import { EntityRenderProgressSchema } from '../src/domain/entity-render-input'
import { planMobVisual } from '../src/domain/mob-visual'
import { planWitherSkullVisual, planWitherVisual } from '../src/domain/wither-visual'
import { copyRenderEntity, planEntityVisual, type RenderEntity } from '../src/application/entity-visual-plan'

const position = { x: 4, y: 70, z: -2 }
const entityRenderProgress = Schema.decodeUnknownSync(EntityRenderProgressSchema)

const entity = (overrides: Partial<RenderEntity> = {}): RenderEntity => ({
  feetPosition: position,
  id: 'entity-1',
  kind: 'zombie',
  ...overrides,
})

const expectPlannedVisual = (source: RenderEntity, expected: unknown): void => {
  const planned = planEntityVisual(source)
  expect(Result.isSuccess(planned)).toBe(true)
  if (Result.isSuccess(planned)) {
    expect(planned.success).toStrictEqual(expected)
  }
}

describe('entity visual planning', () => {
  it('plans an item as a small gold cube at the entity position', () => {
    expectPlannedVisual(entity({ category: 'item', facingRadians: Math.PI / 2 }), {
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

  it('adapts the wither domain plan without duplicating its state rules', () => {
    const witherState = {
      chargeRemainingSecs: 0,
      feetPosition: position,
      healthPoints: 300,
      phase: 'airborne' as const,
      velocity: { x: 1, y: 0, z: 0 },
    }
    const visual = planWitherVisual(witherState)

    expectPlannedVisual(entity({ kind: 'wither', witherState }), {
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
    const visual = planWitherSkullVisual(projectile)

    expectPlannedVisual(entity({ kind: 'wither_skull', witherSkullProjectile: projectile }), {
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
    const visual = planWitherVisual({
      chargeRemainingSecs: 0,
      feetPosition: position,
      healthPoints: 300,
      phase: 'airborne',
      velocity: { x: -Math.sin(facingRadians), y: 0, z: -Math.cos(facingRadians) },
    })

    expectPlannedVisual(entity({ facingRadians, kind: 'wither' }), {
      facingRadians: visual.yawRadians,
      parts: visual.parts,
      position: visual.position,
    })
  })

  it('plans a wither skull with no reported projectile as a freshly spawned, harmless one', () => {
    // Same fallback shape as the wither case above, for the projectile
    // instead of the boss state.
    const facingRadians = Math.PI / 4
    const visual = planWitherSkullVisual({
      destroysResistantBlocks: false,
      direction: { x: -Math.sin(facingRadians), y: 0, z: -Math.cos(facingRadians) },
      explosivePower: 0,
      kind: 'wither_skull',
      origin: position,
      speed: 0,
      variant: 'normal',
    })

    expectPlannedVisual(entity({ facingRadians, kind: 'wither_skull' }), {
      facingRadians: visual.yawRadians,
      parts: visual.parts,
      position: visual.position,
    })
  })

  it('uses the default facing only when the ordinary mob omits orientation', () => {
    const animation = { phaseRadians: Math.PI / 2, state: 'walk' as const }

    expectPlannedVisual(entity({ animation }), {
      facingRadians: 0,
      parts: planMobVisual('zombie', animation).parts,
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
      category: 'hostile',
      facingRadians: 2,
      feetPosition: position,
      id: 'wither-skull-1',
      kind: 'wither_skull',
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
