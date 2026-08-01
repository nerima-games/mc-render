import { describe, expect, it } from 'vitest'
import {
  buildFluidGeometry,
  combineChunkGeometry,
  type FaceDirection,
  type FluidQuad,
} from '../src/domain/chunk-geometry'

const top = (flow?: FluidQuad['flow']): FluidQuad => ({
  blockId: 6,
  direction: 'yPos',
  vertices: [[0, 0.8, 0], [0, 0.8, 1], [1, 0.8, 1], [1, 0.8, 0]],
  ...(flow === undefined ? {} : { flow }),
  ao: 0,
})

const side = (direction: FaceDirection): FluidQuad => ({
  blockId: 6,
  direction,
  vertices: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  ao: 0,
})

describe('buildFluidGeometry', () => {
  it('preserves canonical top UVs and zero metadata for still fluid', () => {
    const geometry = buildFluidGeometry([top()])

    expect([...geometry.uvs]).toStrictEqual([0, 0, 0, 1, 1, 1, 1, 0])
    expect([...geometry.fluidDirections]).toStrictEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect([...geometry.fluidFalling]).toStrictEqual([0, 0, 0, 0])
  })

  it('orients top UVs and repeats normalized horizontal flow per vertex', () => {
    const geometry = buildFluidGeometry([top({ direction: [2, 0], falling: false })])

    expect([...geometry.uvs]).toStrictEqual([0, 0, 1, 0, 1, 1, 0, 1])
    expect([...geometry.fluidDirections]).toStrictEqual([1, 0, 1, 0, 1, 0, 1, 0])
  })

  it('propagates falling state to the positive side of the same fluid cell', () => {
    const geometry = buildFluidGeometry([
      top({ direction: [0, 0], falling: true }),
      side('xPos'),
    ])

    expect([...geometry.fluidFalling]).toStrictEqual([1, 1, 1, 1, 1, 1, 1, 1])
    expect(Array.from(geometry.fluidDirections.slice(8))).toStrictEqual([1, 0, 1, 0, 1, 0, 1, 0])
  })

  it('falls back safely when flow direction is not finite', () => {
    const geometry = buildFluidGeometry([top({ direction: [Number.NaN, Number.POSITIVE_INFINITY], falling: false })])

    expect([...geometry.fluidDirections]).toStrictEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect([...geometry.uvs]).toStrictEqual([0, 0, 0, 1, 1, 1, 1, 0])
  })
})

describe('combineChunkGeometry', () => {
  it('offsets indices while concatenating fluid metadata', () => {
    const first = buildFluidGeometry([top()])
    const second = buildFluidGeometry([top({ direction: [0, 1], falling: false })])
    const combined = combineChunkGeometry(first, second)

    expect(combined.vertexCount).toBe(8)
    expect(Array.from(combined.indices.slice(6))).toStrictEqual([4, 5, 6, 4, 6, 7])
    expect(Array.from(combined.fluidDirections.slice(8))).toStrictEqual([0, 1, 0, 1, 0, 1, 0, 1])
  })
})
