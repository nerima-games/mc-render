import { makeBrowserWorkerPort, type BrowserWorkerLike } from '../../src/application/browser-worker-port'

declare const worker: Worker

export const structuralWorker: BrowserWorkerLike<Transferable> = worker
export const port = makeBrowserWorkerPort<{ readonly id: number }, { readonly ok: boolean }, Transferable>(worker)
