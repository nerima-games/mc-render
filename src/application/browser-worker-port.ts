import type { WorkerPort } from './worker-pool.js'
import { Data, Either, Schema } from 'effect'
import type { ParseResult } from 'effect'

export type BrowserWorkerMessageEvent = {
  readonly data: unknown
}

export type BrowserWorkerErrorEvent = {
  readonly error?: unknown
  readonly message?: string
}

const WorkerResponseDecodeErrorBase: ReturnType<typeof Data.TaggedError<'WorkerResponseDecodeError'>> =
  Data.TaggedError('WorkerResponseDecodeError')

export class WorkerResponseDecodeError extends WorkerResponseDecodeErrorBase<{
  readonly cause: ParseResult.ParseError
  readonly workerIndex: number
}> {}

export type BrowserWorkerLike<TTransfer = unknown> = {
  postMessage(message: unknown, transfer?: Array<TTransfer>): void
  addEventListener(type: 'message', listener: (event: BrowserWorkerMessageEvent) => void): void
  addEventListener(type: 'error', listener: (event: BrowserWorkerErrorEvent) => void): void
  terminate(): void
}

export type BrowserWorkerPortOptions<TRequest, TResponse, TTransfer = unknown> = {
  readonly transfer?: (request: TRequest) => Array<TTransfer>
  readonly responseSchema: Schema.Schema<TResponse>
  readonly workerIndex: number
}

export const makeBrowserWorkerPort = <TRequest, TResponse, TTransfer = unknown>(
  worker: BrowserWorkerLike<TTransfer>,
  options: BrowserWorkerPortOptions<TRequest, TResponse, TTransfer>,
): WorkerPort<TRequest, TResponse> => {
  let messageHandler: (response: TResponse) => void = () => undefined
  let errorHandler: (reason: unknown) => void = () => undefined

  worker.addEventListener('message', (event) => {
    const decoded = Schema.decodeUnknownEither(options.responseSchema)(event.data)
    if (Either.isLeft(decoded)) {
      errorHandler(new WorkerResponseDecodeError({ cause: decoded.left, workerIndex: options.workerIndex }))
      return
    }
    messageHandler(decoded.right)
  })
  worker.addEventListener('error', (event) => {
    errorHandler(event.error ?? event.message ?? event)
  })

  return {
    onError: (handler) => {
      errorHandler = handler
    },
    onMessage: (handler) => {
      messageHandler = handler
    },
    post: (request) => {
      const transfer = options.transfer?.(request)
      if (transfer === undefined) {
        worker.postMessage(request)
      } else {
        worker.postMessage(request, transfer)
      }
    },
    terminate: () => {
      worker.terminate()
    },
  }
}
