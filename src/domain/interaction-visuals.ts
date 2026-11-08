import { Brand, Result, Schema } from 'effect'

const UNIT_MIN = 0
const UNIT_MAX = 1

export type InteractionUnitValue = Brand.Branded<number, 'InteractionUnitValue'>
export type InteractionRadians = Brand.Branded<number, 'InteractionRadians'>
export type CrackStageIndex = Brand.Branded<number, 'CrackStageIndex'>
export type InteractionCoordinate = Brand.Branded<number, 'InteractionCoordinate'>
export type InteractionVector2 = Brand.Branded<Readonly<{ x: InteractionCoordinate; y: InteractionCoordinate }>, 'InteractionVector2'>
export type InteractionVector3 = Brand.Branded<Readonly<{ x: InteractionCoordinate; y: InteractionCoordinate; z: InteractionCoordinate }>, 'InteractionVector3'>
export type InteractionBox = Readonly<{ min: InteractionVector3; max: InteractionVector3 }>
export type BlockSelectionShape = Readonly<{ boxes: ReadonlyArray<InteractionBox> }>

type InteractionVector2Encoded = Readonly<{ x: number; y: number }>
type InteractionVector3Encoded = Readonly<{ x: number; y: number; z: number }>
type InteractionBoxEncoded = Readonly<{ min: InteractionVector3Encoded; max: InteractionVector3Encoded }>
type BlockSelectionShapeEncoded = Readonly<{ boxes: ReadonlyArray<InteractionBoxEncoded> }>

const makeInteractionUnitValue = Brand.nominal<InteractionUnitValue>()
const makeInteractionRadians = Brand.nominal<InteractionRadians>()
const makeCrackStageIndex = Brand.nominal<CrackStageIndex>()
const makeInteractionCoordinate = Brand.nominal<InteractionCoordinate>()
const makeInteractionVector2Value = Brand.nominal<InteractionVector2>()
const makeInteractionVector3Value = Brand.nominal<InteractionVector3>()
export const makeInteractionVector2: (value: InteractionVector2Encoded) => InteractionVector2 = ({ x, y }) =>
  makeInteractionVector2Value({ x: makeInteractionCoordinate(x), y: makeInteractionCoordinate(y) })
export const makeInteractionVector3: (value: InteractionVector3Encoded) => InteractionVector3 = ({ x, y, z }) =>
  makeInteractionVector3Value({
    x: makeInteractionCoordinate(x),
    y: makeInteractionCoordinate(y),
    z: makeInteractionCoordinate(z),
  })

const InteractionUnitValueSchema: Schema.Codec<InteractionUnitValue, number> = Schema.Finite.pipe(
  Schema.brand('InteractionUnitValue'),
)
const InteractionRadiansSchema: Schema.Codec<InteractionRadians, number> = Schema.Finite.pipe(
  Schema.brand('InteractionRadians'),
)
const CrackStageIndexSchema: Schema.Codec<CrackStageIndex, number> = Schema.Int.pipe(
  Schema.brand('CrackStageIndex'),
)
const InteractionCoordinateSchema: Schema.Codec<InteractionCoordinate, number> = Schema.Finite.pipe(
  Schema.brand('InteractionCoordinate'),
)

export const InteractionVector2Schema: Schema.Codec<InteractionVector2, Readonly<{ x: number; y: number }>> = Schema.Struct({
  x: InteractionCoordinateSchema,
  y: InteractionCoordinateSchema,
}).pipe(Schema.brand('InteractionVector2'))

export const InteractionVector3Schema: Schema.Codec<InteractionVector3, Readonly<{ x: number; y: number; z: number }>> = Schema.Struct({
  x: InteractionCoordinateSchema,
  y: InteractionCoordinateSchema,
  z: InteractionCoordinateSchema,
}).pipe(Schema.brand('InteractionVector3'))

export const InteractionBoxSchema: Schema.Codec<InteractionBox, InteractionBoxEncoded> = Schema.Struct({
  max: InteractionVector3Schema,
  min: InteractionVector3Schema,
})

export const BlockSelectionShapeSchema: Schema.Codec<BlockSelectionShape, BlockSelectionShapeEncoded> = Schema.Struct({
  boxes: Schema.Array(InteractionBoxSchema),
})

export type InteractionVisualInputError = Readonly<{
  _tag: 'InteractionVisualInputError'
  operation: 'selection-outline' | 'crack-stage' | 'first-person-pose' | 'damage-feedback' | 'interaction-frame'
  reason: 'invalid-input' | 'not-finite' | 'out-of-range' | 'empty-shape' | 'invalid-bounds' | 'invalid-position' | 'disposed'
}>

export const InteractionVisualInputErrorSchema: Schema.Codec<InteractionVisualInputError> = Schema.Struct({
  _tag: Schema.Literal('InteractionVisualInputError'),
  operation: Schema.Literals([
    'selection-outline',
    'crack-stage',
    'first-person-pose',
    'damage-feedback',
    'interaction-frame',
  ]),
  reason: Schema.Literals([
    'invalid-input',
    'not-finite',
    'out-of-range',
    'empty-shape',
    'invalid-bounds',
    'invalid-position',
    'disposed',
  ]),
})

const inputError = (
  operation: InteractionVisualInputError['operation'],
  reason: InteractionVisualInputError['reason'],
): InteractionVisualInputError => ({
  _tag: 'InteractionVisualInputError',
  operation,
  reason,
})

const decodeFailure = <TValue, TEncoded>(schema: Schema.Codec<TValue, TEncoded>, input: unknown): Result.Result<TValue, Schema.SchemaError> =>
  Schema.decodeUnknownResult(schema, { onExcessProperty: 'error' })(input)

export type SelectionOutlineSegment = Readonly<{
  start: InteractionVector3
  end: InteractionVector3
}>

export type SelectionOutlinePlan = Readonly<{
  segments: ReadonlyArray<SelectionOutlineSegment>
}>

const SelectionOutlineSegmentSchema: Schema.Codec<SelectionOutlineSegment, Readonly<{ start: InteractionVector3Encoded; end: InteractionVector3Encoded }>> = Schema.Struct({
  end: InteractionVector3Schema,
  start: InteractionVector3Schema,
})

export const SelectionOutlinePlanSchema: Schema.Codec<SelectionOutlinePlan, Readonly<{ segments: ReadonlyArray<Schema.Codec.Encoded<typeof SelectionOutlineSegmentSchema>> }>> = Schema.Struct({
  segments: Schema.Array(SelectionOutlineSegmentSchema),
})

type SelectionOutlineInput = Readonly<{ blockPosition: InteractionVector3; shape: BlockSelectionShape }>

const SelectionOutlineInputSchema: Schema.Codec<SelectionOutlineInput, Readonly<{ blockPosition: InteractionVector3Encoded; shape: BlockSelectionShapeEncoded }>> = Schema.Struct({
  blockPosition: InteractionVector3Schema,
  shape: BlockSelectionShapeSchema,
})

const CORNER_MIN = 0
const CORNER_MAX = 1
type CornerBits = readonly [number, number, number]

const CORNER_000: CornerBits = [CORNER_MIN, CORNER_MIN, CORNER_MIN]
const CORNER_100: CornerBits = [CORNER_MAX, CORNER_MIN, CORNER_MIN]
const CORNER_110: CornerBits = [CORNER_MAX, CORNER_MAX, CORNER_MIN]
const CORNER_010: CornerBits = [CORNER_MIN, CORNER_MAX, CORNER_MIN]
const CORNER_001: CornerBits = [CORNER_MIN, CORNER_MIN, CORNER_MAX]
const CORNER_101: CornerBits = [CORNER_MAX, CORNER_MIN, CORNER_MAX]
const CORNER_111: CornerBits = [CORNER_MAX, CORNER_MAX, CORNER_MAX]
const CORNER_011: CornerBits = [CORNER_MIN, CORNER_MAX, CORNER_MAX]

const BOX_EDGES: ReadonlyArray<readonly [CornerBits, CornerBits]> = [
  [CORNER_000, CORNER_100],
  [CORNER_100, CORNER_110],
  [CORNER_110, CORNER_010],
  [CORNER_010, CORNER_000],
  [CORNER_001, CORNER_101],
  [CORNER_101, CORNER_111],
  [CORNER_111, CORNER_011],
  [CORNER_011, CORNER_001],
  [CORNER_000, CORNER_001],
  [CORNER_100, CORNER_101],
  [CORNER_110, CORNER_111],
  [CORNER_010, CORNER_011],
]

const cornerFor = (box: InteractionBox, position: InteractionVector3, bits: readonly [number, number, number]): InteractionVector3 => {
  const [xBit, yBit, zBit] = bits
  return makeInteractionVector3({
    x: position.x + box.min.x + xBit * (box.max.x - box.min.x),
    y: position.y + box.min.y + yBit * (box.max.y - box.min.y),
    z: position.z + box.min.z + zBit * (box.max.z - box.min.z),
  })
}

const pointKey = (point: InteractionVector3): string => `${point.x},${point.y},${point.z}`

const segmentKey = (start: InteractionVector3, end: InteractionVector3): string => {
  const startKey = pointKey(start)
  const endKey = pointKey(end)
  if (startKey < endKey) {
    return `${startKey}|${endKey}`
  }
  return `${endKey}|${startKey}`
}

const inUnitBox = (point: InteractionVector3): boolean =>
  point.x >= UNIT_MIN && point.x <= UNIT_MAX &&
  point.y >= UNIT_MIN && point.y <= UNIT_MAX &&
  point.z >= UNIT_MIN && point.z <= UNIT_MAX

const boundsAreOrdered = (box: InteractionBox): boolean =>
  box.min.x < box.max.x && box.min.y < box.max.y && box.min.z < box.max.z

const validateSelectionPosition = (position: InteractionVector3): Result.Result<void, InteractionVisualInputError> => {
  if (![position.x, position.y, position.z].every(Number.isSafeInteger)) {
    return Result.fail(inputError('selection-outline', 'invalid-position'))
  }
  return Result.succeed(undefined)
}

const validateSelectionBox = (box: InteractionBox): Result.Result<void, InteractionVisualInputError> => {
  if (!boundsAreOrdered(box)) {
    return Result.fail(inputError('selection-outline', 'invalid-bounds'))
  }
  if (!inUnitBox(box.min) || !inUnitBox(box.max)) {
    return Result.fail(inputError('selection-outline', 'out-of-range'))
  }
  return Result.succeed(undefined)
}

const validateSelectionBoxes = (boxes: ReadonlyArray<InteractionBox>): Result.Result<void, InteractionVisualInputError> => {
  for (const box of boxes) {
    const validation = validateSelectionBox(box)
    if (Result.isFailure(validation)) {
      return Result.fail(validation.failure)
    }
  }
  return Result.succeed(undefined)
}

const validateSelectionOutline = (
  input: SelectionOutlineInput,
): Result.Result<SelectionOutlineInput, InteractionVisualInputError> => {
  const { blockPosition, shape } = input
  if (shape.boxes.length === UNIT_MIN) {
    return Result.fail(inputError('selection-outline', 'empty-shape'))
  }
  const positionValidation = validateSelectionPosition(blockPosition)
  if (Result.isFailure(positionValidation)) {
    return Result.fail(positionValidation.failure)
  }
  const boxesValidation = validateSelectionBoxes(shape.boxes)
  if (Result.isFailure(boxesValidation)) {
    return Result.fail(boxesValidation.failure)
  }
  return Result.succeed(input)
}

const buildSelectionSegments = ({ blockPosition, shape }: SelectionOutlineInput): SelectionOutlinePlan => {
  const uniqueSegments = new Map<string, SelectionOutlineSegment>()
  for (const box of shape.boxes) {
    for (const [startBits, endBits] of BOX_EDGES) {
      const start = cornerFor(box, blockPosition, startBits)
      const end = cornerFor(box, blockPosition, endBits)
      uniqueSegments.set(segmentKey(start, end), { end, start })
    }
  }
  return { segments: [...uniqueSegments.values()] }
}

export const planSelectionOutline = (
  shape: unknown,
  blockPosition: unknown,
): Result.Result<SelectionOutlinePlan, InteractionVisualInputError> => {
  const decoded = decodeFailure(SelectionOutlineInputSchema, { blockPosition, shape })
  if (Result.isFailure(decoded)) {
    return Result.fail(inputError('selection-outline', 'invalid-input'))
  }
  const validated = validateSelectionOutline(decoded.success)
  if (Result.isFailure(validated)) {
    return Result.fail(validated.failure)
  }
  return Result.succeed(buildSelectionSegments(validated.success))
}

export type CrackStagePlan = Readonly<{
  stage: CrackStageIndex
  opacity: InteractionUnitValue
}>

export const CrackStagePlanSchema: Schema.Codec<CrackStagePlan, Readonly<{ stage: number; opacity: number }>> = Schema.Struct({
  opacity: InteractionUnitValueSchema,
  stage: CrackStageIndexSchema,
})

const CRACK_STAGE_COUNT = 10
const CRACK_BASE_OPACITY = 0.16
const CRACK_OPACITY_RANGE = 0.64

export const planCrackStage = (progress: unknown): Result.Result<CrackStagePlan, InteractionVisualInputError> => {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) {
    return Result.fail(inputError('crack-stage', 'not-finite'))
  }
  if (progress < UNIT_MIN || progress > UNIT_MAX) {
    return Result.fail(inputError('crack-stage', 'out-of-range'))
  }
  if (progress === UNIT_MIN) {
  return Result.succeed({ opacity: makeInteractionUnitValue(UNIT_MIN), stage: makeCrackStageIndex(UNIT_MIN) })
  }
  const stage = Math.ceil(progress * CRACK_STAGE_COUNT)
  const opacity = CRACK_BASE_OPACITY + (stage / CRACK_STAGE_COUNT) * CRACK_OPACITY_RANGE
  return Result.succeed({ opacity: makeInteractionUnitValue(opacity), stage: makeCrackStageIndex(stage) })
}

export type FirstPersonAction = 'idle' | 'attack' | 'mine' | 'place'

export type FirstPersonMotionInput = Readonly<{
  action: FirstPersonAction
  actionProgress: InteractionUnitValue
  movementIntensity: InteractionUnitValue
  gaitPhaseRadians: InteractionRadians
  reducedMotion: boolean
}>

export type FirstPersonPose = Readonly<{
  offset: InteractionVector3
  rotation: InteractionVector3
}>

const FirstPersonMotionInputSchema: Schema.Codec<FirstPersonMotionInput, Readonly<{ action: FirstPersonAction; actionProgress: number; gaitPhaseRadians: number; movementIntensity: number; reducedMotion: boolean }>> = Schema.Struct({
  action: Schema.Literals(['idle', 'attack', 'mine', 'place']),
  actionProgress: InteractionUnitValueSchema,
  gaitPhaseRadians: InteractionRadiansSchema,
  movementIntensity: InteractionUnitValueSchema,
  reducedMotion: Schema.Boolean,
})

export const FirstPersonPoseSchema: Schema.Codec<FirstPersonPose, Readonly<{ offset: InteractionVector3Encoded; rotation: InteractionVector3Encoded }>> = Schema.Struct({
  offset: InteractionVector3Schema,
  rotation: InteractionVector3Schema,
})

const HAND_REST_X = 0.42
const HAND_REST_Y = -0.38
const HAND_REST_Z = -0.72
const WALK_BOB_X = 0.018
const WALK_BOB_Y = 0.035
const WALK_ROLL = 0.025
const REDUCED_ACTION_FACTOR = 0.5
const WALK_VERTICAL_FREQUENCY = 2
const ACTION_HALF_CYCLE_RADIANS = Math.PI

type ActionPoseProfile = Readonly<{
  dropDistance: number
  forwardDistance: number
  swingAngle: number
  twistAngle: number
}>

const ACTION_POSE_PROFILES: Readonly<Record<FirstPersonAction, ActionPoseProfile>> = {
  attack: { dropDistance: 0.12, forwardDistance: 0.12, swingAngle: 0.85, twistAngle: 0.15 },
  idle: { dropDistance: 0, forwardDistance: 0, swingAngle: 0, twistAngle: 0 },
  mine: { dropDistance: 0.18, forwardDistance: 0.07, swingAngle: 1.1, twistAngle: 0 },
  place: { dropDistance: 0.025, forwardDistance: 0.11, swingAngle: 0.28, twistAngle: -0.08 },
}

const isUnitValue = (value: number): boolean => value >= UNIT_MIN && value <= UNIT_MAX

const decodeFirstPersonMotion = (input: unknown): Result.Result<FirstPersonMotionInput, InteractionVisualInputError> => {
  const decoded = decodeFailure(FirstPersonMotionInputSchema, input)
  if (Result.isFailure(decoded)) {
    return Result.fail(inputError('first-person-pose', 'invalid-input'))
  }
  const motion = decoded.success
  if (!isUnitValue(motion.actionProgress) || !isUnitValue(motion.movementIntensity)) {
    return Result.fail(inputError('first-person-pose', 'out-of-range'))
  }
  return Result.succeed(motion)
}

const movementIntensityFor = (motion: FirstPersonMotionInput): number => {
  if (motion.reducedMotion) {
    return UNIT_MIN
  }
  return motion.movementIntensity
}

const actionFactorFor = (motion: FirstPersonMotionInput): number => {
  if (motion.reducedMotion) {
    return REDUCED_ACTION_FACTOR
  }
  return UNIT_MAX
}

const buildFirstPersonPose = (motion: FirstPersonMotionInput): FirstPersonPose => {
  const movement = movementIntensityFor(motion)
  const actionFactor = actionFactorFor(motion)
  const gaitX = Math.cos(motion.gaitPhaseRadians) * movement
  const gaitY = Math.sin(motion.gaitPhaseRadians * WALK_VERTICAL_FREQUENCY) * movement
  const swing = Math.sin(motion.actionProgress * ACTION_HALF_CYCLE_RADIANS) * actionFactor
  const actionProfile = ACTION_POSE_PROFILES[motion.action]
  const actionDrop = swing * actionProfile.dropDistance
  const actionReach = swing * actionProfile.forwardDistance
  const pose: FirstPersonPose = {
    offset: makeInteractionVector3({
      x: HAND_REST_X + gaitX * WALK_BOB_X,
      y: HAND_REST_Y + gaitY * WALK_BOB_Y - actionDrop,
      z: HAND_REST_Z - actionReach,
    }),
    rotation: makeInteractionVector3({
      x: swing * actionProfile.swingAngle,
      y: gaitX * WALK_ROLL,
      z: gaitX * WALK_ROLL + swing * actionProfile.twistAngle,
    }),
  }
  return pose
}

export const planFirstPersonPose = (input: unknown): Result.Result<FirstPersonPose, InteractionVisualInputError> => {
  const motion = decodeFirstPersonMotion(input)
  if (Result.isFailure(motion)) {
    return Result.fail(motion.failure)
  }
  return Result.succeed(buildFirstPersonPose(motion.success))
}

export type DamageFeedbackInput = Readonly<{
  intensity: InteractionUnitValue
  attackDirection: InteractionVector2
  reducedMotion: boolean
}>

export type DamageFeedbackPlan = Readonly<{
  flashOpacity: InteractionUnitValue
  /** The host applies this roll to the active world camera; cameraObject contains overlays only. */
  cameraRollRadians: InteractionRadians
  directionAngleRadians: InteractionRadians
}>

const DamageFeedbackInputSchema: Schema.Codec<DamageFeedbackInput, Readonly<{ attackDirection: InteractionVector2Encoded; intensity: number; reducedMotion: boolean }>> = Schema.Struct({
  attackDirection: InteractionVector2Schema,
  intensity: InteractionUnitValueSchema,
  reducedMotion: Schema.Boolean,
})

export const DamageFeedbackPlanSchema: Schema.Codec<DamageFeedbackPlan, Readonly<{ cameraRollRadians: number; directionAngleRadians: number; flashOpacity: number }>> = Schema.Struct({
  cameraRollRadians: InteractionRadiansSchema,
  directionAngleRadians: InteractionRadiansSchema,
  flashOpacity: InteractionUnitValueSchema,
})

const DAMAGE_MAX_FLASH_OPACITY = 0.48
const DAMAGE_MAX_TILT_RADIANS = 0.14
const REDUCED_DAMAGE_TILT_FACTOR = 0.25

type ValidDamageInput = Readonly<{
  input: DamageFeedbackInput
  directionLength: number
}>

const decodeDamageInput = (input: unknown): Result.Result<ValidDamageInput, InteractionVisualInputError> => {
  const decoded = decodeFailure(DamageFeedbackInputSchema, input)
  if (Result.isFailure(decoded)) {
    return Result.fail(inputError('damage-feedback', 'invalid-input'))
  }
  const { attackDirection, intensity } = decoded.success
  if (!isUnitValue(intensity)) {
    return Result.fail(inputError('damage-feedback', 'out-of-range'))
  }
  const directionLength = Math.hypot(attackDirection.x, attackDirection.y)
  if (intensity > UNIT_MIN && directionLength === UNIT_MIN) {
    return Result.fail(inputError('damage-feedback', 'invalid-input'))
  }
  return Result.succeed({ directionLength, input: decoded.success })
}

const normalizeAttackDirection = ({ input: { attackDirection }, directionLength }: ValidDamageInput): InteractionVector2 => {
  if (directionLength === UNIT_MIN) {
    return makeInteractionVector2({ x: UNIT_MIN, y: UNIT_MIN })
  }
  return makeInteractionVector2({ x: attackDirection.x / directionLength, y: attackDirection.y / directionLength })
}

const damageMotionFactor = (reducedMotion: boolean): number => {
  if (reducedMotion) {
    return REDUCED_DAMAGE_TILT_FACTOR
  }
  return UNIT_MAX
}

const signedCameraRoll = (rollMagnitude: number): number => {
  if (rollMagnitude === UNIT_MIN) {
    return UNIT_MIN
  }
  return -rollMagnitude
}

const buildDamageFeedbackPlan = (validInput: ValidDamageInput): DamageFeedbackPlan => {
  const { input: { intensity, reducedMotion } } = validInput
  const normalizedDirection = normalizeAttackDirection(validInput)
  const rollMagnitude = normalizedDirection.x * DAMAGE_MAX_TILT_RADIANS * intensity * damageMotionFactor(reducedMotion)
  return {
    cameraRollRadians: makeInteractionRadians(signedCameraRoll(rollMagnitude)),
    directionAngleRadians: makeInteractionRadians(Math.atan2(normalizedDirection.y, normalizedDirection.x)),
    flashOpacity: makeInteractionUnitValue(DAMAGE_MAX_FLASH_OPACITY * intensity),
  }
}

export const planDamageFeedback = (input: unknown): Result.Result<DamageFeedbackPlan, InteractionVisualInputError> => {
  const validInput = decodeDamageInput(input)
  if (Result.isFailure(validInput)) {
    return Result.fail(validInput.failure)
  }
  return Result.succeed(buildDamageFeedbackPlan(validInput.success))
}
