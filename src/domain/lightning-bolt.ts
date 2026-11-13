import { Brand, Result, Schema } from 'effect'

type LightningPoint = Readonly<{ readonly x: number; readonly y: number; readonly z: number }>

export type LightningSeed = Brand.Branded<number, 'LightningSeed'>
export type LightningSequence = Brand.Branded<number, 'LightningSequence'>
export type LightningFlash = Brand.Branded<number, 'LightningFlash'>

const ZERO = 0
const UNIT_INTERVAL_MAX = 1
const MIN_LIGHTNING_SEQUENCE = 0

export const LightningSeedSchema: Schema.Codec<LightningSeed, number> = Schema.Int
  .pipe(Schema.brand('LightningSeed'))

export const LightningSequenceSchema: Schema.Codec<LightningSequence, number> = Schema.Int
  .check(Schema.isGreaterThanOrEqualTo(MIN_LIGHTNING_SEQUENCE))
  .pipe(Schema.brand('LightningSequence'))

export const LightningFlashSchema: Schema.Codec<LightningFlash, number> = Schema.Finite
  .check(Schema.isBetween({ maximum: UNIT_INTERVAL_MAX, minimum: ZERO }))
  .pipe(Schema.brand('LightningFlash'))

export const decodeLightningFlash = (input: unknown): Result.Result<LightningFlash, Schema.SchemaError> =>
  Schema.decodeUnknownResult(LightningFlashSchema)(input)

export type LightningBoltPlan = Readonly<{
  readonly sequence: LightningSequence
  readonly strands: ReadonlyArray<ReadonlyArray<LightningPoint>>
}>

export type LightningBoltInput = Readonly<{
  readonly origin: LightningPoint
  readonly seed: LightningSeed
  readonly sequence: LightningSequence
}>

const LightningPointSchema: Schema.Codec<LightningPoint> = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  z: Schema.Finite,
})

export const LightningBoltInputSchema: Schema.Codec<LightningBoltInput, Readonly<{
  readonly origin: Readonly<{ readonly x: number; readonly y: number; readonly z: number }>
  readonly seed: number
  readonly sequence: number
}>> = Schema.Struct({
  origin: LightningPointSchema,
  seed: LightningSeedSchema,
  sequence: LightningSequenceSchema,
})

export const decodeLightningBoltInput: (
  input: unknown,
) => Result.Result<LightningBoltInput, Schema.SchemaError> = (input) =>
  Schema.decodeUnknownResult(LightningBoltInputSchema, { onExcessProperty: 'error' })(input)

const LIGHTNING_STRAND_COUNT = 3
const LIGHTNING_SEGMENT_COUNT = 8
const LIGHTNING_HEIGHT = 32
const MAX_STRAND_OFFSET = 5
const MAX_JAGGED_OFFSET = 2.5
const UNIT_INTERVAL_SCALE = 2
const UNIT_INTERVAL_MIN = 1
const ZERO_BASED_INDEX_OFFSET = 1
const FIRST_LIGHTNING_POINT = 0
const FIRST_LIGHTNING_STRAND = 0
const UINT32_UNSIGNED_SHIFT = 0
const INITIAL_HASH_SHIFT = 16
const HASH_FOLD_SHIFT = 15
const UINT32_RANGE = 0x1_0000_0000
const SEED_MULTIPLIER = 0x21f0aaad
const SEQUENCE_MULTIPLIER = 0x735a2d97
const STRAND_MULTIPLIER = 0x85ebca6b
const POINT_MULTIPLIER = 0x68bc21eb

/**
 * XOR, unsigned shifts and `Math.imul` intentionally use 32-bit integer
 * arithmetic to keep a strike's procedural silhouette stable across frames.
 */
type LightningRandomInput = Readonly<{
  readonly seed: number
  readonly sequence: number
  readonly strand: number
  readonly point: number
}>

const random01 = ({ point, seed, sequence, strand }: LightningRandomInput): number => {
  let value = Math.imul(Math.trunc(seed), SEED_MULTIPLIER) ^
    Math.imul(Math.trunc(sequence), SEQUENCE_MULTIPLIER) ^
    Math.imul(strand + ZERO_BASED_INDEX_OFFSET, STRAND_MULTIPLIER) ^
    Math.imul(point + ZERO_BASED_INDEX_OFFSET, POINT_MULTIPLIER)
  value = Math.imul(value ^ (value >>> INITIAL_HASH_SHIFT), SEED_MULTIPLIER)
  value = Math.imul(value ^ (value >>> HASH_FOLD_SHIFT), SEQUENCE_MULTIPLIER)
  return ((value ^ (value >>> HASH_FOLD_SHIFT)) >>> UINT32_UNSIGNED_SHIFT) / UINT32_RANGE
}

const signedOffset = (value: number, range: number): number =>
  (value * UNIT_INTERVAL_SCALE - UNIT_INTERVAL_MIN) * range

type LightningPointInput = Readonly<{
  readonly input: LightningBoltInput
  readonly strand: number
  readonly point: number
  readonly top: LightningPoint
  readonly bottom: LightningPoint
}>

const pointFor = ({ bottom, input, point, strand, top }: LightningPointInput): LightningPoint => {
  if (point === FIRST_LIGHTNING_POINT) {
    return top
  }
  if (point === LIGHTNING_SEGMENT_COUNT) {
    return bottom
  }
  const progress = point / LIGHTNING_SEGMENT_COUNT
  const remaining = UNIT_INTERVAL_MIN - progress
  const jitterX = signedOffset(random01({ point, seed: input.seed, sequence: input.sequence, strand }), MAX_JAGGED_OFFSET)
  const jitterZ = signedOffset(random01({
    point,
    seed: input.seed,
    sequence: input.sequence,
    strand: strand + LIGHTNING_STRAND_COUNT,
  }), MAX_JAGGED_OFFSET)
  return {
    x: top.x * remaining + bottom.x * progress + jitterX,
    y: input.origin.y + LIGHTNING_HEIGHT * remaining,
    z: top.z * remaining + bottom.z * progress + jitterZ,
  }
}

/** Build three deterministic, eight-segment strands around one strike point. */
export const planLightningBolt = (input: LightningBoltInput): LightningBoltPlan => {
  const strands = Array.from({ length: LIGHTNING_STRAND_COUNT }, (_unused, strand) => {
    const top: LightningPoint = {
      x: input.origin.x + signedOffset(random01({
        point: FIRST_LIGHTNING_POINT,
        seed: input.seed,
        sequence: input.sequence,
        strand,
      }), MAX_STRAND_OFFSET),
      y: input.origin.y + LIGHTNING_HEIGHT,
      z: input.origin.z + signedOffset(random01({
        point: ZERO_BASED_INDEX_OFFSET,
        seed: input.seed,
        sequence: input.sequence,
        strand,
      }), MAX_STRAND_OFFSET),
    }
    let bottom: LightningPoint = input.origin
    if (strand !== FIRST_LIGHTNING_STRAND) {
      bottom = {
        x: input.origin.x + signedOffset(random01({
          point: LIGHTNING_SEGMENT_COUNT,
          seed: input.seed,
          sequence: input.sequence,
          strand,
        }), MAX_STRAND_OFFSET),
        y: input.origin.y,
        z: input.origin.z + signedOffset(random01({
          point: LIGHTNING_SEGMENT_COUNT,
          seed: input.seed,
          sequence: input.sequence,
          strand: strand + LIGHTNING_STRAND_COUNT,
        }), MAX_STRAND_OFFSET),
      }
    }
    return Array.from({ length: LIGHTNING_SEGMENT_COUNT + ZERO_BASED_INDEX_OFFSET }, (_point, index) =>
      pointFor({ bottom, input, point: index, strand, top }),
    )
  })
  return { sequence: input.sequence, strands }
}
