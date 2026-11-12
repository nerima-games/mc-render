import {
  type AnimationClockInput,
  type AnimationClockInputError,
  type AnimationSeconds,
  PartialTickSchema,
  TimeOfDayTicksSchema,
  animationTimeSeconds,
} from './animation-clock.js'
import { Brand, Result, Schema } from 'effect'
import { SimulationTickSchema, type WorldPosition, WorldPositionSchema } from '@nerima-games/mc-kernel'

export type EntityRenderIdentifier = Brand.Branded<string, 'EntityRenderIdentifier'>
export type EntityRenderKind = Brand.Branded<string, 'EntityRenderKind'>
export type EntityRenderYawRadians = Brand.Branded<number, 'EntityRenderYawRadians'>
export type EntityRenderPitchRadians = Brand.Branded<number, 'EntityRenderPitchRadians'>
export type EntityRenderWalkPhaseRadians = Brand.Branded<number, 'EntityRenderWalkPhaseRadians'>
export type EntityRenderProgress = Brand.Branded<number, 'EntityRenderProgress'>
export type EntityRenderLightLevel = Brand.Branded<number, 'EntityRenderLightLevel'>

const MINIMUM_ENTITY_ANGLE_RADIANS = -Math.PI
const MAXIMUM_ENTITY_ANGLE_RADIANS = Math.PI
const HALF_TURN_DIVISOR = 2
const MINIMUM_PITCH_RADIANS = -Math.PI / HALF_TURN_DIVISOR
const MAXIMUM_PITCH_RADIANS = Math.PI / HALF_TURN_DIVISOR
const MINIMUM_WALK_PHASE_RADIANS = 0
const WALK_PHASE_RADIANS_PER_CYCLE = HALF_TURN_DIVISOR * Math.PI
const MINIMUM_IDENTIFIER_LENGTH = 1
const MINIMUM_PROGRESS = 0
const MAXIMUM_PROGRESS = 1
const MINIMUM_LIGHT_LEVEL = 0
const MAXIMUM_LIGHT_LEVEL = 15

/** Entity IDs and kinds are non-empty host identifiers; this module does not depend on gameplay types. */
export const EntityRenderIdentifierSchema: Schema.Codec<EntityRenderIdentifier, string> = Schema.String
  .check(Schema.isMinLength(MINIMUM_IDENTIFIER_LENGTH))
  .pipe(Schema.brand('EntityRenderIdentifier'))

export const EntityRenderKindSchema: Schema.Codec<EntityRenderKind, string> = Schema.String
  .check(Schema.isMinLength(MINIMUM_IDENTIFIER_LENGTH))
  .pipe(Schema.brand('EntityRenderKind'))

/** Yaw values are radians in the canonical inclusive range [-π, π]. */
export const EntityRenderYawRadiansSchema: Schema.Codec<EntityRenderYawRadians, number> = Schema.Finite
  .check(Schema.isBetween({ maximum: MAXIMUM_ENTITY_ANGLE_RADIANS, minimum: MINIMUM_ENTITY_ANGLE_RADIANS }))
  .pipe(Schema.brand('EntityRenderYawRadians'))

/** Pitch is radians in the inclusive range [-π/2, π/2]. */
export const EntityRenderPitchRadiansSchema: Schema.Codec<EntityRenderPitchRadians, number> = Schema.Finite
  .check(Schema.isBetween({ maximum: MAXIMUM_PITCH_RADIANS, minimum: MINIMUM_PITCH_RADIANS }))
  .pipe(Schema.brand('EntityRenderPitchRadians'))

/** The gait phase is radians in [0, 2π), with one value per point in the cycle. */
export const EntityRenderWalkPhaseRadiansSchema: Schema.Codec<EntityRenderWalkPhaseRadians, number> = Schema.Finite
  .check(Schema.makeFilter<number>((value) =>
    value >= MINIMUM_WALK_PHASE_RADIANS && value < WALK_PHASE_RADIANS_PER_CYCLE ||
    'Walk phase must be in [0, 2π)',
  ))
  .pipe(Schema.brand('EntityRenderWalkPhaseRadians'))

/** Walk amount and attack, hurt, and death progress are normalized values in [0, 1]. */
export const EntityRenderProgressSchema: Schema.Codec<EntityRenderProgress, number> = Schema.Finite
  .check(Schema.isBetween({ maximum: MAXIMUM_PROGRESS, minimum: MINIMUM_PROGRESS }))
  .pipe(Schema.brand('EntityRenderProgress'))

/** Block and sky light are separate Minecraft light levels, each an integer in [0, 15]. */
export const EntityRenderLightLevelSchema: Schema.Codec<EntityRenderLightLevel, number> = Schema.Int
  .check(Schema.isBetween({ maximum: MAXIMUM_LIGHT_LEVEL, minimum: MINIMUM_LIGHT_LEVEL }))
  .pipe(Schema.brand('EntityRenderLightLevel'))

export type EntityRenderEntityInput = Readonly<{
  readonly id: EntityRenderIdentifier
  readonly kind: EntityRenderKind
  readonly position: WorldPosition
  readonly bodyYawRadians: EntityRenderYawRadians
  readonly headYawRadians: EntityRenderYawRadians
  readonly pitchRadians: EntityRenderPitchRadians
  readonly blockLight: EntityRenderLightLevel
  readonly skyLight: EntityRenderLightLevel
  readonly walkPhaseRadians: EntityRenderWalkPhaseRadians
  readonly walkAmount: EntityRenderProgress
  readonly attackProgress: EntityRenderProgress
  readonly hurtProgress: EntityRenderProgress
  readonly deathProgress: EntityRenderProgress
}>

type EntityRenderEntityInputEncoded = Readonly<{
  readonly id: string
  readonly kind: string
  readonly position: Schema.Codec.Encoded<typeof WorldPositionSchema>
  readonly bodyYawRadians: number
  readonly headYawRadians: number
  readonly pitchRadians: number
  readonly blockLight: number
  readonly skyLight: number
  readonly walkPhaseRadians: number
  readonly walkAmount: number
  readonly attackProgress: number
  readonly hurtProgress: number
  readonly deathProgress: number
}>

export const EntityRenderEntityInputSchema: Schema.Codec<
  EntityRenderEntityInput,
  EntityRenderEntityInputEncoded
> = Schema.Struct({
  attackProgress: EntityRenderProgressSchema,
  blockLight: EntityRenderLightLevelSchema,
  bodyYawRadians: EntityRenderYawRadiansSchema,
  deathProgress: EntityRenderProgressSchema,
  headYawRadians: EntityRenderYawRadiansSchema,
  hurtProgress: EntityRenderProgressSchema,
  id: EntityRenderIdentifierSchema,
  kind: EntityRenderKindSchema,
  pitchRadians: EntityRenderPitchRadiansSchema,
  position: WorldPositionSchema,
  skyLight: EntityRenderLightLevelSchema,
  walkAmount: EntityRenderProgressSchema,
  walkPhaseRadians: EntityRenderWalkPhaseRadiansSchema,
})

export type EntityRenderFrameInput = AnimationClockInput & Readonly<{
  readonly entities: ReadonlyArray<EntityRenderEntityInput>
}>

type EntityRenderFrameInputEncoded = Readonly<{
  readonly simulationTick: number
  readonly partialTick: number
  readonly timeOfDayTicks: number
  readonly entities: ReadonlyArray<EntityRenderEntityInputEncoded>
}>

/** A complete frame uses the shared simulation clock plus all render-ready entity state. */
export const EntityRenderFrameInputSchema: Schema.Codec<
  EntityRenderFrameInput,
  EntityRenderFrameInputEncoded
> = Schema.Struct({
  entities: Schema.Array(EntityRenderEntityInputSchema),
  partialTick: PartialTickSchema,
  simulationTick: SimulationTickSchema,
  timeOfDayTicks: TimeOfDayTicksSchema,
})

/** Decoders reject unknown fields at every nested object boundary. */
export const decodeEntityRenderEntityInput: (
  input: unknown,
) => Result.Result<EntityRenderEntityInput, Schema.SchemaError> = Schema.decodeUnknownResult(
  EntityRenderEntityInputSchema,
  { onExcessProperty: 'error' },
)

export const decodeEntityRenderFrameInput: (
  input: unknown,
) => Result.Result<EntityRenderFrameInput, Schema.SchemaError> = Schema.decodeUnknownResult(
  EntityRenderFrameInputSchema,
  { onExcessProperty: 'error' },
)

export type SampledEntityRenderFrame = Readonly<{
  readonly frame: EntityRenderFrameInput
  readonly animationSeconds: AnimationSeconds
}>

/** Validate a host frame and derive animation time from simulation ticks, without render-delta accumulation. */
export const sampleEntityRenderFrame = (
  input: unknown,
): Result.Result<SampledEntityRenderFrame, Schema.SchemaError | AnimationClockInputError> => {
  const frame = decodeEntityRenderFrameInput(input)
  if (Result.isFailure(frame)) {
    return Result.fail(frame.failure)
  }

  const animationSeconds = animationTimeSeconds(frame.success)
  if (Result.isFailure(animationSeconds)) {
    return Result.fail(animationSeconds.failure)
  }

  return Result.succeed({ animationSeconds: animationSeconds.success, frame: frame.success })
}
