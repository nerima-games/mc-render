import { Brand, Result, Schema } from 'effect'

const MIN_WORKER_COUNT = 1
const RESERVED_HOST_PROCESSORS = 1
const MIN_WORKER_INDEX = 0

export type WorkerCount = Brand.Branded<number, 'WorkerCount'>
export type HardwareConcurrency = Brand.Branded<number, 'HardwareConcurrency'>
export type WorkerQueueCapacity = Brand.Branded<number, 'WorkerQueueCapacity'>
export type WorkerIndex = Brand.Branded<number, 'WorkerIndex'>
export type WorkerFailureMessage = Brand.Branded<string, 'WorkerFailureMessage'>

export const WorkerCountSchema: Schema.Codec<WorkerCount, number> = Schema.Int
  .check(Schema.isGreaterThanOrEqualTo(MIN_WORKER_COUNT))
  .pipe(Schema.brand('WorkerCount'))

export const HardwareConcurrencySchema: Schema.Codec<HardwareConcurrency, number> = Schema.Int
  .check(Schema.isGreaterThanOrEqualTo(MIN_WORKER_COUNT))
  .pipe(Schema.brand('HardwareConcurrency'))

export const WorkerQueueCapacitySchema: Schema.Codec<WorkerQueueCapacity, number> = Schema.Int
  .check(Schema.isGreaterThanOrEqualTo(MIN_WORKER_COUNT))
  .pipe(Schema.brand('WorkerQueueCapacity'))

export const WorkerIndexSchema: Schema.Codec<WorkerIndex, number> = Schema.Int
  .check(Schema.isGreaterThanOrEqualTo(MIN_WORKER_INDEX))
  .pipe(Schema.brand('WorkerIndex'))

export const WorkerFailureMessageSchema: Schema.Codec<WorkerFailureMessage, string> =
  Schema.String.pipe(Schema.brand('WorkerFailureMessage'))

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
  readonly workerCount?: WorkerCount | undefined
  readonly hardwareConcurrency?: HardwareConcurrency | undefined
}

export type WorkerParallelismInputEncoded = Readonly<{
  readonly hardwareConcurrency?: Schema.Codec.Encoded<typeof HardwareConcurrencySchema> | undefined
  readonly workerCount?: Schema.Codec.Encoded<typeof WorkerCountSchema> | undefined
}>

export const WorkerParallelismInputSchema: Schema.Codec<WorkerParallelismInput, WorkerParallelismInputEncoded> = Schema.Struct({
  hardwareConcurrency: Schema.optional(HardwareConcurrencySchema),
  workerCount: Schema.optional(WorkerCountSchema),
})

const workerParallelismError = (reason: WorkerParallelismError['reason']): WorkerParallelismError => ({
  _tag: 'WorkerParallelismError',
  reason,
})

const decodeCount = Schema.decodeUnknownResult(WorkerCountSchema)
const decodeHardwareConcurrency = Schema.decodeUnknownResult(HardwareConcurrencySchema)

export const makeWorkerCount = (input: unknown): Result.Result<WorkerCount, WorkerParallelismError> => {
  const decoded = decodeCount(input)
  if (Result.isFailure(decoded)) {
    return Result.fail(workerParallelismError('invalid-worker-count'))
  }
  return Result.succeed(decoded.success)
}

export const makeHardwareConcurrency = (input: unknown): Result.Result<HardwareConcurrency, WorkerParallelismError> => {
  const decoded = decodeHardwareConcurrency(input)
  if (Result.isFailure(decoded)) {
    return Result.fail(workerParallelismError('invalid-hardware-concurrency'))
  }
  return Result.succeed(decoded.success)
}

const workerCountFromHardware = (hardwareConcurrency: HardwareConcurrency): Result.Result<WorkerCount, WorkerParallelismError> => {
  const decoded = decodeCount(Math.max(MIN_WORKER_COUNT, hardwareConcurrency - RESERVED_HOST_PROCESSORS))
  return Result.mapError(decoded, workerParallelismError.bind(undefined, 'invalid-hardware-concurrency'))
}

/** Use an explicit host count when supplied; otherwise leave one logical CPU for the host. */
export const resolveWorkerParallelism = (
  input: WorkerParallelismInput,
): Result.Result<WorkerCount, WorkerParallelismError> => {
  if (input.workerCount !== undefined) {
    return makeWorkerCount(input.workerCount)
  }
  if (input.hardwareConcurrency === undefined) {
    return Result.fail(workerParallelismError('missing-hardware-concurrency'))
  }
  const hardwareConcurrency = makeHardwareConcurrency(input.hardwareConcurrency)
  if (Result.isFailure(hardwareConcurrency)) {
    return Result.fail(hardwareConcurrency.failure)
  }
  return workerCountFromHardware(hardwareConcurrency.success)
}
