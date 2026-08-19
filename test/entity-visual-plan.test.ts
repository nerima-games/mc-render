import { describe, expect, it } from '@effect/vitest'
import { planMobVisual } from '../src/domain/mob-visual'
import { planWitherSkullVisual, planWitherVisual } from '../src/domain/wither-visual'
import { copyRenderEntity, planEntityVisual, type RenderEntity } from '../src/application/entity-visual-plan'

const position = { x: 4, y: 70, z: -2 }

const entity = (overrides: Partial<RenderEntity> = {}): RenderEntity => ({
  feetPosition: position,
  id: 'entity-1',
  kind: 'zombie',
  ...overrides,
})

describe('entity visual planning', () => {
  it('plans an item as a small gold cube at the entity position', () => {
    const plan = planEntityVisual(entity({ category: 'item', facingRadians: Math.PI / 2 }))

    expect(plan.position).toBe(position)
    expect(plan.facingRadians).toBe(Math.PI / 2)
    expect(plan.parts).toStrictEqual([
      {
        center: [0, 0.15, 0],
        color: [225, 165, 65],
        id: 'item',
        role: 'body',
        rotation: [0, 0, 0],
        size: [0.3, 0.3, 0.3],
      },
    ])
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

    expect(planEntityVisual(entity({ kind: 'wither', witherState }))).toStrictEqual({
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

    expect(planEntityVisual(entity({ kind: 'wither_skull', witherSkullProjectile: projectile }))).toStrictEqual({
      facingRadians: visual.yawRadians,
      parts: visual.parts,
      position: visual.position,
    })
  })

  it('uses a finite default facing for the ordinary mob path', () => {
    const animation = { phaseRadians: Math.PI / 2, state: 'walk' as const }

    expect(planEntityVisual(entity({ animation, facingRadians: Number.NaN }))).toStrictEqual({
      facingRadians: 0,
      parts: planMobVisual('zombie', animation).parts,
      position,
    })
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
