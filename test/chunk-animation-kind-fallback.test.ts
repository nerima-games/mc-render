import { BLOCK_IDS, type BlockId } from '@nerima-games/mc-kernel'
import { describe, expect, it, vi } from 'vitest'
import { CHUNK_ANIMATION_KIND, chunkAnimationKindForBlockId } from '../src/domain/chunk-animation-kind'

vi.mock('@nerima-games/mc-kernel', async (importOriginal) => {
  const kernel = await importOriginal<typeof import('@nerima-games/mc-kernel')>()
  const [unresolvedBlockId] = kernel.BLOCK_IDS
  const { Result } = await import('effect')

  return {
    ...kernel,
    blockTypeOfId: (blockId: BlockId) => {
      if (blockId === unresolvedBlockId) {
        return Result.succeed(undefined)
      }
      return kernel.blockTypeOfId(blockId)
    },
  }
})

const [unresolvedBlockId] = BLOCK_IDS
if (unresolvedBlockId === undefined) {
  throw new Error('The kernel registry must define at least one block ID.')
}

describe('chunk animation kinds for unresolved registry entries', () => {
  it('leaves unresolved block IDs unanimated', () => {
    expect(chunkAnimationKindForBlockId(unresolvedBlockId)).toBe(CHUNK_ANIMATION_KIND.none)
  })
})
