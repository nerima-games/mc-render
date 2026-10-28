/**
 * Regression coverage for reusable per-frame scratch buffers.
 *
 * A lease-checked view prevents retained references from observing later frame
 * data. Typed failures make misuse visible while the lease bracket releases on
 * success, typed failure, interruption, or defect.
 */
import { Cause, Effect, Exit, Fiber, Result } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  makeFrameScratch,
  makeScratchMap,
  type ScratchMisuseError,
  snapshotScratch,
  withScratch,
  type ScratchMap,
  type ScratchMapView,
} from '../src/domain/frame-scratch'
import { inspectTypeScriptFixture } from './typescript-project'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const runView = <A>(effect: Effect.Effect<A, ScratchMisuseError>): A => Effect.runSync(effect)

const resultOf = <A>(
  effect: Effect.Effect<A, ScratchMisuseError>,
): Result.Result<A, ScratchMisuseError> => Effect.runSync(Effect.result(effect))

const withScratchValue = <Key, Value, A>(
  scratch: ScratchMap<Key, Value>,
  use: (view: ScratchMapView<Key, Value>) => A,
): A =>
  Effect.runSync(withScratch(scratch, (view) => Effect.sync(() => use(view))))

const expectScratchFailure = <A>(
  result: Result.Result<A, ScratchMisuseError>,
  rule: ScratchMisuseError['violation']['rule'],
): void => {
  expect(Result.isFailure(result)).toBe(true)
  if (Result.isFailure(result)) {
    expect(result.failure._tag).toBe('ScratchMisuseError')
    expect(result.failure.violation.rule).toBe(rule)
    expect(result.failure.message).not.toBe('')
  }
}

describe('frame scratch', () => {
  it.effect('requires the factory brand in the public type', () =>
    Effect.sync(() => {
      const fixture = `${repositoryRoot}/test/fixtures/frame-scratch-brand.ts`
      const inspection = inspectTypeScriptFixture(repositoryRoot, fixture, ['ES2022'])

      expect(inspection.errors).toStrictEqual([])
    }),
  )

  it.effect('reuses one guarded view and clears the buffer on entry', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks', 512)
      const views: Array<ScratchMapView<string, number>> = []

      for (let frame = 0; frame < 5; frame += 1) {
        const size = withScratchValue(scratch, (view) => {
          runView(view.set(`chunk:${String(frame)}`, frame))
          views.push(view)
          return runView(view.size())
        })
        expect(size).toBe(1)
      }

      expect(views).toHaveLength(5)
      expect(views.every((view) => view === views[0])).toBe(true)
      expect(scratch.usageCount()).toBe(5)

      const contents = withScratchValue(scratch, (view) => runView(view.entries()))
      expect(contents).toStrictEqual([])
    }),
  )

  it.effect('reports an exact view escape and releases the lease', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')
      const escaped = resultOf(withScratch(scratch, (view) => Effect.succeed(view)))

      expectScratchFailure(escaped, 'escaped-buffer')
      expect(scratch.borrowedCount()).toBe(0)
      expect(withScratchValue(scratch, (view) => runView(view.size()))).toBe(0)
      expect(scratch.usageCount()).toBe(2)
    }),
  )

  it.effect('returns typed failures when retained views are used after the lease', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')
      const retained = withScratchValue(scratch, (view) => ({ view }))
      const deferred = withScratchValue(scratch, (view) => () => view.size())
      const deferredEffect = withScratchValue(scratch, (view) => view.size())

      expectScratchFailure(resultOf(retained.view.size()), 'escaped-buffer')
      expectScratchFailure(resultOf(deferred()), 'escaped-buffer')
      expectScratchFailure(resultOf(deferredEffect), 'escaped-buffer')
      expect(scratch.borrowedCount()).toBe(0)
    }),
  )

  it.effect('copies entries so snapshots survive subsequent frames', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')
      const kept = Effect.runSync(
        withScratch(scratch, (view) =>
          Effect.flatMap(view.set('chunk:0', 12), () =>
            Effect.flatMap(view.set('chunk:1', 30), () => snapshotScratch(view)),
          ),
        ),
      )

      withScratchValue(scratch, (view) => {
        runView(view.set('chunk:2', 99))
      })

      expect([...kept.entries()]).toStrictEqual([
        ['chunk:0', 12],
        ['chunk:1', 30],
      ])
    }),
  )

  it.effect('returns a typed re-entrant failure and releases the outer borrow', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')
      const outcome = resultOf(
        withScratch(scratch, (outer) =>
          Effect.flatMap(outer.set('outer', 1), () =>
            withScratch(scratch, (inner) => inner.size()),
          ),
        ),
      )

      expectScratchFailure(outcome, 're-entrant-borrow')
      expect(scratch.borrowedCount()).toBe(0)
      expect(scratch.usageCount()).toBe(1)
      expect(withScratchValue(scratch, (view) => runView(view.size()))).toBe(0)
    }),
  )

  it.effect('rejects non-object, null, and forged scratch handles with typed failures', () =>
    Effect.sync(() => {
      const nonObject = 'not-a-scratch-map' as unknown as ScratchMap<string, number>
      const nullValue = null as unknown as ScratchMap<string, number>
      const forged = { ...makeScratchMap<string, number>('forged') } as unknown as ScratchMap<
        string,
        number
      >

      expectScratchFailure(resultOf(withScratch(nonObject, (view) => view.size())), 'foreign-scratch')
      expectScratchFailure(resultOf(withScratch(nullValue, (view) => view.size())), 'foreign-scratch')
      expectScratchFailure(resultOf(withScratch(forged, (view) => view.size())), 'foreign-scratch')
    }),
  )

  it.effect('delegates the map operations through the active lease', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')

      withScratchValue(scratch, (view) => {
        expect(runView(view.has('a'))).toBe(false)
        runView(view.set('a', 1))
        runView(view.set('b', 2))

        expect(runView(view.size())).toBe(2)
        expect(runView(view.has('a'))).toBe(true)
        expect(runView(view.get('a'))).toBe(1)
        expect(runView(view.get('missing'))).toBeUndefined()
        expect(runView(view.entries())).toStrictEqual([
          ['a', 1],
          ['b', 2],
        ])
        expect(runView(view.keys())).toStrictEqual(['a', 'b'])
        expect(runView(view.values())).toStrictEqual([1, 2])

        const seen: Array<readonly [string, number, ScratchMapView<string, number>]> = []
        runView(
          view.forEach((value, key, map) => {
            seen.push([key, value, map])
          }),
        )
        expect(seen).toStrictEqual([
          ['a', 1, view],
          ['b', 2, view],
        ])

        expect(runView(view.delete('a'))).toBe(true)
        expect(runView(view.has('a'))).toBe(false)
        runView(view.clear())
        expect(runView(view.size())).toBe(0)
      })
    }),
  )

  it.effect('forEach honours thisArg', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')
      const receiver = { tag: 'receiver' }
      const seenThis: Array<unknown> = []

      withScratchValue(scratch, (view) => {
        runView(view.set('a', 1))
        runView(
          view.forEach(function callback(this: unknown) {
            seenThis.push(this)
          }, receiver),
        )
      })

      expect(seenThis).toStrictEqual([receiver])
    }),
  )

  it.effect('keeps entries copied out of a lease independent from the live buffer', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')
      const entries = withScratchValue(scratch, (view) => {
        runView(view.set('chunk:0', 12))
        return runView(view.entries())
      })

      withScratchValue(scratch, (view) => {
        runView(view.set('chunk:1', 99))
      })

      expect(entries).toStrictEqual([['chunk:0', 12]])
    }),
  )

  it.effect('a defect in the use effect still releases the lease', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')
      const defect = new Error('scratch use defect')
      const exit = Effect.runSyncExit(withScratch(scratch, () => Effect.die(defect)))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const found = Cause.findDefect(exit.cause)
        expect(Result.isSuccess(found)).toBe(true)
        if (Result.isSuccess(found)) {
          expect(found.success).toBe(defect)
        }
      }
      expect(scratch.borrowedCount()).toBe(0)
      expect(withScratchValue(scratch, (view) => runView(view.size()))).toBe(0)
    }),
  )

  it.effect('rejects a second effect that starts while the first lease is active', () =>
    Effect.gen(function* () {
      const scratch = makeScratchMap<string, number>('visibleChunks')
      let signalStarted: () => void = () => undefined
      let finishLease: () => void = () => undefined
      const started = new Promise<void>((resolve) => {
        signalStarted = resolve
      })
      const leaseReleased = new Promise<void>((resolve) => {
        finishLease = resolve
      })
      const first = withScratch(scratch, () =>
        Effect.promise(() => {
          signalStarted()
          return leaseReleased.then(() => 'held')
        }),
      )
      const second = withScratch(scratch, (view) => view.size())
      const firstFiber = yield* Effect.forkChild(first)

      yield* Effect.promise(() => started)
      const secondOutcome = yield* Effect.result(second)

      expectScratchFailure(secondOutcome, 're-entrant-borrow')
      expect(scratch.borrowedCount()).toBe(1)

      yield* Effect.sync(() => finishLease())
      expect(yield* Fiber.join(firstFiber)).toBe('held')
      expect(scratch.borrowedCount()).toBe(0)
      expect(scratch.usageCount()).toBe(1)
    }),
  )

  it.effect('provides distinct frame buffers with independent storage', () =>
    Effect.sync(() => {
      const frame = makeFrameScratch()
      const visible = withScratchValue(frame.visibleChunks, (view) => ({ view }))
      const entities = withScratchValue(frame.entityInstances, (view) => ({ view }))
      const lights = withScratchValue(frame.lightUpdates, (view) => ({ view }))

      expect(visible.view).not.toBe(entities.view)
      expect(entities.view).not.toBe(lights.view)
      expect(frame.visibleChunks.name).toBe('visibleChunks[~512]')
      expect(frame.lightUpdates.name).toBe('lightUpdates[~64]')

      withScratchValue(frame.visibleChunks, (view) => {
        runView(view.set('chunk:0', 1))
      })
      expect(withScratchValue(frame.entityInstances, (view) => runView(view.size()))).toBe(0)
    }),
  )

  it.effect('two renderer scratch sets remain independent', () =>
    Effect.sync(() => {
      const a = makeFrameScratch()
      const b = makeFrameScratch()

      withScratchValue(a.visibleChunks, (view) => {
        runView(view.set('chunk:0', 1))
      })

      expect(withScratchValue(a.visibleChunks, (view) => runView(view.size()))).toBe(0)
      expect(withScratchValue(b.visibleChunks, (view) => runView(view.size()))).toBe(0)
    }),
  )
})
