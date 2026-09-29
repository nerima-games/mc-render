import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as ParseResult from 'effect/ParseResult'
import * as Schema from 'effect/Schema'
import {
  makeBrowserWorkerPort,
  WorkerResponseDecodeError,
  type BrowserWorkerErrorEvent,
  type BrowserWorkerLike,
  type BrowserWorkerMessageEvent,
} from '../src/application/browser-worker-port'
import { inspectTypeScriptFixture } from './typescript-project'

const responseSchema: Schema.Schema<{ readonly ok: number }, unknown> = Schema.declare<
  { readonly ok: number },
  unknown,
  []
>([], {
  decode: () => (input) => ParseResult.decodeUnknown(Schema.Struct({ ok: Schema.NumberFromString }))(input),
  encode: () => (input) => Effect.succeed(input),
})

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

type PostedMessage = {
  readonly message: unknown
  readonly transfer: ReadonlyArray<string> | undefined
}

type FakeWorker = BrowserWorkerLike<string> & {
  readonly posted: Array<PostedMessage>
  readonly emitError: (event: BrowserWorkerErrorEvent) => void
  readonly emitMessage: (data: unknown) => void
  readonly terminated: () => boolean
}

const makeFakeWorker = (): FakeWorker => {
  let messageHandler: (event: BrowserWorkerMessageEvent) => void = () => undefined
  let errorHandler: (event: BrowserWorkerErrorEvent) => void = () => undefined
  let isTerminated = false
  const posted: Array<PostedMessage> = []

  function addEventListener(type: 'message', listener: (event: BrowserWorkerMessageEvent) => void): void
  function addEventListener(type: 'error', listener: (event: BrowserWorkerErrorEvent) => void): void
  function addEventListener(
    type: 'message' | 'error',
    listener: ((event: BrowserWorkerMessageEvent) => void) | ((event: BrowserWorkerErrorEvent) => void),
  ): void {
    if (type === 'message') {
      messageHandler = listener as (event: BrowserWorkerMessageEvent) => void
    } else {
      errorHandler = listener as (event: BrowserWorkerErrorEvent) => void
    }
  }

  return {
    addEventListener,
    emitError: (event) => {
      errorHandler?.(event)
    },
    emitMessage: (data) => {
      messageHandler?.({ data })
    },
    posted,
    postMessage: (message, transfer) => {
      posted.push({ message, transfer })
    },
    terminate: () => {
      isTerminated = true
    },
    terminated: () => isTerminated,
  }
}

it.effect('adapts messages, posts and termination to WorkerPort', () =>
  Effect.sync(() => {
    const worker = makeFakeWorker()
    const port = makeBrowserWorkerPort<{ readonly id: number }, { readonly ok: number }, string>(worker, {
      responseSchema,
      workerIndex: 0,
    })
    const received: Array<{ readonly ok: number }> = []

    worker.emitMessage({ ok: '0' })
    port.onMessage((response) => {
      received.push(response)
    })
    worker.emitMessage({ ok: '1' })
    port.post({ id: 7 })
    port.terminate()

    expect(received).toStrictEqual([{ ok: 1 }])
    expect(worker.posted).toStrictEqual([{ message: { id: 7 }, transfer: undefined }])
    expect(worker.terminated()).toBe(true)
  }),
)

it.effect('forwards transfer lists and all browser error forms', () =>
  Effect.sync(() => {
    const worker = makeFakeWorker()
    const port = makeBrowserWorkerPort<{ readonly id: number }, { readonly ok: number }, string>(worker, {
      transfer: () => ['chunk-buffer'],
      responseSchema,
      workerIndex: 0,
    })
    const errors: Array<unknown> = []
    const eventError = new Error('worker failed')
    const fallbackEvent: BrowserWorkerErrorEvent = {}

    worker.emitError({ error: eventError })
    port.onError?.((reason) => {
      errors.push(reason)
    })
    worker.emitError({ error: eventError })
    worker.emitError({ message: 'worker message' })
    worker.emitError(fallbackEvent)
    port.post({ id: 8 })

    expect(errors).toStrictEqual([eventError, 'worker message', fallbackEvent])
    expect(worker.posted).toStrictEqual([{ message: { id: 8 }, transfer: ['chunk-buffer'] }])
  }),
)

it.effect('routes response decoder failures through the worker error boundary', () =>
  Effect.sync(() => {
    const worker = makeFakeWorker()
    const port = makeBrowserWorkerPort<{ readonly id: number }, { readonly ok: number }>(worker, {
      responseSchema,
      workerIndex: 0,
    })
    const errors: Array<unknown> = []
    port.onError?.((reason) => errors.push(reason))
    worker.emitMessage({ invalid: true })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(WorkerResponseDecodeError)
    expect(errors[0]).toMatchObject({ _tag: 'WorkerResponseDecodeError' })
  }),
)

it.effect('accepts the real DOM Worker surface without a cast', () =>
  Effect.sync(() => {
    const fixture = `${repositoryRoot}/test/fixtures/browser-worker-port.ts`
    const inspection = inspectTypeScriptFixture(repositoryRoot, fixture, ['ES2022', 'DOM'])

    expect(inspection.errors).toStrictEqual([])
  }),
  60_000,
)
