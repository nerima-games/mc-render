import { describe, expect, it } from '@effect/vitest'
import { HOSTILE_ENTITY_MODELS } from '../../src/domain/entity-models/hostile-mobs'

const hostileKinds = [
  'blaze',
  'bogged',
  'breeze',
  'creeper',
  'drowned',
  'elder_guardian',
  'endermite',
  'evoker',
  'ghast',
  'giant',
  'guardian',
  'hoglin',
  'husk',
  'magma_cube',
  'phantom',
  'piglin_brute',
  'pillager',
  'ravager',
  'shulker',
  'silverfish',
  'skeleton',
  'slime',
  'stray',
  'vex',
  'vindicator',
  'warden',
  'witch',
  'wither_skeleton',
  'zoglin',
  'zombie',
  'zombie_villager',
  'wither',
] as const

describe('hostile entity models', () => {
  it('covers every assigned kind exactly once', () => {
    expect(HOSTILE_ENTITY_MODELS).toHaveLength(hostileKinds.length)
    expect(HOSTILE_ENTITY_MODELS.map(({ kind }) => kind).sort()).toStrictEqual([...hostileKinds].sort())
  })

  it('gives every kind non-empty visible cuboid geometry', () => {
    for (const descriptor of HOSTILE_ENTITY_MODELS) {
      expect(descriptor.parts.length, descriptor.kind).toBeGreaterThan(0)
      for (const { role, size, center, color } of descriptor.parts) {
        expect(role.length, `${descriptor.kind} role`).toBeGreaterThan(0)
        expect(size.every((axis) => Number.isFinite(axis) && axis > 0), `${descriptor.kind} size`).toBe(true)
        expect(center.every(Number.isFinite), `${descriptor.kind} center`).toBe(true)
        expect(color.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255), `${descriptor.kind} color`).toBe(true)
        expect(color.some((channel) => channel > 0), `${descriptor.kind} visible color`).toBe(true)
      }
    }
  })

  it('gives each kind a distinct rendered signature independent of part IDs and ordering', () => {
    const signatures = HOSTILE_ENTITY_MODELS.map(({ parts }) =>
      JSON.stringify(
        parts
          .map(({ role, size, center, color, rotation }) => ({ role, size, center, color, rotation }))
          .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
      ),
    )

    expect(new Set(signatures).size).toBe(hostileKinds.length)
  })
})
