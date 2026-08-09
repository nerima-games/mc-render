/**
 * `application/worker-pool.ts`, against fake ports.
 *
 * NOTHING HERE IS EVIDENCE ABOUT A THREAD. The fake replies when a test tells
 * it to, which is what makes dispatch order and cancellation observable at all
 * — a real worker replies whenever it finishes, and a test that raced it would
 * assert on whichever ordering the machine happened to produce. What this
 * cannot say: whether a structured clone accepts the payload, or whether
 * transferring a typed array avoided a copy. Both are browser facts.
 *
 * The properties worth pinning are the ones a frame loop depends on and that
 * are invisible until the world is large: that a saturated pool queues rather
 * than drops silently, that a cancelled chunk never delivers, and that a worker
 * is returned to the idle set even when its result was discarded.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber } from 'effect'
import {
  DEFAULT_MAX_QUEUED,
  makeWorkerPool,
  type WorkerPort,
  type WorkerRequest,
  type WorkerResponse,
} from '../src/application/worker-pool'

type Payload = { readonly chunk: string }
type Result = { readonly quads: number }

type FakeWorker = WorkerPort<WorkerRequest<Payload>, WorkerResponse<Result>> & {
  /** Requests this worker was handed, in order. */
  readonly received: () => ReadonlyArray<WorkerRequest<Payload>>
  /** Reply to the request at `index`. The test decides when. */
  readonly reply: (index: number, quads: number) => void
  readonly terminated: () => boolean
}

const makeFakeWorker = (): FakeWorker => {
  const received: Array<WorkerRequest<Payload>> = []
  let handler: ((response: WorkerResponse<Result>) => void) | undefined = undefined
  let terminated = false
  return {
    post: (request) => {
      received.push(request)
    },
    onMessage: (next) => {
      handler = next
    },
    terminate: () => {
      terminated = true
    },
    received: () => received,
    reply: (index, quads) => {
      const request = received[index]
      if (request === undefined || handler === undefined) {
        throw new Error(`no request at ${String(index)} to reply to`)
      }
      handler({ id: request.id, result: { quads } })
    },
    terminated: () => terminated,
  }
}

const workers = (count: number): ReadonlyArray<FakeWorker> =>
  Array.from({ length: count }, () => makeFakeWorker())

/**
 * Let forked fibers reach their `Effect.async` body.
 *
 * `Effect.fork` SCHEDULES a fiber; it does not run it. Without this the
 * assertions below inspect the fake worker before the pool has posted
 * anything, and every one of them reads zero — which looks exactly like a pool
 * that never dispatches. The first cut of this file had nine failures for that
 * reason and none of them were about the pool.
 */
const settle = Effect.yieldNow()

describe('dispatch', () => {
  it.effect('a job goes straight to an idle worker', () =>
    Effect.gen(function* () {
      const [worker] = workers(1)
      if (worker === undefined) {throw new Error('no worker')}
      const pool = yield* makeWorkerPool([worker])

      const fiber = yield* Effect.fork(pool.submit('0,0', { chunk: '0,0' }))

      yield* settle
      expect(worker.received()).toHaveLength(1)

      worker.reply(0, 42)

      yield* settle
      const outcome = yield* Fiber.join(fiber)

      expect(outcome).toStrictEqual({ _tag: 'completed', result: { quads: 42 } })
    }),
  )

  it.effect('work spreads across workers before any of them queues', () =>
    Effect.gen(function* () {
      const pool_workers = workers(3)
      const pool = yield* makeWorkerPool(pool_workers)

      for (const key of ['a', 'b', 'c']) {
        yield* Effect.fork(pool.submit(key, { chunk: key }))
      }
      yield* settle

      // One each, not three on the first. A pool that filled one worker before
      // touching the next would serialise the frame's meshing.
      expect(pool_workers.map((worker) => worker.received().length)).toStrictEqual([1, 1, 1])
      expect((yield* pool.stats).queued).toBe(0)
    }),
  )

  it.effect('the fourth job waits when three workers are busy', () =>
    Effect.gen(function* () {
      const pool_workers = workers(3)
      const pool = yield* makeWorkerPool(pool_workers)

      for (const key of ['a', 'b', 'c', 'd']) {
        yield* Effect.fork(pool.submit(key, { chunk: key }))
      }
      yield* settle

      const stats = yield* pool.stats
      expect(stats.busy).toBe(3)
      expect(stats.queued).toBe(1)
      expect(pool_workers.map((worker) => worker.received().length)).toStrictEqual([1, 1, 1])
    }),
  )

  it.effect('a freed worker picks up the next queued job', () =>
    Effect.gen(function* () {
      const [worker] = workers(1)
      if (worker === undefined) {throw new Error('no worker')}
      const pool = yield* makeWorkerPool([worker])

      const first = yield* Effect.fork(pool.submit('a', { chunk: 'a' }))

      yield* settle
      yield* Effect.fork(pool.submit('b', { chunk: 'b' }))
      yield* settle

      expect(worker.received()).toHaveLength(1)

      worker.reply(0, 1)
      yield* Fiber.join(first)

      // The pump ran on the reply, not on the next submit.
      expect(worker.received()).toHaveLength(2)
      expect(worker.received()[1]?.payload.chunk).toBe('b')
    }),
  )
})

describe('cancellation', () => {
  it.effect('a queued job is removed and resolves as cancelled', () =>
    Effect.gen(function* () {
      // THE CASE THE POOL EXISTS FOR: a chunk queued for meshing, then walked
      // away from before its job ran.
      const [worker] = workers(1)
      if (worker === undefined) {throw new Error('no worker')}
      const pool = yield* makeWorkerPool([worker])

      yield* Effect.fork(pool.submit('a', { chunk: 'a' }))

      yield* settle
      const doomed = yield* Effect.fork(pool.submit('b', { chunk: 'b' }))
      yield* settle

      const affected = yield* pool.cancel('b')
      const outcome = yield* Fiber.join(doomed)

      expect(affected).toBe(1)
      expect(outcome).toStrictEqual({ _tag: 'cancelled' })
      // Never dispatched: the whole point.
      expect(worker.received().map((request) => request.payload.chunk)).toStrictEqual(['a'])
      expect((yield* pool.stats).cancelledBeforeStart).toBe(1)
    }),
  )

  it.effect('a running job resolves immediately and its reply is discarded', () =>
    Effect.gen(function* () {
      // A worker cannot be interrupted, so the work finishes. What must NOT
      // happen is the result being delivered — the chunk is gone from the
      // scene, and handing back a mesh would put it back.
      const [worker] = workers(1)
      if (worker === undefined) {throw new Error('no worker')}
      const pool = yield* makeWorkerPool([worker])

      const running = yield* Effect.fork(pool.submit('a', { chunk: 'a' }))

      yield* settle
      expect(worker.received()).toHaveLength(1)

      const affected = yield* pool.cancel('a')
      const outcome = yield* Fiber.join(running)

      expect(affected).toBe(1)
      expect(outcome).toStrictEqual({ _tag: 'cancelled' })

      // The reply lands afterwards and must be inert.
      worker.reply(0, 99)
      yield* settle
      const stats = yield* pool.stats
      expect(stats.discardedAfterStart).toBe(1)
      expect(stats.completed).toBe(0)
    }),
  )

  it.effect('REGRESSION: a discarded job still frees its worker', () =>
    Effect.gen(function* () {
      // The leak this guards is silent and terminal: if a cancelled-but-running
      // job never returned its worker to the idle set, the pool would lose one
      // worker per cancellation and eventually stop dispatching entirely —
      // which presents as "chunks stop appearing after a few minutes of
      // walking", with no error anywhere.
      const [worker] = workers(1)
      if (worker === undefined) {throw new Error('no worker')}
      const pool = yield* makeWorkerPool([worker])

      yield* Effect.fork(pool.submit('a', { chunk: 'a' }))

      yield* settle
      yield* pool.cancel('a')
      worker.reply(0, 1)
      yield* settle

      const next = yield* Effect.fork(pool.submit('b', { chunk: 'b' }))

      yield* settle
      expect(worker.received()).toHaveLength(2)

      worker.reply(1, 7)

      yield* settle
      expect(yield* Fiber.join(next)).toStrictEqual({ _tag: 'completed', result: { quads: 7 } })
    }),
  )

  it.effect('cancelling a key nobody submitted affects nothing', () =>
    Effect.gen(function* () {
      const [worker] = workers(1)
      if (worker === undefined) {throw new Error('no worker')}
      const pool = yield* makeWorkerPool([worker])

      expect(yield* pool.cancel('never-submitted')).toBe(0)
    }),
  )

  it.effect('one key submitted twice cancels both', () =>
    Effect.gen(function* () {
      // `world-sync` can dirty the same chunk twice before the first result
      // lands. Two live jobs share a key; `cancel` is about the key.
      const [worker] = workers(1)
      if (worker === undefined) {throw new Error('no worker')}
      const pool = yield* makeWorkerPool([worker])

      const first = yield* Effect.fork(pool.submit('a', { chunk: 'a' }))

      yield* settle
      const second = yield* Effect.fork(pool.submit('a', { chunk: 'a' }))
      yield* settle

      // One running, one queued — and `cancel` is about the KEY, so it must
      // reach both states. A cancel that only swept the queue would leave the
      // running job to deliver a mesh for a chunk that is gone.
      expect(yield* pool.cancel('a')).toBe(2)
      expect(yield* Fiber.join(first)).toStrictEqual({ _tag: 'cancelled' })
      expect(yield* Fiber.join(second)).toStrictEqual({ _tag: 'cancelled' })
    }),
  )
})

describe('backpressure', () => {
  it.effect('the OLDEST waiting job is dropped when the queue is full', () =>
    Effect.gen(function* () {
      // Oldest, not newest: the job that has waited longest is the one most
      // likely to be behind the player. Dropping the newest would discard the
      // chunk they are walking into.
      const [worker] = workers(1)
      if (worker === undefined) {throw new Error('no worker')}
      const pool = yield* makeWorkerPool([worker], { maxQueued: 2 })

      yield* Effect.fork(pool.submit('running', { chunk: 'running' }))

      yield* settle
      const oldest = yield* Effect.fork(pool.submit('oldest', { chunk: 'oldest' }))
      yield* settle
      yield* Effect.fork(pool.submit('middle', { chunk: 'middle' }))
      yield* settle
      yield* Effect.fork(pool.submit('newest', { chunk: 'newest' }))

      expect(yield* Fiber.join(oldest)).toStrictEqual({ _tag: 'cancelled' })

      const stats = yield* pool.stats
      expect(stats.droppedForBackpressure).toBe(1)
      expect(stats.queued).toBe(2)
    }),
  )

  it.effect('the default depth is a number, not undefined', () =>
    Effect.sync(() => {
      // Guards the `?? DEFAULT_MAX_QUEUED` from being removed in a tidy-up: an
      // undefined bound makes `queue.length > maxQueued` always false, which is
      // an unbounded queue that no test would otherwise notice.
      expect(Number.isFinite(DEFAULT_MAX_QUEUED)).toBe(true)
      expect(DEFAULT_MAX_QUEUED).toBeGreaterThan(0)
    }),
  )
})

describe('shutdown', () => {
  it.effect('terminates every worker and cancels everything outstanding', () =>
    Effect.gen(function* () {
      const pool_workers = workers(2)
      const pool = yield* makeWorkerPool(pool_workers)

      const running = yield* Effect.fork(pool.submit('a', { chunk: 'a' }))

      yield* settle
      const queued = yield* Effect.fork(pool.submit('b', { chunk: 'b' }))
      const alsoQueued = yield* Effect.fork(pool.submit('c', { chunk: 'c' }))
      yield* settle

      yield* pool.shutdown

      expect(yield* Fiber.join(running)).toStrictEqual({ _tag: 'cancelled' })
      expect(yield* Fiber.join(queued)).toStrictEqual({ _tag: 'cancelled' })
      expect(yield* Fiber.join(alsoQueued)).toStrictEqual({ _tag: 'cancelled' })
      expect(pool_workers.every((worker) => worker.terminated())).toBe(true)
    }),
  )

  it.effect('a submit after shutdown is cancelled rather than queued forever', () =>
    Effect.gen(function* () {
      // The alternative is a promise that never settles, which in a frame loop
      // is a leak that looks like nothing at all.
      const [worker] = workers(1)
      if (worker === undefined) {throw new Error('no worker')}
      const pool = yield* makeWorkerPool([worker])

      yield* pool.shutdown
      const outcome = yield* pool.submit('late', { chunk: 'late' })

      expect(outcome).toStrictEqual({ _tag: 'cancelled' })
      expect(worker.received()).toHaveLength(0)
    }),
  )

  it.effect('a reply arriving after shutdown is inert', () =>
    Effect.gen(function* () {
      // A real worker can already be mid-task when `terminate()` is called and
      // the platform does not promise the message queue is empty.
      const [worker] = workers(1)
      if (worker === undefined) {throw new Error('no worker')}
      const pool = yield* makeWorkerPool([worker])

      yield* Effect.fork(pool.submit('a', { chunk: 'a' }))

      yield* settle
      yield* pool.shutdown

      worker.reply(0, 5)

      yield* settle

      expect((yield* pool.stats).completed).toBe(0)
    }),
  )
})
