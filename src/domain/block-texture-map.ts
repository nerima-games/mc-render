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
import type { FaceRole } from './meshing-vocabulary.js'
import type { QuadTile } from './chunk-geometry.js'

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
  air: { bottom: 0, side: 0, top: 0 },
  amethyst_block: { bottom: 148, side: 148, top: 148 },
  amethyst_cluster: { bottom: 149, side: 149, top: 149 },
  andesite: { bottom: 15, side: 15, top: 15 },
  anvil: { bottom: 116, side: 116, top: 116 },
  bed: { bottom: 78, side: 79, top: 78 }, // Distinct side.
  bedrock: { bottom: 17, side: 17, top: 17 },
  brewing_stand: { bottom: 64, side: 64, top: 64 },
  brown_mushroom: { bottom: 111, side: 111, top: 111 },
  cactus: { bottom: 133, side: 133, top: 133 },
  calcite: { bottom: 147, side: 147, top: 147 },
  cauldron: { bottom: 117, side: 117, top: 117 },
  chest: { bottom: 102, side: 102, top: 102 },
  chorus_flower: { bottom: 69, side: 69, top: 69 },
  chorus_plant: { bottom: 65, side: 65, top: 65 },
  coal_block: { bottom: 34, side: 34, top: 34 },
  coal_ore: { bottom: 20, side: 20, top: 20 },
  cobblestone: { bottom: 12, side: 12, top: 12 },
  cobweb: { bottom: 107, side: 107, top: 107 },
  comparator: { bottom: 142, side: 142, top: 142 },
  crafting_table: { bottom: 43, side: 43, top: 43 },
  dandelion: { bottom: 109, side: 109, top: 109 },
  deepslate: { bottom: 16, side: 16, top: 16 },
  deepslate_coal_ore: { bottom: 27, side: 27, top: 27 },
  deepslate_diamond_ore: { bottom: 30, side: 30, top: 30 },
  deepslate_emerald_ore: { bottom: 33, side: 33, top: 33 },
  deepslate_gold_ore: { bottom: 29, side: 29, top: 29 },
  deepslate_iron_ore: { bottom: 28, side: 28, top: 28 },
  deepslate_lapis_ore: { bottom: 32, side: 32, top: 32 },
  deepslate_redstone_ore: { bottom: 31, side: 31, top: 31 },
  diamond_block: { bottom: 37, side: 37, top: 37 },
  diamond_ore: { bottom: 23, side: 23, top: 23 },
  diorite: { bottom: 14, side: 14, top: 14 },
  dirt: { bottom: 0, side: 0, top: 0 },
  dispenser: { bottom: 1, side: 143, top: 1 }, // Distinct side: the barrel faces out.
  door: { bottom: 103, side: 103, top: 103 },
  door_open: { bottom: 104, side: 104, top: 104 },
  dragon_egg: { bottom: 74, side: 74, top: 73 }, // Distinct top.
  emerald_block: { bottom: 40, side: 40, top: 40 },
  emerald_ore: { bottom: 26, side: 26, top: 26 },
  enchanting_table: { bottom: 80, side: 80, top: 80 },
  end_crystal: { bottom: 66, side: 66, top: 66 },
  end_gateway: { bottom: 67, side: 68, top: 67 }, // Distinct side.
  end_portal: { bottom: 92, side: 92, top: 92 },
  end_portal_frame: { bottom: 71, side: 71, top: 71 },
  end_portal_frame_filled: { bottom: 72, side: 72, top: 72 },
  end_rod: { bottom: 66, side: 66, top: 66 },
  end_stone: { bottom: 81, side: 81, top: 81 },
  end_stone_bricks: { bottom: 66, side: 66, top: 66 },
  ender_chest: { bottom: 75, side: 75, top: 75 },
  farmland: { bottom: 0, side: 0, top: 84 }, // Three roles: tilled top, dirt elsewhere.
  fern: { bottom: 1, side: 1, top: 1 }, // ANOMALY: tile 1 is stone. See header.
  fire: { bottom: 121, side: 121, top: 121 },
  furnace: { bottom: 44, side: 44, top: 44 },
  glass: { bottom: 9, side: 9, top: 9 },
  glowstone: { bottom: 105, side: 105, top: 105 },
  gold_block: { bottom: 36, side: 36, top: 36 },
  gold_ore: { bottom: 22, side: 22, top: 22 },
  granite: { bottom: 13, side: 13, top: 13 },
  grass_block: { bottom: 0, side: 5, top: 4 }, // Reference GRASS. Three distinct roles.
  gravel: { bottom: 11, side: 11, top: 11 },
  hopper: { bottom: 141, side: 141, top: 141 },
  ice: { bottom: 18, side: 18, top: 18 }, // ANOMALY: tile 18 is lava/fire. See header.
  iron_block: { bottom: 35, side: 35, top: 35 },
  iron_ore: { bottom: 21, side: 21, top: 21 },
  kelp: { bottom: 109, side: 109, top: 109 },
  ladder: { bottom: 106, side: 106, top: 106 },
  lapis_block: { bottom: 39, side: 39, top: 39 },
  lapis_ore: { bottom: 25, side: 25, top: 25 },
  lava: { bottom: 18, side: 18, top: 18 },
  lever: { bottom: 88, side: 88, top: 88 },
  lily_pad: { bottom: 134, side: 134, top: 134 },
  nether_brick: { bottom: 70, side: 70, top: 70 },
  nether_portal: { bottom: 86, side: 86, top: 86 },
  nether_wart_crop: { bottom: 127, side: 127, top: 127 },
  netherrack: { bottom: 63, side: 63, top: 63 },
  oak_leaves: { bottom: 8, side: 8, top: 8 }, // Reference LEAVES
  oak_log: { bottom: 3, side: 2, top: 3 }, // Reference WOOD. top = rings, side = bark.
  oak_planks: { bottom: 41, side: 41, top: 41 }, // Reference PLANKS
  oak_stairs: { bottom: 1, side: 131, top: 130 }, // Three distinct roles.
  observer: { bottom: 1, side: 140, top: 140 }, // Distinct bottom.
  obsidian: { bottom: 19, side: 19, top: 19 },
  piston: { bottom: 91, side: 91, top: 91 },
  piston_head: { bottom: 130, side: 130, top: 130 },
  poppy: { bottom: 110, side: 110, top: 110 },
  potato_crop: { bottom: 115, side: 115, top: 115 },
  powered_rail: { bottom: 144, side: 144, top: 144 },
  pressure_plate: { bottom: 134, side: 134, top: 134 },
  prismarine: { bottom: 136, side: 136, top: 136 },
  purpur_block: { bottom: 74, side: 74, top: 73 }, // Distinct top.
  purpur_pillar: { bottom: 41, side: 41, top: 41 },
  purpur_slab: { bottom: 41, side: 41, top: 41 },
  purpur_stairs: { bottom: 113, side: 113, top: 113 },
  rail: { bottom: 125, side: 125, top: 125 },
  red_mushroom: { bottom: 112, side: 112, top: 112 },
  redstone_block: { bottom: 38, side: 38, top: 38 },
  redstone_lamp: { bottom: 77, side: 77, top: 76 }, // Distinct top.
  redstone_lamp_lit: { bottom: 19, side: 83, top: 82 }, // Three distinct roles.
  redstone_ore: { bottom: 24, side: 24, top: 24 },
  redstone_torch: { bottom: 87, side: 87, top: 87 },
  redstone_wire: { bottom: 100, side: 100, top: 100 },
  repeater: { bottom: 90, side: 90, top: 90 },
  sand: { bottom: 6, side: 6, top: 6 },
  sandstone: { bottom: 135, side: 135, top: 135 },
  sapling: { bottom: 108, side: 108, top: 108 },
  seagrass: { bottom: 107, side: 107, top: 107 },
  shulker_box: { bottom: 41, side: 41, top: 41 },
  smooth_basalt: { bottom: 146, side: 146, top: 146 },
  snow: { bottom: 10, side: 10, top: 10 },
  soul_sand: { bottom: 126, side: 126, top: 126 },
  stone: { bottom: 1, side: 1, top: 1 },
  stone_button: { bottom: 89, side: 89, top: 89 },
  stone_slab: { bottom: 132, side: 132, top: 132 },
  sugar_cane: { bottom: 41, side: 41, top: 41 },
  tall_grass: { bottom: 1, side: 1, top: 1 }, // ANOMALY: tile 1 is stone. See header.
  tnt: { bottom: 101, side: 101, top: 101 },
  torch: { bottom: 45, side: 45, top: 45 },
  water: { bottom: 7, side: 7, top: 7 },
  water_cauldron: { bottom: 122, side: 122, top: 122 },
  wheat_crop: { bottom: 85, side: 85, top: 85 },
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
 * The resolver as `buildChunkGeometry` wants it: a function of the whole quad.
 *
 * The adapter is three lines and exists so the two `MeshQuad` fields that decide
 * a tile are named ONCE. `blockId` and `role` are the pair, and the second is
 * the one a caller writing this inline would drop — `role` is what makes a grass
 * block green on top, brown underneath and banded on the side, and a
 * `(quad) => resolve(quad.blockId, 'side')` renders a plausible world with flat
 * grass. That is the failure this repository's §8 lesson 2 already has one
 * instance of: a wrong tile table looks like an art mistake, not a code one.
 *
 * IT LIVES HERE AND NOT IN `./chunk-geometry.ts` because the import already runs
 * this direction — that file owns `FaceRole` and `QuadTile`, this one owns the
 * table. Putting the adapter beside the table keeps the arrow single; putting it
 * beside the type would make it a cycle.
 */
export const quadTileFromResolver =
  (resolve: (blockId: number, role: FaceRole) => number): QuadTile =>
  (quad) =>
    resolve(quad.blockId, quad.role)

/**
 * The whole binding in one call: a host's `id -> name` becomes a `QuadTile`.
 *
 * What a textured host actually passes to `buildChunkGeometry`. The two-step
 * spelling stays exported because the intermediate resolver is also what
 * `./particle-pool.ts` will want — a particle has a `blockId` and no quad.
 */
export const quadTileForLookup = (blockNameOf: BlockNameLookup): QuadTile =>
  quadTileFromResolver(tileIndexResolver(blockNameOf))

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
