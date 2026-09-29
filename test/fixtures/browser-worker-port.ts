import { makeBrowserWorkerPort, type BrowserWorkerLike } from '../../src/application/browser-worker-port'
import * as Effect from 'effect/Effect'
import * as ParseResult from 'effect/ParseResult'
import * as Schema from 'effect/Schema'

declare const worker: Worker

export const structuralWorker: BrowserWorkerLike<Transferable> = worker
export const port = makeBrowserWorkerPort<{ readonly id: number }, { readonly ok: number }, Transferable>(worker, {
  responseSchema: Schema.declare<{ readonly ok: number }, unknown, []>([], {
    decode: () => (input) => ParseResult.decodeUnknown(Schema.Struct({ ok: Schema.NumberFromString }))(input),
    encode: () => (input) => Effect.succeed(input),
  }),
  workerIndex: 0,
})
