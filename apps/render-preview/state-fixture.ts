import {
  BlockAxis,
  ChunkAxis,
  LocalAxis,
  blockIdOf,
  chunkCoord,
  encodeBlockState,
  type BlockStateValues,
  type BlockType,
} from '@nerima-games/mc-kernel'
import { CHUNK_SIZE, blockIndex } from '@nerima-games/mc-meshing'
import type { Chunk } from '@nerima-games/mc-worldgen'
import { emptyBlocks, setBlockAt } from '@nerima-games/mc-worldgen/testing'
import { Option, Result } from 'effect'

const GROUND_Y = 19
const OBJECT_Y = GROUND_Y + 1
const DOOR_UPPER_Y = OBJECT_Y + 1
const FIRST_LOCAL_BLOCK = 2
const LAST_LOCAL_BLOCK = 13
const STATE_PREVIEW_BIOME = 'PLAINS' as const

type StatefulBlock = Readonly<{
  readonly blockType: BlockType
  readonly position: readonly [lx: number, y: number, lz: number]
  readonly state: BlockStateValues
}>

const STATEFUL_BLOCKS: ReadonlyArray<StatefulBlock> = [
  {
    blockType: 'door',
    position: [4, OBJECT_Y, 4],
    state: { facing: 'north', half: 'lower', hinge: 'left', open: false },
  },
  {
    blockType: 'door',
    position: [4, DOOR_UPPER_Y, 4],
    state: { facing: 'north', half: 'upper', hinge: 'left', open: false },
  },
  {
    blockType: 'door',
    position: [6, OBJECT_Y, 4],
    state: { facing: 'north', half: 'lower', hinge: 'left', open: true },
  },
  {
    blockType: 'door',
    position: [6, DOOR_UPPER_Y, 4],
    state: { facing: 'north', half: 'upper', hinge: 'left', open: true },
  },
  {
    blockType: 'oak_stairs',
    position: [8, OBJECT_Y, 4],
    state: { facing: 'east', half: 'bottom', shape: 'straight' },
  },
  {
    blockType: 'oak_stairs',
    position: [10, OBJECT_Y, 4],
    state: { facing: 'north', half: 'bottom', shape: 'outer_right' },
  },
  { blockType: 'water', position: [4, OBJECT_Y, 8], state: { level: 7 } },
  { blockType: 'water', position: [7, OBJECT_Y, 8], state: { level: 0 } },
  { blockType: 'water', position: [8, OBJECT_Y, 8], state: { level: 7 } },
  { blockType: 'rail', position: [10, OBJECT_Y, 8], state: { shape: 'north_east' } },
  { blockType: 'rail', position: [12, OBJECT_Y, 8], state: { shape: 'ascending_east' } },
  { blockType: 'wheat_crop', position: [4, OBJECT_Y, 12], state: { age: 0 } },
  { blockType: 'wheat_crop', position: [6, OBJECT_Y, 12], state: { age: 7 } },
]

const blockIdForType = (blockType: BlockType) => Option.getOrThrow(blockIdOf(blockType))

const encodedStateFor = (blockType: BlockType, state: BlockStateValues): number =>
  Result.getOrThrow(encodeBlockState(blockIdForType(blockType), state))

const stateIndexFor = ([lx, y, lz]: StatefulBlock['position']): number => blockIndex(lx, y, lz)

export type StatePreviewChunk = Chunk | (Chunk & Readonly<{ blockStates: Uint32Array }>)

/** Build the same block fixture with or without RN6's per-cell state buffer. */
export const createStatePreviewChunk = (includeBlockStates: boolean): StatePreviewChunk => {
  const blocks = emptyBlocks()
  const stoneId = blockIdForType('stone')
  for (let lx = FIRST_LOCAL_BLOCK; lx <= LAST_LOCAL_BLOCK; lx += 1) {
    for (let lz = FIRST_LOCAL_BLOCK; lz <= LAST_LOCAL_BLOCK; lz += 1) {
      setBlockAt(blocks, LocalAxis(lx), BlockAxis(GROUND_Y), LocalAxis(lz), stoneId)
    }
  }
  for (const { blockType, position } of STATEFUL_BLOCKS) {
    setBlockAt(blocks, LocalAxis(position[0]), BlockAxis(position[1]), LocalAxis(position[2]), blockIdForType(blockType))
  }

  const chunk: Chunk = {
    biomes: Array.from({ length: CHUNK_SIZE * CHUNK_SIZE }, () => STATE_PREVIEW_BIOME),
    blocks,
    coord: chunkCoord(ChunkAxis(0), ChunkAxis(0)),
  }
  if (!includeBlockStates) {
    return chunk
  }

  const blockStates = new Uint32Array(blocks.length)
  blockStates.fill(encodedStateFor('air', {}))
  for (const { blockType, position, state } of STATEFUL_BLOCKS) {
    blockStates[stateIndexFor(position)] = encodedStateFor(blockType, state)
  }
  return { ...chunk, blockStates }
}
