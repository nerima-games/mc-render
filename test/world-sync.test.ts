/**
 * `application/world-sync.ts` — the chunk-to-screen path, against fakes.
 *
 * Nothing here is evidence about pixels; `test/support/fake-three.ts`'s header
 * says what a fake `three` cannot carry. What these tests CAN carry is the
 * bookkeeping, and the bookkeeping is where this seam's failures live: a
 * removal applied in the wrong order, a deferred chunk counted as meshed, or a
 * chunk-local position never offset into world space.
 *
 * The offset is the one worth naming. mc-meshing emits chunk-local coordinates
 * and mc-render applies the origin; if it did not, every chunk in the world
 * would be stacked at 0,0 — which renders as ONE chunk of terrain rather than
 * as nothing, and so reads as "the world generator only made one chunk".
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Ref } from 'effect'
import { makeWorldRenderer } from '../src/application/world-renderer'
import {
  EMPTY_SYNC_REPORT,
  chunkKeyOf,
  chunkOrigin,
  syncWorld,
  type ChunkRef,
  type DirtyBatch,
} from '../src/application/world-sync'
import { CHUNK_SIZE } from '../src/domain/lod-vocabulary'
import type { MeshQuad } from '../src/domain/chunk-geometry'
import { FAKE_CANVAS, makeFakeThree } from './support/fake-three'

const VIEWPORT = { width: 1280, height: 720 }

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

/** A drain that yields each batch once, then nothing. */
const scriptedSource = (batches: ReadonlyArray<DirtyBatch>) =>
  Effect.gen(function* () {
    const remaining = yield* Ref.make([...batches])
    return {
      drain: Ref.modify(remaining, (queue) => {
        const [next, ...rest] = queue
        return [next ?? { changed: [], removed: [] }, rest]
      }),
    }
  })

describe('chunkOrigin', () => {
  it.effect('scales the chunk coordinate by the mirrored CHUNK_SIZE', () =>
    Effect.sync(() => {
      // Derived from the mirror, not from a 16 typed in the test — a test that
      // restated the constant would agree with a builder that had drifted.
      expect(chunkOrigin({ cx: 0, cz: 0 })).toStrictEqual([0, 0])
      expect(chunkOrigin({ cx: 3, cz: -2 })).toStrictEqual([3 * CHUNK_SIZE, -2 * CHUNK_SIZE])
    }),
  )

  it.effect('REGRESSION: a non-zero chunk does not land at the origin', () =>
    Effect.gen(function* () {
      // The failure that looks like a world-generator bug: every chunk stacked
      // at 0,0 renders as ONE chunk of terrain, not as an empty screen.
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const source = yield* scriptedSource([{ changed: [{ cx: 2, cz: 0 }], removed: [] }])

      yield* syncWorld(renderer, source, () => Effect.succeed([quad()]))

      const positions = three.geometries()[0]?.attributes.get('position')
      const xs = [...((positions as { array: Float32Array }).array ?? [])].filter(
        (_, at) => at % 3 === 0,
      )

      expect(Math.min(...xs)).toBe(2 * CHUNK_SIZE)
    }),
  )
})

describe('syncWorld', () => {
  it.effect('meshes each changed chunk into the scene under its own key', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const changed: ReadonlyArray<ChunkRef> = [
        { cx: 0, cz: 0 },
        { cx: 1, cz: 0 },
        { cx: 0, cz: 1 },
      ]
      const source = yield* scriptedSource([{ changed, removed: [] }])

      const report = yield* syncWorld(renderer, source, () => Effect.succeed([quad()]))

      expect(report).toStrictEqual({ meshed: 3, deferred: 0, removed: 0 })
      expect([...(yield* renderer.chunkKeys)].sort()).toStrictEqual(
        changed.map(chunkKeyOf).sort(),
      )
    }),
  )

  it.effect('an empty quad list is a real answer and goes into the scene', () =>
    Effect.gen(function* () {
      // "No visible faces" is the normal case at the edge of the world, and it
      // is NOT the same as "ask again later". A chunk that is genuinely empty
      // must occupy its key, or the next drain will keep re-meshing it.
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const source = yield* scriptedSource([{ changed: [{ cx: 0, cz: 0 }], removed: [] }])

      const report = yield* syncWorld(renderer, source, () => Effect.succeed([]))

      expect(report.meshed).toBe(1)
      expect(yield* renderer.chunkKeys).toStrictEqual(['0,0'])
    }),
  )

  it.effect('an undefined mesh defers, and puts nothing in the scene', () =>
    Effect.gen(function* () {
      // The other half of the distinction. A chunk whose neighbours have not
      // loaded must not be meshed now: doing so seals faces the neighbour is
      // about to open, and nothing will mark it dirty a second time.
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const source = yield* scriptedSource([{ changed: [{ cx: 0, cz: 0 }], removed: [] }])

      const report = yield* syncWorld(renderer, source, () => Effect.succeed(undefined))

      expect(report).toStrictEqual({ meshed: 0, deferred: 1, removed: 0 })
      expect(yield* renderer.chunkKeys).toStrictEqual([])
    }),
  )

  it.effect('removals take chunks out of the scene', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const source = yield* scriptedSource([
        { changed: [{ cx: 0, cz: 0 }, { cx: 1, cz: 0 }], removed: [] },
        { changed: [], removed: [{ cx: 0, cz: 0 }] },
      ])

      yield* syncWorld(renderer, source, () => Effect.succeed([quad()]))
      const report = yield* syncWorld(renderer, source, () => Effect.succeed([quad()]))

      expect(report).toStrictEqual({ meshed: 0, deferred: 0, removed: 1 })
      expect(yield* renderer.chunkKeys).toStrictEqual(['1,0'])
    }),
  )

  it.effect('REGRESSION: a coordinate in BOTH lists survives as loaded', () =>
    Effect.gen(function* () {
      // `ChunkDirtyBatch` does not promise the lists are disjoint — an unload
      // and a reload inside one frame put the same coordinate in each. Applying
      // removals first means the surviving state is "loaded", which is what
      // happened. The other order drops the chunk until something dirties it
      // again, and nothing will.
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const source = yield* scriptedSource([
        { changed: [{ cx: 4, cz: 4 }], removed: [{ cx: 4, cz: 4 }] },
      ])

      yield* syncWorld(renderer, source, () => Effect.succeed([quad()]))

      expect(yield* renderer.chunkKeys).toStrictEqual(['4,4'])
    }),
  )

  it.effect('re-meshing a chunk replaces it rather than leaking a mesh', () =>
    Effect.gen(function* () {
      // The coalescing claim from the header, as bookkeeping: a falling column
      // of sand dirties one chunk repeatedly and each drain must REPLACE.
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const source = yield* scriptedSource([
        { changed: [{ cx: 0, cz: 0 }], removed: [] },
        { changed: [{ cx: 0, cz: 0 }], removed: [] },
      ])

      yield* syncWorld(renderer, source, () => Effect.succeed([quad()]))
      yield* syncWorld(renderer, source, () => Effect.succeed([quad()]))

      expect(yield* renderer.chunkKeys).toStrictEqual(['0,0'])
      expect(three.scene().members()).toHaveLength(1)
      expect(three.geometries()[0]?.disposed()).toBe(true)
    }),
  )

  it.effect('a drain with nothing in it does nothing', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const source = yield* scriptedSource([])

      const report = yield* syncWorld(renderer, source, () => Effect.succeed([quad()]))

      expect(report).toStrictEqual(EMPTY_SYNC_REPORT)
      expect(three.geometries()).toHaveLength(0)
    }),
  )

  it.effect('one drain per call, so meshing cannot starve a frame', () =>
    Effect.gen(function* () {
      // Meshing a chunk can dirty its neighbours. A loop-until-empty would have
      // no bound on one frame's work; the next frame drains what this produced.
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const source = yield* scriptedSource([
        { changed: [{ cx: 0, cz: 0 }], removed: [] },
        { changed: [{ cx: 1, cz: 0 }], removed: [] },
      ])

      const first = yield* syncWorld(renderer, source, () => Effect.succeed([quad()]))

      expect(first.meshed).toBe(1)
      expect(yield* renderer.chunkKeys).toStrictEqual(['0,0'])
    }),
  )
})
