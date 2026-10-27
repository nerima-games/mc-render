import { describe, expect, it, vi } from 'vitest'

vi.mock('@nerima-games/mc-kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nerima-games/mc-kernel')>()
  const { Option, Result } = await import('effect')

  return {
    ...actual,
    blockIdsWithOpacity: () => Result.succeed(Option.none()),
  }
})

const { KERNEL_MESH_CONFIG } = await import('../src/application/chunk-store-mesher.js')

describe('KERNEL_MESH_CONFIG', () => {
  it('uses an empty set when the kernel has no transparent-solid blocks', () => {
    expect(KERNEL_MESH_CONFIG.transparentSolidBlockIds).toStrictEqual(new Set())
  })
})
