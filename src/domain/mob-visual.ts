/** Renderer-independent mob silhouettes and deterministic animation planning. */

export const MOB_VISUAL_KINDS = [
  'zombie',
  'creeper',
  'enderman',
  'skeleton',
  'spider',
  'cow',
  'pig',
  'sheep',
  'chicken',
  'zombified_piglin',
  'blaze',
] as const

export type MobVisualKind = (typeof MOB_VISUAL_KINDS)[number]
export type MobTemperament = 'hostile' | 'passive' | 'neutral'
export type MobAnimationState = 'idle' | 'walk' | 'hurt' | 'death'
export type MobVisualPartRole =
  | 'body'
  | 'head'
  | 'arm'
  | 'leg'
  | 'wing'
  | 'snout'
  | 'horn'
  | 'eye'
  | 'beak'
  | 'blaze_rod'

export type MobVisualVector = readonly [xAxis: number, yAxis: number, zAxis: number]
export type MobVisualColor = readonly [red: number, green: number, blue: number]

type MobPartMotion =
  | 'static'
  | 'body'
  | 'left_limb'
  | 'right_limb'
  | 'left_spider_leg'
  | 'right_spider_leg'
  | 'left_wing'
  | 'right_wing'
  | 'blaze_orbit'

export type MobVisualPartDescriptor = {
  readonly id: string
  readonly role: MobVisualPartRole
  readonly size: MobVisualVector
  readonly center: MobVisualVector
  readonly color: MobVisualColor
  readonly motion: MobPartMotion
  readonly motionIndex: number
}

export type MobVisualDescriptor = {
  readonly kind: MobVisualKind | 'unknown'
  readonly temperament: MobTemperament
  readonly scale: MobVisualVector
  readonly parts: ReadonlyArray<MobVisualPartDescriptor>
}

export type MobAnimationInput = {
  readonly state: MobAnimationState
  readonly phaseRadians?: number
  readonly progress?: number
}

export type MobVisualPartPlan = {
  readonly id: string
  readonly role: MobVisualPartRole
  readonly size: MobVisualVector
  readonly center: MobVisualVector
  readonly rotation: MobVisualVector
  readonly color: MobVisualColor
}

export type MobVisualPlan = {
  readonly descriptorKind: MobVisualKind | 'unknown'
  readonly temperament: MobTemperament
  readonly animation: Readonly<Required<MobAnimationInput>>
  readonly parts: ReadonlyArray<MobVisualPartPlan>
}

/* Shared numeric building blocks. Reused wherever the same literal recurs with the same domain
 * meaning (a centered axis offset, a unit scale factor, a tuple axis index); every other literal
 * below is named for the specific dimension, position, or color channel it represents. */
const AXIS_ORIGIN = 0
const UNIT_SCALE = 1
const X_AXIS_INDEX = 0
const Y_AXIS_INDEX = 1
const Z_AXIS_INDEX = 2
const DEFAULT_MOTION_INDEX = 0

/* -- part() -- */

type PartOptions = {
  readonly id: string
  readonly role: MobVisualPartRole
  readonly size: MobVisualVector
  readonly center: MobVisualVector
  readonly color: MobVisualColor
  readonly motion?: MobPartMotion
  readonly motionIndex?: number
}

const part = (options: PartOptions): MobVisualPartDescriptor => {
  const { id, role, size, center, color, motion = 'static', motionIndex = DEFAULT_MOTION_INDEX } = options
  return { center, color, id, motion, motionIndex, role, size }
}

/* -- biped() -- */

const BIPED_HEAD_SIZE_UNIT = 0.5
const BIPED_HEAD_CENTER_Y = 1.55
const BIPED_BODY_SIZE_X = 0.55
const BIPED_BODY_SIZE_Y = 0.7
const BIPED_BODY_SIZE_Z = 0.3
const BIPED_BODY_CENTER_Y = 0.95
const BIPED_ARM_HEIGHT = 0.75
const BIPED_ARM_CENTER_X = 0.4
const BIPED_ARM_CENTER_Y = 0.95
const BIPED_LEG_HEIGHT = 0.8
const BIPED_LEG_CENTER_X = 0.16
const BIPED_LEG_CENTER_Y = 0.4
const BIPED_SLENDER_LIMB_WIDTH = 0.14
const BIPED_LIMB_WIDTH = 0.2

type BipedColors = {
  readonly head: MobVisualColor
  readonly body: MobVisualColor
  readonly limbs: MobVisualColor
}

type BipedOptions = {
  readonly kind: MobVisualKind
  readonly temperament: MobTemperament
  readonly scale: MobVisualVector
  readonly colors: BipedColors
  readonly slender?: boolean
  readonly extras?: ReadonlyArray<MobVisualPartDescriptor>
}

const limbWidthFor = (slender: boolean): number => {
  if (slender) {
    return BIPED_SLENDER_LIMB_WIDTH
  }
  return BIPED_LIMB_WIDTH
}

const biped = (options: BipedOptions): MobVisualDescriptor => {
  const { kind, temperament, scale, colors, slender = false, extras = [] } = options
  const limbWidth = limbWidthFor(slender)
  return {
    kind,
    parts: [
      part({
        center: [AXIS_ORIGIN, BIPED_HEAD_CENTER_Y, AXIS_ORIGIN],
        color: colors.head,
        id: 'head',
        role: 'head',
        size: [BIPED_HEAD_SIZE_UNIT, BIPED_HEAD_SIZE_UNIT, BIPED_HEAD_SIZE_UNIT],
      }),
      part({
        center: [AXIS_ORIGIN, BIPED_BODY_CENTER_Y, AXIS_ORIGIN],
        color: colors.body,
        id: 'body',
        motion: 'body',
        role: 'body',
        size: [BIPED_BODY_SIZE_X, BIPED_BODY_SIZE_Y, BIPED_BODY_SIZE_Z],
      }),
      part({
        center: [-BIPED_ARM_CENTER_X, BIPED_ARM_CENTER_Y, AXIS_ORIGIN],
        color: colors.limbs,
        id: 'left-arm',
        motion: 'left_limb',
        role: 'arm',
        size: [limbWidth, BIPED_ARM_HEIGHT, limbWidth],
      }),
      part({
        center: [BIPED_ARM_CENTER_X, BIPED_ARM_CENTER_Y, AXIS_ORIGIN],
        color: colors.limbs,
        id: 'right-arm',
        motion: 'right_limb',
        role: 'arm',
        size: [limbWidth, BIPED_ARM_HEIGHT, limbWidth],
      }),
      part({
        center: [-BIPED_LEG_CENTER_X, BIPED_LEG_CENTER_Y, AXIS_ORIGIN],
        color: colors.limbs,
        id: 'left-leg',
        motion: 'right_limb',
        role: 'leg',
        size: [limbWidth, BIPED_LEG_HEIGHT, limbWidth],
      }),
      part({
        center: [BIPED_LEG_CENTER_X, BIPED_LEG_CENTER_Y, AXIS_ORIGIN],
        color: colors.limbs,
        id: 'right-leg',
        motion: 'left_limb',
        role: 'leg',
        size: [limbWidth, BIPED_LEG_HEIGHT, limbWidth],
      }),
      ...extras,
    ],
    scale,
    temperament,
  }
}

/* -- quadruped() -- */

const QUADRUPED_BODY_SIZE_X = 0.9
const QUADRUPED_BODY_SIZE_Y = 0.65
const QUADRUPED_BODY_SIZE_Z = 1.25
const QUADRUPED_BODY_CENTER_Y = 0.85
const QUADRUPED_HEAD_SIZE_XY = 0.65
const QUADRUPED_HEAD_SIZE_Z = 0.55
const QUADRUPED_HEAD_CENTER_Y = 1.05
const QUADRUPED_HEAD_CENTER_Z = -0.82
const QUADRUPED_LEG_SIZE_XZ = 0.18
const QUADRUPED_LEG_HEIGHT = 0.65
const QUADRUPED_LEG_CENTER_X = 0.3
const QUADRUPED_LEG_CENTER_Y = 0.35
const QUADRUPED_LEG_CENTER_Z = 0.38

type QuadrupedOptions = {
  readonly kind: MobVisualKind
  readonly bodyColor: MobVisualColor
  readonly headColor: MobVisualColor
  readonly scale: MobVisualVector
  readonly extras?: ReadonlyArray<MobVisualPartDescriptor>
}

const quadruped = (options: QuadrupedOptions): MobVisualDescriptor => {
  const { kind, bodyColor, headColor, scale, extras = [] } = options
  return {
    kind,
    parts: [
      part({
        center: [AXIS_ORIGIN, QUADRUPED_BODY_CENTER_Y, AXIS_ORIGIN],
        color: bodyColor,
        id: 'body',
        motion: 'body',
        role: 'body',
        size: [QUADRUPED_BODY_SIZE_X, QUADRUPED_BODY_SIZE_Y, QUADRUPED_BODY_SIZE_Z],
      }),
      part({
        center: [AXIS_ORIGIN, QUADRUPED_HEAD_CENTER_Y, QUADRUPED_HEAD_CENTER_Z],
        color: headColor,
        id: 'head',
        role: 'head',
        size: [QUADRUPED_HEAD_SIZE_XY, QUADRUPED_HEAD_SIZE_XY, QUADRUPED_HEAD_SIZE_Z],
      }),
      part({
        center: [-QUADRUPED_LEG_CENTER_X, QUADRUPED_LEG_CENTER_Y, -QUADRUPED_LEG_CENTER_Z],
        color: headColor,
        id: 'front-left-leg',
        motion: 'left_limb',
        role: 'leg',
        size: [QUADRUPED_LEG_SIZE_XZ, QUADRUPED_LEG_HEIGHT, QUADRUPED_LEG_SIZE_XZ],
      }),
      part({
        center: [QUADRUPED_LEG_CENTER_X, QUADRUPED_LEG_CENTER_Y, -QUADRUPED_LEG_CENTER_Z],
        color: headColor,
        id: 'front-right-leg',
        motion: 'right_limb',
        role: 'leg',
        size: [QUADRUPED_LEG_SIZE_XZ, QUADRUPED_LEG_HEIGHT, QUADRUPED_LEG_SIZE_XZ],
      }),
      part({
        center: [-QUADRUPED_LEG_CENTER_X, QUADRUPED_LEG_CENTER_Y, QUADRUPED_LEG_CENTER_Z],
        color: headColor,
        id: 'back-left-leg',
        motion: 'right_limb',
        role: 'leg',
        size: [QUADRUPED_LEG_SIZE_XZ, QUADRUPED_LEG_HEIGHT, QUADRUPED_LEG_SIZE_XZ],
      }),
      part({
        center: [QUADRUPED_LEG_CENTER_X, QUADRUPED_LEG_CENTER_Y, QUADRUPED_LEG_CENTER_Z],
        color: headColor,
        id: 'back-right-leg',
        motion: 'left_limb',
        role: 'leg',
        size: [QUADRUPED_LEG_SIZE_XZ, QUADRUPED_LEG_HEIGHT, QUADRUPED_LEG_SIZE_XZ],
      }),
      ...extras,
    ],
    scale,
    temperament: 'passive',
  }
}

/* -- spiderLegs() -- */

const SPIDER_LEG_ROW_FRONT_Z = -0.48
const SPIDER_LEG_ROW_FRONT_MID_Z = -0.16
const SPIDER_LEG_ROW_BACK_MID_Z = 0.16
const SPIDER_LEG_ROW_BACK_Z = 0.48
const SPIDER_LEG_LENGTH = 0.85
const SPIDER_LEG_THICKNESS = 0.12
const SPIDER_LEG_X_OFFSET = 0.65
const SPIDER_LEG_Y = 0.34
const LEG_INDEX_LABEL_OFFSET = 1

const spiderLegs = (color: MobVisualColor): ReadonlyArray<MobVisualPartDescriptor> =>
  [SPIDER_LEG_ROW_FRONT_Z, SPIDER_LEG_ROW_FRONT_MID_Z, SPIDER_LEG_ROW_BACK_MID_Z, SPIDER_LEG_ROW_BACK_Z].flatMap(
    (zOffset, index) => [
      part({
        center: [-SPIDER_LEG_X_OFFSET, SPIDER_LEG_Y, zOffset],
        color,
        id: `left-leg-${String(index + LEG_INDEX_LABEL_OFFSET)}`,
        motion: 'left_spider_leg',
        motionIndex: index,
        role: 'leg',
        size: [SPIDER_LEG_LENGTH, SPIDER_LEG_THICKNESS, SPIDER_LEG_THICKNESS],
      }),
      part({
        center: [SPIDER_LEG_X_OFFSET, SPIDER_LEG_Y, zOffset],
        color,
        id: `right-leg-${String(index + LEG_INDEX_LABEL_OFFSET)}`,
        motion: 'right_spider_leg',
        motionIndex: index,
        role: 'leg',
        size: [SPIDER_LEG_LENGTH, SPIDER_LEG_THICKNESS, SPIDER_LEG_THICKNESS],
      }),
    ],
  )

/* -- blazeRods() -- */

const BLAZE_ROD_COUNT = 12
const BLAZE_RODS_PER_RING = 4
const BLAZE_ROD_MIDDLE_RING_END = 8
const QUARTER_TURN_DIVISOR = 2
const BLAZE_ROD_RING_ANGLE_STEP = Math.PI / QUARTER_TURN_DIVISOR
const BLAZE_ROD_OUTER_RING_RADIUS = 0.62
const BLAZE_ROD_MIDDLE_RING_RADIUS = 0.48
const BLAZE_ROD_INNER_RING_RADIUS = 0.36
const BLAZE_ROD_OUTER_RING_HEIGHT = 1.25
const BLAZE_ROD_MIDDLE_RING_HEIGHT = 0.8
const BLAZE_ROD_INNER_RING_HEIGHT = 0.4
const BLAZE_ROD_SIZE_X = 0.13
const BLAZE_ROD_SIZE_Y = 0.5

const blazeRodRadiusFor = (index: number): number => {
  if (index < BLAZE_RODS_PER_RING) {
    return BLAZE_ROD_OUTER_RING_RADIUS
  }
  if (index < BLAZE_ROD_MIDDLE_RING_END) {
    return BLAZE_ROD_MIDDLE_RING_RADIUS
  }
  return BLAZE_ROD_INNER_RING_RADIUS
}

const blazeRodHeightFor = (index: number): number => {
  if (index < BLAZE_RODS_PER_RING) {
    return BLAZE_ROD_OUTER_RING_HEIGHT
  }
  if (index < BLAZE_ROD_MIDDLE_RING_END) {
    return BLAZE_ROD_MIDDLE_RING_HEIGHT
  }
  return BLAZE_ROD_INNER_RING_HEIGHT
}

const blazeRods = (color: MobVisualColor): ReadonlyArray<MobVisualPartDescriptor> =>
  Array.from({ length: BLAZE_ROD_COUNT }, (_unusedElement, index) => {
    const angle = (index % BLAZE_RODS_PER_RING) * BLAZE_ROD_RING_ANGLE_STEP
    const radius = blazeRodRadiusFor(index)
    const height = blazeRodHeightFor(index)
    return part({
      center: [Math.cos(angle) * radius, height, Math.sin(angle) * radius],
      color,
      id: `rod-${String(index + LEG_INDEX_LABEL_OFFSET)}`,
      motion: 'blaze_orbit',
      motionIndex: index,
      role: 'blaze_rod',
      size: [BLAZE_ROD_SIZE_X, BLAZE_ROD_SIZE_Y, BLAZE_ROD_SIZE_X],
    })
  })

/* -- Per-kind geometry and color constants -- */

const BLAZE_HEAD_SIZE_UNIT = 0.62
const BLAZE_HEAD_CENTER_Y = 1.5
const BLAZE_HEAD_COLOR_RED = 233
const BLAZE_HEAD_COLOR_GREEN = 175
const BLAZE_HEAD_COLOR_BLUE = 45
const BLAZE_HEAD_COLOR: MobVisualColor = [BLAZE_HEAD_COLOR_RED, BLAZE_HEAD_COLOR_GREEN, BLAZE_HEAD_COLOR_BLUE]
const BLAZE_EYES_SIZE_X = 0.36
const BLAZE_EYES_SIZE_Y = 0.08
const BLAZE_EYES_SIZE_Z = 0.03
const BLAZE_EYES_CENTER_Y = 1.52
const BLAZE_EYES_CENTER_Z = -0.33
const BLAZE_EYES_COLOR_RED = 69
const BLAZE_EYES_COLOR_GREEN = 42
const BLAZE_EYES_COLOR_BLUE = 24
const BLAZE_EYES_COLOR: MobVisualColor = [BLAZE_EYES_COLOR_RED, BLAZE_EYES_COLOR_GREEN, BLAZE_EYES_COLOR_BLUE]
const BLAZE_ROD_COLOR_RED = 208
const BLAZE_ROD_COLOR_GREEN = 139
const BLAZE_ROD_COLOR_BLUE = 32
const BLAZE_ROD_COLOR: MobVisualColor = [BLAZE_ROD_COLOR_RED, BLAZE_ROD_COLOR_GREEN, BLAZE_ROD_COLOR_BLUE]
const BLAZE_SCALE_Y = 1.15

const CHICKEN_BODY_SIZE_X = 0.75
const CHICKEN_BODY_SIZE_Y = 0.78
const CHICKEN_BODY_SIZE_Z = 0.72
const CHICKEN_BODY_CENTER_Y = 0.72
const CHICKEN_BODY_COLOR_RED = 231
const CHICKEN_BODY_COLOR_GREEN = 227
const CHICKEN_BODY_COLOR_BLUE = 211
const CHICKEN_BODY_COLOR: MobVisualColor = [CHICKEN_BODY_COLOR_RED, CHICKEN_BODY_COLOR_GREEN, CHICKEN_BODY_COLOR_BLUE]
const CHICKEN_HEAD_SIZE_XY = 0.48
const CHICKEN_HEAD_SIZE_Z = 0.44
const CHICKEN_HEAD_CENTER_Y = 1.25
const CHICKEN_HEAD_CENTER_Z = -0.14
const CHICKEN_HEAD_COLOR_RED = 242
const CHICKEN_HEAD_COLOR_GREEN = 238
const CHICKEN_HEAD_COLOR_BLUE = 218
const CHICKEN_HEAD_COLOR: MobVisualColor = [CHICKEN_HEAD_COLOR_RED, CHICKEN_HEAD_COLOR_GREEN, CHICKEN_HEAD_COLOR_BLUE]
const CHICKEN_BEAK_SIZE_X = 0.26
const CHICKEN_BEAK_SIZE_Y = 0.16
const CHICKEN_BEAK_SIZE_Z = 0.24
const CHICKEN_BEAK_CENTER_Y = 1.18
const CHICKEN_BEAK_CENTER_Z = -0.46
const CHICKEN_BEAK_COLOR_RED = 225
const CHICKEN_BEAK_COLOR_GREEN = 166
const CHICKEN_BEAK_COLOR_BLUE = 50
const CHICKEN_BEAK_COLOR: MobVisualColor = [CHICKEN_BEAK_COLOR_RED, CHICKEN_BEAK_COLOR_GREEN, CHICKEN_BEAK_COLOR_BLUE]
const CHICKEN_WING_SIZE_X = 0.12
const CHICKEN_WING_SIZE_Y = 0.48
const CHICKEN_WING_SIZE_Z = 0.52
const CHICKEN_WING_CENTER_X = 0.43
const CHICKEN_WING_CENTER_Y = 0.78
const CHICKEN_WING_COLOR_RED = 211
const CHICKEN_WING_COLOR_GREEN = 207
const CHICKEN_WING_COLOR_BLUE = 193
const CHICKEN_WING_COLOR: MobVisualColor = [CHICKEN_WING_COLOR_RED, CHICKEN_WING_COLOR_GREEN, CHICKEN_WING_COLOR_BLUE]
const CHICKEN_LEG_SIZE_XZ = 0.1
const CHICKEN_LEG_SIZE_Y = 0.48
const CHICKEN_LEG_CENTER_X = 0.18
const CHICKEN_LEG_CENTER_Y = 0.24
const CHICKEN_LEG_COLOR_RED = 188
const CHICKEN_LEG_COLOR_GREEN = 133
const CHICKEN_LEG_COLOR_BLUE = 44
const CHICKEN_LEG_COLOR: MobVisualColor = [CHICKEN_LEG_COLOR_RED, CHICKEN_LEG_COLOR_GREEN, CHICKEN_LEG_COLOR_BLUE]
const CHICKEN_SCALE_UNIT = 0.72

const COW_BODY_COLOR_RED = 105
const COW_BODY_COLOR_GREEN = 70
const COW_BODY_COLOR_BLUE = 49
const COW_BODY_COLOR: MobVisualColor = [COW_BODY_COLOR_RED, COW_BODY_COLOR_GREEN, COW_BODY_COLOR_BLUE]
const COW_HEAD_COLOR_RED = 126
const COW_HEAD_COLOR_GREEN = 87
const COW_HEAD_COLOR_BLUE = 61
const COW_HEAD_COLOR: MobVisualColor = [COW_HEAD_COLOR_RED, COW_HEAD_COLOR_GREEN, COW_HEAD_COLOR_BLUE]
const COW_SCALE_UNIT = 1.12
const COW_HORN_SIZE_XZ = 0.12
const COW_HORN_SIZE_Y = 0.22
const COW_HORN_CENTER_X = 0.25
const COW_HORN_CENTER_Y = 1.42
const COW_HORN_CENTER_Z = -0.82
const COW_HORN_COLOR_RED = 222
const COW_HORN_COLOR_GREEN = 210
const COW_HORN_COLOR_BLUE = 166
const COW_HORN_COLOR: MobVisualColor = [COW_HORN_COLOR_RED, COW_HORN_COLOR_GREEN, COW_HORN_COLOR_BLUE]

const CREEPER_HEAD_SIZE_UNIT = 0.62
const CREEPER_HEAD_CENTER_Y = 1.42
const CREEPER_HEAD_COLOR_RED = 72
const CREEPER_HEAD_COLOR_GREEN = 167
const CREEPER_HEAD_COLOR_BLUE = 65
const CREEPER_HEAD_COLOR: MobVisualColor = [CREEPER_HEAD_COLOR_RED, CREEPER_HEAD_COLOR_GREEN, CREEPER_HEAD_COLOR_BLUE]
const CREEPER_BODY_SIZE_X = 0.48
const CREEPER_BODY_SIZE_Y = 0.8
const CREEPER_BODY_SIZE_Z = 0.42
const CREEPER_BODY_CENTER_Y = 0.78
const CREEPER_BODY_COLOR_RED = 65
const CREEPER_BODY_COLOR_GREEN = 146
const CREEPER_BODY_COLOR_BLUE = 59
const CREEPER_BODY_COLOR: MobVisualColor = [CREEPER_BODY_COLOR_RED, CREEPER_BODY_COLOR_GREEN, CREEPER_BODY_COLOR_BLUE]
const CREEPER_LEG_SIZE_XZ = 0.22
const CREEPER_LEG_SIZE_Y = 0.48
const CREEPER_LEG_CENTER_X = 0.2
const CREEPER_LEG_CENTER_Y = 0.24
const CREEPER_LEG_CENTER_Z = 0.16
const CREEPER_LEG_COLOR_RED = 55
const CREEPER_LEG_COLOR_GREEN = 126
const CREEPER_LEG_COLOR_BLUE = 51
const CREEPER_LEG_COLOR: MobVisualColor = [CREEPER_LEG_COLOR_RED, CREEPER_LEG_COLOR_GREEN, CREEPER_LEG_COLOR_BLUE]

const ENDERMAN_SCALE_XZ = 0.85
const ENDERMAN_SCALE_Y = 1.58
const ENDERMAN_HEAD_COLOR_RED = 31
const ENDERMAN_HEAD_COLOR_GREEN = 27
const ENDERMAN_HEAD_COLOR_BLUE = 35
const ENDERMAN_HEAD_COLOR: MobVisualColor = [ENDERMAN_HEAD_COLOR_RED, ENDERMAN_HEAD_COLOR_GREEN, ENDERMAN_HEAD_COLOR_BLUE]
const ENDERMAN_BODY_COLOR_RED = 24
const ENDERMAN_BODY_COLOR_GREEN = 21
const ENDERMAN_BODY_COLOR_BLUE = 28
const ENDERMAN_BODY_COLOR: MobVisualColor = [ENDERMAN_BODY_COLOR_RED, ENDERMAN_BODY_COLOR_GREEN, ENDERMAN_BODY_COLOR_BLUE]
const ENDERMAN_LIMBS_COLOR_RED = 19
const ENDERMAN_LIMBS_COLOR_GREEN = 17
const ENDERMAN_LIMBS_COLOR_BLUE = 23
const ENDERMAN_LIMBS_COLOR: MobVisualColor = [ENDERMAN_LIMBS_COLOR_RED, ENDERMAN_LIMBS_COLOR_GREEN, ENDERMAN_LIMBS_COLOR_BLUE]
const ENDERMAN_EYE_SIZE_X = 0.13
const ENDERMAN_EYE_SIZE_Y = 0.06
const ENDERMAN_EYE_SIZE_Z = 0.02
const ENDERMAN_EYE_CENTER_X = 0.13
const ENDERMAN_EYE_CENTER_Y = 1.58
const ENDERMAN_EYE_CENTER_Z = -0.26
const ENDERMAN_EYE_COLOR_RED = 196
const ENDERMAN_EYE_COLOR_GREEN = 58
const ENDERMAN_EYE_COLOR_BLUE = 210
const ENDERMAN_EYE_COLOR: MobVisualColor = [ENDERMAN_EYE_COLOR_RED, ENDERMAN_EYE_COLOR_GREEN, ENDERMAN_EYE_COLOR_BLUE]

const PIG_BODY_COLOR_RED = 222
const PIG_BODY_COLOR_GREEN = 144
const PIG_BODY_COLOR_BLUE = 151
const PIG_BODY_COLOR: MobVisualColor = [PIG_BODY_COLOR_RED, PIG_BODY_COLOR_GREEN, PIG_BODY_COLOR_BLUE]
const PIG_HEAD_COLOR_RED = 235
const PIG_HEAD_COLOR_GREEN = 161
const PIG_HEAD_COLOR_BLUE = 167
const PIG_HEAD_COLOR: MobVisualColor = [PIG_HEAD_COLOR_RED, PIG_HEAD_COLOR_GREEN, PIG_HEAD_COLOR_BLUE]
const PIG_SCALE_UNIT = 0.9
const PIG_SNOUT_SIZE_X = 0.4
const PIG_SNOUT_SIZE_Y = 0.25
const PIG_SNOUT_SIZE_Z = 0.18
const PIG_SNOUT_CENTER_Y = 0.98
const PIG_SNOUT_CENTER_Z = -1.11
const PIG_SNOUT_COLOR_RED = 207
const PIG_SNOUT_COLOR_GREEN = 119
const PIG_SNOUT_COLOR_BLUE = 132
const PIG_SNOUT_COLOR: MobVisualColor = [PIG_SNOUT_COLOR_RED, PIG_SNOUT_COLOR_GREEN, PIG_SNOUT_COLOR_BLUE]

const SHEEP_BODY_COLOR_RED = 229
const SHEEP_BODY_COLOR_GREEN = 225
const SHEEP_BODY_COLOR_BLUE = 209
const SHEEP_BODY_COLOR: MobVisualColor = [SHEEP_BODY_COLOR_RED, SHEEP_BODY_COLOR_GREEN, SHEEP_BODY_COLOR_BLUE]
const SHEEP_HEAD_COLOR_RED = 106
const SHEEP_HEAD_COLOR_GREEN = 97
const SHEEP_HEAD_COLOR_BLUE = 86
const SHEEP_HEAD_COLOR: MobVisualColor = [SHEEP_HEAD_COLOR_RED, SHEEP_HEAD_COLOR_GREEN, SHEEP_HEAD_COLOR_BLUE]
const SHEEP_SCALE_UNIT = 1.05
const SHEEP_WOOL_CAP_SIZE_X = 0.7
const SHEEP_WOOL_CAP_SIZE_Y = 0.25
const SHEEP_WOOL_CAP_SIZE_Z = 0.62
const SHEEP_WOOL_CAP_CENTER_Y = 1.31
const SHEEP_WOOL_CAP_CENTER_Z = -0.77
const SHEEP_WOOL_CAP_COLOR_RED = 235
const SHEEP_WOOL_CAP_COLOR_GREEN = 232
const SHEEP_WOOL_CAP_COLOR_BLUE = 218
const SHEEP_WOOL_CAP_COLOR: MobVisualColor = [SHEEP_WOOL_CAP_COLOR_RED, SHEEP_WOOL_CAP_COLOR_GREEN, SHEEP_WOOL_CAP_COLOR_BLUE]

const SKELETON_SCALE_XZ = 0.95
const SKELETON_SCALE_Y = 1.05
const SKELETON_HEAD_COLOR_RED = 218
const SKELETON_HEAD_COLOR_GREEN = 214
const SKELETON_HEAD_COLOR_BLUE = 194
const SKELETON_HEAD_COLOR: MobVisualColor = [SKELETON_HEAD_COLOR_RED, SKELETON_HEAD_COLOR_GREEN, SKELETON_HEAD_COLOR_BLUE]
const SKELETON_BODY_COLOR_RED = 205
const SKELETON_BODY_COLOR_GREEN = 202
const SKELETON_BODY_COLOR_BLUE = 184
const SKELETON_BODY_COLOR: MobVisualColor = [SKELETON_BODY_COLOR_RED, SKELETON_BODY_COLOR_GREEN, SKELETON_BODY_COLOR_BLUE]
const SKELETON_LIMBS_COLOR_RED = 225
const SKELETON_LIMBS_COLOR_GREEN = 222
const SKELETON_LIMBS_COLOR_BLUE = 205
const SKELETON_LIMBS_COLOR: MobVisualColor = [SKELETON_LIMBS_COLOR_RED, SKELETON_LIMBS_COLOR_GREEN, SKELETON_LIMBS_COLOR_BLUE]

const SPIDER_ABDOMEN_SIZE_X = 0.85
const SPIDER_ABDOMEN_SIZE_Y = 0.52
const SPIDER_ABDOMEN_SIZE_Z = 1
const SPIDER_ABDOMEN_CENTER_Y = 0.48
const SPIDER_ABDOMEN_CENTER_Z = 0.25
const SPIDER_ABDOMEN_COLOR_RED = 50
const SPIDER_ABDOMEN_COLOR_GREEN = 42
const SPIDER_ABDOMEN_COLOR_BLUE = 47
const SPIDER_ABDOMEN_COLOR: MobVisualColor = [SPIDER_ABDOMEN_COLOR_RED, SPIDER_ABDOMEN_COLOR_GREEN, SPIDER_ABDOMEN_COLOR_BLUE]
const SPIDER_HEAD_SIZE_X = 0.65
const SPIDER_HEAD_SIZE_Y = 0.45
const SPIDER_HEAD_SIZE_Z = 0.58
const SPIDER_HEAD_CENTER_Y = 0.48
const SPIDER_HEAD_CENTER_Z = -0.55
const SPIDER_HEAD_COLOR_RED = 42
const SPIDER_HEAD_COLOR_GREEN = 35
const SPIDER_HEAD_COLOR_BLUE = 39
const SPIDER_HEAD_COLOR: MobVisualColor = [SPIDER_HEAD_COLOR_RED, SPIDER_HEAD_COLOR_GREEN, SPIDER_HEAD_COLOR_BLUE]
const SPIDER_EYES_SIZE_X = 0.38
const SPIDER_EYES_SIZE_Y = 0.09
const SPIDER_EYES_SIZE_Z = 0.03
const SPIDER_EYES_CENTER_Y = 0.53
const SPIDER_EYES_CENTER_Z = -0.86
const SPIDER_EYES_COLOR_RED = 176
const SPIDER_EYES_COLOR_GREEN = 35
const SPIDER_EYES_COLOR_BLUE = 29
const SPIDER_EYES_COLOR: MobVisualColor = [SPIDER_EYES_COLOR_RED, SPIDER_EYES_COLOR_GREEN, SPIDER_EYES_COLOR_BLUE]
const SPIDER_LEG_COLOR_RED = 38
const SPIDER_LEG_COLOR_GREEN = 31
const SPIDER_LEG_COLOR_BLUE = 35
const SPIDER_LEG_COLOR: MobVisualColor = [SPIDER_LEG_COLOR_RED, SPIDER_LEG_COLOR_GREEN, SPIDER_LEG_COLOR_BLUE]
const SPIDER_SCALE_XZ = 1.15

const ZOMBIE_HEAD_COLOR_RED = 95
const ZOMBIE_HEAD_COLOR_GREEN = 155
const ZOMBIE_HEAD_COLOR_BLUE = 85
const ZOMBIE_HEAD_COLOR: MobVisualColor = [ZOMBIE_HEAD_COLOR_RED, ZOMBIE_HEAD_COLOR_GREEN, ZOMBIE_HEAD_COLOR_BLUE]
const ZOMBIE_BODY_COLOR_RED = 65
const ZOMBIE_BODY_COLOR_GREEN = 95
const ZOMBIE_BODY_COLOR_BLUE = 145
const ZOMBIE_BODY_COLOR: MobVisualColor = [ZOMBIE_BODY_COLOR_RED, ZOMBIE_BODY_COLOR_GREEN, ZOMBIE_BODY_COLOR_BLUE]
const ZOMBIE_LIMBS_COLOR_RED = 80
const ZOMBIE_LIMBS_COLOR_GREEN = 130
const ZOMBIE_LIMBS_COLOR_BLUE = 75
const ZOMBIE_LIMBS_COLOR: MobVisualColor = [ZOMBIE_LIMBS_COLOR_RED, ZOMBIE_LIMBS_COLOR_GREEN, ZOMBIE_LIMBS_COLOR_BLUE]

const ZOMBIFIED_PIGLIN_SCALE_X = 1.05
const ZOMBIFIED_PIGLIN_SCALE_Y = 1.02
const ZOMBIFIED_PIGLIN_HEAD_COLOR_RED = 212
const ZOMBIFIED_PIGLIN_HEAD_COLOR_GREEN = 132
const ZOMBIFIED_PIGLIN_HEAD_COLOR_BLUE = 125
const ZOMBIFIED_PIGLIN_HEAD_COLOR: MobVisualColor = [ZOMBIFIED_PIGLIN_HEAD_COLOR_RED, ZOMBIFIED_PIGLIN_HEAD_COLOR_GREEN, ZOMBIFIED_PIGLIN_HEAD_COLOR_BLUE]
const ZOMBIFIED_PIGLIN_BODY_COLOR_RED = 125
const ZOMBIFIED_PIGLIN_BODY_COLOR_GREEN = 75
const ZOMBIFIED_PIGLIN_BODY_COLOR_BLUE = 62
const ZOMBIFIED_PIGLIN_BODY_COLOR: MobVisualColor = [ZOMBIFIED_PIGLIN_BODY_COLOR_RED, ZOMBIFIED_PIGLIN_BODY_COLOR_GREEN, ZOMBIFIED_PIGLIN_BODY_COLOR_BLUE]
const ZOMBIFIED_PIGLIN_LIMBS_COLOR_RED = 161
const ZOMBIFIED_PIGLIN_LIMBS_COLOR_GREEN = 118
const ZOMBIFIED_PIGLIN_LIMBS_COLOR_BLUE = 92
const ZOMBIFIED_PIGLIN_LIMBS_COLOR: MobVisualColor = [ZOMBIFIED_PIGLIN_LIMBS_COLOR_RED, ZOMBIFIED_PIGLIN_LIMBS_COLOR_GREEN, ZOMBIFIED_PIGLIN_LIMBS_COLOR_BLUE]
const ZOMBIFIED_PIGLIN_SNOUT_SIZE_X = 0.32
const ZOMBIFIED_PIGLIN_SNOUT_SIZE_Y = 0.22
const ZOMBIFIED_PIGLIN_SNOUT_SIZE_Z = 0.18
const ZOMBIFIED_PIGLIN_SNOUT_CENTER_Y = 1.5
const ZOMBIFIED_PIGLIN_SNOUT_CENTER_Z = -0.32
const ZOMBIFIED_PIGLIN_SNOUT_COLOR_RED = 191
const ZOMBIFIED_PIGLIN_SNOUT_COLOR_GREEN = 112
const ZOMBIFIED_PIGLIN_SNOUT_COLOR_BLUE = 111
const ZOMBIFIED_PIGLIN_SNOUT_COLOR: MobVisualColor = [ZOMBIFIED_PIGLIN_SNOUT_COLOR_RED, ZOMBIFIED_PIGLIN_SNOUT_COLOR_GREEN, ZOMBIFIED_PIGLIN_SNOUT_COLOR_BLUE]

const descriptors: Readonly<Record<MobVisualKind, MobVisualDescriptor>> = {
  blaze: {
    kind: 'blaze',
    parts: [
      part({
        center: [AXIS_ORIGIN, BLAZE_HEAD_CENTER_Y, AXIS_ORIGIN],
        color: BLAZE_HEAD_COLOR,
        id: 'head',
        motion: 'body',
        role: 'head',
        size: [BLAZE_HEAD_SIZE_UNIT, BLAZE_HEAD_SIZE_UNIT, BLAZE_HEAD_SIZE_UNIT],
      }),
      part({
        center: [AXIS_ORIGIN, BLAZE_EYES_CENTER_Y, BLAZE_EYES_CENTER_Z],
        color: BLAZE_EYES_COLOR,
        id: 'eyes',
        role: 'eye',
        size: [BLAZE_EYES_SIZE_X, BLAZE_EYES_SIZE_Y, BLAZE_EYES_SIZE_Z],
      }),
      ...blazeRods(BLAZE_ROD_COLOR),
    ],
    scale: [UNIT_SCALE, BLAZE_SCALE_Y, UNIT_SCALE],
    temperament: 'hostile',
  },
  chicken: {
    kind: 'chicken',
    parts: [
      part({
        center: [AXIS_ORIGIN, CHICKEN_BODY_CENTER_Y, AXIS_ORIGIN],
        color: CHICKEN_BODY_COLOR,
        id: 'body',
        motion: 'body',
        role: 'body',
        size: [CHICKEN_BODY_SIZE_X, CHICKEN_BODY_SIZE_Y, CHICKEN_BODY_SIZE_Z],
      }),
      part({
        center: [AXIS_ORIGIN, CHICKEN_HEAD_CENTER_Y, CHICKEN_HEAD_CENTER_Z],
        color: CHICKEN_HEAD_COLOR,
        id: 'head',
        role: 'head',
        size: [CHICKEN_HEAD_SIZE_XY, CHICKEN_HEAD_SIZE_XY, CHICKEN_HEAD_SIZE_Z],
      }),
      part({
        center: [AXIS_ORIGIN, CHICKEN_BEAK_CENTER_Y, CHICKEN_BEAK_CENTER_Z],
        color: CHICKEN_BEAK_COLOR,
        id: 'beak',
        role: 'beak',
        size: [CHICKEN_BEAK_SIZE_X, CHICKEN_BEAK_SIZE_Y, CHICKEN_BEAK_SIZE_Z],
      }),
      part({
        center: [-CHICKEN_WING_CENTER_X, CHICKEN_WING_CENTER_Y, AXIS_ORIGIN],
        color: CHICKEN_WING_COLOR,
        id: 'left-wing',
        motion: 'left_wing',
        role: 'wing',
        size: [CHICKEN_WING_SIZE_X, CHICKEN_WING_SIZE_Y, CHICKEN_WING_SIZE_Z],
      }),
      part({
        center: [CHICKEN_WING_CENTER_X, CHICKEN_WING_CENTER_Y, AXIS_ORIGIN],
        color: CHICKEN_WING_COLOR,
        id: 'right-wing',
        motion: 'right_wing',
        role: 'wing',
        size: [CHICKEN_WING_SIZE_X, CHICKEN_WING_SIZE_Y, CHICKEN_WING_SIZE_Z],
      }),
      part({
        center: [-CHICKEN_LEG_CENTER_X, CHICKEN_LEG_CENTER_Y, AXIS_ORIGIN],
        color: CHICKEN_LEG_COLOR,
        id: 'left-leg',
        motion: 'left_limb',
        role: 'leg',
        size: [CHICKEN_LEG_SIZE_XZ, CHICKEN_LEG_SIZE_Y, CHICKEN_LEG_SIZE_XZ],
      }),
      part({
        center: [CHICKEN_LEG_CENTER_X, CHICKEN_LEG_CENTER_Y, AXIS_ORIGIN],
        color: CHICKEN_LEG_COLOR,
        id: 'right-leg',
        motion: 'right_limb',
        role: 'leg',
        size: [CHICKEN_LEG_SIZE_XZ, CHICKEN_LEG_SIZE_Y, CHICKEN_LEG_SIZE_XZ],
      }),
    ],
    scale: [CHICKEN_SCALE_UNIT, CHICKEN_SCALE_UNIT, CHICKEN_SCALE_UNIT],
    temperament: 'passive',
  },
  cow: quadruped({
    bodyColor: COW_BODY_COLOR,
    extras: [
      part({
        center: [-COW_HORN_CENTER_X, COW_HORN_CENTER_Y, COW_HORN_CENTER_Z],
        color: COW_HORN_COLOR,
        id: 'left-horn',
        role: 'horn',
        size: [COW_HORN_SIZE_XZ, COW_HORN_SIZE_Y, COW_HORN_SIZE_XZ],
      }),
      part({
        center: [COW_HORN_CENTER_X, COW_HORN_CENTER_Y, COW_HORN_CENTER_Z],
        color: COW_HORN_COLOR,
        id: 'right-horn',
        role: 'horn',
        size: [COW_HORN_SIZE_XZ, COW_HORN_SIZE_Y, COW_HORN_SIZE_XZ],
      }),
    ],
    headColor: COW_HEAD_COLOR,
    kind: 'cow',
    scale: [COW_SCALE_UNIT, COW_SCALE_UNIT, COW_SCALE_UNIT],
  }),
  creeper: {
    kind: 'creeper',
    parts: [
      part({
        center: [AXIS_ORIGIN, CREEPER_HEAD_CENTER_Y, AXIS_ORIGIN],
        color: CREEPER_HEAD_COLOR,
        id: 'head',
        role: 'head',
        size: [CREEPER_HEAD_SIZE_UNIT, CREEPER_HEAD_SIZE_UNIT, CREEPER_HEAD_SIZE_UNIT],
      }),
      part({
        center: [AXIS_ORIGIN, CREEPER_BODY_CENTER_Y, AXIS_ORIGIN],
        color: CREEPER_BODY_COLOR,
        id: 'body',
        motion: 'body',
        role: 'body',
        size: [CREEPER_BODY_SIZE_X, CREEPER_BODY_SIZE_Y, CREEPER_BODY_SIZE_Z],
      }),
      part({
        center: [-CREEPER_LEG_CENTER_X, CREEPER_LEG_CENTER_Y, -CREEPER_LEG_CENTER_Z],
        color: CREEPER_LEG_COLOR,
        id: 'front-left-leg',
        motion: 'left_limb',
        role: 'leg',
        size: [CREEPER_LEG_SIZE_XZ, CREEPER_LEG_SIZE_Y, CREEPER_LEG_SIZE_XZ],
      }),
      part({
        center: [CREEPER_LEG_CENTER_X, CREEPER_LEG_CENTER_Y, -CREEPER_LEG_CENTER_Z],
        color: CREEPER_LEG_COLOR,
        id: 'front-right-leg',
        motion: 'right_limb',
        role: 'leg',
        size: [CREEPER_LEG_SIZE_XZ, CREEPER_LEG_SIZE_Y, CREEPER_LEG_SIZE_XZ],
      }),
      part({
        center: [-CREEPER_LEG_CENTER_X, CREEPER_LEG_CENTER_Y, CREEPER_LEG_CENTER_Z],
        color: CREEPER_LEG_COLOR,
        id: 'back-left-leg',
        motion: 'right_limb',
        role: 'leg',
        size: [CREEPER_LEG_SIZE_XZ, CREEPER_LEG_SIZE_Y, CREEPER_LEG_SIZE_XZ],
      }),
      part({
        center: [CREEPER_LEG_CENTER_X, CREEPER_LEG_CENTER_Y, CREEPER_LEG_CENTER_Z],
        color: CREEPER_LEG_COLOR,
        id: 'back-right-leg',
        motion: 'left_limb',
        role: 'leg',
        size: [CREEPER_LEG_SIZE_XZ, CREEPER_LEG_SIZE_Y, CREEPER_LEG_SIZE_XZ],
      }),
    ],
    scale: [UNIT_SCALE, UNIT_SCALE, UNIT_SCALE],
    temperament: 'hostile',
  },
  enderman: biped({
    colors: { body: ENDERMAN_BODY_COLOR, head: ENDERMAN_HEAD_COLOR, limbs: ENDERMAN_LIMBS_COLOR },
    extras: [
      part({
        center: [-ENDERMAN_EYE_CENTER_X, ENDERMAN_EYE_CENTER_Y, ENDERMAN_EYE_CENTER_Z],
        color: ENDERMAN_EYE_COLOR,
        id: 'left-eye',
        role: 'eye',
        size: [ENDERMAN_EYE_SIZE_X, ENDERMAN_EYE_SIZE_Y, ENDERMAN_EYE_SIZE_Z],
      }),
      part({
        center: [ENDERMAN_EYE_CENTER_X, ENDERMAN_EYE_CENTER_Y, ENDERMAN_EYE_CENTER_Z],
        color: ENDERMAN_EYE_COLOR,
        id: 'right-eye',
        role: 'eye',
        size: [ENDERMAN_EYE_SIZE_X, ENDERMAN_EYE_SIZE_Y, ENDERMAN_EYE_SIZE_Z],
      }),
    ],
    kind: 'enderman',
    scale: [ENDERMAN_SCALE_XZ, ENDERMAN_SCALE_Y, ENDERMAN_SCALE_XZ],
    slender: true,
    temperament: 'hostile',
  }),
  pig: quadruped({
    bodyColor: PIG_BODY_COLOR,
    extras: [
      part({
        center: [AXIS_ORIGIN, PIG_SNOUT_CENTER_Y, PIG_SNOUT_CENTER_Z],
        color: PIG_SNOUT_COLOR,
        id: 'snout',
        role: 'snout',
        size: [PIG_SNOUT_SIZE_X, PIG_SNOUT_SIZE_Y, PIG_SNOUT_SIZE_Z],
      }),
    ],
    headColor: PIG_HEAD_COLOR,
    kind: 'pig',
    scale: [PIG_SCALE_UNIT, PIG_SCALE_UNIT, PIG_SCALE_UNIT],
  }),
  sheep: quadruped({
    bodyColor: SHEEP_BODY_COLOR,
    extras: [
      part({
        center: [AXIS_ORIGIN, SHEEP_WOOL_CAP_CENTER_Y, SHEEP_WOOL_CAP_CENTER_Z],
        color: SHEEP_WOOL_CAP_COLOR,
        id: 'wool-cap',
        role: 'body',
        size: [SHEEP_WOOL_CAP_SIZE_X, SHEEP_WOOL_CAP_SIZE_Y, SHEEP_WOOL_CAP_SIZE_Z],
      }),
    ],
    headColor: SHEEP_HEAD_COLOR,
    kind: 'sheep',
    scale: [SHEEP_SCALE_UNIT, SHEEP_SCALE_UNIT, SHEEP_SCALE_UNIT],
  }),
  skeleton: biped({
    colors: { body: SKELETON_BODY_COLOR, head: SKELETON_HEAD_COLOR, limbs: SKELETON_LIMBS_COLOR },
    kind: 'skeleton',
    scale: [SKELETON_SCALE_XZ, SKELETON_SCALE_Y, SKELETON_SCALE_XZ],
    slender: true,
    temperament: 'hostile',
  }),
  spider: {
    kind: 'spider',
    parts: [
      part({
        center: [AXIS_ORIGIN, SPIDER_ABDOMEN_CENTER_Y, SPIDER_ABDOMEN_CENTER_Z],
        color: SPIDER_ABDOMEN_COLOR,
        id: 'abdomen',
        motion: 'body',
        role: 'body',
        size: [SPIDER_ABDOMEN_SIZE_X, SPIDER_ABDOMEN_SIZE_Y, SPIDER_ABDOMEN_SIZE_Z],
      }),
      part({
        center: [AXIS_ORIGIN, SPIDER_HEAD_CENTER_Y, SPIDER_HEAD_CENTER_Z],
        color: SPIDER_HEAD_COLOR,
        id: 'head',
        role: 'head',
        size: [SPIDER_HEAD_SIZE_X, SPIDER_HEAD_SIZE_Y, SPIDER_HEAD_SIZE_Z],
      }),
      part({
        center: [AXIS_ORIGIN, SPIDER_EYES_CENTER_Y, SPIDER_EYES_CENTER_Z],
        color: SPIDER_EYES_COLOR,
        id: 'eyes',
        role: 'eye',
        size: [SPIDER_EYES_SIZE_X, SPIDER_EYES_SIZE_Y, SPIDER_EYES_SIZE_Z],
      }),
      ...spiderLegs(SPIDER_LEG_COLOR),
    ],
    scale: [SPIDER_SCALE_XZ, UNIT_SCALE, SPIDER_SCALE_XZ],
    temperament: 'hostile',
  },
  zombie: biped({
    colors: { body: ZOMBIE_BODY_COLOR, head: ZOMBIE_HEAD_COLOR, limbs: ZOMBIE_LIMBS_COLOR },
    kind: 'zombie',
    scale: [UNIT_SCALE, UNIT_SCALE, UNIT_SCALE],
    temperament: 'hostile',
  }),
  zombified_piglin: biped({
    colors: {
      body: ZOMBIFIED_PIGLIN_BODY_COLOR,
      head: ZOMBIFIED_PIGLIN_HEAD_COLOR,
      limbs: ZOMBIFIED_PIGLIN_LIMBS_COLOR,
    },
    extras: [
      part({
        center: [AXIS_ORIGIN, ZOMBIFIED_PIGLIN_SNOUT_CENTER_Y, ZOMBIFIED_PIGLIN_SNOUT_CENTER_Z],
        color: ZOMBIFIED_PIGLIN_SNOUT_COLOR,
        id: 'snout',
        role: 'snout',
        size: [ZOMBIFIED_PIGLIN_SNOUT_SIZE_X, ZOMBIFIED_PIGLIN_SNOUT_SIZE_Y, ZOMBIFIED_PIGLIN_SNOUT_SIZE_Z],
      }),
    ],
    kind: 'zombified_piglin',
    scale: [ZOMBIFIED_PIGLIN_SCALE_X, ZOMBIFIED_PIGLIN_SCALE_Y, UNIT_SCALE],
    temperament: 'hostile',
  }),
}

const UNKNOWN_BODY_SIZE_X = 0.65
const UNKNOWN_BODY_SIZE_Y = 0.9
const UNKNOWN_BODY_SIZE_Z = 0.5
const UNKNOWN_BODY_CENTER_Y = 0.65
const UNKNOWN_BODY_COLOR_RED = 154
const UNKNOWN_BODY_COLOR_GREEN = 82
const UNKNOWN_BODY_COLOR_BLUE = 57
const UNKNOWN_BODY_COLOR: MobVisualColor = [UNKNOWN_BODY_COLOR_RED, UNKNOWN_BODY_COLOR_GREEN, UNKNOWN_BODY_COLOR_BLUE]
const UNKNOWN_HEAD_SIZE_UNIT = 0.52
const UNKNOWN_HEAD_CENTER_Y = 1.35
const UNKNOWN_HEAD_COLOR_RED = 185
const UNKNOWN_HEAD_COLOR_GREEN = 111
const UNKNOWN_HEAD_COLOR_BLUE = 72
const UNKNOWN_HEAD_COLOR: MobVisualColor = [UNKNOWN_HEAD_COLOR_RED, UNKNOWN_HEAD_COLOR_GREEN, UNKNOWN_HEAD_COLOR_BLUE]

export const UNKNOWN_MOB_VISUAL: MobVisualDescriptor = {
  kind: 'unknown',
  parts: [
    part({
      center: [AXIS_ORIGIN, UNKNOWN_BODY_CENTER_Y, AXIS_ORIGIN],
      color: UNKNOWN_BODY_COLOR,
      id: 'body',
      motion: 'body',
      role: 'body',
      size: [UNKNOWN_BODY_SIZE_X, UNKNOWN_BODY_SIZE_Y, UNKNOWN_BODY_SIZE_Z],
    }),
    part({
      center: [AXIS_ORIGIN, UNKNOWN_HEAD_CENTER_Y, AXIS_ORIGIN],
      color: UNKNOWN_HEAD_COLOR,
      id: 'head',
      role: 'head',
      size: [UNKNOWN_HEAD_SIZE_UNIT, UNKNOWN_HEAD_SIZE_UNIT, UNKNOWN_HEAD_SIZE_UNIT],
    }),
  ],
  scale: [UNIT_SCALE, UNIT_SCALE, UNIT_SCALE],
  temperament: 'neutral',
}

const knownKinds = new Set<string>(MOB_VISUAL_KINDS)

export const mobVisualDescriptor = (kind: string): MobVisualDescriptor => {
  if (knownKinds.has(kind)) {
    return descriptors[kind as MobVisualKind]
  }
  return UNKNOWN_MOB_VISUAL
}

const finiteOr = (value: number | undefined, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  return fallback
}

const UNIT_INTERVAL_MIN = 0
const UNIT_INTERVAL_MAX = 1

const clamp01 = (value: number): number => Math.max(UNIT_INTERVAL_MIN, Math.min(UNIT_INTERVAL_MAX, value))

const scaleVector = (vector: MobVisualVector, scale: MobVisualVector): MobVisualVector => [
  vector[X_AXIS_INDEX] * scale[X_AXIS_INDEX],
  vector[Y_AXIS_INDEX] * scale[Y_AXIS_INDEX],
  vector[Z_AXIS_INDEX] * scale[Z_AXIS_INDEX],
]

/* -- Animation planning -- */

const DEFAULT_PHASE_RADIANS = 0
const NO_PROGRESS = 0
const FULL_PROGRESS = 1
const NO_ROTATION = 0
const WALK_STRIDE_SCALE = 0.65
const IDLE_BOB_PHASE_SCALE = 0.5
const IDLE_BOB_AMPLITUDE = 0.025
const HURT_LEAN_SCALE = 0.24
const DEATH_LEAN_AT_FULL_PROGRESS = Math.PI / QUARTER_TURN_DIVISOR
const SPIDER_LEG_ROTATION_INDEX_OFFSET = 1.5
const SPIDER_LEG_ROTATION_Y_SCALE = 0.18
const SPIDER_LEG_ROTATION_Z_BASE = 0.72
const SPIDER_LEG_ROTATION_Z_SWING = 0.12
const WING_ROTATION_Z_BASE = 0.18
const WING_ROTATION_Z_SWING = 0.65
const BLAZE_ORBIT_PHASE_SCALE = 0.55
const BLAZE_ORBIT_BOB_INDEX_SCALE = 0.7
const BLAZE_ORBIT_BOB_AMPLITUDE = 0.08

const DEFAULT_ANIMATION_INPUT: MobAnimationInput = { state: 'idle' }

const resolveDefaultProgress = (state: MobAnimationState): number => {
  if (state === 'hurt' || state === 'death') {
    return FULL_PROGRESS
  }
  return NO_PROGRESS
}

type AnimationSample = Readonly<Required<MobAnimationInput>>

const resolveAnimationSample = (input: MobAnimationInput): AnimationSample => {
  const phaseRadians = finiteOr(input.phaseRadians, DEFAULT_PHASE_RADIANS)
  const progress = clamp01(finiteOr(input.progress, resolveDefaultProgress(input.state)))
  return { phaseRadians, progress, state: input.state }
}

const strideFor = (state: MobAnimationState, phaseRadians: number): number => {
  if (state === 'walk') {
    return Math.sin(phaseRadians) * WALK_STRIDE_SCALE
  }
  return NO_ROTATION
}

const idleBobFor = (state: MobAnimationState, phaseRadians: number): number => {
  if (state === 'idle') {
    return Math.sin(phaseRadians * IDLE_BOB_PHASE_SCALE) * IDLE_BOB_AMPLITUDE
  }
  return AXIS_ORIGIN
}

const hurtLeanFor = (state: MobAnimationState, progress: number): number => {
  if (state === 'hurt') {
    return HURT_LEAN_SCALE * progress
  }
  return NO_ROTATION
}

const deathLeanFor = (state: MobAnimationState, progress: number): number => {
  if (state === 'death') {
    return DEATH_LEAN_AT_FULL_PROGRESS * progress
  }
  return NO_ROTATION
}

type MotionOutput = {
  readonly positionX: number
  readonly positionY: number
  readonly positionZ: number
  readonly rotationX: number
  readonly rotationY: number
  readonly rotationZ: number
}

type MotionInputs = {
  readonly phaseRadians: number
  readonly stride: number
  readonly idleBob: number
}

const applyPartMotion = (source: MobVisualPartDescriptor, base: MotionOutput, motionInputs: MotionInputs): MotionOutput => {
  const { phaseRadians, stride, idleBob } = motionInputs
  switch (source.motion) {
    case 'body':
      return { ...base, positionY: base.positionY + idleBob }
    case 'left_limb':
      return { ...base, rotationX: stride }
    case 'right_limb':
      return { ...base, rotationX: -stride }
    case 'left_spider_leg':
      return {
        ...base,
        rotationY: (source.motionIndex - SPIDER_LEG_ROTATION_INDEX_OFFSET) * SPIDER_LEG_ROTATION_Y_SCALE,
        rotationZ:
          -SPIDER_LEG_ROTATION_Z_BASE - Math.sin(phaseRadians + source.motionIndex) * SPIDER_LEG_ROTATION_Z_SWING,
      }
    case 'right_spider_leg':
      return {
        ...base,
        rotationY: -(source.motionIndex - SPIDER_LEG_ROTATION_INDEX_OFFSET) * SPIDER_LEG_ROTATION_Y_SCALE,
        rotationZ:
          SPIDER_LEG_ROTATION_Z_BASE + Math.sin(phaseRadians + source.motionIndex) * SPIDER_LEG_ROTATION_Z_SWING,
      }
    case 'left_wing':
      return {
        ...base,
        rotationZ: -WING_ROTATION_Z_BASE - Math.abs(Math.sin(phaseRadians)) * WING_ROTATION_Z_SWING,
      }
    case 'right_wing':
      return {
        ...base,
        rotationZ: WING_ROTATION_Z_BASE + Math.abs(Math.sin(phaseRadians)) * WING_ROTATION_Z_SWING,
      }
    case 'blaze_orbit': {
      const orbit =
        phaseRadians * BLAZE_ORBIT_PHASE_SCALE +
        (source.motionIndex % BLAZE_RODS_PER_RING) * BLAZE_ROD_RING_ANGLE_STEP
      const radius = Math.hypot(base.positionX, base.positionZ)
      return {
        ...base,
        positionX: Math.cos(orbit) * radius,
        positionY: base.positionY + Math.sin(phaseRadians + source.motionIndex * BLAZE_ORBIT_BOB_INDEX_SCALE) * BLAZE_ORBIT_BOB_AMPLITUDE,
        positionZ: Math.sin(orbit) * radius,
        rotationY: orbit,
      }
    }
    case 'static':
    default:
      return base
  }
}

const applyRootLean = (
  positionX: number,
  positionY: number,
  rootLean: number,
): { readonly leanedX: number; readonly leanedY: number } => ({
  leanedX: positionX * Math.cos(rootLean) - positionY * Math.sin(rootLean),
  leanedY: positionX * Math.sin(rootLean) + positionY * Math.cos(rootLean),
})

type PartPlanContext = {
  readonly idleBob: number
  readonly phaseRadians: number
  readonly rootLean: number
  readonly stride: number
}

const buildPartPlan = (
  source: MobVisualPartDescriptor,
  scale: MobVisualVector,
  context: PartPlanContext,
): MobVisualPartPlan => {
  const [baseX, baseY, baseZ] = scaleVector(source.center, scale)
  const motion = applyPartMotion(
    source,
    { positionX: baseX, positionY: baseY, positionZ: baseZ, rotationX: NO_ROTATION, rotationY: NO_ROTATION, rotationZ: NO_ROTATION },
    { idleBob: context.idleBob, phaseRadians: context.phaseRadians, stride: context.stride },
  )
  const { leanedX, leanedY } = applyRootLean(motion.positionX, motion.positionY, context.rootLean)
  return {
    center: [leanedX, leanedY, motion.positionZ],
    color: source.color,
    id: source.id,
    role: source.role,
    rotation: [motion.rotationX, motion.rotationY, motion.rotationZ + context.rootLean],
    size: scaleVector(source.size, scale),
  }
}

/** Resolve a mob kind and animation sample into immutable cuboid transforms. */
export const planMobVisual = (kind: string, input: MobAnimationInput = DEFAULT_ANIMATION_INPUT): MobVisualPlan => {
  const descriptor = mobVisualDescriptor(kind)
  const animation = resolveAnimationSample(input)
  const { phaseRadians, progress, state } = animation
  const stride = strideFor(state, phaseRadians)
  const idleBob = idleBobFor(state, phaseRadians)
  const hurtLean = hurtLeanFor(state, progress)
  const deathLean = deathLeanFor(state, progress)
  const rootLean = hurtLean + deathLean

  const parts = descriptor.parts.map((source): MobVisualPartPlan =>
    buildPartPlan(source, descriptor.scale, { idleBob, phaseRadians, rootLean, stride }),
  )

  return { animation, descriptorKind: descriptor.kind, parts, temperament: descriptor.temperament }
}
