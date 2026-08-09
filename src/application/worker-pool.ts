/**
 * The worker pool: N workers, one queue, and an answer for the job whose
 * result nobody wants any more.
 *
 * docs/responsibility.md gives this repository the terrain and meshing worker
 * pool. The reference's is `packages/worker`, 1,556 LOC, and most of that bulk
 * is the two things this file does NOT contain — the terrain generator and the
 * mesher themselves, which are mc-worldgen's and mc-meshing's. What is left is
 * the pool, and the pool is a scheduling problem.
 *
 * ---------------------------------------------------------------------------
 * IT TAKES PORTS, SO IT RUNS IN NODE AND OWNS NO `Worker`
 * ---------------------------------------------------------------------------
 *
 * `WorkerPort` below is the four members this file calls on a real `Worker`,
 * structurally — the same discipline `application/three-surface.ts` applies to
 * `three` and for the same reason: `tsconfig.base.json` omits "DOM" from `lib`,
 * and naming `Worker` here would need it for every module in the repository
 * including the pure ones.
 *
 * The consequence is that everything below is testable without a thread. What
 * that CANNOT tell you is whether a real worker's structured clone accepts the
 * payload, or whether transferring a `Float32Array` actually avoided a copy —
 * both are browser facts, and `test/support/fake-three.ts`'s header makes the
 * same disclaimer about the same boundary.
 *
 * ---------------------------------------------------------------------------
 * CANCELLATION IS THE FEATURE, NOT AN EXTRA
 * ---------------------------------------------------------------------------
 *
 * A pool that only submits is a queue with extra steps. The reason this one
 * exists is the interaction with `application/world-sync.ts`: a player walking
 * forward dirties chunks ahead and drops chunks behind, and a chunk can be
 * QUEUED FOR MESHING AND THEN UNLOADED BEFORE ITS JOB RUNS. Meshing it then is
 * not merely wasted — the result arrives for a chunk that is no longer in the
 * scene, and a pool that handed it over would put a mesh back into a world that
 * had removed it.
 *
 * So `cancel` is here, jobs are keyed by the caller's own key (a `ChunkKey`, in
 * practice), and a cancelled job that has NOT started is dropped from the queue
 * while a cancelled job that HAS started is allowed to finish and its result
 * discarded. The second half is the one worth stating: a worker cannot be
 * interrupted mid-task, and pretending otherwise would mean either a lie or a
 * `terminate()` that throws away the whole thread and its warm state.
 *
 * ---------------------------------------------------------------------------
 * WHY DISPATCH IS "FIRST IDLE" AND NOT ROUND-ROBIN
 * ---------------------------------------------------------------------------
 *
 * Round-robin is the obvious choice and is wrong for this workload. Chunk
 * meshing times vary by an order of magnitude — `domain/chunk-geometry.ts` and
 * mc-meshing's notes both record that a flat chunk merges to a handful of quads
 * while a cave system produces hundreds — so round-robin queues a fast job
 * behind a slow one while another worker sits idle. First-idle is the same
 * decision `maxSpeedWithoutTunnelling` makes in mc-physics: prefer the rule
 * that cannot produce the pathological case over the rule that is tidier.
 */
import { Effect, Ref } from 'effect'

/**
 * A worker, reduced to what this file calls.
 *
 * `onMessage` takes the handler rather than returning a stream because that is
 * the shape the platform has — `worker.onmessage = fn` — and an adapter that
 * inverted it here would have to buffer, which is a second queue nobody asked
 * for. The pool sets it once at construction.
 */
export type WorkerPort<TRequest, TResponse> = {
  readonly post: (request: TRequest) => void
  readonly onMessage: (handler: (response: TResponse) => void) => void
  readonly terminate: () => void
}

/** How a job is addressed. `ChunkKey` in practice; opaque here. */
export type JobKey = string

/**
 * What the pool puts on the wire.
 *
 * The `id` is the POOL'S, not the caller's key, and the distinction is
 * load-bearing: a caller may submit the same key twice (a chunk dirtied,
 * meshed, and dirtied again before the first result landed), and two live jobs
 * under one key would make the reply ambiguous. The key is what `cancel`
 * matches on; the id is what a reply is matched by.
 */
export type WorkerRequest<TPayload> = {
  readonly id: number
  readonly payload: TPayload
}

export type WorkerResponse<TResult> = {
  readonly id: number
  readonly result: TResult
}

/** Why a submitted job did not produce a result. */
export type JobOutcome<TResult> =
  | { readonly _tag: 'completed'; readonly result: TResult }
  | { readonly _tag: 'cancelled' }

export type WorkerPoolOptions = {
  /**
   * How many jobs may WAIT. Does not bound how many may run — that is the
   * worker count.
   *
   * Bounded because the caller is a frame loop: `world-sync` can submit a
   * screenful of chunks in one drain, and an unbounded queue would let a player
   * sprinting across a world accumulate work faster than the pool retires it,
   * with the queue growing until the chunks in it are all behind the player.
   * When full, the OLDEST waiting job is dropped — it is the one most likely to
   * have been superseded, by the same reasoning `domain/particle-pool.ts` uses
   * to evict oldest rather than newest.
   */
  readonly maxQueued?: number
}

/** Default queue depth. Two screenfuls of chunks at a typical render distance. */
export const DEFAULT_MAX_QUEUED = 64

export type PoolStats = {
  readonly busy: number
  readonly queued: number
  /** Jobs that finished and whose result was delivered. */
  readonly completed: number
  /** Jobs cancelled before they were dispatched. */
  readonly cancelledBeforeStart: number
  /** Jobs cancelled after dispatch, whose result was computed and discarded. */
  readonly discardedAfterStart: number
  /** Jobs dropped because the queue was full. */
  readonly droppedForBackpressure: number
}

export type WorkerPool<TPayload, TResult> = {
  /**
   * Run one job. Resolves when the result arrives, or as `cancelled`.
   *
   * NEVER FAILS. A pool whose submit could fail would put error handling in the
   * frame loop for a condition — "the queue was full" — that the frame loop can
   * do nothing about except drop the chunk, which is what the pool already did.
   */
  readonly submit: (key: JobKey, payload: TPayload) => Effect.Effect<JobOutcome<TResult>>
  /**
   * Abandon every job under `key`. Returns how many were affected.
   *
   * Both states count: a queued job is removed, a running job is marked so its
   * reply is discarded. The caller cannot tell which happened and does not need
   * to — in either case nothing will be delivered for that key.
   */
  readonly cancel: (key: JobKey) => Effect.Effect<number>
  readonly stats: Effect.Effect<PoolStats>
  /** Terminate every worker. In-flight jobs resolve as `cancelled`. */
  readonly shutdown: Effect.Effect<void>
}

type Waiting<TPayload, TResult> = {
  readonly id: number
  readonly key: JobKey
  readonly payload: TPayload
  readonly resume: (outcome: JobOutcome<TResult>) => void
}

type Running<TResult> = {
  readonly key: JobKey
  readonly workerIndex: number
  readonly resume: (outcome: JobOutcome<TResult>) => void
  /** Set by `cancel`. The reply still arrives; it is dropped on the floor. */
  discarded: boolean
}

type PoolState<TPayload, TResult> = {
  nextId: number
  readonly queue: Array<Waiting<TPayload, TResult>>
  readonly running: Map<number, Running<TResult>>
  readonly idle: Array<number>
  completed: number
  cancelledBeforeStart: number
  discardedAfterStart: number
  droppedForBackpressure: number
  shuttingDown: boolean
}

/*
 * Counting/indexing arithmetic shared by the helpers below. Every value here
 * is the domain quantity "no items" or "one item", never an arbitrary tuning
 * knob — grouped so the same quantity is spelled once rather than re-typed at
 * each call site.
 */
/** An idle/queued array with no entries has this length. */
const EMPTY_LENGTH = 0
/** The array index a backward scan starts at, and stops at (inclusive). */
const ARRAY_START_INDEX = 0
/** Moving a cursor, or a queue length, by exactly one array slot. */
const ONE_INDEX_STEP = 1
/** `Array.prototype.splice`'s delete-count for removing exactly one entry. */
const REMOVE_COUNT_ONE = 1
/** One more job counted as affected by a cancellation. */
const ONE_AFFECTED_JOB = 1

/**
 * Move as much work onto idle workers as will fit.
 *
 * A LOOP AND NOT A SINGLE STEP, because a reply frees exactly one worker but a
 * `cancel` can free several — and after a shutdown-cancel the queue may be
 * shorter than the idle list. Draining until one of the two runs out is the
 * only formulation that is correct in all three cases.
 */
const pump = <TPayload, TResult>(
  current: PoolState<TPayload, TResult>,
  ports: ReadonlyArray<WorkerPort<WorkerRequest<TPayload>, WorkerResponse<TResult>>>,
): void => {
  while (current.idle.length > EMPTY_LENGTH && current.queue.length > EMPTY_LENGTH && !current.shuttingDown) {
    const workerIndex = current.idle.shift()
    const job = current.queue.shift()
    if (workerIndex === undefined || job === undefined) {
      return
    }
    current.running.set(job.id, {
      discarded: false,
      key: job.key,
      resume: job.resume,
      workerIndex,
    })
    ports[workerIndex]?.post({ id: job.id, payload: job.payload })
  }
}

/** Credit one worker reply as either delivered or discarded, on `current`. */
const recordJobOutcome = <TPayload, TResult>(
  current: PoolState<TPayload, TResult>,
  job: Running<TResult>,
  response: WorkerResponse<TResult>,
): void => {
  if (job.discarded) {
    current.discardedAfterStart += ONE_AFFECTED_JOB
    return
  }
  current.completed += ONE_AFFECTED_JOB
  job.resume({ _tag: 'completed', result: response.result })
}

/**
 * Fold one worker's reply into pool state: free the worker, and either
 * deliver the result or drop it if `cancel` marked the job discarded.
 */
const applyWorkerResponse = <TPayload, TResult>(
  current: PoolState<TPayload, TResult>,
  workerIndex: number,
  response: WorkerResponse<TResult>,
): PoolState<TPayload, TResult> => {
  const job = current.running.get(response.id)
  if (job === undefined) {
    // A reply for a job the pool has forgotten. Reachable after
    // `shutdown`, and inert: there is nobody to resume.
    return current
  }
  current.running.delete(response.id)
  current.idle.push(workerIndex)
  recordJobOutcome(current, job, response)
  return current
}

/**
 * Remove and resolve every QUEUED job under `key`. Iterated back to front so
 * the splice does not move an element past the cursor.
 */
const cancelQueued = <TPayload, TResult>(current: PoolState<TPayload, TResult>, key: JobKey): number => {
  let affected = 0
  for (let at = current.queue.length - ONE_INDEX_STEP; at >= ARRAY_START_INDEX; at -= ONE_INDEX_STEP) {
    const job = current.queue[at]
    if (job !== undefined && job.key === key) {
      current.queue.splice(at, REMOVE_COUNT_ONE)
      current.cancelledBeforeStart += ONE_AFFECTED_JOB
      affected += ONE_AFFECTED_JOB
      job.resume({ _tag: 'cancelled' })
    }
  }
  return affected
}

/**
 * Mark every RUNNING job under `key` as discarded and resolve it now. The
 * caller is released immediately — waiting for a result nobody wants would
 * hold the frame loop for the exact duration it is trying to avoid.
 */
const cancelRunning = <TPayload, TResult>(current: PoolState<TPayload, TResult>, key: JobKey): number => {
  let affected = 0
  for (const job of current.running.values()) {
    if (job.key === key && !job.discarded) {
      job.discarded = true
      affected += ONE_AFFECTED_JOB
      job.resume({ _tag: 'cancelled' })
    }
  }
  return affected
}

/** Drop every still-queued job on `shutdown`, resolving each as cancelled. */
const drainQueueOnShutdown = <TPayload, TResult>(current: PoolState<TPayload, TResult>): void => {
  for (const job of current.queue.splice(ARRAY_START_INDEX)) {
    current.cancelledBeforeStart += ONE_AFFECTED_JOB
    job.resume({ _tag: 'cancelled' })
  }
}

/** Resolve every still-running job on `shutdown`; its reply is discarded. */
const discardRunningOnShutdown = <TPayload, TResult>(current: PoolState<TPayload, TResult>): void => {
  for (const job of current.running.values()) {
    if (!job.discarded) {
      job.discarded = true
      job.resume({ _tag: 'cancelled' })
    }
  }
  current.running.clear()
}

/** Drop the OLDEST waiting job, not the one just enqueued. See `maxQueued`. */
const evictOverflow = <TPayload, TResult>(current: PoolState<TPayload, TResult>, maxQueued: number): void => {
  while (current.queue.length > maxQueued) {
    const dropped = current.queue.shift()
    if (dropped !== undefined) {
      current.droppedForBackpressure += ONE_AFFECTED_JOB
      dropped.resume({ _tag: 'cancelled' })
    }
  }
}

type EnqueueJobOptions<TPayload, TResult> = {
  readonly key: JobKey
  readonly payload: TPayload
  readonly resumeAsync: (effect: Effect.Effect<JobOutcome<TResult>>) => void
}

/** Append one job to the queue. Does not evict; see `evictOverflow`. */
const enqueueJob = <TPayload, TResult>(
  current: PoolState<TPayload, TResult>,
  job: EnqueueJobOptions<TPayload, TResult>,
): void => {
  const id = current.nextId
  current.nextId += 1
  current.queue.push({
    id,
    key: job.key,
    payload: job.payload,
    resume: (outcome) => job.resumeAsync(Effect.succeed(outcome)),
  })
}

/**
 * Build a pool over the given ports.
 *
 * ONE PORT PER WORKER and the array's length IS the concurrency. There is no
 * `workerCount` option, because the pool cannot create a worker — it has no
 * `Worker` constructor, by design (see the header) — so the count is a property
 * of what the host handed over rather than a number this file could honour.
 *
 * A host builds `navigator.hardwareConcurrency - 1` of them and passes them in;
 * that subtraction is a host decision and reads oddly here, which is the point.
 */
export const makeWorkerPool = <TPayload, TResult>(
  ports: ReadonlyArray<WorkerPort<WorkerRequest<TPayload>, WorkerResponse<TResult>>>,
  options: WorkerPoolOptions = {},
): Effect.Effect<WorkerPool<TPayload, TResult>> =>
  Effect.gen(function* () {
    const maxQueued = options.maxQueued ?? DEFAULT_MAX_QUEUED

    const state = yield* Ref.make<PoolState<TPayload, TResult>>({
      cancelledBeforeStart: 0,
      completed: 0,
      discardedAfterStart: 0,
      droppedForBackpressure: 0,
      idle: ports.map((_port, index) => index),
      nextId: 1,
      queue: [],
      running: new Map(),
      shuttingDown: false,
    })

    // Wired once, at construction. A handler installed per job would leak one
    // Closure per chunk meshed, which on a walked-across world is unbounded.
    ports.forEach((port, workerIndex) => {
      port.onMessage((response) => {
        Effect.runSync(
          Ref.update(state, (current) => {
            const next = applyWorkerResponse(current, workerIndex, response)
            pump(next, ports)
            return next
          }),
        )
      })
    })

    return {
      cancel: (key) =>
        Ref.modify(state, (current) => {
          const affected = cancelQueued(current, key) + cancelRunning(current, key)
          pump(current, ports)
          return [affected, current]
        }),

      shutdown: Ref.update(state, (current) => {
        current.shuttingDown = true
        drainQueueOnShutdown(current)
        discardRunningOnShutdown(current)
        for (const port of ports) {
          port.terminate()
        }
        return current
      }),

      stats: Ref.get(state).pipe(
        Effect.map((current) => ({
          busy: current.running.size,
          cancelledBeforeStart: current.cancelledBeforeStart,
          completed: current.completed,
          discardedAfterStart: current.discardedAfterStart,
          droppedForBackpressure: current.droppedForBackpressure,
          queued: current.queue.length,
        })),
      ),

      submit: (key, payload) =>
        Effect.async<JobOutcome<TResult>>((resume) => {
          Effect.runSync(
            Ref.update(state, (current) => {
              if (current.shuttingDown) {
                resume(Effect.succeed({ _tag: 'cancelled' as const }))
                return current
              }
              enqueueJob(current, { key, payload, resumeAsync: resume })
              evictOverflow(current, maxQueued)
              pump(current, ports)
              return current
            }),
          )
        }),
    }
  })
