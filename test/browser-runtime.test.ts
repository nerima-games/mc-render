import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import {
  GpuTimerService,
  GpuTimerServiceLayer,
  makeGpuTimerService,
} from '../src/browser.js'

const DEFAULT_EXTENSION = {
  GPU_DISJOINT_EXT: 0x8fbb,
  TIME_ELAPSED_EXT: 0x88bf,
}

const makeTimerContext = ({
  available = true,
  disjoint = false,
  elapsedNanoseconds = 2_500_000,
  extension = DEFAULT_EXTENSION,
  beginFailure,
}: {
  readonly available?: boolean
  readonly disjoint?: boolean
  readonly elapsedNanoseconds?: unknown
  readonly extension?: unknown
  readonly beginFailure?: Error
} = {}) => {
  const query = {}
  const queryResultAvailable = 0x8867
  const queryResult = 0x8866
  const gl = {
    QUERY_RESULT: queryResult,
    QUERY_RESULT_AVAILABLE: queryResultAvailable,
    beginQuery: vi.fn(() => {
      if (beginFailure) {
        throw beginFailure
      }
    }),
    createQuery: vi.fn(() => query),
    deleteQuery: vi.fn(),
    endQuery: vi.fn(),
    getExtension: vi.fn(() => extension),
    getParameter: vi.fn(() => disjoint),
    getQueryParameter: vi.fn((_query: unknown, parameter: number) =>
      parameter === queryResultAvailable ? available : elapsedNanoseconds,
    ),
  } as unknown as WebGL2RenderingContext
  return { gl, query }
}

const acquireTimerService = (gl: WebGL2RenderingContext) =>
  Effect.runSync(
    Effect.gen(function* acquireService() {
      return yield* GpuTimerService
    }).pipe(Effect.provide(GpuTimerServiceLayer(gl))),
  )

describe('browser GPU timer service', () => {
  it('provides an Effect service and converts available nanoseconds to milliseconds', () => {
    const { gl, query } = makeTimerContext()
    const service = acquireTimerService(gl)

    expect(service.supported).toBe(true)
    Effect.runSync(service.begin)
    Effect.runSync(service.end)

    expect(Effect.runSync(service.poll)).toBe(2.5)
    expect(gl.beginQuery).toHaveBeenCalledWith(DEFAULT_EXTENSION.TIME_ELAPSED_EXT, query)
    expect(gl.endQuery).toHaveBeenCalledWith(DEFAULT_EXTENSION.TIME_ELAPSED_EXT)
    expect(gl.deleteQuery).toHaveBeenCalledWith(query)
    Effect.runSync(service.dispose)
  })

  it('keeps drawing available when the timer extension is missing', () => {
    const { gl } = makeTimerContext({ extension: null })
    const service = Effect.runSync(makeGpuTimerService(gl))

    expect(service.supported).toBe(false)
    Effect.runSync(service.begin)
    Effect.runSync(service.end)
    expect(Effect.runSync(service.poll)).toBeUndefined()
    expect(gl.createQuery).not.toHaveBeenCalled()
  })

  it('does not publish a disjoint query result', () => {
    const { gl, query } = makeTimerContext({ disjoint: true })
    const service = acquireTimerService(gl)

    Effect.runSync(service.begin)
    Effect.runSync(service.end)

    expect(Effect.runSync(service.poll)).toBeUndefined()
    expect(gl.deleteQuery).toHaveBeenCalledWith(query)
  })

  it('preserves a WebGL query failure as an Effect failure', () => {
    const failure = new Error('begin query failed')
    const { gl } = makeTimerContext({ beginFailure: failure })
    const service = acquireTimerService(gl)

    expect(() => Effect.runSync(service.begin)).toThrow()
  })
})
