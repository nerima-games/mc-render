/**
 * REGRESSION: per-frame temporaries are pre-allocated and reused.
 *
 * plan.md §3.9 / §5.2 — a sanctioned deviation from idiomatic Effect, alongside
 * meshing's native `Set` and noise's `let` + `for` octave loop. Reference
 * evidence at
 * ts-minecraft/packages/rendering/infrastructure/entity/entity-renderer.ts:35-38
 * and .../renderer/world-renderer.ts:52-58.
 *
 * A reused mutable buffer is only safe under one rule: nothing may hold a
 * reference to it across a frame boundary. These tests pin that rule, because
 * violating it produces a timing-dependent bug that is close to impossible to
 * find by reading.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  makeFrameScratch,
  makeScratchMap,
  ScratchMisuseError,
  snapshotScratch,
  withScratch,
} from '../domain/frame-scratch'

describe('reuse', () => {
  it.effect('the SAME Map object serves every frame — no allocation per frame', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks', 512)
      const seen: Array<Map<string, number>> = []

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

  it.effect('REGRESSION: the buffer is cleared on ENTRY, so a frame never sees stale data', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('lightUpdates')

      withScratch(scratch, (buffer) => {
        buffer.set('a', 1)
      })
      const contents = withScratch(scratch, (buffer) => [...buffer.keys()])

      expect(contents).toStrictEqual([])
    }),
  )

  it.effect('clearing keeps the buffer identity, which is what keeps the bucket array', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('entityInstances')
      const identity = scratch.buffer

      withScratch(scratch, (buffer) => {
        buffer.set('mob:1', 0)
      })
      withScratch(scratch, (buffer) => {
        buffer.set('mob:2', 1)
      })

      expect(scratch.buffer).toBe(identity)
    }),
  )
})

describe('REGRESSION: the buffer must not escape the frame', () => {
  it.effect('returning the buffer itself throws rather than handing out a live reference', () =>
    Effect.sync(() => {
      // A caller that keeps this reference sees it emptied and refilled with
      // next frame's data. Failing loudly here is the whole point.
      const scratch = makeScratchMap<string, number>('visibleChunks')

      expect(() => withScratch(scratch, (buffer) => buffer)).toThrow(ScratchMisuseError)
      try {
        withScratch(scratch, (buffer) => buffer)
      } catch (error) {
        expect(error instanceof ScratchMisuseError && error.violation.rule).toBe('escaped-buffer')
      }
    }),
  )

  it.effect('a failed escape still releases the borrow, so the buffer stays usable', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')

      expect(() => withScratch(scratch, (buffer) => buffer)).toThrow()
      expect(scratch.borrowedCount()).toBe(0)
      expect(withScratch(scratch, (buffer) => buffer.size)).toBe(0)
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

      // The buffer moves on; the copy does not.
      withScratch(scratch, (buffer) => {
        buffer.set('chunk:2', 99)
      })

      expect([...kept.entries()]).toStrictEqual([
        ['chunk:0', 12],
        ['chunk:1', 30],
      ])
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
          // The inner borrow would clear the buffer the outer one is mid-way
          // through filling.
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

  it.effect('two DIFFERENT buffers may be borrowed at once', () =>
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
  it.effect('provides distinct buffers, each named for the profiler', () =>
    Effect.sync(() => {
      const frame = makeFrameScratch()

      expect(frame.visibleChunks.buffer).not.toBe(frame.entityInstances.buffer)
      expect(frame.entityInstances.buffer).not.toBe(frame.lightUpdates.buffer)
      expect(frame.visibleChunks.name).toBe('visibleChunks[~512]')
      expect(frame.lightUpdates.name).toBe('lightUpdates[~64]')
    }),
  )

  it.effect('two frame-scratch sets are independent, so two renderers can coexist', () =>
    Effect.sync(() => {
      // mc-playground-kit runs two previews side by side; a module-level
      // scratch would have them share one buffer.
      const a = makeFrameScratch()
      const b = makeFrameScratch()

      withScratch(a.visibleChunks, (buffer) => {
        buffer.set('chunk:0', 1)
      })

      expect(a.visibleChunks.buffer.size).toBe(1)
      expect(b.visibleChunks.buffer.size).toBe(0)
    }),
  )
})
