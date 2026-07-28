/**
 * Which atlas tile each block shows on each face.
 *
 * `./texture-atlas.ts` holds the LAYOUT — where tile `n` sits in the image and
 * what UV rectangle that is. This holds the ASSIGNMENT — which `n` a block
 * uses. The two were always going to be separate files: the layout is
 * arithmetic over two integers and the assignment is a table of 120 rows, and
 * only one of them changes when a texture is redrawn.
 *
 * ---------------------------------------------------------------------------
 * THE TABLE COULD NOT BE TRANSCRIBED. THE BLOCK IDS ARE NOT THE SAME IDS.
 * ---------------------------------------------------------------------------
 *
 * This is the whole reason the file has a header rather than a one-line comment.
 *
 * The reference's `block-texture-map.config.ts` is a `ReadonlyArray` INDEXED BY
 * BLOCK ID, and its own comment says so: "TILE_MAP is indexed by BlockType
 * storage id only." Copying it into this repository is a two-second edit and
 * would have been wrong in every row but three, because mc-kernel's
 * `BLOCK_TYPES` is a different ordering of the same vocabulary:
 *
 *     id   reference          mc-kernel
 *      0   AIR                air          <- agree
 *      1   DIRT               stone
 *      2   STONE              cobblestone
 *      3   WOOD               dirt
 *      4   GRASS              grass_block  <- agree
 *      5   SAND               sand         <- agree
 *      6   WATER              gravel
 *      7   LEAVES             water
 *      8   GLASS              lava
 *      9   SNOW               oak_log
 *     10   GRAVEL             oak_planks
 *     11   COBBLESTONE        oak_leaves
 *
 * An index-wise copy would have drawn stone as dirt, cobblestone as stone, dirt
 * as bark, gravel as water, water as leaves, lava as glass and oak logs as snow.
 * EVERY FACE WOULD HAVE HAD A REAL BLOCK TEXTURE ON IT — just the wrong one —
 * so it reads as "the artist assigned the tiles wrongly" rather than as a
 * transposition, and the code that produced it looks like a faithful port. That
 * is the eight-instance defect shape this repository keeps a list of: the
 * conclusion is right and the evidence underneath it is not.
 *
 * So the table below is keyed BY NAME and was produced mechanically: join the
 * reference's block-id list to its tile rows, then re-key by mc-kernel's names.
 * The two vocabularies turn out to be the SAME SET of 120 — zero unmatched in
 * either direction — under exactly four renames:
 *
 *     mc-kernel        reference
 *     grass_block  ->  GRASS
 *     oak_log      ->  WOOD
 *     oak_planks   ->  PLANKS
 *     oak_leaves   ->  LEAVES
 *
 * A bijection is a much stronger result than "close enough", and it is what
 * makes `everyBlockNameHasATile` in the test file a real check rather than a
 * coverage figure: any block this repository can be handed has a row, and no row
 * describes a block that does not exist.
 *
 * ---------------------------------------------------------------------------
 * TWO ANOMALIES CARRIED OVER RATHER THAN CORRECTED
 * ---------------------------------------------------------------------------
 *
 * Both are the reference's and both are recorded here instead of being silently
 * fixed, because a port that improves its source without saying so is a port
 * whose diffs stop meaning anything.
 *
 *   `ice` AND `lava` BOTH SIT ON TILE 18, which the atlas legend calls
 *   "lava/fire". Ice is not lava. The reference has no dedicated ice tile, so
 *   the choice is between transcribing a wrong-looking assignment and inventing
 *   a tile index for an image that does not exist yet. Inventing one would put
 *   a number in this table that no PNG backs — the atlas is not drawn — and the
 *   day it is drawn, the artist would have to match a number chosen here
 *   instead of the other way round. It is pinned by a test so it is a known
 *   quantity rather than a surprise.
 *
 *   `tall_grass` AND `fern` SIT ON TILE 1, which is stone. Same reasoning, and
 *   the same test.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DOES NOT DO: EMIT UVs
 * ---------------------------------------------------------------------------
 *
 * A tile index is not yet a texture coordinate on a chunk face, and the gap is
 * the same missing noun `./voxel-lighting.ts` names — a `ShaderMaterial` in
 * `application/three-surface.ts`.
 *
 * `./chunk-geometry.ts`'s `quadUvExtent` emits UVs in BLOCK units: a merged
 * 16x1 quad gets `u` running 0..16, carrying the reference's comment for why —
 * "keeping UVs in block units lets the shader repeat the selected atlas tile
 * once per block instead of stretching one texel tile across the whole merged
 * face". THE SHADER IS DOING THE WORK IN THAT SENTENCE. `THREE.RepeatWrapping`
 * repeats the WHOLE IMAGE, not a tile inside it, so feeding those UVs to a
 * plain textured `MeshBasicMaterial` tiles the entire 512x512 atlas sixteen
 * times across one merged face.
 *
 * The three ways out, so the next reader does not have to re-derive them:
 * add the shader and keep merging; stop merging and emit per-block quads, which
 * gives back the 99.8% triangle reduction docs/design-notes.md M-9 measured;
 * or pad every tile with its own repeated border, which costs atlas space and
 * still breaks at high mip levels. The first is the reference's answer and the
 * only one that keeps a measurement this organisation has already paid for.
 *
 * The table is nonetheless useful before any of that, and not only as
 * groundwork: `./particle-pool.ts` needs a per-particle UV offset to sample the
 * block a particle was broken from, and `./texture-atlas.ts`'s header already
 * names that as a dependency rather than a side-quest. A particle quad is a
 * single unit face, so it has none of the merged-repeat problem above.
 */
import type { FaceRole } from './chunk-geometry'

/** The three tiles a block shows: one per texturing role. */
export type TileAssignment = Readonly<Record<FaceRole, number>>

/**
 * The tile a block with no row would get.
 *
 * TRANSCRIBED from the reference's `?? 0` in `getTileIndex`, and 0 is `dirt` —
 * not a magenta "missing texture" checkerboard. That is worth knowing rather
 * than worth changing: a graphics engine that renders unknown blocks as dirt
 * hides the mistake, and one that renders them as magenta advertises it.
 *
 * The reason it is kept is that in THIS repository the fallback is unreachable
 * for any real block — the table is a bijection with mc-kernel's vocabulary, and
 * a test asserts that — so the only values reaching it are ids outside the
 * vocabulary entirely, which is a caller bug rather than a missing texture. A
 * magenta tile would need an index no PNG backs, which is the same objection the
 * header raises against inventing an ice tile.
 */
export const MISSING_TILE = 0

/**
 * Tile index per block name per face role.
 *
 * GENERATED, not hand-typed: the reference's id-indexed rows joined to its
 * id-ordered name list, then re-keyed by mc-kernel's names. See the header for
 * why hand-typing it would have been wrong in 117 of 120 rows.
 *
 * Rows whose three roles differ are marked, because those are the ones where a
 * role mix-up is visible in play — grass with dirt on top, a log with bark on
 * its cut end — and the ones a test enumerates individually.
 */
export const TILE_BY_BLOCK_NAME: Readonly<Record<string, TileAssignment>> = {
  air: { top: 0, bottom: 0, side: 0 },
  stone: { top: 1, bottom: 1, side: 1 },
  cobblestone: { top: 12, bottom: 12, side: 12 },
  dirt: { top: 0, bottom: 0, side: 0 },
  grass_block: { top: 4, bottom: 0, side: 5 }, // reference GRASS. Three distinct roles.
  sand: { top: 6, bottom: 6, side: 6 },
  gravel: { top: 11, bottom: 11, side: 11 },
  water: { top: 7, bottom: 7, side: 7 },
  lava: { top: 18, bottom: 18, side: 18 },
  oak_log: { top: 3, bottom: 3, side: 2 }, // reference WOOD. top = rings, side = bark.
  oak_planks: { top: 41, bottom: 41, side: 41 }, // reference PLANKS
  oak_leaves: { top: 8, bottom: 8, side: 8 }, // reference LEAVES
  glass: { top: 9, bottom: 9, side: 9 },
  torch: { top: 45, bottom: 45, side: 45 },
  glowstone: { top: 105, bottom: 105, side: 105 },
  bedrock: { top: 17, bottom: 17, side: 17 },
  piston: { top: 91, bottom: 91, side: 91 },
  snow: { top: 10, bottom: 10, side: 10 },
  ladder: { top: 106, bottom: 106, side: 106 },
  cobweb: { top: 107, bottom: 107, side: 107 },
  sapling: { top: 108, bottom: 108, side: 108 },
  dandelion: { top: 109, bottom: 109, side: 109 },
  poppy: { top: 110, bottom: 110, side: 110 },
  brown_mushroom: { top: 111, bottom: 111, side: 111 },
  red_mushroom: { top: 112, bottom: 112, side: 112 },
  tall_grass: { top: 1, bottom: 1, side: 1 }, // ANOMALY: tile 1 is stone. See header.
  fern: { top: 1, bottom: 1, side: 1 }, // ANOMALY: tile 1 is stone. See header.
  sugar_cane: { top: 41, bottom: 41, side: 41 },
  lily_pad: { top: 134, bottom: 134, side: 134 },
  kelp: { top: 109, bottom: 109, side: 109 },
  seagrass: { top: 107, bottom: 107, side: 107 },
  rail: { top: 125, bottom: 125, side: 125 },
  powered_rail: { top: 144, bottom: 144, side: 144 },
  cactus: { top: 133, bottom: 133, side: 133 },
  pressure_plate: { top: 134, bottom: 134, side: 134 },
  stone_slab: { top: 132, bottom: 132, side: 132 },
  granite: { top: 13, bottom: 13, side: 13 },
  diorite: { top: 14, bottom: 14, side: 14 },
  andesite: { top: 15, bottom: 15, side: 15 },
  deepslate: { top: 16, bottom: 16, side: 16 },
  obsidian: { top: 19, bottom: 19, side: 19 },
  smooth_basalt: { top: 146, bottom: 146, side: 146 },
  calcite: { top: 147, bottom: 147, side: 147 },
  amethyst_block: { top: 148, bottom: 148, side: 148 },
  amethyst_cluster: { top: 149, bottom: 149, side: 149 },
  sandstone: { top: 135, bottom: 135, side: 135 },
  prismarine: { top: 136, bottom: 136, side: 136 },
  soul_sand: { top: 126, bottom: 126, side: 126 },
  ice: { top: 18, bottom: 18, side: 18 }, // ANOMALY: tile 18 is lava/fire. See header.
  farmland: { top: 84, bottom: 0, side: 0 }, // Three roles: tilled top, dirt elsewhere.
  coal_ore: { top: 20, bottom: 20, side: 20 },
  iron_ore: { top: 21, bottom: 21, side: 21 },
  gold_ore: { top: 22, bottom: 22, side: 22 },
  diamond_ore: { top: 23, bottom: 23, side: 23 },
  redstone_ore: { top: 24, bottom: 24, side: 24 },
  lapis_ore: { top: 25, bottom: 25, side: 25 },
  emerald_ore: { top: 26, bottom: 26, side: 26 },
  deepslate_coal_ore: { top: 27, bottom: 27, side: 27 },
  deepslate_iron_ore: { top: 28, bottom: 28, side: 28 },
  deepslate_gold_ore: { top: 29, bottom: 29, side: 29 },
  deepslate_diamond_ore: { top: 30, bottom: 30, side: 30 },
  deepslate_redstone_ore: { top: 31, bottom: 31, side: 31 },
  deepslate_lapis_ore: { top: 32, bottom: 32, side: 32 },
  deepslate_emerald_ore: { top: 33, bottom: 33, side: 33 },
  coal_block: { top: 34, bottom: 34, side: 34 },
  iron_block: { top: 35, bottom: 35, side: 35 },
  gold_block: { top: 36, bottom: 36, side: 36 },
  diamond_block: { top: 37, bottom: 37, side: 37 },
  redstone_block: { top: 38, bottom: 38, side: 38 },
  lapis_block: { top: 39, bottom: 39, side: 39 },
  emerald_block: { top: 40, bottom: 40, side: 40 },
  wheat_crop: { top: 85, bottom: 85, side: 85 },
  potato_crop: { top: 115, bottom: 115, side: 115 },
  nether_wart_crop: { top: 127, bottom: 127, side: 127 },
  redstone_wire: { top: 100, bottom: 100, side: 100 },
  redstone_torch: { top: 87, bottom: 87, side: 87 },
  lever: { top: 88, bottom: 88, side: 88 },
  stone_button: { top: 89, bottom: 89, side: 89 },
  repeater: { top: 90, bottom: 90, side: 90 },
  redstone_lamp: { top: 76, bottom: 77, side: 77 }, // Distinct top.
  redstone_lamp_lit: { top: 82, bottom: 19, side: 83 }, // Three distinct roles.
  observer: { top: 140, bottom: 1, side: 140 }, // Distinct bottom.
  comparator: { top: 142, bottom: 142, side: 142 },
  dispenser: { top: 1, bottom: 1, side: 143 }, // Distinct side: the barrel faces out.
  hopper: { top: 141, bottom: 141, side: 141 },
  piston_head: { top: 130, bottom: 130, side: 130 },
  end_stone: { top: 81, bottom: 81, side: 81 },
  end_portal_frame: { top: 71, bottom: 71, side: 71 },
  end_portal_frame_filled: { top: 72, bottom: 72, side: 72 },
  end_portal: { top: 92, bottom: 92, side: 92 },
  chorus_flower: { top: 69, bottom: 69, side: 69 },
  chorus_plant: { top: 65, bottom: 65, side: 65 },
  dragon_egg: { top: 73, bottom: 74, side: 74 }, // Distinct top.
  end_crystal: { top: 66, bottom: 66, side: 66 },
  end_gateway: { top: 67, bottom: 67, side: 68 }, // Distinct side.
  end_rod: { top: 66, bottom: 66, side: 66 },
  end_stone_bricks: { top: 66, bottom: 66, side: 66 },
  ender_chest: { top: 75, bottom: 75, side: 75 },
  purpur_block: { top: 73, bottom: 74, side: 74 }, // Distinct top.
  purpur_pillar: { top: 41, bottom: 41, side: 41 },
  purpur_slab: { top: 41, bottom: 41, side: 41 },
  purpur_stairs: { top: 113, bottom: 113, side: 113 },
  shulker_box: { top: 41, bottom: 41, side: 41 },
  crafting_table: { top: 43, bottom: 43, side: 43 },
  furnace: { top: 44, bottom: 44, side: 44 },
  chest: { top: 102, bottom: 102, side: 102 },
  door: { top: 103, bottom: 103, side: 103 },
  door_open: { top: 104, bottom: 104, side: 104 },
  oak_stairs: { top: 130, bottom: 1, side: 131 }, // Three distinct roles.
  anvil: { top: 116, bottom: 116, side: 116 },
  cauldron: { top: 117, bottom: 117, side: 117 },
  water_cauldron: { top: 122, bottom: 122, side: 122 },
  bed: { top: 78, bottom: 78, side: 79 }, // Distinct side.
  enchanting_table: { top: 80, bottom: 80, side: 80 },
  brewing_stand: { top: 64, bottom: 64, side: 64 },
  tnt: { top: 101, bottom: 101, side: 101 },
  nether_brick: { top: 70, bottom: 70, side: 70 },
  netherrack: { top: 63, bottom: 63, side: 63 },
  nether_portal: { top: 86, bottom: 86, side: 86 },
  fire: { top: 121, bottom: 121, side: 121 },
}

/**
 * The tile a named block shows on a given face role.
 *
 * TOTAL, like every other lookup in this repository's domain: an unknown name
 * yields `MISSING_TILE` rather than throwing. A renderer that threw on an
 * unrecognised block would take down the frame for one bad cell.
 */
export const tileIndexForBlockName = (blockName: string, role: FaceRole): number =>
  TILE_BY_BLOCK_NAME[blockName]?.[role] ?? MISSING_TILE

/**
 * How a caller turns the numeric `MeshQuad.blockId` into a name.
 *
 * AN INJECTED LOOKUP, and the third one in this repository after `DrawPort` and
 * `LightSampler`. mc-kernel owns `BLOCK_TYPES` — 120 string literals, a closed
 * union — and mirroring it here to do one array index would be the widest
 * mirror in the workspace carrying the least information. The organisation has
 * already paid once for a partial mirror of a closed union (mc-sim's
 * `ITEM_TYPES` at 23 of 97 literals, invisible until `check:repoint`), and the
 * lesson taken was that such a mirror must be carried WHOLE or not carried.
 *
 * Not carried, then: the host holds kernel's array and answers `id -> name`.
 * `mx-gameplay/domain/block-vocabulary.ts` is the repository that genuinely
 * needs the union — it reasons about which blocks are which — and this one does
 * not; it needs a key for a table lookup.
 */
export type BlockNameLookup = (blockId: number) => string

/**
 * Bind a name lookup into the `blockId -> tile` resolver a mesher wants.
 *
 * Curried rather than a two-argument function so the host resolves its lookup
 * once per world instead of once per quad, which matters because this is called
 * for every visible face of every re-meshed chunk.
 */
export const tileIndexResolver =
  (blockNameOf: BlockNameLookup) =>
  (blockId: number, role: FaceRole): number =>
    tileIndexForBlockName(blockNameOf(blockId), role)

/**
 * Every distinct tile index the table names.
 *
 * Sorted and de-duplicated, so it answers "how many tiles does the atlas
 * actually have to contain" — the question the person drawing the PNG needs
 * answered, and one that cannot be read off a 120-row table by eye.
 */
export const referencedTileIndices = (): ReadonlyArray<number> =>
  [
    ...new Set(
      Object.values(TILE_BY_BLOCK_NAME).flatMap((assignment) => [
        assignment.top,
        assignment.bottom,
        assignment.side,
      ]),
    ),
  ].sort((left, right) => left - right)
