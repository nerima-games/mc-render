import { BLOCK_IDS, type BlockId, blockTypeOfId } from '@nerima-games/mc-kernel'
import { Result } from 'effect'

/** Stable per-vertex tags for the chunk shader's animated materials. */
export const CHUNK_ANIMATION_KIND = {
  endPortal: 5,
  fire: 3,
  lava: 2,
  netherPortal: 4,
  none: 0,
  water: 1,
} as const

export type ChunkAnimationKind = (typeof CHUNK_ANIMATION_KIND)[keyof typeof CHUNK_ANIMATION_KIND]

const ANIMATION_KIND_BY_BLOCK_TYPE: Readonly<Record<string, ChunkAnimationKind | undefined>> = {
  end_portal: CHUNK_ANIMATION_KIND.endPortal,
  fire: CHUNK_ANIMATION_KIND.fire,
  lava: CHUNK_ANIMATION_KIND.lava,
  lava_cauldron: CHUNK_ANIMATION_KIND.lava,
  nether_portal: CHUNK_ANIMATION_KIND.netherPortal,
  water: CHUNK_ANIMATION_KIND.water,
  water_cauldron: CHUNK_ANIMATION_KIND.water,
}

const ANIMATION_KIND_BY_BLOCK_ID = new Map<BlockId, ChunkAnimationKind>(
  BLOCK_IDS.flatMap((blockId) => {
    const blockType = Result.getOrThrow(blockTypeOfId(blockId)) ?? 'unknown'
    const animationKind = ANIMATION_KIND_BY_BLOCK_TYPE[blockType]
    if (animationKind === undefined) {
      return []
    }
    return [[blockId, animationKind] as const]
  }),
)

/** Resolve motion from block identity so atlas reassignment cannot animate unrelated blocks. */
export const chunkAnimationKindForBlockId = (blockId: BlockId): ChunkAnimationKind =>
  ANIMATION_KIND_BY_BLOCK_ID.get(blockId) ?? CHUNK_ANIMATION_KIND.none
