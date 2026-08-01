/**
 * Tests for the refraction pre-pass decision.
 *
 * The load-bearing one is the last group: all 720 orderings of the six gates
 * agree on run-versus-skip. That is the property the reorder away from the
 * reference's order rests on, and without it the reorder would be an unargued
 * change to a decision that costs a full scene render when it goes wrong.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { QUALITY_PRESETS, type QualityPreset } from '../src/domain/post-processing'
import {
  BEHIND_NEAR_PLANE_RATIO,
  decideRefractionPrePass,
  describeRefractionDecision,
  isRefractionSkipped,
  NDC_VIEWPORT_AREA,
  REFERENCE_REFRACTION_GATE_ORDER,
  REFRACTION_GATE_ORDER,
  REFRACTION_INTERVAL_FRAMES,
  REFRACTION_MIN_SCREEN_RATIO,
  refractionRunsOnFrame,
  sameRefractionKey,
  screenRatioForNdcRect,
  type RefractionCameraKey,
  type RefractionGate,
  type RefractionInputs,
} from '../src/domain/water-refraction'

const KEY: RefractionCameraKey = {
  sceneVersion: 3,
  x: 1,
  y: 2,
  z: 3,
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

  it.effect('refuses intervals and frame numbers that are not positive integers', () =>
    Effect.sync(() => {
      expect(refractionRunsOnFrame(-1, 1)).toBe(false)
      expect(refractionRunsOnFrame(1.5, 1)).toBe(false)
      expect(refractionRunsOnFrame(Number.NaN, 1)).toBe(false)
      expect(refractionRunsOnFrame(1, 0)).toBe(false)
      expect(refractionRunsOnFrame(1, 2.5)).toBe(false)
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
        'x',
        'y',
        'z',
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

  it.effect('a NaN key never matches, including itself', () =>
    Effect.sync(() => {
      const broken: RefractionCameraKey = { ...KEY, x: Number.NaN }
      expect(sameRefractionKey(broken, broken)).toBe(false)
    }),
  )
})

describe('the screen ratio', () => {
  it.effect('a rect covering the whole viewport is 1', () =>
    Effect.sync(() => {
      expect(screenRatioForNdcRect(-1, -1, 1, 1)).toBe(1)
      expect(NDC_VIEWPORT_AREA).toBe(4)
    }),
  )

  it.effect('a quarter-viewport rect is a quarter', () =>
    Effect.sync(() => {
      expect(screenRatioForNdcRect(-1, -1, 0, 0)).toBe(0.25)
    }),
  )

  it.effect('clips the part that is off screen rather than counting it', () =>
    Effect.sync(() => {
      expect(screenRatioForNdcRect(-5, -5, 5, 5)).toBe(1)
      expect(screenRatioForNdcRect(-3, -1, -1, 1)).toBe(0)
    }),
  )

  it.effect('an inverted rect is empty, not negative', () =>
    Effect.sync(() => {
      expect(screenRatioForNdcRect(1, 1, -1, -1)).toBe(0)
    }),
  )

  it.effect('fails toward NOT skipping when the projection is unusable', () =>
    Effect.sync(() => {
      // Standing in water is when refraction matters most, and it is also when
      // the surface AABB straddles the near plane. An estimator that failed
      // toward "skip" would drop the effect exactly there.
      expect(BEHIND_NEAR_PLANE_RATIO).toBe(1)
      expect(screenRatioForNdcRect(Number.NaN, -1, 1, 1)).toBe(BEHIND_NEAR_PLANE_RATIO)
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
      expect(decideRefractionPrePass({ ...RUNNING, waterMeshCount: 0 })).toBe('skip:no-water-meshes')
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
        decideRefractionPrePass({ ...RUNNING, lastRenderedKey: { ...KEY, x: KEY.x + 0.01 } }),
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

  it.effect('every decision has a diagnostic that names its gate', () =>
    Effect.sync(() => {
      const decisions = ['run' as const, ...REFRACTION_GATE_ORDER.map((gate) => `skip:${gate}` as const)]
      for (const decision of decisions) {
        expect(describeRefractionDecision(decision).length).toBeGreaterThan(20)
      }
      expect(decisions).toHaveLength(7)
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
