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
  type ScratchMap,
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

/**
 * KNOWN GAP, pinned rather than fixed.
 *
 * `domain/frame-scratch.ts` says the cross-frame invariant "is enforced rather
 * than documented". Exactly ONE shape of escape is enforced: the identity check
 * compares the RESULT against the buffer. Every other way of getting the same
 * live `Map` out — a wrapper object, a closure over it, a deferred callback, or
 * simply reading the public `scratch.buffer` field — hands out the same
 * reference and the same lifetime bug, undetected.
 *
 * WHY NOT FIXED NOW. Detecting these means not handing out the live `Map` at
 * all: a lease-checked facade, or making `buffer` private. Both change the
 * module's public type, and the facade puts a branch (and a wrapper object) on
 * the hot path that this module exists to keep allocation-free — the deviation
 * plan.md §5.2 sanctions BY NAME, so weakening it is not a local decision. The
 * shipped call site (`render:chunk-sync` in `stages/registration.ts`) is
 * synchronous and returns a number, which is why nothing has hit it.
 *
 * The foreign-ScratchMap row below is the one piece that is cheap in isolation
 * — `withScratch` casts to a private shape the public type does not carry, so a
 * hand-built `ScratchMap` dies with a `TypeError` rather than a diagnostic. It
 * is left with the rest deliberately: `makeScratchMap` is the only constructor
 * and it is exported, so reaching that row means hand-writing an object literal
 * against a type documented as "only `withScratch` may drive it". Paying a new
 * public `ScratchViolation` rule for a case nothing in the organisation can
 * reach, while the escapes above stay open, buys a louder error on the least
 * likely path and leaves the module's central claim just as false. Both, in the
 * redesign, or neither.
 *
 * These tests describe what the module DOES. When it is fixed, they are the
 * tests that fail.
 */
describe('KNOWN GAP: withScratch catches only the identity escape', () => {
  it.effect('a WRAPPER object hands out the same live buffer, undetected', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')

      const escaped = withScratch(scratch, (buffer) => {
        buffer.set('chunk:0', 1)
        buffer.set('chunk:1', 2)
        return { inside: buffer }
      })

      // No throw. And it really is the live buffer: the next borrow clears it
      // under its holder, which is precisely the bug the module exists to make
      // impossible.
      expect(escaped.inside).toBe(scratch.buffer)
      expect(escaped.inside.size).toBe(2)
      withScratch(scratch, (buffer) => buffer.size)
      expect(escaped.inside.size).toBe(0)
    }),
  )

  it.effect('a CLOSURE over the buffer escapes the same way', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')

      const readLater = withScratch(scratch, (buffer) => {
        buffer.set('chunk:0', 1)
        buffer.set('chunk:1', 2)
        return () => buffer.size
      })

      expect(readLater()).toBe(2)
      withScratch(scratch, (buffer) => buffer.size)
      expect(readLater()).toBe(0)
    }),
  )

  it.effect('a DEFERRED callback runs after the lease is gone — the shape Effect code reaches for', () =>
    Effect.gen(function* () {
      // The sharpest one. `withScratch` releases the lease in a `finally`, so
      // `withScratch(s, (b) => Effect.sync(() => b.size))` returns an
      // UNEVALUATED Effect with the borrow already over; by the time it runs,
      // the next borrow has cleared the buffer. Nothing about this looks wrong
      // at the call site, and it is the idiom the rest of the repository is
      // written in.
      const scratch = makeScratchMap<string, number>('visibleChunks')

      const deferred = withScratch(scratch, (buffer) => {
        buffer.set('chunk:0', 1)
        return Effect.sync(() => buffer.size)
      })

      // The borrow is already over before the Effect has run at all.
      expect(scratch.borrowedCount()).toBe(0)
      expect(yield* deferred).toBe(1)

      // ...and after the next frame's borrow, the same Effect reads next
      // frame's (empty) buffer.
      withScratch(scratch, (buffer) => buffer.size)
      expect(yield* deferred).toBe(0)
    }),
  )

  it.effect('`scratch.buffer` is public and readable outside any borrow, despite its own doc', () =>
    Effect.sync(() => {
      // `ScratchMap.buffer` is documented "Valid ONLY inside a withScratch
      // callback", with nothing making that true. This file's other tests read
      // it outside a borrow too, which is how ordinary the access is.
      const scratch = makeScratchMap<string, number>('visibleChunks')

      withScratch(scratch, (buffer) => {
        buffer.set('chunk:0', 1)
      })

      expect(scratch.borrowedCount()).toBe(0)
      expect(scratch.buffer.size).toBe(1)
      // Writable, too.
      scratch.buffer.set('chunk:1', 2)
      expect(scratch.buffer.size).toBe(2)
    }),
  )

  it.effect('a FOREIGN ScratchMap dies with a TypeError, not a ScratchMisuseError', () =>
    Effect.sync(() => {
      // `withScratch` casts to `LeasedScratchMap`, a private shape the public
      // `ScratchMap` type does not carry, so a structurally valid value built
      // anywhere else has no `lease` — and the failure names a missing property
      // instead of the mistake.
      const foreign: ScratchMap<string, number> = {
        name: 'hand-built',
        buffer: new Map<string, number>(),
        usageCount: () => 0,
        borrowedCount: () => 0,
      }

      expect(() => withScratch(foreign, (buffer) => buffer.size)).toThrow(TypeError)
      expect(() => withScratch(foreign, (buffer) => buffer.size)).not.toThrow(ScratchMisuseError)
    }),
  )

  it.effect('usageCount counts BORROWS, including one that died on the escape check', () =>
    Effect.sync(() => {
      // Documented as "Frames this buffer has served". It increments in
      // `enter()`, i.e. once per borrow, and a borrow that throws has already
      // counted. Harmless — it is diagnostics — but the name and the number
      // disagree, and a profiler reading "frames" would be reading borrows.
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
