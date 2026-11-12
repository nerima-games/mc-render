import { Result, Schema } from 'effect'

const MIN_WORKER_COUNT = 1
const RESERVED_HOST_PROCESSORS = 1

export type WorkerParallelismError = {
  readonly _tag: 'WorkerParallelismError'
  readonly reason: 'invalid-worker-count' | 'invalid-hardware-concurrency' | 'missing-hardware-concurrency'
}

export const WorkerParallelismErrorSchema: Schema.Codec<WorkerParallelismError> = Schema.Struct({
  _tag: Schema.Literal('WorkerParallelismError'),
  reason: Schema.Literals([
    'invalid-worker-count',
    'invalid-hardware-concurrency',
    'missing-hardware-concurrency',
  ]),
})

export type WorkerParallelismInput = {
  readonly workerCount?: number | undefined
  readonly hardwareConcurrency?: number | undefined
}

const workerParallelismError = (reason: WorkerParallelismError['reason']): WorkerParallelismError => ({
  _tag: 'WorkerParallelismError',
  reason,
})

const isPositiveSafeInteger = (value: number): boolean => Number.isSafeInteger(value) && value >= MIN_WORKER_COUNT

/** Use an explicit host count when supplied; otherwise leave one logical CPU for the host. */
export const resolveWorkerParallelism = (
  input: WorkerParallelismInput,
): Result.Result<number, WorkerParallelismError> => {
  if (input.workerCount !== undefined) {
    if (isPositiveSafeInteger(input.workerCount)) {
      return Result.succeed(input.workerCount)
    }
    return Result.fail(workerParallelismError('invalid-worker-count'))
  }
  if (input.hardwareConcurrency === undefined) {
    return Result.fail(workerParallelismError('missing-hardware-concurrency'))
  }
  if (!isPositiveSafeInteger(input.hardwareConcurrency)) {
    return Result.fail(workerParallelismError('invalid-hardware-concurrency'))
  }
  return Result.succeed(Math.max(MIN_WORKER_COUNT, input.hardwareConcurrency - RESERVED_HOST_PROCESSORS))
}
