import type { WorkerPort } from './worker-pool.js'

export type BrowserWorkerMessageEvent = {
  readonly data: unknown
}

export type BrowserWorkerErrorEvent = {
  readonly error?: unknown
  readonly message?: string
}

export class WorkerResponseDecodeError extends Error {
  readonly _tag = 'WorkerResponseDecodeError'

  constructor(cause: unknown) {
    super('Worker response failed schema decoding.', { cause })
    this.name = 'WorkerResponseDecodeError'
  }
}

export type BrowserWorkerLike<TTransfer = unknown> = {
  postMessage(message: unknown, transfer?: Array<TTransfer>): void
  addEventListener(type: 'message', listener: (event: BrowserWorkerMessageEvent) => void): void
  addEventListener(type: 'error', listener: (event: BrowserWorkerErrorEvent) => void): void
  terminate(): void
}

export type BrowserWorkerPortOptions<TRequest, TResponse, TTransfer = unknown> = {
  readonly transfer?: (request: TRequest) => Array<TTransfer>
  readonly decodeResponse: (data: unknown) => TResponse
}

export const makeBrowserWorkerPort = <TRequest, TResponse, TTransfer = unknown>(
  worker: BrowserWorkerLike<TTransfer>,
  options: BrowserWorkerPortOptions<TRequest, TResponse, TTransfer>,
): WorkerPort<TRequest, TResponse> => {
  let messageHandler: (response: TResponse) => void = () => undefined
  let errorHandler: (reason: unknown) => void = () => undefined

  worker.addEventListener('message', (event) => {
    try {
      messageHandler(options.decodeResponse(event.data))
    } catch (error) {
      errorHandler(new WorkerResponseDecodeError(error))
    }
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
