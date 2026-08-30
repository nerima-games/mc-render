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
} from '../src/domain/frame-scratch'

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
      let identity = new Map<string, number>()

      withScratch(scratch, (buffer) => {
        identity = buffer
        buffer.set('mob:1', 0)
      })
      withScratch(scratch, (buffer) => {
        expect(buffer).toBe(identity)
        buffer.set('mob:2', 1)
      })

      expect(identity).toBeDefined()
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

describe('REGRESSION: withScratch prevents cross-frame escapes', () => {
  it.effect('a wrapper cannot retain a usable view after the lease ends', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')

      const escaped = withScratch(scratch, (buffer) => {
        buffer.set('chunk:0', 1)
        buffer.set('chunk:1', 2)
        return { inside: buffer }
      })

      expect(() => escaped.inside.size).toThrow(ScratchMisuseError)
    }),
  )

  it.effect('a closure cannot read the view after the lease ends', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')

      const readLater = withScratch(scratch, (buffer) => {
        buffer.set('chunk:0', 1)
        buffer.set('chunk:1', 2)
        return () => buffer.size
      })

      expect(() => readLater()).toThrow(ScratchMisuseError)
    }),
  )

  it.effect('a deferred Effect fails when it tries to use the released view', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')

      const deferred = withScratch(scratch, (buffer) => {
        buffer.set('chunk:0', 1)
        return Effect.sync(() => buffer.size)
      })

      expect(scratch.borrowedCount()).toBe(0)
      expect(() => Effect.runSync(deferred)).toThrow('used outside its withScratch borrow')
    }),
  )

  it.effect('the raw buffer is not part of the public scratch value', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')

      expect('buffer' in scratch).toBe(false)
    }),
  )

  it.effect('a foreign ScratchMap is rejected with a diagnostic error', () =>
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
        expect(error instanceof ScratchMisuseError && error.violation.rule).toBe('foreign-scratch')
      }
    }),
  )

  it.effect('usageCount counts BORROWS, including one that died on the escape check', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')

      withScratch(scratch, (buffer) => buffer.size)
      expect(() => withScratch(scratch, (buffer) => buffer)).toThrow(ScratchMisuseError)

      expect(scratch.usageCount()).toBe(2)
    }),
  )
})

describe('the guarded view delegates the whole Map interface, lease-checked', () => {
  it.effect('every read/write method delegates to the backing buffer', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')

      withScratch(scratch, (buffer) => {
        expect(buffer.has('a')).toBe(false)
        buffer.set('a', 1)
        buffer.set('b', 2)

        expect(buffer.size).toBe(2)
        expect(buffer.has('a')).toBe(true)
        expect(buffer.get('a')).toBe(1)
        expect(buffer.get('missing')).toBeUndefined()
        expect([...buffer.entries()]).toStrictEqual([
          ['a', 1],
          ['b', 2],
        ])
        expect([...buffer.values()]).toStrictEqual([1, 2])
        expect([...buffer]).toStrictEqual([
          ['a', 1],
          ['b', 2],
        ])

        const seen: Array<readonly [string, number, Map<string, number>]> = []
        buffer.forEach((value, key, map) => {
          seen.push([key, value, map])
        })
        expect(seen).toStrictEqual([
          ['a', 1, buffer],
          ['b', 2, buffer],
        ])

        expect(buffer.delete('a')).toBe(true)
        expect(buffer.has('a')).toBe(false)
        expect(buffer.size).toBe(1)

        buffer.clear()
        expect(buffer.size).toBe(0)
      })
    }),
  )

  it.effect('forEach honours thisArg, exactly as the real Map does', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')
      const receiver = { tag: 'receiver' }
      const seenThis: Array<unknown> = []

      withScratch(scratch, (buffer) => {
        buffer.set('a', 1)
        buffer.forEach(function callback(this: unknown) {
          seenThis.push(this)
        }, receiver)
      })

      expect(seenThis).toStrictEqual([receiver])
    }),
  )

  it.effect('the Map delegate methods raise the same escaped-buffer error after the lease ends', () =>
    Effect.sync(() => {
      const scratch = makeScratchMap<string, number>('visibleChunks')
      const escaped = withScratch(scratch, (buffer) => {
        buffer.set('a', 1)
        return { inside: buffer }
      })
      const { inside } = escaped

      expect(() => inside.clear()).toThrow(ScratchMisuseError)
      expect(() => inside.delete('a')).toThrow(ScratchMisuseError)
      expect(() => [...inside.entries()]).toThrow(ScratchMisuseError)
      expect(() => inside.forEach(() => undefined)).toThrow(ScratchMisuseError)
      expect(() => inside.get('a')).toThrow(ScratchMisuseError)
      expect(() => inside.has('a')).toThrow(ScratchMisuseError)
      expect(() => [...inside.keys()]).toThrow(ScratchMisuseError)
      expect(() => inside.set('b', 2)).toThrow(ScratchMisuseError)
      expect(() => [...inside.values()]).toThrow(ScratchMisuseError)
      expect(() => [...inside]).toThrow(ScratchMisuseError)
    }),
  )

  it.effect('withScratch received a non-object scratch value created outside makeScratchMap', () =>
    Effect.sync(() => {
      // `stateFor`'s first guard, ahead of the WeakMap lookup: a scratch value
      // that is not even an object (a stray string) cannot be a WeakMap key
      // at all.
      const foreign = 'not-a-scratch-map' as unknown as ScratchMap<string, number>

      expect(() => withScratch(foreign, (buffer) => buffer.size)).toThrow(ScratchMisuseError)
      try {
        withScratch(foreign, (buffer) => buffer.size)
      } catch (error) {
        expect(error instanceof ScratchMisuseError && error.violation.rule).toBe('foreign-scratch')
        expect(error instanceof ScratchMisuseError && error.violation.message).toContain(
          'non-object scratch value',
        )
      }
    }),
  )

  it.effect('withScratch received null, which typeof reports as "object"', () =>
    Effect.sync(() => {
      // `typeof null === 'object'`, so the non-object check alone would let a
      // null scratch value through to the WeakMap lookup — this is the
      // `scratch === null` half of that guard, exercised on its own.
      const foreign = null as unknown as ScratchMap<string, number>

      expect(() => withScratch(foreign, (buffer) => buffer.size)).toThrow(ScratchMisuseError)
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
      let visible = new Map<string, number>()
      let entities = new Map<string, number>()
      let lights = new Map<string, number>()

      withScratch(frame.visibleChunks, (buffer) => {
        visible = buffer
        withScratch(frame.entityInstances, (entityBuffer) => {
          entities = entityBuffer
          withScratch(frame.lightUpdates, (lightBuffer) => {
            lights = lightBuffer
            expect(visible).not.toBe(entities)
            expect(entities).not.toBe(lights)
          })
        })
      })

      expect(visible).toBeDefined()
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

      const aSize = withScratch(a.visibleChunks, (buffer) => {
        buffer.set('chunk:0', 1)
        return buffer.size
      })
      const bSize = withScratch(b.visibleChunks, (buffer) => buffer.size)

      expect(aSize).toBe(1)
      expect(bSize).toBe(0)
    }),
  )
})
