import {
  type MobAnimationInput,
  type MobVisualPartPlan,
  planMobVisual,
} from '../domain/mob-visual.js'
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
export type RenderEntity = {
  readonly id: string
  readonly kind: string
  readonly feetPosition: {
    readonly x: number
    readonly y: number
    readonly z: number
  }
  readonly category?: EntityRenderCategory
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
  ...copiedFacingRadians(entity),
  ...copiedAnimation(entity),
  ...copiedWitherState(entity),
  ...copiedWitherSkullProjectile(entity),
})

export type EntityVisualPartPlan = MobVisualPartPlan | WitherVisualPartDescriptor

export type EntityVisualPlan = Readonly<{
  position: WitherVisualPosition
  facingRadians: number
  parts: ReadonlyArray<EntityVisualPartPlan>
}>

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

const entityFacing = (entity: RenderEntity): number => {
  if (typeof entity.facingRadians === 'number' && Number.isFinite(entity.facingRadians)) {
    return entity.facingRadians
  }
  return DEFAULT_FACING_RADIANS
}

const facingDirection = (facingRadians: number): WitherVisualPosition => ({
  x: -Math.sin(facingRadians),
  y: 0,
  z: -Math.cos(facingRadians),
})

const planItemVisual = (entity: RenderEntity, facingRadians: number): EntityVisualPlan => ({
  facingRadians,
  parts: ITEM_VISUAL_PARTS,
  position: entity.feetPosition,
})

const planWitherEntityVisual = (entity: RenderEntity, facingRadians: number): EntityVisualPlan => {
  const state: WitherVisualStateInput = entity.witherState ?? {
    chargeRemainingSecs: 0,
    feetPosition: entity.feetPosition,
    healthPoints: 300,
    phase: 'airborne',
    velocity: facingDirection(facingRadians),
  }
  const visual = planWitherVisual(state)
  return {
    facingRadians: visual.yawRadians,
    parts: visual.parts,
    position: visual.position,
  }
}

const planWitherSkullEntityVisual = (entity: RenderEntity, facingRadians: number): EntityVisualPlan => {
  const projectile: WitherSkullVisualInput = entity.witherSkullProjectile ?? {
    destroysResistantBlocks: false,
    direction: facingDirection(facingRadians),
    explosivePower: 0,
    kind: 'wither_skull',
    origin: entity.feetPosition,
    speed: 0,
    variant: 'normal',
  }
  const visual = planWitherSkullVisual(projectile)
  return {
    facingRadians: visual.yawRadians,
    parts: visual.parts,
    position: visual.position,
  }
}

const planDefaultEntityVisual = (entity: RenderEntity, facingRadians: number): EntityVisualPlan => ({
  facingRadians,
  parts: planMobVisual(entity.kind, entity.animation).parts,
  position: entity.feetPosition,
})

export const planEntityVisual = (entity: RenderEntity): EntityVisualPlan => {
  const facingRadians = entityFacing(entity)
  if (entity.category === 'item') {
    return planItemVisual(entity, facingRadians)
  }
  if (entity.kind === 'wither') {
    return planWitherEntityVisual(entity, facingRadians)
  }
  if (entity.kind === 'wither_skull') {
    return planWitherSkullEntityVisual(entity, facingRadians)
  }
  return planDefaultEntityVisual(entity, facingRadians)
}
