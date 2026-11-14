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
import { Effect, Fiber, Ref, Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import { BLOCK_IDS, BlockAxis, LocalAxis } from '@nerima-games/mc-kernel'
import type { Chunk } from '@nerima-games/mc-worldgen'
import { emptyBlocks, setBlockAt } from '@nerima-games/mc-worldgen/testing'
import {
  makeWorldRenderer,
  type ChunkGeometryUpdate,
  type WorldRenderer,
} from '../src/application/world-renderer'
import {
  blockNameFromKernel,
  makeChunkStoreMesher,
  type MeshingChunkStore,
} from '../src/application/chunk-store-mesher'
import {
  EMPTY_SYNC_REPORT,
  BudgetedDirtySourceInputErrorSchema,
  BudgetedDirtySourceResultSchema,
  attachWorldRenderer,
  chunkKeyOf,
  chunkOrigin,
  makeBudgetedDirtySource,
  syncWorld,
  type ChunkRef,
  type DirtyBatch,
  type DirtySource,
  type BudgetedDirtySourceInputError,
} from '../src/application/world-sync'
import { CHUNK_SIZE } from '@nerima-games/mc-meshing'
import type { CrossPlantQuad, GeometryQuad, MeshQuad, QuadColor } from '../src/domain/chunk-geometry'
import { TILE_BY_BLOCK_NAME, quadTileForLookup } from '../src/domain/block-texture-map'
import { FAKE_CANVAS, makeFakeThree } from './support/fake-three'
import { blockId, chunkCoord } from './support/kernel-brands'
import { WorkerCountSchema } from '../src/domain/worker-parallelism.js'

const VIEWPORT = { width: 1280, height: 720 }
const workerCount = Schema.decodeUnknownSync(WorkerCountSchema)

const quad = (overrides: Partial<MeshQuad> = {}): MeshQuad => ({
  blockId: blockId(1),
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

const crossPlantQuad = (overrides: Partial<CrossPlantQuad> = {}): CrossPlantQuad => ({
  blockId: blockId(21),
  role: 'side',
  vertices: [
    [1, 10, 2],
    [1, 11, 2],
    [2, 11, 3],
    [2, 10, 3],
  ],
  nx: 0,
  ny: 0,
  nz: 1,
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
      expect(chunkOrigin(chunkCoord(0, 0))).toStrictEqual([0, 0])
      expect(chunkOrigin(chunkCoord(3, -2))).toStrictEqual([3 * CHUNK_SIZE, -2 * CHUNK_SIZE])
    }),
  )

  it.effect('REGRESSION: a non-zero chunk does not land at the origin', () =>
    Effect.gen(function* () {
      // The failure that looks like a world-generator bug: every chunk stacked
      // at 0,0 renders as ONE chunk of terrain, not as an empty screen.
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const source = yield* scriptedSource([{ changed: [chunkCoord(2, 0)], removed: [] }])

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
  it.effect('records typed faults when present mesh fields are unreadable', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const invalidFields = ['blockShapes', 'crossPlants', 'specialBlocks', 'fluids', 'renderLayers'] as const
      for (const [index, field] of invalidFields.entries()) {
        const chunk = chunkCoord(index, 0)
        const source = yield* scriptedSource([{ changed: [chunk], removed: [] }])
        const mesh = [quad()]
        Object.defineProperty(mesh, field, { enumerable: true, value: null })

        const report = yield* syncWorld(renderer, source, () => Effect.succeed(mesh))
        expect(report).toStrictEqual({
          deferred: 0,
          faults: [{
            chunk,
            error: {
              _tag: 'ChunkMeshGeometryInputFailure',
              field,
            },
          }],
          meshed: 0,
          removed: 0,
        })
      }
    }),
  )

  it.effect('records a global LOD refresh fault while applying changed chunks', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const changed = chunkCoord(3, -2)
      const source = yield* scriptedSource([{ changed: [changed], removed: [] }])
      const lodError = {
        _tag: 'LodInputError',
        operation: 'thresholds',
        reason: 'invalid-thresholds',
      } as const
      const mesher = Object.assign(() => Effect.succeed([quad()]), {
        refreshLod: () => Result.fail(lodError),
      })

      const report = yield* syncWorld(renderer, source, mesher)

      expect(report).toStrictEqual({
        deferred: 0,
        faults: [{ chunk: undefined, error: lodError }],
        meshed: 1,
        removed: 0,
      })
      expect(yield* renderer.chunkKeys).toStrictEqual([chunkKeyOf(changed)])
      const position = three.geometries()[0]?.attributes.get('position')
      expect(position?.array.length).toBeGreaterThan(0)
    }),
  )

  it.effect('runs worker-backed meshers concurrently up to their advertised pool width', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const source = yield* scriptedSource([{ changed: [chunkCoord(0, 0), chunkCoord(1, 0), chunkCoord(2, 0)], removed: [] }])
      const started: Array<number> = []
      const releases: Array<() => void> = []
      const mesher = Object.assign(
        (chunk: ChunkRef) => Effect.callback<ReadonlyArray<MeshQuad>>((resume) => {
          started.push(chunk.cx)
          releases.push(() => resume(Effect.succeed([quad()])))
        }),
        { concurrency: workerCount(2) },
      )

      const syncing = yield* Effect.forkChild(syncWorld(renderer, source, mesher))
      yield* Effect.yieldNow
      expect(started).toStrictEqual([0, 1])

      const [releaseFirst] = releases
      if (releaseFirst === undefined) {
        throw new Error('expected the first worker task to have a release callback')
      }
      releaseFirst()
      yield* Effect.yieldNow
      expect(started).toStrictEqual([0, 1, 2])

      for (const release of releases.slice(1)) {
        release()
      }
      yield* Fiber.join(syncing)
    }),
  )

  it.effect('merges camera-driven LOD refreshes with dirty chunks without meshing duplicates', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const alreadyDirty = chunkCoord(2, 0)
      const lodOnly = chunkCoord(4, 0)
      const source = yield* scriptedSource([{ changed: [alreadyDirty], removed: [] }])
      const meshed: Array<string> = []
      const mesher = Object.assign(
        (chunk: ChunkRef) => Effect.sync(() => {
          meshed.push(`${chunk.cx},${chunk.cz}`)
          return [quad()]
        }),
        { refreshLod: () => Result.succeed([lodOnly, alreadyDirty]) },
      )

      const report = yield* syncWorld(renderer, source, mesher)

      expect(meshed).toStrictEqual(['2,0', '4,0'])
      expect(report).toStrictEqual({ meshed: 2, deferred: 0, removed: 0 })
    }),
  )

  it.effect('cancels work for unloaded chunks before removing their scene entry', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const chunk = chunkCoord(4, -2)
      const cancelled: Array<string> = []
      const mesher = Object.assign(
        () => Effect.succeed([quad()]),
        { cancel: (removed: ChunkRef) => Effect.sync(() => { cancelled.push(`${removed.cx},${removed.cz}`) }) },
      )
      const source = yield* scriptedSource([{ changed: [], removed: [chunk] }])

      const report = yield* syncWorld(renderer, source, mesher)

      expect(cancelled).toStrictEqual(['4,-2'])
      expect(report.removed).toBe(1)
      expect(yield* renderer.chunkKeys).toStrictEqual([])
    }),
  )

  for (const count of [81, 289, 1089] as const) {
    it.effect(`keeps ${String(count)} changed chunks within one registry commit`, () =>
      Effect.gen(function* () {
        const three = makeFakeThree()
        const actual = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
        const changed = Array.from({ length: count }, (_, index) => chunkCoord(index, 0))
        const source = yield* scriptedSource([{ changed, removed: [] }])
        const committedSizes: Array<number> = []
        const renderer: WorldRenderer = {
          ...actual,
          setChunk: () => Effect.die('syncWorld must use the batch API'),
          setChunks: (updates: ReadonlyArray<ChunkGeometryUpdate>) =>
            Effect.sync(() => {
              committedSizes.push(updates.length)
            }),
        }

        const report = yield* syncWorld(renderer, source, () => Effect.succeed([]))

        expect(report.meshed).toBe(count)
        expect(committedSizes).toStrictEqual([count])
      }),
    )
  }

  it.effect('meshes each changed chunk into the scene under its own key', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const changed: ReadonlyArray<ChunkRef> = [
        chunkCoord(0, 0),
        chunkCoord(1, 0),
        chunkCoord(0, 1),
      ]
      const source = yield* scriptedSource([{ changed, removed: [] }])

      const report = yield* syncWorld(renderer, source, () => Effect.succeed([quad()]))

      expect(report).toStrictEqual({ meshed: 3, deferred: 0, removed: 0 })
      expect([...(yield* renderer.chunkKeys)].sort()).toStrictEqual(
        changed.map(chunkKeyOf).sort(),
      )
    }),
  )

  it.effect('passes cross plants into the Three.js buffer with double-sided indices', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const source = yield* scriptedSource([{ changed: [chunkCoord(0, 0)], removed: [] }])
      const mesh = Object.assign([quad()], { crossPlants: [crossPlantQuad()] })

      const report = yield* syncWorld(renderer, source, () => Effect.succeed(mesh))

      expect(report).toStrictEqual({ meshed: 1, deferred: 0, removed: 0 })
      const geometry = three.geometries().find((candidate) => candidate.index()?.array.length === 12)
      if (geometry === undefined) {
        throw new Error('the cross plant must create its own double-sided geometry')
      }
      const positions = geometry.attributes.get('position')
      const index = geometry.index()
      if (positions === undefined || index === undefined) {
        throw new Error('the cross plant geometry must expose position and index buffers')
      }

      expect(positions.array).toHaveLength(12)
      expect(index.array).toHaveLength(12)
      expect(Array.from(index.array)).toStrictEqual([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2])
    }),
  )

  it.effect('routes kernel leaves, glass, water and lava to their render layers', () =>
    Effect.gen(function* () {
      const blockIdNamed = (name: string) => BLOCK_IDS.find((candidateId) => blockNameFromKernel(candidateId) === name)
      const stone = blockIdNamed('stone')
      const leaves = blockIdNamed('oak_leaves')
      const glass = blockIdNamed('glass')
      const water = blockIdNamed('water')
      const lava = blockIdNamed('lava')
      if (stone === undefined || leaves === undefined || glass === undefined || water === undefined || lava === undefined) {
        throw new Error('mc-kernel must expose the block ids used by the render-layer test')
      }

      const blocks = emptyBlocks()
      for (const [lx, placedBlockId] of [[1, stone], [4, leaves], [7, glass], [10, water], [13, lava]] as const) {
        setBlockAt(blocks, LocalAxis(lx), BlockAxis(20), LocalAxis(1), placedBlockId)
      }
      const resident: Chunk = {
        biomes: Array.from({ length: 16 * 16 }, () => 'PLAINS' as const),
        blocks,
        coord: chunkCoord(0, 0),
      }
      const store: MeshingChunkStore = {
        neighbours: () => Effect.succeed({}),
        peek: () => Effect.succeed(resident),
      }
      const mesher = makeChunkStoreMesher(store)
      const mesh = yield* mesher(chunkCoord(0, 0))
      if (mesh === undefined) {
        throw new Error('the resident test chunk must produce a mesh')
      }

      expect(mesh.renderLayers?.opaque.some(({ blockId: quadBlockId }) => quadBlockId === stone)).toBe(true)
      expect(mesh.renderLayers?.cutout.some(({ blockId: quadBlockId }) => quadBlockId === leaves)).toBe(true)
      expect(mesh.renderLayers?.transparentSolid.some(({ blockId: quadBlockId }) => quadBlockId === glass)).toBe(true)
      expect(mesh.fluids?.some(({ blockId: fluidBlockId }) => fluidBlockId === water)).toBe(true)
      expect(mesh.fluids?.some(({ blockId: fluidBlockId }) => fluidBlockId === lava)).toBe(true)

      const three = makeFakeThree()
      const materials = {
        cutout: new three.MeshBasicMaterial({ vertexColors: true, wireframe: false }),
        opaque: new three.MeshBasicMaterial({ vertexColors: true, wireframe: false }),
        transparent: new three.MeshBasicMaterial({ vertexColors: true, wireframe: false }),
      }
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT, {
        cutoutMaterial: () => materials.cutout,
        material: () => materials.opaque,
        transparentMaterial: () => materials.transparent,
      })
      const source = yield* scriptedSource([{ changed: [chunkCoord(0, 0)], removed: [] }])
      const report = yield* syncWorld(renderer, source, mesher, {
        tileLookup: quadTileForLookup(blockNameFromKernel),
      })

      expect(report.meshed).toBe(1)
      expect(three.meshes()).toHaveLength(3)
      expect(three.meshes().map(({ material }) => material)).toStrictEqual([
        materials.opaque,
        materials.cutout,
        materials.transparent,
      ])
      const tileIndicesFor = (material: (typeof materials)[keyof typeof materials]): ReadonlyArray<number> => {
        const meshForLayer = three.meshes().find((candidateMesh) => candidateMesh.material === material)
        const attribute = meshForLayer?.geometry.attributes.get('tileIndex')
        if (attribute === undefined) {
          return []
        }
        return Array.from(attribute.array)
      }
      const cutoutTiles = tileIndicesFor(materials.cutout)
      const transparentTiles = tileIndicesFor(materials.transparent)
      const expectedLeafTiles = new Set<number>(Object.values(TILE_BY_BLOCK_NAME.oak_leaves))
      expect(cutoutTiles.length).toBeGreaterThan(0)
      expect(cutoutTiles.every((tile) => expectedLeafTiles.has(tile))).toBe(true)
      for (const blockName of ['glass', 'water', 'lava'] as const) {
        expect(Object.values(TILE_BY_BLOCK_NAME[blockName]).some((tile) => transparentTiles.includes(tile))).toBe(true)
      }
      const waterFlags = three.meshes()[2]?.geometry.attributes.get('waterSurface')?.array ?? []
      expect(Array.from(waterFlags).some((flag) => flag === 1)).toBe(true)

      yield* renderer.dispose
    }),
  )

  it.effect('keeps an empty layered chunk registered without allocating a renderable', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const source = yield* scriptedSource([{ changed: [chunkCoord(0, 0)], removed: [] }])
      const emptyMesh = Object.assign([], {
        renderLayers: {
          cutout: [],
          opaque: [],
          transparentSolid: [],
          water: [],
        },
      })

      const report = yield* syncWorld(renderer, source, () => Effect.succeed(emptyMesh))

      expect(report).toStrictEqual({ meshed: 1, deferred: 0, removed: 0 })
      expect(yield* renderer.chunkKeys).toStrictEqual(['0,0'])
      expect(three.meshes()).toHaveLength(0)
      expect(three.scene().members()).toHaveLength(0)

      yield* renderer.dispose
    }),
  )

  it.effect('preserves every generated render-layer count, including empty and single-quad boundaries', () =>
    Effect.sync(() => {
      const updates: Array<ChunkGeometryUpdate> = []
      const renderer = {
        removeChunk: () => Effect.void,
        setChunks: (batch: ReadonlyArray<ChunkGeometryUpdate>) => Effect.sync(() => updates.push(...batch)),
      } as unknown as WorldRenderer
      const source: DirtySource = {
        drain: Effect.succeed({ changed: [chunkCoord(0, 0)], removed: [] }),
      }
      const quadCount = FastCheck.integer({ min: 0, max: 4 })
      const counts = FastCheck.record({
        cutout: quadCount,
        opaque: quadCount,
        transparentSolid: quadCount,
        water: quadCount,
      })

      FastCheck.assert(
        FastCheck.property(counts, (expected) => {
          updates.length = 0
          const quads = (count: number): ReadonlyArray<MeshQuad> => Array.from({ length: count }, () => quad())
          const renderLayers = {
            cutout: quads(expected.cutout),
            opaque: quads(expected.opaque),
            transparentSolid: quads(expected.transparentSolid),
            water: quads(expected.water),
          }
          const mesh = Object.assign(
            [...renderLayers.opaque, ...renderLayers.cutout, ...renderLayers.transparentSolid, ...renderLayers.water],
            { renderLayers },
          )
          const report = Effect.runSync(syncWorld(renderer, source, () => Effect.succeed(mesh)))
          const [update] = updates
          return report.meshed === 1 && update !== undefined &&
            update.buffers.quadCount === expected.opaque &&
            update.cutoutBuffers?.quadCount === expected.cutout &&
            update.transparentSolidBuffers?.quadCount === expected.transparentSolid &&
            update.waterBuffers?.quadCount === expected.water
        }),
        { seed: 0x51a7e, numRuns: 100 },
      )
    }),
  )

  it.effect('colorForChunk, when given, is used instead of the flat color option', () =>
    Effect.gen(function* () {
      // `resolveChunkColor`'s other branch: with `colorForChunk` present, the
      // flat `options.color` must never be consulted, even though a caller
      // could pass both — a chunk-scoped colour (e.g. baked light) exists
      // precisely to override the flat default, and a build that fell through
      // to the flat one anyway would light every chunk identically.
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const source = yield* scriptedSource([{ changed: [chunkCoord(0, 0)], removed: [] }])
      const flatColorCalls: Array<GeometryQuad> = []
      const chunkColorCalls: Array<{ chunk: ChunkRef; quads: ReadonlyArray<GeometryQuad> }> = []
      const flatColor: QuadColor = (meshQuad) => {
        flatColorCalls.push(meshQuad)
        return [1, 0, 0]
      }
      const perChunkColor: QuadColor = () => [0, 1, 0]

      const report = yield* syncWorld(renderer, source, () => Effect.succeed([quad()]), {
        color: flatColor,
        colorForChunk: (chunk, quads) =>
          Effect.sync(() => {
            chunkColorCalls.push({ chunk, quads })
            return perChunkColor
          }),
      })

      expect(report).toStrictEqual({ meshed: 1, deferred: 0, removed: 0 })
      expect(chunkColorCalls).toStrictEqual([{ chunk: chunkCoord(0, 0), quads: [quad()] }])
      // The flat color function was never invoked — proof `resolveChunkColor`
      // took the `colorForChunk` branch rather than falling through to it.
      expect(flatColorCalls).toStrictEqual([])
    }),
  )

  it.effect('an empty quad list is a real answer and goes into the scene', () =>
    Effect.gen(function* () {
      // "No visible faces" is the normal case at the edge of the world, and it
      // is NOT the same as "ask again later". A chunk that is genuinely empty
      // must occupy its key, or the next drain will keep re-meshing it.
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const source = yield* scriptedSource([{ changed: [chunkCoord(0, 0)], removed: [] }])

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
      const source = yield* scriptedSource([{ changed: [chunkCoord(0, 0)], removed: [] }])

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
        { changed: [chunkCoord(0, 0), chunkCoord(1, 0)], removed: [] },
        { changed: [], removed: [chunkCoord(0, 0)] },
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
        { changed: [chunkCoord(4, 4)], removed: [chunkCoord(4, 4)] },
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
        { changed: [chunkCoord(0, 0)], removed: [] },
        { changed: [chunkCoord(0, 0)], removed: [] },
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
        { changed: [chunkCoord(0, 0)], removed: [] },
        { changed: [chunkCoord(1, 0)], removed: [] },
      ])

      const first = yield* syncWorld(renderer, source, () => Effect.succeed([quad()]))

      expect(first.meshed).toBe(1)
      expect(yield* renderer.chunkKeys).toStrictEqual(['0,0'])
    }),
  )
})

describe('attachWorldRenderer', () => {
  it.effect('updates, removes, and ignores dirty work after detach', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const batches = yield* Ref.make<ReadonlyArray<DirtyBatch>>([
        { changed: [chunkCoord(2, 3)], removed: [] },
        { changed: [], removed: [chunkCoord(2, 3)] },
        { changed: [chunkCoord(9, 9)], removed: [] },
      ])
      const unsubscribed = yield* Ref.make(0)
      const store = {
        subscribeDirty: Effect.succeed({
          drain: Ref.modify(batches, ([next, ...rest]) => [
            next ?? { changed: [], removed: [] },
            rest,
          ]),
          unsubscribe: Ref.update(unsubscribed, (count) => count + 1),
        }),
      }
      const attachment = yield* attachWorldRenderer(
        renderer,
        store,
        () => Effect.succeed([quad()]),
      )

      expect((yield* attachment.update).meshed).toBe(1)
      expect(yield* renderer.chunkKeys).toStrictEqual(['2,3'])
      expect((yield* attachment.update).removed).toBe(1)
      expect(yield* renderer.chunkKeys).toStrictEqual([])

      yield* attachment.detach
      yield* attachment.detach
      expect(yield* attachment.attached).toBe(false)
      expect(yield* Ref.get(unsubscribed)).toBe(1)
      expect(yield* attachment.update).toStrictEqual(EMPTY_SYNC_REPORT)
      expect(yield* renderer.chunkKeys).toStrictEqual([])
      expect(yield* Ref.get(batches)).toHaveLength(1)
    }),
  )

  it.effect('updates good chunks and drains one typed fault for a failed texture lookup', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const batches = yield* Ref.make<ReadonlyArray<DirtyBatch>>([
        { changed: [chunkCoord(0, 0), chunkCoord(1, 0)], removed: [] },
      ])
      const store = {
        subscribeDirty: Effect.succeed({
          drain: Ref.modify(batches, ([next, ...rest]) => [
            next ?? { changed: [], removed: [] },
            rest,
          ]),
          unsubscribe: Effect.void,
        }),
      }
      const lookupError = {
        _tag: 'BlockTextureLookupError',
        blockName: 'unknown',
        reason: 'unknown-block',
        role: 'top',
      } as const
      const attachment = yield* attachWorldRenderer(
        renderer,
        store,
        (chunk) => {
          if (chunk.cx === 0) {
            return Effect.succeed([quad({ blockId: blockId(2) })])
          }
          return Effect.succeed([quad({ blockId: blockId(1) })])
        },
        {
          tileLookup: (geometryQuad) => {
            if (geometryQuad.blockId === blockId(2)) {
              return Result.fail(lookupError)
            }
            return quadTileForLookup(blockNameFromKernel)(geometryQuad)
          },
        },
      )

      const report = yield* attachment.update
      const faults = yield* attachment.drainFaults

      expect(report.meshed).toBe(1)
      expect(yield* renderer.chunkKeys).toStrictEqual(['1,0'])
      expect(faults).toStrictEqual([{
        _tag: 'ChunkRenderFault',
        chunk: chunkCoord(0, 0),
        error: lookupError,
        occurrences: 1,
      }])
      expect(yield* attachment.drainFaults).toStrictEqual([])
      const nonemptyPosition = three.geometries()
        .map((geometry) => geometry.attributes.get('position'))
        .find((attribute) => attribute !== undefined && attribute.array.length > 0)
      expect(Array.from(nonemptyPosition?.array ?? [])).toContain(16)
    }),
  )

  it.effect('coalesces repeated identical faults for one chunk and counts occurrences', () =>
    Effect.gen(function* () {
      const renderer = yield* makeWorldRenderer(makeFakeThree(), FAKE_CANVAS, VIEWPORT)
      const failedChunk = chunkCoord(0, 0)
      const batches = yield* Ref.make<ReadonlyArray<DirtyBatch>>([
        { changed: [failedChunk], removed: [] },
        { changed: [failedChunk], removed: [] },
      ])
      const store = {
        subscribeDirty: Effect.succeed({
          drain: Ref.modify(batches, ([next, ...rest]) => [
            next ?? { changed: [], removed: [] },
            rest,
          ]),
          unsubscribe: Effect.void,
        }),
      }
      const malformedMesh = [quad()]
      Object.defineProperty(malformedMesh, 'renderLayers', { enumerable: true, value: null })
      const attachment = yield* attachWorldRenderer(
        renderer,
        store,
        () => Effect.succeed(malformedMesh),
      )

      const firstUpdate = yield* attachment.update
      const secondUpdate = yield* attachment.update
      const faults = yield* attachment.drainFaults

      expect(firstUpdate).toStrictEqual(EMPTY_SYNC_REPORT)
      expect(secondUpdate).toStrictEqual(EMPTY_SYNC_REPORT)
      expect(yield* renderer.chunkKeys).toStrictEqual([])
      expect(faults).toStrictEqual([{
        _tag: 'ChunkRenderFault',
        chunk: failedChunk,
        error: { _tag: 'ChunkMeshGeometryInputFailure', field: 'renderLayers' },
        occurrences: 2,
      }])
    }),
  )

  it.effect('applies changed chunks and drains a global fault when LOD refresh fails', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const changed = chunkCoord(4, -3)
      const batches = yield* Ref.make<ReadonlyArray<DirtyBatch>>([
        { changed: [changed], removed: [] },
      ])
      const store = {
        subscribeDirty: Effect.succeed({
          drain: Ref.modify(batches, ([next, ...rest]) => [
            next ?? { changed: [], removed: [] },
            rest,
          ]),
          unsubscribe: Effect.void,
        }),
      }
      const lodError = {
        _tag: 'LodInputError',
        operation: 'thresholds',
        reason: 'invalid-thresholds',
      } as const
      const mesher = Object.assign(() => Effect.succeed([quad()]), {
        refreshLod: () => Result.fail(lodError),
      })
      const attachment = yield* attachWorldRenderer(renderer, store, mesher)

      const report = yield* attachment.update
      const faults = yield* attachment.drainFaults

      expect(report.meshed).toBe(1)
      expect(yield* renderer.chunkKeys).toStrictEqual([chunkKeyOf(changed)])
      expect(faults).toStrictEqual([{
        _tag: 'ChunkRenderFault',
        chunk: undefined,
        error: lodError,
        occurrences: 1,
      }])
      const position = three.geometries()[0]?.attributes.get('position')
      expect(position?.array.length).toBeGreaterThan(0)
    }),
  )
})

/**
 * Lowered from mc-compose's `apps/web/chunk-sync-budget.ts` (Wave 1, W1-L5).
 * A `DirtySource` decorator, so these tests build one directly rather than
 * reusing `scriptedSource` above (which yields an `Effect<DirtySource>` sized
 * for `syncWorld`'s tests, not a plain one to wrap).
 */
describe('makeBudgetedDirtySource', () => {
  const chunk = (cx: number, cz: number): ChunkRef => chunkCoord(cx, cz)
  const drain = (source: DirtySource): DirtyBatch => Effect.runSync(source.drain)
  const expectSuccess: <A, E>(
    result: Result.Result<A, E>,
  ) => asserts result is Result.Success<A, E> = (result) => {
    expect(Result.isSuccess(result)).toBe(true)
  }

  const staticSource = (...batches: ReadonlyArray<DirtyBatch>): DirtySource => {
    const remaining = [...batches]
    return {
      drain: Effect.sync(() => remaining.shift() ?? { changed: [], removed: [] }),
    }
  }

  const budgetedSource = (source: DirtySource, budget: number) => {
    const result = makeBudgetedDirtySource(source, budget)
    expectSuccess(result)
    return result.success
  }

  const decodeBudgetedSourceResult = Schema.decodeUnknownResult(BudgetedDirtySourceResultSchema, {
    onExcessProperty: 'error',
  })
  const invalidBudgets = FastCheck.oneof(
    FastCheck.integer({ min: -1000, max: 0 }),
    FastCheck.double({ min: -1000, max: 1000, noNaN: true }).filter(
      (budget) => !Number.isInteger(budget) || budget < 1,
    ),
    FastCheck.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
  )

  it.effect('returns a strict typed failure for every invalid frame budget', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(invalidBudgets, (budget) => {
          const result = makeBudgetedDirtySource(staticSource(), budget)
          const inspected = decodeBudgetedSourceResult(result)
          return (
            Result.isSuccess(inspected) &&
            inspected.success._tag === 'Failure' &&
            inspected.success.failure._tag === 'BudgetedDirtySourceInputError' &&
            inspected.success.failure.reason === 'invalid-frame-budget'
          )
        }),
        { seed: 0x5eed, numRuns: 100 },
      )

      const error: BudgetedDirtySourceInputError = {
        _tag: 'BudgetedDirtySourceInputError',
        reason: 'invalid-frame-budget',
      }
      const decodedError = Schema.decodeUnknownResult(BudgetedDirtySourceInputErrorSchema, {
        onExcessProperty: 'error',
      })(error)
      expect(Result.isSuccess(decodedError)).toBe(true)
      expect(
        Result.isFailure(decodeBudgetedSourceResult({ ...Result.fail(error), unexpected: true })),
      ).toBe(true)
    }),
  )

  it.effect('prioritizes removals and carries the remaining changes to later frames', () =>
    Effect.sync(() => {
      const source = budgetedSource(
        staticSource({
          changed: [chunk(1, 0), chunk(2, 0), chunk(3, 0)],
          removed: [chunk(4, 0), chunk(5, 0)],
        }),
        2,
      )

      expect(drain(source)).toEqual({ changed: [], removed: [chunk(4, 0), chunk(5, 0)] })
      expect(drain(source)).toEqual({ changed: [chunk(1, 0), chunk(2, 0)], removed: [] })
      expect(drain(source)).toEqual({ changed: [chunk(3, 0)], removed: [] })
      expect(drain(source)).toEqual({ changed: [], removed: [] })
    }),
  )

  it.effect('coalesces updates by chunk, and a later change replaces an earlier removal', () =>
    Effect.sync(() => {
      const target = chunk(7, -2)
      const source = budgetedSource(
        staticSource(
          { changed: [target, chunk(8, -2)], removed: [] },
          { changed: [target], removed: [target] },
          { changed: [], removed: [chunk(8, -2)] },
        ),
        2,
      )

      expect(drain(source)).toEqual({ changed: [target, chunk(8, -2)], removed: [] })
      expect(drain(source)).toEqual({ changed: [target], removed: [] })
      expect(drain(source)).toEqual({ changed: [], removed: [chunk(8, -2)] })
      expect(drain(source)).toEqual({ changed: [], removed: [] })
    }),
  )

  it.effect('enqueue renders a chunk loaded before the wrapped source ever notifies', () =>
    Effect.sync(() => {
      const source = budgetedSource(staticSource({ changed: [], removed: [] }), 1)

      source.enqueue({ changed: [chunk(8, -3)], removed: [] })

      expect(drain(source)).toEqual({ changed: [chunk(8, -3)], removed: [] })
    }),
  )

  it.effect(
    'never returns more than its per-frame budget, and never permanently drops a chunk — ' +
      'a property over an arbitrary sequence of dirty batches, not one hand-picked case',
    () =>
      Effect.sync(() => {
        const arbitraryEvent = FastCheck.record({
          cx: FastCheck.integer({ min: -1000, max: 1000 }),
          cz: FastCheck.integer({ min: -1000, max: 1000 }),
          isRemoval: FastCheck.boolean(),
        })

        FastCheck.assert(
          FastCheck.property(
            FastCheck.integer({ min: 1, max: 5 }),
            FastCheck.array(arbitraryEvent, { minLength: 0, maxLength: 40 }),
            (budget, events) => {
              // De-duplicated by key, so each event touches a DISTINCT chunk —
              // this isolates the budget/no-drop property from coalescing,
              // which the two example tests above already cover on its own.
              const seenKeys = new Set<string>()
              const distinctEvents = events.filter((event) => {
                const key = chunkKeyOf(chunk(event.cx, event.cz))
                if (seenKeys.has(key)) {
                  return false
                }
                seenKeys.add(key)
                return true
              })

              const remainingEvents = [...distinctEvents]
              const source: DirtySource = {
                drain: Effect.sync(() => {
                  const event = remainingEvents.shift()
                  if (event === undefined) {
                    return { changed: [], removed: [] }
                  }
                  const dirtiedChunk = chunk(event.cx, event.cz)
                  if (event.isRemoval) {
                    return { changed: [], removed: [dirtiedChunk] }
                  }
                  return { changed: [dirtiedChunk], removed: [] }
                }),
              }
              const budgeted = budgetedSource(source, budget)

              // One call per event to feed them all in, plus enough more to
              // drain whatever backlog that built up, plus one to confirm it
              // is actually empty by then.
              const drainCallCount =
                distinctEvents.length + Math.ceil(distinctEvents.length / budget) + 1

              const returnedKeys = new Set<string>()
              for (let callIndex = 0; callIndex < drainCallCount; callIndex += 1) {
                const result = drain(budgeted)
                const returnedThisCall = result.changed.length + result.removed.length
                expect(returnedThisCall, `call ${String(callIndex)}`).toBeLessThanOrEqual(budget)
                for (const returnedChunk of [...result.changed, ...result.removed]) {
                  returnedKeys.add(chunkKeyOf(returnedChunk))
                }
              }

              expect(returnedKeys.size).toBe(distinctEvents.length)
            },
          ),
          { seed: 0, numRuns: 200 },
        )
      }),
  )
})
