/**
 * REGRESSION: per-frame temporaries are pre-allocated and reused.
 *
 * plan.md §3.9 / §5.2 — a sanctioned deviation from idiomatic Effect, alongside
 * meshing's native `Set` and noise's `let` + `for` octave loop. Reference
 * evidence at the renderer's per-frame scratch allocations.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  makeFrameScratch,
  makeScratchMap,
  ScratchMisuseError,
  snapshotScratch,
  withScratch,
  type ScratchBuffer,
  type ScratchMap,
} from '../src/domain/frame-scratch'

describe('reuse', () => {
  it.effect('the same lease object serves every frame — no per-frame wrapper allocation', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks', 512)
      const seen: Array<ScratchBuffer<string, number>> = []

      for (let frame = 0; frame < 5; frame += 1) {
        withScratch(scratch, (buffer) => {
          buffer.set(`chunk:${String(frame)}`, frame)
          seen.push(buffer)
          return buffer.size
        })
      }

      expect(seen).toHaveLength(5)
      expect(seen.every((buffer) => buffer === seen[0])).toBe(true)
      expect(scratch.usageCount()).toBe(5)
    }),
  )

  it.effect('the native map is private and the lease is only active during the callback', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')

      expect(Reflect.has(scratch, 'buffer')).toBe(false)
      expect(Reflect.get(scratch, 'buffer')).toBeUndefined()
      withScratch(scratch, (buffer) => {
        buffer.set('chunk:0', 1)
      })
      expect(scratch.borrowedCount()).toBe(0)
    }),
  )

  it.effect('the buffer is cleared on entry, so a frame never sees stale data', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('lightUpdates')

      withScratch(scratch, (buffer) => {
        buffer.set('a', 1)
      })
      const contents = withScratch(scratch, (buffer) => [...buffer.keys()])

      expect(contents).toStrictEqual([])
    }),
  )

  it.effect('all map operations use the active reusable lease', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('entityInstances')
      const values = withScratch(scratch, (buffer) => {
        buffer.set('mob:1', 0).set('mob:2', 1)
        const visited: Array<string> = []
        const context = { visited }
        buffer.forEach(function (this: typeof context, value, key, map) {
          expect(map).toBe(buffer)
          this.visited.push(`${key}:${String(value)}`)
        }, context)

        const entries = [...buffer.entries()]
        const keys = [...buffer.keys()]
        const iteratorEntries = [...buffer]
        const iteratorValues = [...buffer.values()]
        const read = buffer.get('mob:1')
        const has = buffer.has('mob:2')
        const deleted = buffer.delete('mob:1')
        const missing = buffer.delete('missing')
        const sizeAfterDelete = buffer.size
        buffer.clear()

        return {
          deleted,
          entries,
          has,
          iteratorEntries,
          iteratorValues,
          keys,
          missing,
          read,
          sizeAfterDelete,
          visited,
          clearedSize: buffer.size,
        }
      })

      expect(values).toStrictEqual({
        clearedSize: 0,
        deleted: true,
        entries: [
          ['mob:1', 0],
          ['mob:2', 1],
        ],
        has: true,
        iteratorEntries: [
          ['mob:1', 0],
          ['mob:2', 1],
        ],
        iteratorValues: [0, 1],
        keys: ['mob:1', 'mob:2'],
        missing: false,
        read: 0,
        sizeAfterDelete: 1,
        visited: ['mob:1:0', 'mob:2:1'],
      })
    }),
  )
})

describe('REGRESSION: the buffer must not escape the frame', () => {
  it.effect('returning the lease itself throws and releases the borrow', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')

      expect(() => withScratch(scratch, (buffer) => buffer)).toThrow(ScratchMisuseError)
      expect(scratch.borrowedCount()).toBe(0)
      try {
        withScratch(scratch, (buffer) => buffer)
      } catch (error) {
        expect(error instanceof ScratchMisuseError && error.violation.rule).toBe('escaped-buffer')
      }
    }),
  )

  it.effect('a wrapper that retains the lease fails when read after the callback', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')
      const escaped = withScratch(scratch, (buffer) => {
        buffer.set('chunk:0', 1)
        return { inside: buffer }
      })

      expect(() => escaped.inside.size).toThrow(ScratchMisuseError)
      expect(() => escaped.inside.set('chunk:1', 2)).toThrow(ScratchMisuseError)
    }),
  )

  it.effect('a closure over the lease fails when invoked later', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')
      const readLater = withScratch(scratch, (buffer) => {
        buffer.set('chunk:0', 1)
        return () => buffer.size
      })

      expect(() => readLater()).toThrow(ScratchMisuseError)
    }),
  )

  it.effect('a deferred Effect cannot read a lease after its synchronous borrow', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')
      const deferred = withScratch(scratch, (buffer) => {
        buffer.set('chunk:0', 1)
        return Effect.sync(() => buffer.size)
      })

      expect(scratch.borrowedCount()).toBe(0)
      expect(() => Effect.runSync(deferred)).toThrow(/withScratch lease ended/)
    }),
  )

  it.effect('an escaped iterator fails on its next operation', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')
      const iterator = withScratch(scratch, (buffer) => {
        buffer.set('chunk:0', 1)
        return buffer.entries()
      })

      expect(() => iterator.next()).toThrow(ScratchMisuseError)
    }),
  )

  it.effect('snapshotScratch is the sanctioned way to keep results, and it copies', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')

      const kept = withScratch(scratch, (buffer) => {
        buffer.set('chunk:0', 12)
        buffer.set('chunk:1', 30)
        return snapshotScratch(buffer)
      })

      withScratch(scratch, (buffer) => {
        buffer.set('chunk:2', 99)
      })

      expect([...kept.entries()]).toStrictEqual([
        ['chunk:0', 12],
        ['chunk:1', 30],
      ])
    }),
  )

  it.effect('a foreign ScratchMap gets a diagnostic rather than a private-property TypeError', () =>
    Effect.sync(() => {
      const foreign: ScratchMap<string, number> = {
        name: 'hand-built',
        usageCount: () => 0,
        borrowedCount: () => 0,
      }

      expect(() => withScratch(foreign, (buffer) => buffer.size)).toThrow(ScratchMisuseError)
      try {
        withScratch(foreign, (buffer) => buffer.size)
      } catch (error) {
        expect(error instanceof ScratchMisuseError && error.violation.rule).toBe('invalid-scratch')
      }
    }),
  )

  it.effect('usageCount counts borrows, including one that failed its escape check', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')

      withScratch(scratch, (buffer) => buffer.size)
      expect(() => withScratch(scratch, (buffer) => buffer)).toThrow(ScratchMisuseError)

      expect(scratch.usageCount()).toBe(2)
    }),
  )
})

describe('REGRESSION: re-entrant borrows are rejected', () => {
  it.effect('two nested users of one buffer would clobber each other', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')

      expect(() =>
        withScratch(scratch, (outer) => {
          outer.set('outer', 1)
          return withScratch(scratch, (inner) => inner.size)
        }),
      ).toThrow(ScratchMisuseError)
    }),
  )

  it.effect('an aborted nested borrow leaves the outer borrow accounted for correctly', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')

      expect(() =>
        withScratch(scratch, () => withScratch(scratch, (inner) => inner.size)),
      ).toThrow()
      expect(scratch.borrowedCount()).toBe(0)
    }),
  )

  it.effect('sequential borrows are fine — it is nesting that is the problem', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')

      expect(withScratch(scratch, (buffer) => buffer.set('a', 1).size)).toBe(1)
      expect(withScratch(scratch, (buffer) => buffer.set('b', 2).size)).toBe(1)
      expect(scratch.borrowedCount()).toBe(0)
    }),
  )

  it.effect('two different buffers may be borrowed at once', () =>
    Effect.sync(() => {
      const frame = makeFrameScratch()

      const result = withScratch(frame.visibleChunks, (chunks) => {
        chunks.set('chunk:0', 1)
        return withScratch(frame.entityInstances, (entities) => {
          entities.set('mob:0', 0)
          return chunks.size + entities.size
        })
      })

      expect(result).toBe(2)
    }),
  )
})

describe('makeFrameScratch', () => {
  it.effect('provides distinct scratch owners, each named for the profiler', () =>
    Effect.sync(() => {
      const frame = makeFrameScratch()

      expect(frame.visibleChunks).not.toBe(frame.entityInstances)
      expect(frame.entityInstances).not.toBe(frame.lightUpdates)
      expect(frame.visibleChunks.name).toBe('visibleChunks[~512]')
      expect(frame.lightUpdates.name).toBe('lightUpdates[~64]')
    }),
  )

  it.effect('two frame-scratch sets are independent, so two renderers can coexist', () =>
    Effect.sync(() => {
      const a = makeFrameScratch()
      const b = makeFrameScratch()

      const aSize = withScratch(a.visibleChunks, (buffer) => {
        buffer.set('chunk:0', 1)
        return buffer.size
      })

      expect(aSize).toBe(1)
      expect(withScratch(b.visibleChunks, (buffer) => buffer.size)).toBe(0)
    }),
  )
})
