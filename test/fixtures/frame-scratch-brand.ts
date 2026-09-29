import type { ScratchMap } from '../../src/domain/frame-scratch.js'

// @ts-expect-error ScratchMap requires the private factory brand.
export const handBuilt: ScratchMap<string, number> = {
  name: 'hand-built',
  usageCount: () => 0,
  borrowedCount: () => 0,
}
