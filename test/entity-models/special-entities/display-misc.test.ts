import { describe, expect, it } from '@effect/vitest'
import { DISPLAY_MISC_ENTITY_MODELS } from '../../../src/domain/entity-models/special-entities/display-misc.js'
import type { EntityModelDescriptor } from '../../../src/domain/entity-models/types.js'

const EXPECTED_KINDS = [
  'block_display',
  'interaction',
  'item_display',
  'marker',
  'text_display',
  'area_effect_cloud',
  'armor_stand',
  'end_crystal',
  'evoker_fangs',
  'experience_orb',
  'eye_of_ender',
  'falling_block',
  'glow_item_frame',
  'item',
  'item_frame',
  'leash_knot',
  'lightning_bolt',
  'painting',
] as const

const visualSignature = (descriptor: EntityModelDescriptor): string =>
  descriptor.parts
    .map(({ role, size, center, color, rotation }) => JSON.stringify([role, size, center, color, rotation]))
    .sort()
    .join('|')

describe('display and miscellaneous entity model descriptors', () => {
  it('publishes all assigned display and miscellaneous kinds', () => {
    expect(DISPLAY_MISC_ENTITY_MODELS.map(({ kind }) => kind)).toStrictEqual(EXPECTED_KINDS)
  })

  it('gives every kind non-empty valid geometry and byte colors', () => {
    for (const descriptor of DISPLAY_MISC_ENTITY_MODELS) {
      expect(descriptor.parts.length, descriptor.kind).toBeGreaterThan(0)
      expect(descriptor.parts.every(({ size, center, color }) =>
        size.every((component) => Number.isFinite(component) && component > 0)
        && center.every(Number.isFinite)
        && color.every((component) => Number.isInteger(component) && component >= 0 && component <= 255),
      ), descriptor.kind).toBe(true)
    }
  })

  it('gives every kind a distinct visible signature independent of part IDs', () => {
    const signatures = DISPLAY_MISC_ENTITY_MODELS.map(visualSignature)

    expect(new Set(signatures).size).toBe(EXPECTED_KINDS.length)
  })

  it('uses recognizable display, marker, mannequin, crystal, effect, and art forms', () => {
    const rolesByKind = new Map<string, Set<string>>(
      DISPLAY_MISC_ENTITY_MODELS.map(({ kind, parts }): readonly [string, Set<string>] => [
        kind,
        new Set<string>(parts.map(({ role }) => role)),
      ]),
    )

    expect(rolesByKind.get('block_display')?.has('display-block')).toBe(true)
    expect(rolesByKind.get('interaction')?.has('target-frame')).toBe(true)
    expect(rolesByKind.get('item_display')?.has('display-pedestal')).toBe(true)
    expect(rolesByKind.get('marker')?.has('marker-stem')).toBe(true)
    expect(rolesByKind.get('text_display')?.has('text-line')).toBe(true)
    expect(rolesByKind.get('area_effect_cloud')?.has('cloud-puff')).toBe(true)
    expect(rolesByKind.get('armor_stand')?.has('stand-base')).toBe(true)
    expect(rolesByKind.get('end_crystal')?.has('crystal-facet')).toBe(true)
    expect(rolesByKind.get('evoker_fangs')?.has('fang-tooth')).toBe(true)
    expect(rolesByKind.get('experience_orb')?.has('orb-shard')).toBe(true)
    expect(rolesByKind.get('eye_of_ender')?.has('eye-iris')).toBe(true)
    expect(rolesByKind.get('falling_block')?.has('grass-cap')).toBe(true)
    expect(rolesByKind.get('glow_item_frame')?.has('glow-halo')).toBe(true)
    expect(rolesByKind.get('item')?.has('dropped-item')).toBe(true)
    expect(rolesByKind.get('item_frame')?.has('framed-item')).toBe(true)
    expect(rolesByKind.get('leash_knot')?.has('rope-knot')).toBe(true)
    expect(rolesByKind.get('lightning_bolt')?.has('lightning-segment')).toBe(true)
    expect(rolesByKind.get('painting')?.has('painting-canvas')).toBe(true)
  })
})
