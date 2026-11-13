import { describe, expect, it } from '@effect/vitest'
import { VEHICLES_TNT_ENTITY_MODELS } from '../../src/domain/entity-models/vehicles-tnt.js'
import type { EntityModelDescriptor } from '../../src/domain/entity-models/types.js'

const visualSignature = (descriptor: EntityModelDescriptor): string =>
  descriptor.parts
    .map(({ role, size, center, color }) => JSON.stringify([role, size, center, color]))
    .sort()
    .join('|')

describe('vehicle and TNT entity model descriptors', () => {
  it('publishes the ten assigned kinds', () => {
    expect(VEHICLES_TNT_ENTITY_MODELS.map(({ kind }) => kind)).toStrictEqual([
      'boat',
      'chest_boat',
      'chest_minecart',
      'command_block_minecart',
      'furnace_minecart',
      'hopper_minecart',
      'minecart',
      'spawner_minecart',
      'tnt_minecart',
      'tnt',
    ])
  })

  it('gives every kind non-empty visible cuboid geometry', () => {
    for (const descriptor of VEHICLES_TNT_ENTITY_MODELS) {
      expect(descriptor.parts.length, descriptor.kind).toBeGreaterThan(0)
      expect(descriptor.parts.every(({ size, center, color }) =>
        size.every((component) => Number.isFinite(component) && component > 0)
        && center.every(Number.isFinite)
        && color.every((component) => Number.isFinite(component) && component >= 0 && component <= 255),
      ), descriptor.kind).toBe(true)
    }
  })

  it('keeps each model visually distinct when part IDs are ignored', () => {
    const signatures = VEHICLES_TNT_ENTITY_MODELS.map(visualSignature)

    expect(new Set(signatures).size).toBe(VEHICLES_TNT_ENTITY_MODELS.length)
  })

  it('shows the defining cargo and block geometry of each vehicle variant', () => {
    const rolesByKind = new Map(VEHICLES_TNT_ENTITY_MODELS.map(({ kind, parts }) => [
      kind,
      new Set(parts.map(({ role }) => role)),
    ]))

    expect(rolesByKind.get('chest_boat')?.has('chest')).toBe(true)
    expect(rolesByKind.get('chest_boat')?.has('chest-latch')).toBe(true)
    expect(rolesByKind.get('chest_minecart')?.has('chest')).toBe(true)
    expect(rolesByKind.get('chest_minecart')?.has('chest-latch')).toBe(true)
    expect(rolesByKind.get('command_block_minecart')?.has('command-face')).toBe(true)
    expect(rolesByKind.get('command_block_minecart')?.has('command-glyph')).toBe(true)
    expect(rolesByKind.get('furnace_minecart')?.has('furnace-mouth')).toBe(true)
    expect(rolesByKind.get('furnace_minecart')?.has('furnace-fire')).toBe(true)
    expect(rolesByKind.get('hopper_minecart')?.has('hopper-rim')).toBe(true)
    expect(rolesByKind.get('hopper_minecart')?.has('hopper-neck')).toBe(true)
    expect(rolesByKind.get('spawner_minecart')?.has('spawner-cage-bar')).toBe(true)
    expect(rolesByKind.get('spawner_minecart')?.has('spawner-core')).toBe(true)
    expect(rolesByKind.get('tnt_minecart')?.has('tnt-cargo')).toBe(true)
    expect(rolesByKind.get('tnt_minecart')?.has('tnt-band')).toBe(true)
    expect(rolesByKind.get('tnt')?.has('tnt-block')).toBe(true)
    expect(rolesByKind.get('tnt')?.has('fuse-spark')).toBe(true)
  })
})
