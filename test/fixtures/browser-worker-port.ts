import { makeBrowserWorkerPort, type BrowserWorkerLike } from '../../src/application/browser-worker-port'
import * as Schema from 'effect/Schema'

declare const worker: Worker

export const structuralWorker: BrowserWorkerLike<Transferable> = worker
export const port = makeBrowserWorkerPort<{ readonly id: number }, { readonly ok: boolean }, Transferable>(worker, {
  responseSchema: Schema.Struct({ ok: Schema.Boolean }),
  workerIndex: 0,
})
