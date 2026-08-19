import { describe, expect, it } from '@effect/vitest'
import { COLOR_COMPONENTS } from '../src/domain/chunk-geometry'
import { makeUnitCubeBuffers } from '../src/application/world-renderer-geometry'

describe('makeUnitCubeBuffers', () => {
  it('creates the eight vertices, six faces, and per-vertex color data', () => {
    const buffers = makeUnitCubeBuffers([12, 34, 56])

    expect(buffers.positions).toHaveLength(8 * 3)
    expect(buffers.indices).toHaveLength(6 * 2 * 3)
    expect(buffers.colors).toHaveLength(8 * COLOR_COMPONENTS)
    expect(Array.from(buffers.positions.slice(0, 3))).toEqual([-0.5, -0.5, -0.5])
    expect(Array.from(buffers.positions.slice(-3))).toEqual([-0.5, 0.5, 0.5])
    expect(Array.from(buffers.colors)).toEqual(Array(8).fill([12, 34, 56]).flat())
  })

  it('returns independent typed arrays for each mesh', () => {
    const first = makeUnitCubeBuffers([1, 2, 3])
    const second = makeUnitCubeBuffers([4, 5, 6])

    first.positions[0] = 99
    first.colors[0] = 88
    first.indices[0] = 7

    expect(second.positions[0]).toBe(-0.5)
    expect(second.colors[0]).toBe(4)
    expect(second.indices[0]).toBe(0)
  })
})
