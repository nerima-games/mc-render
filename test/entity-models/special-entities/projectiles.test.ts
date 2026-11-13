import { describe, expect, it } from '@effect/vitest'
import { PROJECTILE_ENTITY_MODELS } from '../../../src/domain/entity-models/special-entities/projectiles.js'
import type { EntityModelDescriptor } from '../../../src/domain/entity-models/types.js'

const EXPECTED_KINDS = [
  'arrow',
  'breeze_wind_charge',
  'dragon_fireball',
  'egg',
  'ender_pearl',
  'experience_bottle',
  'fireball',
  'firework_rocket',
  'fishing_bobber',
  'llama_spit',
  'potion',
  'shulker_bullet',
  'small_fireball',
  'snowball',
  'spectral_arrow',
  'trident',
  'wind_charge',
  'wither_skull',
] as const

const visualSignature = (descriptor: EntityModelDescriptor): string =>
  descriptor.parts
    .map(({ role, size, center, color }) => JSON.stringify([role, size, center, color]))
    .sort()
    .join('|')

describe('projectile entity model descriptors', () => {
  it('publishes all assigned projectile kinds', () => {
    expect(PROJECTILE_ENTITY_MODELS.map(({ kind }) => kind)).toStrictEqual(EXPECTED_KINDS)
  })

  it('gives every kind non-empty valid geometry', () => {
    for (const descriptor of PROJECTILE_ENTITY_MODELS) {
      expect(descriptor.parts.length, descriptor.kind).toBeGreaterThan(0)
      expect(descriptor.parts.every(({ size, center, color }) =>
        size.every((component) => Number.isFinite(component) && component > 0)
        && center.every(Number.isFinite)
        && color.every((component) => Number.isFinite(component) && component >= 0 && component <= 255),
      ), descriptor.kind).toBe(true)
    }
  })

  it('gives each kind a distinct visible signature independent of part IDs', () => {
    const signatures = PROJECTILE_ENTITY_MODELS.map(visualSignature)

    expect(new Set(signatures).size).toBe(EXPECTED_KINDS.length)
  })

  it('uses recognizable shaft, orb, bottle, rocket, trident, and wind-charge forms', () => {
    const rolesByKind = new Map<string, Set<string>>(
      PROJECTILE_ENTITY_MODELS.map(({ kind, parts }): readonly [string, Set<string>] => [
        kind,
        new Set<string>(parts.map(({ role }) => role)),
      ]),
    )

    expect(rolesByKind.get('arrow')?.has('arrow-shaft')).toBe(true)
    expect(rolesByKind.get('arrow')?.has('arrowhead')).toBe(true)
    expect(rolesByKind.get('spectral_arrow')?.has('spectral-shaft')).toBe(true)
    expect(rolesByKind.get('dragon_fireball')?.has('dragon-orb')).toBe(true)
    expect(rolesByKind.get('ender_pearl')?.has('pearl-orb')).toBe(true)
    expect(rolesByKind.get('experience_bottle')?.has('bottle-neck')).toBe(true)
    expect(rolesByKind.get('potion')?.has('potion-cork')).toBe(true)
    expect(rolesByKind.get('firework_rocket')?.has('rocket-body')).toBe(true)
    expect(rolesByKind.get('firework_rocket')?.has('rocket-fin')).toBe(true)
    expect(rolesByKind.get('trident')?.has('trident-shaft')).toBe(true)
    expect(rolesByKind.get('trident')?.has('trident-prong')).toBe(true)
    expect(rolesByKind.get('breeze_wind_charge')?.has('gust-curl')).toBe(true)
    expect(rolesByKind.get('wind_charge')?.has('wind-ring')).toBe(true)
  })
})
