import { describe, expect, it } from 'vitest'
import {
  buildFluidGeometry,
  combineChunkGeometry,
  type ChunkGeometryBuffers,
  type FaceDirection,
  type FluidQuad,
} from '../src/domain/chunk-geometry'

const top = (flow?: FluidQuad['flow']): FluidQuad => {
  const base = {
    blockId: 6,
    direction: 'yPos' as const,
    vertices: [[0, 0.8, 0], [0, 0.8, 1], [1, 0.8, 1], [1, 0.8, 0]] as FluidQuad['vertices'],
    ao: 0,
  }
  if (flow === undefined) {
    return base
  }
  return { ...base, flow }
}

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

  it('a still, non-falling side face carries no animated flow direction', () => {
    // `fluidFlowDirection` only has two ways to produce a direction: the top
    // face's sampled flow, or a falling side's face normal. A side face that
    // is neither (no `flow.falling`, and its cell is not in `fallingCells`
    // because no top quad in this call is falling) must fall through to
    // `NO_FLOW_DIRECTION` rather than leaving the buffer uninitialized.
    const geometry = buildFluidGeometry([side('xPos')])

    expect([...geometry.fluidDirections]).toStrictEqual([0, 0, 0, 0, 0, 0, 0, 0])
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

  it('substitutes 0 for an index slot a malformed part declared but did not supply', () => {
    // `copyGeometryIndices` reads `part.indices[index]` for `index` up to
    // `part.indexCount`, under `noUncheckedIndexedAccess`. Every INTERNAL
    // producer (`buildChunkGeometry`, `buildFluidGeometry`, `EMPTY_BUFFERS`)
    // always allocates `indices` to be exactly `indexCount` long, so this
    // never misses from inside this module. `combineChunkGeometry` is public,
    // though, and a caller across the exported boundary (mc-compose, or a
    // hand-built fixture) can supply a `ChunkGeometryBuffers` whose declared
    // `indexCount` outruns its actual `indices` array. That out-of-bounds
    // read is `undefined` in JS, and the fallback keeps the combine from
    // writing `undefined` (or NaN, via `+ vertexOffset`) into the buffer.
    const shortPart: ChunkGeometryBuffers = {
      colors: new Uint8Array(0),
      fluidDirections: new Float32Array(0),
      fluidFalling: new Float32Array(0),
      indexCount: 3,
      indices: new Uint32Array(0),
      normals: new Float32Array(0),
      positions: new Float32Array(0),
      quadCount: 0,
      tileIndices: new Float32Array(0),
      uvs: new Float32Array(0),
      vertexCount: 0,
    }

    const combined = combineChunkGeometry(shortPart)

    expect(Array.from(combined.indices)).toStrictEqual([0, 0, 0])
  })
})
