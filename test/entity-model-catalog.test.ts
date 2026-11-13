import { describe, expect, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import { Result, Schema } from 'effect'
import {
  ENTITY_MODEL_CATALOG,
  ENTITY_MODEL_KINDS,
  EntityModelKindSchema,
  EntityModelResolutionIssueSchema,
  InvalidEntityModelKindSchema,
  UNSUPPORTED_ENTITY_MODEL_KINDS,
  UnsupportedEntityModelSchema,
  decodeEntityModelKind,
  entityModelForKind,
  resolveEntityModel,
} from '../src/domain/entity-model-catalog.js'

// Kernel 0.14.0's `ENTITY_TYPES` source list is the independent completeness contract.
const KERNEL_014_ENTITY_KINDS = [
  'player',
  'allay',
  'armadillo',
  'axolotl',
  'bat',
  'camel',
  'cat',
  'chicken',
  'cod',
  'cow',
  'dolphin',
  'donkey',
  'fox',
  'frog',
  'glow_squid',
  'horse',
  'mooshroom',
  'mule',
  'ocelot',
  'parrot',
  'pig',
  'pufferfish',
  'rabbit',
  'salmon',
  'sheep',
  'skeleton_horse',
  'sniffer',
  'squid',
  'strider',
  'tadpole',
  'tropical_fish',
  'turtle',
  'villager',
  'wandering_trader',
  'zombie_horse',
  'bee',
  'cave_spider',
  'enderman',
  'goat',
  'iron_golem',
  'llama',
  'trader_llama',
  'panda',
  'piglin',
  'polar_bear',
  'snow_golem',
  'spider',
  'wolf',
  'zombified_piglin',
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
  'ender_dragon',
  'wither',
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
  'boat',
  'chest_boat',
  'chest_minecart',
  'command_block_minecart',
  'furnace_minecart',
  'hopper_minecart',
  'minecart',
  'spawner_minecart',
  'tnt_minecart',
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
  'tnt',
] as const

const visualSignature = (model: (typeof ENTITY_MODEL_CATALOG)[number]): string => model.parts
  .map(({ center, color, role, rotation, size }) => JSON.stringify({ center, color, role, rotation, size }))
  .toSorted()
  .join('|')

describe('entity model catalog', () => {
  it('resolves each kernel 0.14.0 kind to its own visibly distinct descriptor', () => {
    const expectedKinds = [...KERNEL_014_ENTITY_KINDS].toSorted()
    const actualKinds = ENTITY_MODEL_KINDS.map(String).toSorted()
    const signatures = ENTITY_MODEL_CATALOG.map(visualSignature)

    expect(ENTITY_MODEL_CATALOG).toHaveLength(KERNEL_014_ENTITY_KINDS.length)
    expect(actualKinds).toStrictEqual(expectedKinds)
    expect(new Set(actualKinds)).toHaveLength(KERNEL_014_ENTITY_KINDS.length)
    expect(new Set(signatures)).toHaveLength(KERNEL_014_ENTITY_KINDS.length)
    expect(UNSUPPORTED_ENTITY_MODEL_KINDS).toStrictEqual([])

    for (const kind of KERNEL_014_ENTITY_KINDS) {
      const resolved = resolveEntityModel(kind)
      expect(Result.isSuccess(resolved)).toBe(true)
      if (Result.isSuccess(resolved)) {
        expect(resolved.success.kind).toBe(kind)
        expect(resolved.success.parts.length).toBeGreaterThan(0)
      }
    }
  })

  it('returns only a schema-valid value or a typed catalog error for arbitrary inputs', () => {
    FastCheck.assert(
      FastCheck.property(FastCheck.anything(), (input) => {
        const resolved = resolveEntityModel(input)
        if (Result.isSuccess(resolved)) {
          const decodedKind = Schema.decodeUnknownResult(EntityModelKindSchema)(resolved.success.kind)
          return Result.isSuccess(decodedKind) && decodedKind.success === resolved.success.kind && resolved.success.parts.length > 0
        }
        const decodedIssue = Schema.decodeUnknownResult(EntityModelResolutionIssueSchema)(resolved.failure)
        return Result.isSuccess(decodedIssue)
      }),
      { numRuns: 300 },
    )
  })

  it('distinguishes an empty kind from a non-empty unsupported kind', () => {
    const empty = decodeEntityModelKind('')
    const blank = decodeEntityModelKind(' ')
    const unknown = resolveEntityModel('future_entity')

    expect(Result.isFailure(empty)).toBe(true)
    if (Result.isFailure(empty)) {
      expect(empty.failure).toStrictEqual({ _tag: 'InvalidEntityModelKind', reason: 'empty' })
      expect(Result.isSuccess(Schema.decodeUnknownResult(InvalidEntityModelKindSchema)(empty.failure))).toBe(true)
    }
    expect(Result.isFailure(blank)).toBe(true)
    if (Result.isFailure(blank)) {
      expect(blank.failure).toStrictEqual({ _tag: 'InvalidEntityModelKind', reason: 'invalid-value' })
    }
    expect(Result.isFailure(unknown)).toBe(true)
    if (Result.isFailure(unknown)) {
      expect(unknown.failure).toStrictEqual({ _tag: 'UnsupportedEntityModel', kind: 'future_entity' })
      expect(Result.isSuccess(Schema.decodeUnknownResult(UnsupportedEntityModelSchema)(unknown.failure))).toBe(true)
    }
  })

  it('accepts a catalog lookup only after the kind schema brands it', () => {
    const decoded = decodeEntityModelKind('allay')
    expect(Result.isSuccess(decoded)).toBe(true)
    if (Result.isSuccess(decoded)) {
      const model = entityModelForKind(decoded.success)
      expect(Result.isSuccess(model)).toBe(true)
      if (Result.isSuccess(model)) {
        expect(model.success.kind).toBe(decoded.success)
      }
    }
  })
})
