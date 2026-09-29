import { makeBrowserWorkerPort, type BrowserWorkerLike } from '../../src/application/browser-worker-port'

declare const worker: Worker

export const structuralWorker: BrowserWorkerLike<Transferable> = worker
export const port = makeBrowserWorkerPort<{ readonly id: number }, { readonly ok: boolean }, Transferable>(worker, {
  decodeResponse: (data) => {
    if (typeof data === 'object' && data !== null && 'ok' in data && typeof data.ok === 'boolean') {
      return { ok: data.ok }
    }
    throw new Error('invalid worker response')
  },
})
