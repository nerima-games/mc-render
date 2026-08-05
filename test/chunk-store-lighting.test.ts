import { describe, expect, it } from '@effect/vitest'
import { blockPosition, type BlockPosition } from '@nerima-games/mc-kernel'
import type { LightReading } from '@nerima-games/mc-worldgen'
import { Effect } from 'effect'
import { makeChunkStoreLightColor } from '../src/application/chunk-store-mesher'
import type { MeshQuad } from '../src/domain/chunk-geometry'

const quad = (overrides: Partial<MeshQuad> = {}): MeshQuad => ({
  blockId: 1,
  direction: 'yPos',
  role: 'top',
  lx: 0,
  y: 0,
  lz: 0,
  width: 1,
  height: 1,
  ao: 0,
  ...overrides,
})

describe('makeChunkStoreLightColor', () => {
  it.effect('reads the neighbouring world cell at a negative chunk boundary', () =>
    Effect.gen(function* () {
      const requested: Array<BlockPosition> = []
      const color = yield* makeChunkStoreLightColor(
        {
          getLight: (position) => {
            requested.push(position)
            return Effect.succeed<LightReading>({ _tag: 'Light', sky: 15, block: 7 })
          },
        },
        { cx: 2, cz: -1 },
        [quad({ direction: 'xNeg' })],
      )

      expect(requested).toStrictEqual([blockPosition(31, 0, -16)])
      expect(color(quad({ direction: 'xNeg' })).slice(1)).toStrictEqual([255, 119])
    }),
  )

  it.effect('maps missing data to darkness and clamps malformed stored levels', () =>
    Effect.gen(function* () {
      const missing = yield* makeChunkStoreLightColor(
        { getLight: () => Effect.succeed<LightReading>({ _tag: 'ChunkNotLoaded' }) },
        { cx: 0, cz: 0 },
        [quad()],
      )
      expect(missing(quad()).slice(1)).toStrictEqual([0, 0])

      const malformed = yield* makeChunkStoreLightColor(
        { getLight: () => Effect.succeed<LightReading>({ _tag: 'Light', sky: 99, block: -4 }) },
        { cx: 0, cz: 0 },
        [quad()],
      )
      expect(malformed(quad()).slice(1)).toStrictEqual([255, 0])
    }),
  )

  it.effect('takes a fresh snapshot for every dirty re-mesh', () =>
    Effect.gen(function* () {
      let block = 2
      const store = {
        getLight: () => Effect.succeed<LightReading>({ _tag: 'Light', sky: 0, block }),
      }
      const first = yield* makeChunkStoreLightColor(store, { cx: 0, cz: 0 }, [quad()])
      block = 12
      const second = yield* makeChunkStoreLightColor(store, { cx: 0, cz: 0 }, [quad()])

      expect(first(quad())[2]).toBe(34)
      expect(second(quad())[2]).toBe(204)
    }),
  )
})
