/**
 * The block-to-tile assignment.
 *
 * The assertion that matters most is the FIRST one, and it is not about
 * textures: the table's key space must be mc-kernel's block vocabulary, because
 * the reference's table is keyed by an id space that disagrees with kernel's in
 * 117 of 120 rows. Everything else here is layout hygiene.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, FastCheck } from 'effect'
import {
  MISSING_TILE,
  TILE_BY_BLOCK_NAME,
  referencedTileIndices,
  tileIndexForBlockName,
  tileIndexResolver,
} from '../src/domain/block-texture-map'
import { ATLAS_TILE_COUNT, isTileIndex } from '../src/domain/texture-atlas'
import type { FaceRole } from '../src/domain/chunk-geometry'

const ROLES: ReadonlyArray<FaceRole> = ['top', 'bottom', 'side']

/**
 * mc-kernel's `BLOCK_TYPES`, in order. NOT a mirror — see
 * `domain/block-texture-map.ts` on why the union is injected rather than
 * carried — but the test needs the real order to prove the transposition, and a
 * test fixture that goes stale fails loudly rather than shipping.
 */
const KERNEL_BLOCK_TYPES: ReadonlyArray<string> = [
  'air', 'stone', 'cobblestone', 'dirt', 'grass_block', 'sand', 'gravel', 'water', 'lava',
  'oak_log', 'oak_planks', 'oak_leaves', 'glass', 'torch', 'glowstone', 'bedrock', 'piston',
  'snow', 'ladder', 'cobweb', 'sapling', 'dandelion', 'poppy', 'brown_mushroom', 'red_mushroom',
  'tall_grass', 'fern', 'sugar_cane', 'lily_pad', 'kelp', 'seagrass', 'rail', 'powered_rail',
  'cactus', 'pressure_plate', 'stone_slab', 'granite', 'diorite', 'andesite', 'deepslate',
  'obsidian', 'smooth_basalt', 'calcite', 'amethyst_block', 'amethyst_cluster', 'sandstone',
  'prismarine', 'soul_sand', 'ice', 'farmland', 'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore',
  'redstone_ore', 'lapis_ore', 'emerald_ore', 'deepslate_coal_ore', 'deepslate_iron_ore',
  'deepslate_gold_ore', 'deepslate_diamond_ore', 'deepslate_redstone_ore', 'deepslate_lapis_ore',
  'deepslate_emerald_ore', 'coal_block', 'iron_block', 'gold_block', 'diamond_block',
  'redstone_block', 'lapis_block', 'emerald_block', 'wheat_crop', 'potato_crop',
  'nether_wart_crop', 'redstone_wire', 'redstone_torch', 'lever', 'stone_button', 'repeater',
  'redstone_lamp', 'redstone_lamp_lit', 'observer', 'comparator', 'dispenser', 'hopper',
  'piston_head', 'end_stone', 'end_portal_frame', 'end_portal_frame_filled', 'end_portal',
  'chorus_flower', 'chorus_plant', 'dragon_egg', 'end_crystal', 'end_gateway', 'end_rod',
  'end_stone_bricks', 'ender_chest', 'purpur_block', 'purpur_pillar', 'purpur_slab',
  'purpur_stairs', 'shulker_box', 'crafting_table', 'furnace', 'chest', 'door', 'door_open',
  'oak_stairs', 'anvil', 'cauldron', 'water_cauldron', 'bed', 'enchanting_table',
  'brewing_stand', 'tnt', 'nether_brick', 'netherrack', 'nether_portal', 'fire',
]

describe('the key space', () => {
  it.effect('REGRESSION: the table is a BIJECTION with mc-kernel`s block vocabulary', () =>
    Effect.sync(() => {
      // THE ASSERTION THIS FILE EXISTS FOR. The reference's table is indexed by
      // ITS block ids, and kernel's ordering disagrees from index 1 onward — an
      // index-wise copy draws stone as dirt, dirt as bark, water as leaves and
      // lava as glass, with a real texture on every face so it reads as an art
      // problem rather than a transposition.
      //
      // Both directions, because each catches a different mistake: a missing
      // name means some block renders as `MISSING_TILE`, and an extra name
      // means a row was transcribed for a block that does not exist here and
      // some other row is probably the one it displaced.
      expect(Object.keys(TILE_BY_BLOCK_NAME).sort()).toStrictEqual([...KERNEL_BLOCK_TYPES].sort())
      expect(Object.keys(TILE_BY_BLOCK_NAME).length).toBe(120)
    }),
  )

  it.effect('gives every block a tile on every role, with no fallback reached', () =>
    Effect.sync(() => {
      // `MISSING_TILE` is unreachable for a real block. Asserting that here is
      // what lets `tileIndexForBlockName`'s `?? MISSING_TILE` stay a total
      // function without being a silent hiding place.
      for (const name of KERNEL_BLOCK_TYPES) {
        for (const role of ROLES) {
          expect(typeof tileIndexForBlockName(name, role)).toBe('number')
        }
      }
    }),
  )

  it.effect('REGRESSION: the specific rows an index-wise copy would have got wrong', () =>
    Effect.sync(() => {
      // Spelled out rather than left to the bijection, because the bijection
      // would still hold if the whole table were rotated by one. These are the
      // semantic anchors: each is a block whose reference id and kernel id
      // differ, asserted against the tile its NAME should have.
      expect(tileIndexForBlockName('stone', 'top')).toBe(1) // not 0 (dirt)
      expect(tileIndexForBlockName('cobblestone', 'top')).toBe(12) // not 1 (stone)
      expect(tileIndexForBlockName('dirt', 'top')).toBe(0) // not 2 (wood_side)
      expect(tileIndexForBlockName('water', 'top')).toBe(7) // not 8 (leaves)
      expect(tileIndexForBlockName('lava', 'top')).toBe(18) // not 9 (glass)
      expect(tileIndexForBlockName('oak_log', 'side')).toBe(2) // bark, not 10 (snow)
      expect(tileIndexForBlockName('gravel', 'top')).toBe(11) // not 7 (water)
    }),
  )
})

describe('the roles', () => {
  it.effect('REGRESSION: grass and logs keep their distinct faces', () =>
    Effect.sync(() => {
      // The two blocks where a role mix-up is unmistakable in play: grass with
      // dirt on top, a log with bark on its cut end. If the role keys were ever
      // transposed, these are what would say so.
      expect(TILE_BY_BLOCK_NAME['grass_block']).toStrictEqual({ top: 4, bottom: 0, side: 5 })
      expect(TILE_BY_BLOCK_NAME['oak_log']).toStrictEqual({ top: 3, bottom: 3, side: 2 })
      // Grass's bottom is dirt's tile — the same number dirt itself uses, which
      // is the check that the bottom role is not merely "different".
      expect(TILE_BY_BLOCK_NAME['grass_block']?.bottom).toBe(tileIndexForBlockName('dirt', 'top'))
    }),
  )

  it.effect('exactly twelve blocks have roles that differ', () =>
    Effect.sync(() => {
      // A count derived from the table rather than transcribed beside it —
      // "two hand-written lists stating the same thing" is a defect shape with
      // six recorded instances here, and a hard-coded 12 next to a 120-row
      // table is precisely that. The NAMES are what the test pins.
      const varied = Object.entries(TILE_BY_BLOCK_NAME)
        .filter(([, tiles]) => new Set([tiles.top, tiles.bottom, tiles.side]).size > 1)
        .map(([name]) => name)
        .sort()

      expect(varied).toStrictEqual([
        'bed', 'dispenser', 'dragon_egg', 'end_gateway', 'farmland', 'grass_block',
        'oak_log', 'oak_stairs', 'observer', 'purpur_block', 'redstone_lamp', 'redstone_lamp_lit',
      ])
    }),
  )
})

describe('the anomalies carried over from the reference', () => {
  it.effect('REGRESSION: ice shares lava`s tile, and that is transcribed not chosen', () =>
    Effect.sync(() => {
      // Tile 18 is "lava/fire" in the atlas legend. Ice is not lava. The
      // reference has no ice tile and inventing an index here would put a number
      // in the table that no PNG backs — see the file header. Pinned so it is a
      // known quantity: the day an ice tile is drawn, this test is what points
      // at the row to change.
      expect(tileIndexForBlockName('ice', 'top')).toBe(tileIndexForBlockName('lava', 'top'))
    }),
  )

  it.effect('REGRESSION: tall_grass and fern share stone`s tile', () =>
    Effect.sync(() => {
      expect(tileIndexForBlockName('tall_grass', 'top')).toBe(tileIndexForBlockName('stone', 'top'))
      expect(tileIndexForBlockName('fern', 'top')).toBe(tileIndexForBlockName('stone', 'top'))
    }),
  )
})

describe('the indices themselves', () => {
  it.effect('REGRESSION: every tile index is one the atlas layout can address', () =>
    Effect.sync(() => {
      // The join between this table and `./texture-atlas.ts`. An index past
      // ATLAS_TILE_COUNT wraps under `normaliseTileIndex` and silently draws a
      // different block's texture rather than failing.
      for (const [name, tiles] of Object.entries(TILE_BY_BLOCK_NAME)) {
        for (const role of ROLES) {
          const index = tiles[role]
          expect(isTileIndex(index), `${name}.${role} = ${index}`).toBe(true)
          expect(index).toBeLessThan(ATLAS_TILE_COUNT)
        }
      }
    }),
  )

  it.effect('names how many distinct tiles the PNG must contain', () =>
    Effect.sync(() => {
      // The question the person drawing the atlas needs answered, and one that
      // cannot be read off a 120-row table by eye. Derived, so it cannot go
      // stale against the table above it.
      const tiles = referencedTileIndices()
      expect(tiles.length).toBeGreaterThan(0)
      expect(tiles).toStrictEqual([...tiles].sort((left, right) => left - right))
      expect(new Set(tiles).size).toBe(tiles.length)
      // Comfortably inside one 16x16 atlas, which is what makes the single
      // shared material in `application/world-renderer.ts` possible at all.
      expect(tiles[tiles.length - 1]).toBeLessThan(ATLAS_TILE_COUNT)
    }),
  )
})

describe('the injected name lookup', () => {
  it.effect('resolves a block id through the host`s vocabulary', () =>
    Effect.sync(() => {
      // The seam. mc-kernel owns BLOCK_TYPES and this repository does not mirror
      // it — a closed union must be carried whole or not carried, and 120
      // literals to do one array index is the widest mirror in the workspace
      // carrying the least information.
      const resolve = tileIndexResolver((id) => KERNEL_BLOCK_TYPES[id] ?? '')

      expect(resolve(1, 'top')).toBe(1) // stone
      expect(resolve(4, 'top')).toBe(4) // grass_block, top
      expect(resolve(4, 'bottom')).toBe(0) // grass_block, dirt underneath
      expect(resolve(9, 'side')).toBe(2) // oak_log, bark
    }),
  )

  it.effect('is total for ids outside the vocabulary', () =>
    Effect.sync(() => {
      // A caller bug, not a missing texture — but a renderer that threw would
      // take down the frame for one bad cell.
      const resolve = tileIndexResolver((id) => KERNEL_BLOCK_TYPES[id] ?? '')

      FastCheck.assert(
        FastCheck.property(FastCheck.integer({ min: 120, max: 100_000 }), (id) => {
          expect(resolve(id, 'top')).toBe(MISSING_TILE)
        }),
        { seed: 0, numRuns: 100 },
      )
      expect(tileIndexForBlockName('not_a_block', 'side')).toBe(MISSING_TILE)
    }),
  )
})
