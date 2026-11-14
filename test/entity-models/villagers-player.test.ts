import { describe, expect, it } from '@effect/vitest'
import { VILLAGER_PLAYER_ENTITY_MODELS } from '../../src/domain/entity-models/villagers-player.js'
import type { EntityModelDescriptor } from '../../src/domain/entity-models/types.js'

const visualSignature = (descriptor: EntityModelDescriptor): string =>
  descriptor.parts
    .map(({ role, size, center, color, rotation }) => JSON.stringify([role, size, center, color, rotation]))
    .sort()
    .join('|')

describe('villager and player entity model descriptors', () => {
  it('publishes the three assigned kinds', () => {
    expect(VILLAGER_PLAYER_ENTITY_MODELS.map(({ kind }) => kind)).toStrictEqual([
      'player',
      'villager',
      'wandering_trader',
    ])
  })

  it('gives each kind visible cuboids for a recognizable human figure and outfit', () => {
    for (const descriptor of VILLAGER_PLAYER_ENTITY_MODELS) {
      const roles = new Set<string>(descriptor.parts.map(({ role }) => role))
      const torsoBottom = Math.min(...descriptor.parts
        .filter(({ role }) => role === 'body' || role === 'robe')
        .map(({ center, size }) => center[1] - size[1] / 2))
      const legBottom = Math.min(...descriptor.parts
        .filter(({ role }) => role === 'leg')
        .map(({ center, size }) => center[1] - size[1] / 2))

      expect(descriptor.parts.length).toBeGreaterThan(0)
      expect(descriptor.parts.every(({ size, center, color }) =>
        size.every((component) => Number.isFinite(component) && component > 0)
        && center.every(Number.isFinite)
        && color.every((component) => Number.isFinite(component) && component >= 0 && component <= 255),
      )).toBe(true)
      expect(roles.has('head')).toBe(true)
      expect(roles.has('body') || roles.has('robe')).toBe(true)
      expect(roles.has('arm')).toBe(true)
      expect(roles.has('leg')).toBe(true)
      expect(roles.has('hair') || roles.has('robe') || roles.has('hood')).toBe(true)
      expect(legBottom).toBeLessThan(torsoBottom)
    }
  })

  it('keeps each model visually distinct when part IDs are ignored', () => {
    const signatures = VILLAGER_PLAYER_ENTITY_MODELS.map(visualSignature)

    expect(new Set(signatures).size).toBe(VILLAGER_PLAYER_ENTITY_MODELS.length)
  })
})
