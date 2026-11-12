import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import {
  LightningBoltInputSchema,
  LightningFlashSchema,
  LightningSeedSchema,
  LightningSequenceSchema,
  decodeLightningBoltInput,
  decodeLightningFlash,
  planLightningBolt,
} from '../src/domain/lightning-bolt'

describe('lightning input brands', () => {
  it.effect('accepts integer seeds and nonnegative integer sequences across arbitrary values', () =>
    Effect.sync(() => {
      FastCheck.assert(FastCheck.property(FastCheck.integer(), (seed) =>
        Result.isSuccess(Schema.decodeUnknownResult(LightningSeedSchema)(seed))
      ))
      FastCheck.assert(FastCheck.property(FastCheck.nat(), (sequence) =>
        Result.isSuccess(Schema.decodeUnknownResult(LightningSequenceSchema)(sequence))
      ))

      expect(Result.isSuccess(Schema.decodeUnknownResult(LightningSequenceSchema)(0))).toBe(true)
      expect(Result.isSuccess(Schema.decodeUnknownResult(LightningSequenceSchema)(1))).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(LightningSequenceSchema)(-1))).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(LightningSequenceSchema)(0.5))).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(LightningSeedSchema)(Number.POSITIVE_INFINITY))).toBe(true)
    }),
  )

  it.effect('validates flash endpoints and rejects values immediately outside the unit interval', () =>
    Effect.sync(() => {
      expect(Result.isSuccess(decodeLightningFlash(0))).toBe(true)
      expect(Result.isSuccess(decodeLightningFlash(1))).toBe(true)
      expect(Result.isFailure(decodeLightningFlash(-Number.MIN_VALUE))).toBe(true)
      expect(Result.isFailure(decodeLightningFlash(1 + Number.EPSILON))).toBe(true)
      expect(Result.isFailure(decodeLightningFlash(Number.NaN))).toBe(true)
      expect(Result.isFailure(decodeLightningFlash(Number.POSITIVE_INFINITY))).toBe(true)

      FastCheck.assert(FastCheck.property(FastCheck.anything(), (candidate) => {
        const decoded = decodeLightningFlash(candidate)
        return Result.isFailure(decoded) ||
          (Number.isFinite(decoded.success) && decoded.success >= 0 && decoded.success <= 1)
      }))
    }),
  )

  it.effect('decodes raw host input to branded values used by deterministic plans', () =>
    Effect.sync(() => {
      const rawInput = { origin: { x: 4, y: 64, z: -8 }, seed: 17, sequence: 2 }
      const decoded = decodeLightningBoltInput(rawInput)
      expect(Result.isSuccess(decoded)).toBe(true)
      if (Result.isFailure(decoded)) {
        return
      }

      expect(Result.isSuccess(Schema.decodeUnknownResult(LightningBoltInputSchema)(decoded.success))).toBe(true)
      expect(planLightningBolt(decoded.success).strands[0]?.[4]).toStrictEqual({
        x: 0.3429188693407923,
        y: 80,
        z: -6.693482273956761,
      })
      expect(planLightningBolt(decoded.success).sequence).toBe(2)
    }),
  )
})

describe('lightning flash schema', () => {
  it('has the same bounds through its exported Schema codec', () => {
    expect(Result.isSuccess(Schema.decodeUnknownResult(LightningFlashSchema)(0))).toBe(true)
    expect(Result.isSuccess(Schema.decodeUnknownResult(LightningFlashSchema)(1))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(LightningFlashSchema)(-Number.MIN_VALUE))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(LightningFlashSchema)(1 + Number.EPSILON))).toBe(true)
  })
})
