import { performance } from 'node:perf_hooks'
import { Effect } from 'effect'
import { makeWorldRenderer, type ChunkGeometryUpdate } from '../src/application/world-renderer'
import { buildChunkGeometry, type MeshQuad } from '../src/domain/chunk-geometry'
import { FAKE_CANVAS, makeFakeThree } from '../test/support/fake-three'

const VIEWPORT = { width: 1280, height: 720 }
const CHUNK_COUNTS = [81, 289, 1089] as const
const RUNS = 7

const buffers = buildChunkGeometry([
  {
    blockId: 1,
    direction: 'yPos',
    role: 'top',
    lx: 0,
    y: 0,
    lz: 0,
    width: 1,
    height: 1,
    ao: 0,
  } satisfies MeshQuad,
])

const median = (samples: ReadonlyArray<number>): number => {
  const ordered = [...samples].sort((left, right) => left - right)
  return ordered[Math.floor(ordered.length / 2)] ?? Number.NaN
}

const measureSequential = (count: number): Effect.Effect<number> =>
  Effect.gen(function* () {
    const renderer = yield* makeWorldRenderer(makeFakeThree(), FAKE_CANVAS, VIEWPORT)
    const started = performance.now()
    for (let index = 0; index < count; index += 1) {
      yield* renderer.setChunk(`${String(index)},0`, buffers)
    }
    const elapsed = performance.now() - started
    yield* renderer.dispose
    return elapsed
  })

const measureBatch = (count: number): Effect.Effect<number> =>
  Effect.gen(function* () {
    const renderer = yield* makeWorldRenderer(makeFakeThree(), FAKE_CANVAS, VIEWPORT)
    const updates: Array<ChunkGeometryUpdate> = []
    for (let index = 0; index < count; index += 1) {
      updates.push({ key: `${String(index)},0`, buffers })
    }
    const started = performance.now()
    yield* renderer.setChunks(updates)
    const elapsed = performance.now() - started
    yield* renderer.dispose
    return elapsed
  })

const main = Effect.gen(function* () {
  const results = []
  for (const count of CHUNK_COUNTS) {
    yield* measureSequential(count)
    yield* measureBatch(count)
    const sequential = []
    const batch = []
    for (let run = 0; run < RUNS; run += 1) {
      sequential.push(yield* measureSequential(count))
      batch.push(yield* measureBatch(count))
    }
    const sequentialMedianMs = median(sequential)
    const batchMedianMs = median(batch)
    results.push({
      chunks: count,
      sequentialMedianMs,
      batchMedianMs,
      speedup: sequentialMedianMs / batchMedianMs,
    })
  }
  process.stdout.write(`${JSON.stringify(results, undefined, 2)}\n`)
})

Effect.runPromise(main).catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`)
  process.exitCode = 1
})
