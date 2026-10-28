/**
 * Tests for the refraction pre-pass decision.
 *
 * The load-bearing one is the last group: all 720 orderings of the six gates
 * agree on run-versus-skip. That is the property the reorder away from the
 * reference's order rests on, and without it the reorder would be an unargued
 * change to a decision that costs a full scene render when it goes wrong.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import { QUALITY_PRESETS, type QualityPreset } from '../src/domain/post-processing'
import {
  decideRefractionPrePass as decideRefractionPrePassResult,
  RefractionBooleanResultSchema,
  RefractionDecisionResultSchema,
  RefractionNumberResultSchema,
  RefractionStringResultSchema,
  describeRefractionDecision as describeRefractionDecisionResult,
  isRefractionSkipped as isRefractionSkippedResult,
  NDC_VIEWPORT_AREA,
  REFERENCE_REFRACTION_GATE_ORDER,
  REFRACTION_GATE_ORDER,
  REFRACTION_INTERVAL_FRAMES,
  REFRACTION_MIN_SCREEN_RATIO,
  normalizeRefractionMinScreenRatio as normalizeRefractionMinScreenRatioResult,
  refractionRunsOnFrame as refractionRunsOnFrameResult,
  sameRefractionKey as sameRefractionKeyResult,
  screenRatioForNdcRect as screenRatioForNdcRectResult,
  shouldRunRefractionRatioGate as shouldRunRefractionRatioGateResult,
  type RefractionCameraKey,
  type RefractionDecision,
  type RefractionGate,
  type RefractionInputs,
} from '../src/domain/water-refraction'

const KEY: RefractionCameraKey = {
  sceneVersion: 3,
  worldX: 1,
  worldY: 2,
  worldZ: 3,
  qx: 0,
  qy: 0,
  qz: 0,
  qw: 1,
  projection0: 1.5,
  projection5: 2,
  projection10: -1.0002,
  projection14: -0.2,
}

/** Inputs on which every gate passes, so the pre-pass runs. */
const RUNNING: RefractionInputs = {
  intervalFrames: 1,
  frameNumber: 1,
  waterMeshCount: 4,
  visibleWaterMeshCount: 2,
  waterScreenRatio: 0.5,
  minScreenRatio: 0.005,
  cameraKey: KEY,
  lastRenderedKey: undefined,
}

const minScreenRatioFailureReason = (value: number): 'not-finite' | 'out-of-range' => {
  if (!Number.isFinite(value)) {
    return 'not-finite'
  }
  return 'out-of-range'
}

/** Every permutation of an array. 6 gates is 720, which is cheap to exhaust. */
const permutations = <A>(items: ReadonlyArray<A>): ReadonlyArray<ReadonlyArray<A>> => {
  if (items.length <= 1) {
    return [items]
  }
  const result: Array<ReadonlyArray<A>> = []
  for (let index = 0; index < items.length; index += 1) {
    const head = items[index] as A
    const rest = [...items.slice(0, index), ...items.slice(index + 1)]
    for (const tail of permutations(rest)) {
      result.push([head, ...tail])
    }
  }
  return result
}

const expectSuccess = <Value, Failure>(result: Result.Result<Value, Failure>): Value => {
  if (Result.isFailure(result)) {
    throw new Error(JSON.stringify(result.failure))
  }
  return result.success
}

const expectFailure = <Value, Failure>(result: Result.Result<Value, Failure>): Failure => {
  if (Result.isSuccess(result)) {
    throw new Error(JSON.stringify(result.success))
  }
  return result.failure
}

const normalizeRefractionMinScreenRatio = (value: unknown): number =>
  expectSuccess(normalizeRefractionMinScreenRatioResult(value))

const refractionRunsOnFrame = (interval: unknown, frame: unknown): boolean =>
  expectSuccess(refractionRunsOnFrameResult(interval, frame))

const sameRefractionKey = (first: unknown, second: unknown): boolean =>
  expectSuccess(sameRefractionKeyResult(first, second))

const screenRatioForNdcRect = (rect: unknown): number =>
  expectSuccess(screenRatioForNdcRectResult(rect))

const decideRefractionPrePass = (inputs: unknown, order?: unknown): RefractionDecision =>
  expectSuccess(decideRefractionPrePassResult(inputs, order))

const isRefractionSkipped = (decision: unknown): boolean =>
  expectSuccess(isRefractionSkippedResult(decision))

const describeRefractionDecision = (decision: unknown): string =>
  expectSuccess(describeRefractionDecisionResult(decision))

describe('the preset tables', () => {
  it.effect('are the reference values, asserted as literals', () =>
    Effect.sync(() => {
      expect(REFRACTION_INTERVAL_FRAMES).toStrictEqual({ low: 0, medium: 0, high: 2, ultra: 1 })
      expect(REFRACTION_MIN_SCREEN_RATIO).toStrictEqual({
        low: 0.05,
        medium: 0.05,
        high: 0.005,
        ultra: 0.005,
      })
    }),
  )

  it.effect('cover exactly the four presets domain/post-processing.ts declares', () =>
    Effect.sync(() => {
      // A preset added there and forgotten here would silently take whatever a
      // missing entry produced.
      const presets = Object.keys(QUALITY_PRESETS).sort()
      expect(Object.keys(REFRACTION_INTERVAL_FRAMES).sort()).toStrictEqual(presets)
      expect(Object.keys(REFRACTION_MIN_SCREEN_RATIO).sort()).toStrictEqual(presets)
    }),
  )

  it.effect('low and medium NEVER refract — the zero means never, not unthrottled', () =>
    Effect.sync(() => {
      // The reference's field is named `refractionThrottleFrames`, whose zero
      // reads as "no throttling" and means the opposite.
      for (const preset of ['low', 'medium'] as ReadonlyArray<QualityPreset>) {
        expect(REFRACTION_INTERVAL_FRAMES[preset]).toBe(0)
        for (let frame = 1; frame <= 10; frame += 1) {
          expect(refractionRunsOnFrame(REFRACTION_INTERVAL_FRAMES[preset], frame)).toBe(false)
        }
      }
    }),
  )

  it.effect('high refreshes LESS often than ultra, which is not a transcription slip', () =>
    Effect.sync(() => {
      // settings-service.config.ts:52 and :61. The one preset axis where high is
      // half of ultra rather than a subset of it.
      expect(REFRACTION_INTERVAL_FRAMES.high).toBeGreaterThan(REFRACTION_INTERVAL_FRAMES.ultra)
    }),
  )

  it.effect('and high/ultra skip far less aggressively than low/medium', () =>
    Effect.sync(() => {
      expect(REFRACTION_MIN_SCREEN_RATIO.high).toBeLessThan(REFRACTION_MIN_SCREEN_RATIO.low)
      expect(REFRACTION_MIN_SCREEN_RATIO.ultra).toBeLessThan(REFRACTION_MIN_SCREEN_RATIO.medium)
    }),
  )
})

describe('the frame schedule', () => {
  it.effect('an interval of 1 runs every frame', () =>
    Effect.sync(() => {
      for (let frame = 1; frame <= 20; frame += 1) {
        expect(refractionRunsOnFrame(1, frame)).toBe(true)
      }
    }),
  )

  it.effect('an interval of 2 runs on frames 1, 3, 5 — the FIRST frame always runs', () =>
    Effect.sync(() => {
      // The reference increments its counter before testing, so frame 1 gives
      // (1-1) % N === 0 for every N. A texture that has never been rendered
      // must not be waited for.
      expect([1, 2, 3, 4, 5, 6].map((frame) => refractionRunsOnFrame(2, frame))).toStrictEqual([
        true,
        false,
        true,
        false,
        true,
        false,
      ])
    }),
  )

  it.effect('an interval of 0 never runs — NOT every frame', () =>
    Effect.sync(() => {
      // The reverse test for the naming trap. `% 0` is NaN and `NaN === 0` is
      // false, so the modulo alone happens to give the right answer; the
      // explicit guard is what makes it not a coincidence.
      expect(refractionRunsOnFrame(0, 1)).toBe(false)
      expect(refractionRunsOnFrame(0, 7)).toBe(false)
    }),
  )

  it.effect('returns typed failures for invalid intervals and frame numbers', () =>
    Effect.sync(() => {
      const invalidSchedules = [
        [-1, 1, 'out-of-range'],
        [1.5, 1, 'invalid-integer'],
        [Number.NaN, 1, 'invalid-integer'],
        [1, 0, 'out-of-range'],
        [1, 2.5, 'invalid-integer'],
      ] as const
      for (const [interval, frame, reason] of invalidSchedules) {
        const actual = refractionRunsOnFrameResult(interval, frame)
        const inspected = Schema.decodeUnknownResult(RefractionBooleanResultSchema, {
          onExcessProperty: 'error',
        })(actual)
        expect(Result.isSuccess(inspected)).toBe(true)
        if (Result.isFailure(inspected)) {
          return
        }
        expect(inspected.success).toStrictEqual({
          _tag: 'Failure',
          _op: 'Failure',
          failure: {
            _tag: 'RefractionInputError',
            operation: 'frame-schedule',
            reason,
          },
        })
      }
    }),
  )
})

describe('typed failures for invalid public inputs', () => {
  it.effect('rejects malformed counts, ratios, and thresholds at the ratio gate', () =>
    Effect.sync(() => {
      expect(expectFailure(shouldRunRefractionRatioGateResult(Number.NaN, 0.5, 0.05))).toStrictEqual({
        _tag: 'RefractionInputError', operation: 'ratio-gate', reason: 'invalid-integer',
      })
      expect(expectFailure(shouldRunRefractionRatioGateResult(1, Number.NaN, 0.05))).toStrictEqual({
        _tag: 'RefractionInputError', operation: 'ratio-gate', reason: 'not-finite',
      })
      expect(expectFailure(shouldRunRefractionRatioGateResult(1, -0.01, 0.05))).toStrictEqual({
        _tag: 'RefractionInputError', operation: 'ratio-gate', reason: 'out-of-range',
      })
      expect(expectFailure(shouldRunRefractionRatioGateResult(1, 0.5, 1.01))).toStrictEqual({
        _tag: 'RefractionInputError', operation: 'ratio-gate', reason: 'out-of-range',
      })
      expect(shouldRunRefractionRatioGateResult(0, 1, 0.05)).toStrictEqual(Result.succeed(false))
    }),
  )

  it.effect('rejects a malformed second camera key and unknown skip decisions', () =>
    Effect.sync(() => {
      expect(expectFailure(sameRefractionKeyResult(KEY, { ...KEY, projection14: Number.NaN }))).toStrictEqual({
        _tag: 'RefractionInputError', operation: 'camera-key', reason: 'invalid-input',
      })
      expect(expectFailure(isRefractionSkippedResult('skip:unknown'))).toStrictEqual({
        _tag: 'RefractionInputError', operation: 'description', reason: 'invalid-decision',
      })
    }),
  )

  it.effect('rejects malformed decision inputs and finite but out-of-range values', () =>
    Effect.sync(() => {
      expect(expectFailure(decideRefractionPrePassResult({ ...RUNNING, extra: true }))).toStrictEqual({
        _tag: 'RefractionInputError', operation: 'decision', reason: 'invalid-input',
      })
      expect(expectFailure(decideRefractionPrePassResult({ ...RUNNING, visibleWaterMeshCount: 5 }))).toStrictEqual({
        _tag: 'RefractionInputError', operation: 'decision', reason: 'out-of-range',
      })
    }),
  )
})

describe('the camera key', () => {
  it.effect('matches itself', () =>
    Effect.sync(() => {
      expect(sameRefractionKey(KEY, { ...KEY })).toBe(true)
    }),
  )

  it.effect('every single field invalidates the retained texture', () =>
    Effect.sync(() => {
      // Exhaustive over the key's fields, because a comparison that quietly
      // stopped checking one of them is exactly the bug that shows up as
      // "refraction is sometimes stale" and never reproduces.
      const fields: ReadonlyArray<keyof RefractionCameraKey> = [
        'sceneVersion',
        'worldX',
        'worldY',
        'worldZ',
        'qx',
        'qy',
        'qz',
        'qw',
        'projection0',
        'projection5',
        'projection10',
        'projection14',
      ]
      for (const field of fields) {
        const changed: RefractionCameraKey = { ...KEY, [field]: KEY[field] + 1 }
        expect(sameRefractionKey(KEY, changed), `field ${field}`).toBe(false)
      }
      expect(fields).toHaveLength(12)
    }),
  )

  it.effect('a scene rebuild invalidates it even when the camera has not moved', () =>
    Effect.sync(() => {
      // Without sceneVersion, a player standing still while a chunk finishes
      // meshing keeps refracting the old scene forever.
      expect(sameRefractionKey(KEY, { ...KEY, sceneVersion: KEY.sceneVersion + 1 })).toBe(false)
    }),
  )

  it.effect('rejects a key with a non-finite coordinate', () =>
    Effect.sync(() => {
      const broken = { ...KEY, worldX: Number.NaN }
      const actual = sameRefractionKeyResult(broken, broken)
      const inspected = Schema.decodeUnknownResult(RefractionBooleanResultSchema, {
        onExcessProperty: 'error',
      })(actual)
      expect(Result.isSuccess(inspected)).toBe(true)
      if (Result.isFailure(inspected)) {
        return
      }
      expect(inspected.success).toStrictEqual({
        _tag: 'Failure',
        _op: 'Failure',
        failure: {
          _tag: 'RefractionInputError',
          operation: 'camera-key',
          reason: 'invalid-input',
        },
      })
    }),
  )
})

describe('the screen ratio', () => {
  it.effect('a rect covering the whole viewport is 1', () =>
    Effect.sync(() => {
      expect(screenRatioForNdcRect({ maxX: 1, maxY: 1, minX: -1, minY: -1 })).toBe(1)
      expect(NDC_VIEWPORT_AREA).toBe(4)
    }),
  )

  it.effect('a quarter-viewport rect is a quarter', () =>
    Effect.sync(() => {
      expect(screenRatioForNdcRect({ maxX: 0, maxY: 0, minX: -1, minY: -1 })).toBe(0.25)
    }),
  )

  it.effect('clips the part that is off screen rather than counting it', () =>
    Effect.sync(() => {
      expect(screenRatioForNdcRect({ maxX: 5, maxY: 5, minX: -5, minY: -5 })).toBe(1)
      expect(screenRatioForNdcRect({ maxX: -1, maxY: 1, minX: -3, minY: -1 })).toBe(0)
    }),
  )

  it.effect('rejects an inverted rectangle', () =>
    Effect.sync(() => {
      const actual = screenRatioForNdcRectResult({ maxX: -1, maxY: -1, minX: 1, minY: 1 })
      const inspected = Schema.decodeUnknownResult(RefractionNumberResultSchema, {
        onExcessProperty: 'error',
      })(actual)
      expect(Result.isSuccess(inspected)).toBe(true)
      if (Result.isFailure(inspected)) {
        return
      }
      expect(inspected.success).toStrictEqual({
        _tag: 'Failure',
        _op: 'Failure',
        failure: {
          _tag: 'RefractionInputError',
          operation: 'ndc-rectangle',
          reason: 'reversed-bounds',
        },
      })
    }),
  )
})

describe('the decision', () => {
  it.effect('runs when every gate passes', () =>
    Effect.sync(() => {
      expect(decideRefractionPrePass(RUNNING)).toBe('run')
      expect(isRefractionSkipped('run')).toBe(false)
    }),
  )

  it.effect('the FIRST frame of a session always runs — there is no texture to reuse yet', () =>
    Effect.sync(() => {
      expect(RUNNING.lastRenderedKey).toBeUndefined()
      expect(decideRefractionPrePass(RUNNING)).toBe('run')
    }),
  )

  it.effect('each gate skips for its own reason', () =>
    Effect.sync(() => {
      expect(decideRefractionPrePass({ ...RUNNING, intervalFrames: 0 })).toBe('skip:interval-disabled')
      expect(decideRefractionPrePass({ ...RUNNING, intervalFrames: 2, frameNumber: 2 })).toBe(
        'skip:not-this-frame',
      )
      expect(decideRefractionPrePass({ ...RUNNING, waterMeshCount: 0, visibleWaterMeshCount: 0 })).toBe('skip:no-water-meshes')
      expect(decideRefractionPrePass({ ...RUNNING, visibleWaterMeshCount: 0 })).toBe(
        'skip:no-visible-water',
      )
      expect(decideRefractionPrePass({ ...RUNNING, lastRenderedKey: { ...KEY } })).toBe(
        'skip:camera-and-scene-unchanged',
      )
      expect(decideRefractionPrePass({ ...RUNNING, waterScreenRatio: 0.001 })).toBe(
        'skip:below-screen-ratio',
      )
    }),
  )

  it.effect('a moved camera re-renders even though a previous key exists', () =>
    Effect.sync(() => {
      // The reverse of the cache test: without it, a cache that always reported
      // "unchanged" would pass the gate test above.
      expect(
        decideRefractionPrePass({ ...RUNNING, lastRenderedKey: { ...KEY, worldX: KEY.worldX + 0.01 } }),
      ).toBe('run')
    }),
  )

  it.effect('a minScreenRatio of 0 disables the size gate entirely', () =>
    Effect.sync(() => {
      // world-renderer-refraction.ts:88. No preset uses it; the API permits it.
      expect(
        decideRefractionPrePass({ ...RUNNING, minScreenRatio: 0, waterScreenRatio: 0 }),
      ).toBe('run')
    }),
  )

  it.effect('accepts a custom threshold only inside the screen-ratio domain', () =>
    Effect.sync(() => {
      expect(normalizeRefractionMinScreenRatio(0.25)).toBe(0.25)
      const invalidThresholds = [
        [Number.NaN, 'not-finite'],
        [-0.25, 'out-of-range'],
        [1.25, 'out-of-range'],
        [Number.POSITIVE_INFINITY, 'not-finite'],
      ] as const
      for (const [value, reason] of invalidThresholds) {
        const actual = normalizeRefractionMinScreenRatioResult(value)
        const inspected = Schema.decodeUnknownResult(RefractionNumberResultSchema, {
          onExcessProperty: 'error',
        })(actual)
        expect(Result.isSuccess(inspected)).toBe(true)
        if (Result.isFailure(inspected)) {
          return
        }
        expect(inspected.success._tag).toBe('Failure')
        if (inspected.success._tag === 'Failure') {
          expect(inspected.success.failure).toStrictEqual({
            _tag: 'RefractionInputError',
            operation: 'min-screen-ratio',
            reason,
          })
        }
      }
    }),
  )

  it.effect('every decision has a diagnostic that names its gate', () =>
    Effect.sync(() => {
      const decisions = ['run' as const, ...REFRACTION_GATE_ORDER.map((gate) => `skip:${gate}` as const)]
      for (const decision of decisions) {
        expect(describeRefractionDecision(decision).length).toBeGreaterThan(20)
      }
      expect(decisions).toHaveLength(7)
    }),
  )

  it.effect('property checks expose typed failures for invalid public inputs', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.oneof(
            FastCheck.constantFrom(Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY),
            FastCheck.integer({ min: -1000, max: -1 }).map((value) => value / 1000),
            FastCheck.integer({ min: 1001, max: 2000 }).map((value) => value / 1000),
          ),
          (value) => {
            const actual = normalizeRefractionMinScreenRatioResult(value)
            const inspected = Schema.decodeUnknownResult(RefractionNumberResultSchema, {
              onExcessProperty: 'error',
            })(actual)
            expect(Result.isSuccess(inspected)).toBe(true)
            if (Result.isFailure(inspected)) {
              return
            }
            expect(inspected.success._tag).toBe('Failure')
            if (inspected.success._tag === 'Failure') {
              expect(inspected.success.failure).toStrictEqual({
                _tag: 'RefractionInputError',
                operation: 'min-screen-ratio',
                reason: minScreenRatioFailureReason(value),
              })
            }
          },
        ),
      )
      FastCheck.assert(
        FastCheck.property(FastCheck.integer({ min: -1000, max: -1 }), (interval) => {
          const actual = refractionRunsOnFrameResult(interval, 1)
          const inspected = Schema.decodeUnknownResult(RefractionBooleanResultSchema, {
            onExcessProperty: 'error',
          })(actual)
          expect(Result.isSuccess(inspected)).toBe(true)
          if (Result.isFailure(inspected)) {
            return
          }
          expect(inspected.success).toStrictEqual({
            _tag: 'Failure',
            _op: 'Failure',
            failure: {
              _tag: 'RefractionInputError',
              operation: 'frame-schedule',
              reason: 'out-of-range',
            },
          })
        }),
      )
      FastCheck.assert(
        FastCheck.property(
          FastCheck.constantFrom(Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY),
          (coordinate) => {
            const actual = screenRatioForNdcRectResult({
              maxX: 1,
              maxY: 1,
              minX: coordinate,
              minY: -1,
            })
            const inspected = Schema.decodeUnknownResult(RefractionNumberResultSchema, {
              onExcessProperty: 'error',
            })(actual)
            expect(Result.isSuccess(inspected)).toBe(true)
            if (Result.isFailure(inspected)) {
              return
            }
            expect(inspected.success).toStrictEqual({
              _tag: 'Failure',
              _op: 'Failure',
              failure: {
                _tag: 'RefractionInputError',
                operation: 'ndc-rectangle',
                reason: 'invalid-input',
              },
            })
          },
        ),
      )
      FastCheck.assert(
        FastCheck.property(FastCheck.integer({ min: -1000, max: -1 }), (visibleCount) => {
          const actual = shouldRunRefractionRatioGateResult(visibleCount, 0.05, 0.005)
          const inspected = Schema.decodeUnknownResult(RefractionBooleanResultSchema, {
            onExcessProperty: 'error',
          })(actual)
          expect(Result.isSuccess(inspected)).toBe(true)
          if (Result.isFailure(inspected)) {
            return
          }
          expect(inspected.success).toStrictEqual({
            _tag: 'Failure',
            _op: 'Failure',
            failure: {
              _tag: 'RefractionInputError',
              operation: 'ratio-gate',
              reason: 'out-of-range',
            },
          })
        }),
      )
      const unexpected = Schema.decodeUnknownResult(RefractionNumberResultSchema, {
        onExcessProperty: 'error',
      })({
        _tag: 'Failure',
        _op: 'Failure',
        failure: {
          _tag: 'RefractionInputError',
          operation: 'min-screen-ratio',
          reason: 'out-of-range',
        },
        extra: true,
      })
      expect(Result.isFailure(unexpected)).toBe(true)
      const missing = Schema.decodeUnknownResult(RefractionNumberResultSchema, {
        onExcessProperty: 'error',
      })({ _tag: 'Success', _op: 'Success' })
      expect(Result.isFailure(missing)).toBe(true)
    }),
  )

  it.effect('an unrecognised gate order returns its typed failure', () =>
    Effect.sync(() => {
      const actual = decideRefractionPrePassResult(RUNNING, ['not-a-real-gate'])
      const inspected = Schema.decodeUnknownResult(RefractionDecisionResultSchema, {
        onExcessProperty: 'error',
      })(actual)
      expect(Result.isSuccess(inspected)).toBe(true)
      if (Result.isFailure(inspected)) {
        return
      }
      expect(inspected.success).toStrictEqual({
        _tag: 'Failure',
        _op: 'Failure',
        failure: {
          _tag: 'RefractionInputError',
          operation: 'decision',
          reason: 'invalid-order',
        },
      })
    }),
  )

  it.effect('an unrecognised decision returns its typed failure', () =>
    Effect.sync(() => {
      const actual = describeRefractionDecisionResult('skip:not-a-real-reason')
      const inspected = Schema.decodeUnknownResult(RefractionStringResultSchema, {
        onExcessProperty: 'error',
      })(actual)
      expect(Result.isSuccess(inspected)).toBe(true)
      if (Result.isFailure(inspected)) {
        return
      }
      expect(inspected.success).toStrictEqual({
        _tag: 'Failure',
        _op: 'Failure',
        failure: {
          _tag: 'RefractionInputError',
          operation: 'description',
          reason: 'invalid-decision',
        },
      })
    }),
  )
})

// ---------------------------------------------------------------------------
// LOAD-BEARING. The reorder away from the reference's gate order is only safe
// because the gates are mutually independent. That is a property, so it is
// exhausted rather than argued.
// ---------------------------------------------------------------------------
describe('the gate order changes the reason, never the answer', () => {
  const bothOrders: ReadonlyArray<ReadonlyArray<RefractionGate>> = [
    REFRACTION_GATE_ORDER,
    REFERENCE_REFRACTION_GATE_ORDER,
  ]

  /** Cases where zero, one, or several gates fire at once. */
  const fixtures: ReadonlyArray<RefractionInputs> = [
    RUNNING,
    { ...RUNNING, intervalFrames: 0 },
    { ...RUNNING, intervalFrames: 2, frameNumber: 4 },
    { ...RUNNING, waterMeshCount: 0, visibleWaterMeshCount: 0 },
    { ...RUNNING, visibleWaterMeshCount: 0 },
    { ...RUNNING, waterScreenRatio: 0 },
    { ...RUNNING, lastRenderedKey: { ...KEY } },
    // Two gates fire together: the camera has not moved AND the water is tiny.
    { ...RUNNING, lastRenderedKey: { ...KEY }, waterScreenRatio: 0 },
    // Everything fires at once.
    {
      ...RUNNING,
      intervalFrames: 0,
      waterMeshCount: 0,
      visibleWaterMeshCount: 0,
      waterScreenRatio: 0,
      lastRenderedKey: { ...KEY },
    },
  ]

  it.effect('both declared orders contain exactly the same six gates', () =>
    Effect.sync(() => {
      expect([...REFRACTION_GATE_ORDER].sort()).toStrictEqual([...REFERENCE_REFRACTION_GATE_ORDER].sort())
      expect(REFRACTION_GATE_ORDER).toHaveLength(6)
    }),
  )

  it.effect('and they are NOT the same order — ours puts the cheap cache check first', () =>
    Effect.sync(() => {
      expect(REFRACTION_GATE_ORDER).not.toStrictEqual(REFERENCE_REFRACTION_GATE_ORDER)
      expect(REFRACTION_GATE_ORDER.indexOf('camera-and-scene-unchanged')).toBeLessThan(
        REFRACTION_GATE_ORDER.indexOf('below-screen-ratio'),
      )
      expect(REFERENCE_REFRACTION_GATE_ORDER.indexOf('camera-and-scene-unchanged')).toBeGreaterThan(
        REFERENCE_REFRACTION_GATE_ORDER.indexOf('below-screen-ratio'),
      )
    }),
  )

  it.effect('all 720 permutations agree on run versus skip, for every fixture', () =>
    Effect.sync(() => {
      const orders = permutations(REFRACTION_GATE_ORDER)
      expect(orders).toHaveLength(720)

      for (const fixture of fixtures) {
        const expected = isRefractionSkipped(decideRefractionPrePass(fixture, REFRACTION_GATE_ORDER))
        for (const order of orders) {
          expect(
            isRefractionSkipped(decideRefractionPrePass(fixture, order)),
            `order ${order.join(' > ')}`,
          ).toBe(expected)
        }
      }
    }),
  )

  it.effect('but the REASON does differ when two gates fire — and that is not hidden', () =>
    Effect.sync(() => {
      // Asserting the reasons agreed would be a false claim about what the
      // reorder preserves. This pins the difference instead.
      const both: RefractionInputs = { ...RUNNING, lastRenderedKey: { ...KEY }, waterScreenRatio: 0 }
      expect(decideRefractionPrePass(both, REFRACTION_GATE_ORDER)).toBe(
        'skip:camera-and-scene-unchanged',
      )
      expect(decideRefractionPrePass(both, REFERENCE_REFRACTION_GATE_ORDER)).toBe(
        'skip:below-screen-ratio',
      )
    }),
  )

  it.effect('and both orders still SKIP that case, which is the only part that matters', () =>
    Effect.sync(() => {
      const both: RefractionInputs = { ...RUNNING, lastRenderedKey: { ...KEY }, waterScreenRatio: 0 }
      for (const order of bothOrders) {
        expect(isRefractionSkipped(decideRefractionPrePass(both, order))).toBe(true)
      }
    }),
  )
})
