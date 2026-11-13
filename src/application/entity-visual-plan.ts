import type {
  EntityModelKind,
  EntityModelPartDescriptor,
  EntityModelPartIdentifier,
  EntityModelPartRole,
} from '../domain/entity-models/types.js'
import {
  type EntityModelResolutionIssue,
  decodeEntityModelKind,
  entityModelForKind,
} from '../domain/entity-model-catalog.js'
import {
  type EntityTextureResolutionIssue,
  type EntityTextureUvCoordinates,
  entityTextureUvForKind,
} from '../domain/entity-model-textures.js'
import {
  MOB_VISUAL_KINDS,
  type MobAnimationInput,
  type MobVisualKind,
  type MobVisualPartPlan,
  planMobVisual,
} from '../domain/mob-visual.js'
import { Result, Schema } from 'effect'
import {
  type WitherSkullVisualInput,
  type WitherVisualPartDescriptor,
  type WitherVisualPosition,
  type WitherVisualStateInput,
  planWitherSkullVisual,
  planWitherVisual,
} from '../domain/wither-visual.js'

/** Coarse render policy without importing simulation entity classes. */
export type EntityRenderCategory = 'hostile' | 'passive' | 'item'

/** The renderer-owned entity projection consumed by compose. */
type RenderEntity = {
  readonly id: string
  readonly kind: string
  readonly feetPosition: {
    readonly x: number
    readonly y: number
    readonly z: number
  }
  readonly category?: EntityRenderCategory
  /** Body orientation from a validated host frame, in radians. */
  readonly bodyYawRadians?: number
  /** Head orientation from a validated host frame, in radians. */
  readonly headYawRadians?: number
  /** Head pitch from a validated host frame, in radians. */
  readonly pitchRadians?: number
  /** Horizontal world-space orientation, in radians. */
  readonly facingRadians?: number
  /** Pure animation input used to derive part transforms deterministically. */
  readonly animation?: MobAnimationInput
  /** State projection for a `wither` entity, compatible with mc-sim. */
  readonly witherState?: WitherVisualStateInput
  /** Projectile projection for a `wither_skull` entity, compatible with mc-sim. */
  readonly witherSkullProjectile?: WitherSkullVisualInput
}

/** `entity.category`, present only when the source entity has one. */
const copiedCategory = (entity: RenderEntity): Pick<RenderEntity, 'category'> => {
  if (typeof entity.category === 'undefined') {
    return {}
  }
  return { category: entity.category }
}

const copiedBodyYawRadians = (entity: RenderEntity): Pick<RenderEntity, 'bodyYawRadians'> => {
  if (typeof entity.bodyYawRadians === 'undefined') {
    return {}
  }
  return { bodyYawRadians: entity.bodyYawRadians }
}

const copiedHeadYawRadians = (entity: RenderEntity): Pick<RenderEntity, 'headYawRadians'> => {
  if (typeof entity.headYawRadians === 'undefined') {
    return {}
  }
  return { headYawRadians: entity.headYawRadians }
}

const copiedPitchRadians = (entity: RenderEntity): Pick<RenderEntity, 'pitchRadians'> => {
  if (typeof entity.pitchRadians === 'undefined') {
    return {}
  }
  return { pitchRadians: entity.pitchRadians }
}

/** `entity.facingRadians`, present only when the source entity has one. */
const copiedFacingRadians = (entity: RenderEntity): Pick<RenderEntity, 'facingRadians'> => {
  if (typeof entity.facingRadians === 'undefined') {
    return {}
  }
  return { facingRadians: entity.facingRadians }
}

/** A detached copy of `entity.animation`, present only when the source entity has one. */
const copiedAnimation = (entity: RenderEntity): Pick<RenderEntity, 'animation'> => {
  if (typeof entity.animation === 'undefined') {
    return {}
  }
  return { animation: { ...entity.animation } }
}

/** A detached copy of `entity.witherState`, present only when the source entity has one. */
const copiedWitherState = (entity: RenderEntity): Pick<RenderEntity, 'witherState'> => {
  const { witherState } = entity
  if (typeof witherState === 'undefined') {
    return {}
  }
  return {
    witherState: {
      ...witherState,
      feetPosition: { ...witherState.feetPosition },
      velocity: { ...witherState.velocity },
    },
  }
}

/** A detached copy of `entity.witherSkullProjectile`, present only when the source entity has one. */
const copiedWitherSkullProjectile = (entity: RenderEntity): Pick<RenderEntity, 'witherSkullProjectile'> => {
  const { witherSkullProjectile } = entity
  if (typeof witherSkullProjectile === 'undefined') {
    return {}
  }
  return {
    witherSkullProjectile: {
      ...witherSkullProjectile,
      direction: { ...witherSkullProjectile.direction },
      origin: { ...witherSkullProjectile.origin },
    },
  }
}

/** Detach mutable source projections before the renderer stores them for reconciliation. */
export const copyRenderEntity = (entity: RenderEntity): RenderEntity => ({
  feetPosition: { ...entity.feetPosition },
  id: entity.id,
  kind: entity.kind,
  ...copiedCategory(entity),
  ...copiedBodyYawRadians(entity),
  ...copiedHeadYawRadians(entity),
  ...copiedPitchRadians(entity),
  ...copiedFacingRadians(entity),
  ...copiedAnimation(entity),
  ...copiedWitherState(entity),
  ...copiedWitherSkullProjectile(entity),
})

export type EntityModelPartPlan = Readonly<{
  readonly id: EntityModelPartIdentifier
  readonly role: EntityModelPartRole
  readonly size: MobVisualPartPlan['size']
  readonly center: MobVisualPartPlan['center']
  readonly color: MobVisualPartPlan['color']
  readonly rotation: MobVisualPartPlan['rotation']
}>

export type EntityVisualPartPlan = MobVisualPartPlan | WitherVisualPartDescriptor | EntityModelPartPlan

export type EntityVisualPlan = Readonly<{
  position: WitherVisualPosition
  facingRadians: number
  textureCoordinates: EntityTextureUvCoordinates
  parts: ReadonlyArray<EntityVisualPartPlan>
}>

type UntexturedEntityVisualPlan = Omit<EntityVisualPlan, 'textureCoordinates'>

/** The item visual's part centre: slightly above the feet position, on no horizontal offset. */
const ITEM_CENTER_X = 0
const ITEM_CENTER_Y = 0.15
const ITEM_CENTER_Z = 0

/** The dropped-item colour: a warm gold, standing in for a real per-item texture. */
const ITEM_COLOR_RED = 225
const ITEM_COLOR_GREEN = 165
const ITEM_COLOR_BLUE = 65

/** No rotation on any axis: the item cube is drawn axis-aligned. */
const ITEM_ROTATION_X = 0
const ITEM_ROTATION_Y = 0
const ITEM_ROTATION_Z = 0

/** The item visual's cube size: smaller than a full block on every axis. */
const ITEM_SIZE_X = 0.3
const ITEM_SIZE_Y = 0.3
const ITEM_SIZE_Z = 0.3

const ITEM_VISUAL_PARTS: ReadonlyArray<EntityVisualPartPlan> = [
  {
    center: [ITEM_CENTER_X, ITEM_CENTER_Y, ITEM_CENTER_Z],
    color: [ITEM_COLOR_RED, ITEM_COLOR_GREEN, ITEM_COLOR_BLUE],
    id: 'item',
    role: 'body',
    rotation: [ITEM_ROTATION_X, ITEM_ROTATION_Y, ITEM_ROTATION_Z],
    size: [ITEM_SIZE_X, ITEM_SIZE_Y, ITEM_SIZE_Z],
  },
]

/** The facing this repository assumes for an entity that reports none. */
const DEFAULT_FACING_RADIANS = 0
const NO_ROTATION = 0
const UNIT_INTERVAL_MINIMUM = 0
const UNIT_INTERVAL_MAXIMUM = 1
const GENERIC_WALK_SWING_RADIANS = 0.65
const GENERIC_ARM_SWING_RADIANS = 0.45
const HALF_TURN_DIVISOR = 2
const QUARTER_TURN_DIVISOR = 4
const GENERIC_ATTACK_SWING_RADIANS = Math.PI / QUARTER_TURN_DIVISOR
const GENERIC_WING_SWING_RADIANS = 0.65
const GENERIC_TAIL_SWING_RADIANS = 0.35
const GENERIC_HURT_LEAN_RADIANS = 0.24
const GENERIC_DEATH_LEAN_RADIANS = Math.PI / HALF_TURN_DIVISOR
const MODEL_PART_PHASE_OFFSET_RADIANS = Math.PI
const FIRST_ROLE_PART_INDEX = 0
const ROLE_PART_INDEX_STEP = 1
const ROLE_ALTERNATION_PERIOD = 2
const FIRST_ALTERNATING_ROLE_INDEX = 0
const NEGATIVE_SIDE_DIRECTION = -1
const POSITIVE_SIDE_DIRECTION = 1
const GENERIC_ZERO_ROTATION: MobVisualPartPlan['rotation'] = [NO_ROTATION, NO_ROTATION, NO_ROTATION]

const entityFacing = (entity: RenderEntity): number =>
  entity.bodyYawRadians ?? entity.facingRadians ?? DEFAULT_FACING_RADIANS

const facingDirection = (facingRadians: number): WitherVisualPosition => ({
  x: -Math.sin(facingRadians),
  y: 0,
  z: -Math.cos(facingRadians),
})

const planItemVisual = (entity: RenderEntity, facingRadians: number): UntexturedEntityVisualPlan => ({
  facingRadians,
  parts: ITEM_VISUAL_PARTS,
  position: entity.feetPosition,
})

const planWitherEntityVisual = (
  entity: RenderEntity,
  facingRadians: number,
): Result.Result<UntexturedEntityVisualPlan, Schema.SchemaError> => {
  const state: WitherVisualStateInput = entity.witherState ?? {
    chargeRemainingSecs: 0,
    feetPosition: entity.feetPosition,
    healthPoints: 300,
    phase: 'airborne',
    velocity: facingDirection(facingRadians),
  }
  return Result.map(planWitherVisual(state), (visual) => ({
    facingRadians: visual.yawRadians,
    parts: visual.parts,
    position: visual.position,
  }))
}

const planWitherSkullEntityVisual = (
  entity: RenderEntity,
  facingRadians: number,
): Result.Result<UntexturedEntityVisualPlan, Schema.SchemaError> => {
  const projectile: WitherSkullVisualInput = entity.witherSkullProjectile ?? {
    destroysResistantBlocks: false,
    direction: facingDirection(facingRadians),
    explosivePower: 0,
    kind: 'wither_skull',
    origin: entity.feetPosition,
    speed: 0,
    variant: 'normal',
  }
  return Result.map(planWitherSkullVisual(projectile), (visual) => ({
    facingRadians: visual.yawRadians,
    parts: visual.parts,
    position: visual.position,
  }))
}

const progressValue = (value: number | undefined, fallback: number): number =>
  value ?? fallback

const walkAmountFor = (animation: MobAnimationInput | undefined): number => {
  if (animation?.walkAmount !== undefined) {
    return progressValue(animation.walkAmount, UNIT_INTERVAL_MINIMUM)
  }
  if (animation?.state === 'walk') {
    return UNIT_INTERVAL_MAXIMUM
  }
  return UNIT_INTERVAL_MINIMUM
}

const progressForState = (
  animation: MobAnimationInput | undefined,
  activeState: 'hurt' | 'death',
): number => {
  let explicitProgress: number | undefined = undefined
  if (activeState === 'hurt') {
    explicitProgress = animation?.hurtProgress
  } else {
    explicitProgress = animation?.deathProgress
  }
  if (explicitProgress !== undefined) {
    return progressValue(explicitProgress, UNIT_INTERVAL_MINIMUM)
  }
  if (animation?.state !== activeState) {
    return UNIT_INTERVAL_MINIMUM
  }
  return progressValue(animation.progress, UNIT_INTERVAL_MAXIMUM)
}

const hasExplicitMotionProgress = (animation: MobAnimationInput): boolean =>
  animation.progress !== undefined || animation.walkAmount !== undefined ||
  animation.attackProgress !== undefined || animation.hurtProgress !== undefined || animation.deathProgress !== undefined

type GenericMotionProgressValues = Readonly<{
  readonly walkAmount: number
  readonly attackProgress: number
  readonly hurtProgress: number
  readonly deathProgress: number
}>

const motionProgressFor = (
  animation: MobAnimationInput | undefined,
  values: GenericMotionProgressValues,
): number => {
  if (animation === undefined) {
    return UNIT_INTERVAL_MINIMUM
  }
  const inferredProgress = Math.max(values.walkAmount, values.attackProgress, values.hurtProgress, values.deathProgress)
  if (animation.progress !== undefined) {
    return progressValue(animation.progress, inferredProgress)
  }
  if (hasExplicitMotionProgress(animation)) {
    return inferredProgress
  }
  return UNIT_INTERVAL_MAXIMUM
}

type GenericAnimationSample = Readonly<{
  readonly phaseRadians: number
  readonly walkAmount: number
  readonly attackSwing: number
  readonly motionProgress: number
  readonly sharedLean: number
}>

const genericAnimationSample = (animation: MobAnimationInput | undefined): GenericAnimationSample => {
  const phaseRadians = animation?.phaseRadians ?? NO_ROTATION
  const walkAmount = walkAmountFor(animation)
  const attackProgress = progressValue(animation?.attackProgress, UNIT_INTERVAL_MINIMUM)
  const hurtProgress = progressForState(animation, 'hurt')
  const deathProgress = progressForState(animation, 'death')
  return {
    attackSwing: Math.sin(attackProgress * Math.PI) * GENERIC_ATTACK_SWING_RADIANS,
    motionProgress: motionProgressFor(animation, { attackProgress, deathProgress, hurtProgress, walkAmount }),
    phaseRadians,
    sharedLean: hurtProgress * GENERIC_HURT_LEAN_RADIANS + deathProgress * GENERIC_DEATH_LEAN_RADIANS,
    walkAmount,
  }
}

const roleIndex = (indices: Map<string, number>, role: string): number => {
  const index = indices.get(role) ?? FIRST_ROLE_PART_INDEX
  indices.set(role, index + ROLE_PART_INDEX_STEP)
  return index
}

const sideForPart = (partId: string, index: number): number => {
  const lowered = partId.toLowerCase()
  if (lowered.includes('left')) {
    return NEGATIVE_SIDE_DIRECTION
  }
  if (lowered.includes('right')) {
    return POSITIVE_SIDE_DIRECTION
  }
  if (index % ROLE_ALTERNATION_PERIOD === FIRST_ALTERNATING_ROLE_INDEX) {
    return NEGATIVE_SIDE_DIRECTION
  }
  return POSITIVE_SIDE_DIRECTION
}

const genericLegRotation = (
  part: EntityModelPartDescriptor,
  sample: GenericAnimationSample,
  index: number,
): MobVisualPartPlan['rotation'] => {
  const [rotationX, rotationY, rotationZ] = part.rotation ?? GENERIC_ZERO_ROTATION
  const stride = Math.sin(sample.phaseRadians + index * MODEL_PART_PHASE_OFFSET_RADIANS) * GENERIC_WALK_SWING_RADIANS * sample.walkAmount
  return [rotationX + stride, rotationY, rotationZ]
}

const genericArmRotation = (
  part: EntityModelPartDescriptor,
  sample: GenericAnimationSample,
  index: number,
): MobVisualPartPlan['rotation'] => {
  const [rotationX, rotationY, rotationZ] = part.rotation ?? GENERIC_ZERO_ROTATION
  const side = sideForPart(part.id, index)
  const stride = Math.sin(sample.phaseRadians + index * MODEL_PART_PHASE_OFFSET_RADIANS) * GENERIC_ARM_SWING_RADIANS * sample.walkAmount
  return [rotationX + stride + side * sample.attackSwing, rotationY, rotationZ]
}

const genericWingRotation = (
  part: EntityModelPartDescriptor,
  sample: GenericAnimationSample,
  index: number,
): MobVisualPartPlan['rotation'] => {
  const [rotationX, rotationY, rotationZ] = part.rotation ?? GENERIC_ZERO_ROTATION
  const side = sideForPart(part.id, index)
  const flap = side * Math.sin(sample.phaseRadians) * GENERIC_WING_SWING_RADIANS * sample.motionProgress
  return [rotationX, rotationY, rotationZ + flap]
}

const genericTailRotation = (
  part: EntityModelPartDescriptor,
  sample: GenericAnimationSample,
  index: number,
): MobVisualPartPlan['rotation'] => {
  const [rotationX, rotationY, rotationZ] = part.rotation ?? GENERIC_ZERO_ROTATION
  const sway = Math.sin(sample.phaseRadians + index * MODEL_PART_PHASE_OFFSET_RADIANS) * GENERIC_TAIL_SWING_RADIANS * sample.motionProgress
  return [rotationX, rotationY + sway, rotationZ]
}

const genericPartRotation = (
  part: EntityModelPartDescriptor,
  sample: GenericAnimationSample,
  index: number,
): MobVisualPartPlan['rotation'] => {
  const role = String(part.role)
  let rotation = part.rotation ?? GENERIC_ZERO_ROTATION
  if (role === 'leg') {
    rotation = genericLegRotation(part, sample, index)
  } else if (role === 'arm') {
    rotation = genericArmRotation(part, sample, index)
  } else if (role === 'wing') {
    rotation = genericWingRotation(part, sample, index)
  } else if (role === 'tail') {
    rotation = genericTailRotation(part, sample, index)
  }
  const [rotationX, rotationY, rotationZ] = rotation
  return [rotationX, rotationY, rotationZ + sample.sharedLean]
}

const genericModelPartPlan = (
  part: EntityModelPartDescriptor,
  sample: GenericAnimationSample,
  index: number,
): EntityModelPartPlan => ({
  center: part.center,
  color: part.color,
  id: part.id,
  role: part.role,
  rotation: genericPartRotation(part, sample, index),
  size: part.size,
})

const genericModelParts = (
  parts: ReadonlyArray<EntityModelPartDescriptor>,
  animation: MobAnimationInput | undefined,
): ReadonlyArray<EntityModelPartPlan> => {
  const sample = genericAnimationSample(animation)
  const indices = new Map<string, number>()
  return parts.map((part) => {
    const role = String(part.role)
    return genericModelPartPlan(part, sample, roleIndex(indices, role))
  })
}

const knownMobVisualKinds = new Set<string>(MOB_VISUAL_KINDS)

const isMobVisualKind = (kind: string): kind is MobVisualKind => knownMobVisualKinds.has(kind)

const planCatalogEntityVisual = (
  entity: RenderEntity,
  facingRadians: number,
  kind: EntityModelKind,
): Result.Result<UntexturedEntityVisualPlan, EntityModelResolutionIssue> => {
  const model = entityModelForKind(kind)
  if (Result.isFailure(model)) {
    return Result.fail(model.failure)
  }
  return Result.succeed({
    facingRadians,
    parts: genericModelParts(model.success.parts, entity.animation),
    position: entity.feetPosition,
  })
}

const planDefaultEntityVisual = (
  entity: RenderEntity,
  facingRadians: number,
  kind: EntityModelKind,
): Result.Result<UntexturedEntityVisualPlan, EntityModelResolutionIssue | Schema.SchemaError> => {
  if (!isMobVisualKind(entity.kind)) {
    return planCatalogEntityVisual(entity, facingRadians, kind)
  }
  let mobVisual = planMobVisual(entity.kind)
  if (entity.animation !== undefined) {
    mobVisual = planMobVisual(entity.kind, entity.animation)
  }
  return Result.map(mobVisual, (visual) => ({
    facingRadians,
    parts: visual.parts,
    position: entity.feetPosition,
  }))
}

const planDedicatedEntityVisual = (
  entity: RenderEntity,
  facingRadians: number,
): Result.Result<UntexturedEntityVisualPlan, Schema.SchemaError> | undefined => {
  if (entity.category === 'item') {
    return Result.succeed(planItemVisual(entity, facingRadians))
  }
  if (entity.kind === 'wither') {
    return planWitherEntityVisual(entity, facingRadians)
  }
  if (entity.kind === 'wither_skull') {
    return planWitherSkullEntityVisual(entity, facingRadians)
  }
  return undefined
}

const modelKindInputFor = (entity: RenderEntity): string => {
  if (entity.category === 'item') {
    return 'item'
  }
  return entity.kind
}

const untexturedVisualFor = (
  entity: RenderEntity,
  kind: EntityModelKind,
): Result.Result<UntexturedEntityVisualPlan, EntityModelResolutionIssue | Schema.SchemaError> => {
  const facingRadians = entityFacing(entity)
  const dedicatedVisual = planDedicatedEntityVisual(entity, facingRadians)
  if (dedicatedVisual !== undefined) {
    return dedicatedVisual
  }
  return planDefaultEntityVisual(entity, facingRadians, kind)
}

const withEntityTextureCoordinates = (
  visual: UntexturedEntityVisualPlan,
  kind: EntityModelKind,
): Result.Result<EntityVisualPlan, EntityTextureResolutionIssue> => {
  const textureCoordinates = entityTextureUvForKind(kind)
  if (Result.isFailure(textureCoordinates)) {
    return Result.fail(textureCoordinates.failure)
  }
  return Result.succeed({ ...visual, textureCoordinates: textureCoordinates.success })
}

export const planEntityVisual = (
  entity: RenderEntity,
): Result.Result<EntityVisualPlan, EntityModelResolutionIssue | EntityTextureResolutionIssue | Schema.SchemaError> => {
  const decodedKind = decodeEntityModelKind(modelKindInputFor(entity))
  if (Result.isFailure(decodedKind)) {
    return Result.fail(decodedKind.failure)
  }
  const visual = untexturedVisualFor(entity, decodedKind.success)
  if (Result.isFailure(visual)) {
    return Result.fail(visual.failure)
  }
  return withEntityTextureCoordinates(visual.success, decodedKind.success)
}
