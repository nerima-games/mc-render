/** Renderer-independent Wither and Wither-skull silhouettes and transforms. */

export type WitherVisualPhase = 'charging' | 'airborne' | 'armoured' | 'dead'
export type WitherSkullVisualVariant = 'normal' | 'blue'

/**
 * `x`/`y`/`z` are kept short and un-renamed on purpose: this type mirrors the
 * shape of the real position/velocity objects mc-sim hands in (see the
 * `WitherVisualStateInput` doc comment below), and `src/application/
 * world-renderer.ts` reads `.x`/`.y`/`.z` straight off values shaped like this
 * to feed three.js `vec3` setters. Renaming these fields would not just be a
 * lint fix, it would desynchronise this type from the runtime objects it
 * describes and from that downstream reader.
 */
export type WitherVisualPosition = Readonly<{
  x: number
  y: number
  z: number
}>

/** Structurally compatible with mc-sim's public `WitherState`. */
export type WitherVisualStateInput = Readonly<{
  phase: WitherVisualPhase
  healthPoints: number
  chargeRemainingSecs: number
  feetPosition: WitherVisualPosition
  velocity: WitherVisualPosition
}>

/** Structurally compatible with mc-sim's public `WitherSkullProjectileDescriptor`. */
export type WitherSkullVisualInput = Readonly<{
  kind: 'wither_skull'
  variant: WitherSkullVisualVariant
  origin: WitherVisualPosition
  direction: WitherVisualPosition
  speed: number
  explosivePower: number
  destroysResistantBlocks: boolean
}>

export type WitherVisualVector = readonly [xAxis: number, yAxis: number, zAxis: number]
export type WitherVisualColor = readonly [red: number, green: number, blue: number]
export type WitherVisualPartRole = 'head' | 'eye' | 'body' | 'rib' | 'tail' | 'armour' | 'projectile'

export type WitherVisualPartDescriptor = Readonly<{
  id: string
  role: WitherVisualPartRole
  size: WitherVisualVector
  center: WitherVisualVector
  rotation: WitherVisualVector
  color: WitherVisualColor
}>

export type WitherVisualDescriptor = Readonly<{
  kind: 'wither'
  parts: ReadonlyArray<WitherVisualPartDescriptor>
}>

export type WitherSkullVisualDescriptor = Readonly<{
  kind: 'wither_skull'
  variant: WitherSkullVisualVariant
  parts: ReadonlyArray<WitherVisualPartDescriptor>
}>

export type WitherVisualPlan = Readonly<{
  kind: 'wither'
  phase: WitherVisualPhase
  visible: boolean
  chargingFlashOn: boolean
  position: WitherVisualPosition
  yawRadians: number
  parts: ReadonlyArray<WitherVisualPartDescriptor>
}>

export type WitherSkullVisualPlan = Readonly<{
  kind: 'wither_skull'
  variant: WitherSkullVisualVariant
  position: WitherVisualPosition
  yawRadians: number
  pitchRadians: number
  parts: ReadonlyArray<WitherVisualPartDescriptor>
}>

/** The shared "no offset" / "no size" / "off" value used throughout this file's part table. */
const ZERO = 0

type WitherVisualPartOptions = Readonly<{
  id: string
  role: WitherVisualPartRole
  size: WitherVisualVector
  center: WitherVisualVector
  color: WitherVisualColor
  rotation?: WitherVisualVector
}>

const ZERO_ROTATION: WitherVisualVector = [ZERO, ZERO, ZERO]

const part = (options: WitherVisualPartOptions): WitherVisualPartDescriptor => ({
  center: options.center,
  color: options.color,
  id: options.id,
  role: options.role,
  rotation: options.rotation ?? ZERO_ROTATION,
  size: options.size,
})

const WITHER_BODY_COLOR_R = 44
const WITHER_BODY_COLOR_G = 47
const WITHER_BODY_COLOR_B = 51
const WITHER_BODY_COLOR: WitherVisualColor = [WITHER_BODY_COLOR_R, WITHER_BODY_COLOR_G, WITHER_BODY_COLOR_B]

const WITHER_BONE_COLOR_R = 70
const WITHER_BONE_COLOR_G = 73
const WITHER_BONE_COLOR_B = 77
const WITHER_BONE_COLOR: WitherVisualColor = [WITHER_BONE_COLOR_R, WITHER_BONE_COLOR_G, WITHER_BONE_COLOR_B]

const WITHER_HEAD_COLOR_R = 35
const WITHER_HEAD_COLOR_G = 37
const WITHER_HEAD_COLOR_B = 41
const WITHER_HEAD_COLOR: WitherVisualColor = [WITHER_HEAD_COLOR_R, WITHER_HEAD_COLOR_G, WITHER_HEAD_COLOR_B]

const WITHER_EYE_COLOR_R = 184
const WITHER_EYE_COLOR_G = 198
const WITHER_EYE_COLOR_B = 211
const WITHER_EYE_COLOR: WitherVisualColor = [WITHER_EYE_COLOR_R, WITHER_EYE_COLOR_G, WITHER_EYE_COLOR_B]

// --- WITHER_VISUAL_DESCRIPTOR part measurements -----------------------------

const CENTER_HEAD_SIZE_X = 0.78
const CENTER_HEAD_SIZE_Y = 0.72
const CENTER_HEAD_SIZE_Z = 0.72
const CENTER_HEAD_CENTER_Y = 2.35
const CENTER_HEAD_CENTER_Z = -0.08

/** Shared by `left-head` and `right-head`, mirrored across x. */
const SIDE_HEAD_SIZE_X = 0.62
const SIDE_HEAD_SIZE_Y = 0.58
const SIDE_HEAD_SIZE_Z = 0.58
const SIDE_HEAD_CENTER_X = 0.78
const SIDE_HEAD_CENTER_Y = 2.08
const SIDE_HEAD_CENTER_Z = 0.02

const CENTER_EYES_SIZE_X = 0.4
const CENTER_EYES_SIZE_Y = 0.08
const CENTER_EYES_SIZE_Z = 0.04
const CENTER_EYES_CENTER_Y = 2.4
const CENTER_EYES_CENTER_Z = -0.46

/** Shared by `left-eyes` and `right-eyes`, mirrored across x. */
const SIDE_EYES_SIZE_X = 0.32
const SIDE_EYES_SIZE_Y = 0.07
const SIDE_EYES_SIZE_Z = 0.04
const SIDE_EYES_CENTER_X = 0.78
const SIDE_EYES_CENTER_Y = 2.12
const SIDE_EYES_CENTER_Z = -0.29

const SHOULDERS_SIZE_X = 1.2
const SHOULDERS_SIZE_Y = 0.4
const SHOULDERS_SIZE_Z = 0.5
const SHOULDERS_CENTER_Y = 1.58
const SHOULDERS_CENTER_Z = 0.18

const SPINE_SIZE_X = 0.28
const SPINE_SIZE_Y = 1.18
const SPINE_SIZE_Z = 0.3
const SPINE_CENTER_Y = 1.05
const SPINE_CENTER_Z = 0.24

const UPPER_RIB_SIZE_X = 1.35
const UPPER_RIB_SIZE_Y = 0.16
const UPPER_RIB_SIZE_Z = 0.34
const UPPER_RIB_CENTER_Y = 1.3
const UPPER_RIB_CENTER_Z = 0.23

const MIDDLE_RIB_SIZE_X = 1.12
const MIDDLE_RIB_SIZE_Y = 0.15
const MIDDLE_RIB_SIZE_Z = 0.32
const MIDDLE_RIB_CENTER_Y = 1.02
const MIDDLE_RIB_CENTER_Z = 0.25

const LOWER_RIB_SIZE_X = 0.88
const LOWER_RIB_SIZE_Y = 0.14
const LOWER_RIB_SIZE_Z = 0.3
const LOWER_RIB_CENTER_Y = 0.75
const LOWER_RIB_CENTER_Z = 0.28

const UPPER_TAIL_SIZE_X = 0.26
const UPPER_TAIL_SIZE_Y = 0.72
const UPPER_TAIL_SIZE_Z = 0.26
const UPPER_TAIL_CENTER_Y = 0.42
const UPPER_TAIL_CENTER_Z = 0.38
const UPPER_TAIL_ROTATION_X = 0.24

const TAIL_TIP_SIZE_X = 0.18
const TAIL_TIP_SIZE_Y = 0.48
const TAIL_TIP_SIZE_Z = 0.18
const TAIL_TIP_CENTER_Y = 0.08
const TAIL_TIP_CENTER_Z = 0.56
const TAIL_TIP_ROTATION_X = 0.42

export const WITHER_VISUAL_DESCRIPTOR: WitherVisualDescriptor = {
  kind: 'wither',
  parts: [
    part({
      center: [ZERO, CENTER_HEAD_CENTER_Y, CENTER_HEAD_CENTER_Z],
      color: WITHER_HEAD_COLOR,
      id: 'center-head',
      role: 'head',
      size: [CENTER_HEAD_SIZE_X, CENTER_HEAD_SIZE_Y, CENTER_HEAD_SIZE_Z],
    }),
    part({
      center: [-SIDE_HEAD_CENTER_X, SIDE_HEAD_CENTER_Y, SIDE_HEAD_CENTER_Z],
      color: WITHER_HEAD_COLOR,
      id: 'left-head',
      role: 'head',
      size: [SIDE_HEAD_SIZE_X, SIDE_HEAD_SIZE_Y, SIDE_HEAD_SIZE_Z],
    }),
    part({
      center: [SIDE_HEAD_CENTER_X, SIDE_HEAD_CENTER_Y, SIDE_HEAD_CENTER_Z],
      color: WITHER_HEAD_COLOR,
      id: 'right-head',
      role: 'head',
      size: [SIDE_HEAD_SIZE_X, SIDE_HEAD_SIZE_Y, SIDE_HEAD_SIZE_Z],
    }),
    part({
      center: [ZERO, CENTER_EYES_CENTER_Y, CENTER_EYES_CENTER_Z],
      color: WITHER_EYE_COLOR,
      id: 'center-eyes',
      role: 'eye',
      size: [CENTER_EYES_SIZE_X, CENTER_EYES_SIZE_Y, CENTER_EYES_SIZE_Z],
    }),
    part({
      center: [-SIDE_EYES_CENTER_X, SIDE_EYES_CENTER_Y, SIDE_EYES_CENTER_Z],
      color: WITHER_EYE_COLOR,
      id: 'left-eyes',
      role: 'eye',
      size: [SIDE_EYES_SIZE_X, SIDE_EYES_SIZE_Y, SIDE_EYES_SIZE_Z],
    }),
    part({
      center: [SIDE_EYES_CENTER_X, SIDE_EYES_CENTER_Y, SIDE_EYES_CENTER_Z],
      color: WITHER_EYE_COLOR,
      id: 'right-eyes',
      role: 'eye',
      size: [SIDE_EYES_SIZE_X, SIDE_EYES_SIZE_Y, SIDE_EYES_SIZE_Z],
    }),
    part({
      center: [ZERO, SHOULDERS_CENTER_Y, SHOULDERS_CENTER_Z],
      color: WITHER_BODY_COLOR,
      id: 'shoulders',
      role: 'body',
      size: [SHOULDERS_SIZE_X, SHOULDERS_SIZE_Y, SHOULDERS_SIZE_Z],
    }),
    part({
      center: [ZERO, SPINE_CENTER_Y, SPINE_CENTER_Z],
      color: WITHER_BODY_COLOR,
      id: 'spine',
      role: 'body',
      size: [SPINE_SIZE_X, SPINE_SIZE_Y, SPINE_SIZE_Z],
    }),
    part({
      center: [ZERO, UPPER_RIB_CENTER_Y, UPPER_RIB_CENTER_Z],
      color: WITHER_BONE_COLOR,
      id: 'upper-rib',
      role: 'rib',
      size: [UPPER_RIB_SIZE_X, UPPER_RIB_SIZE_Y, UPPER_RIB_SIZE_Z],
    }),
    part({
      center: [ZERO, MIDDLE_RIB_CENTER_Y, MIDDLE_RIB_CENTER_Z],
      color: WITHER_BONE_COLOR,
      id: 'middle-rib',
      role: 'rib',
      size: [MIDDLE_RIB_SIZE_X, MIDDLE_RIB_SIZE_Y, MIDDLE_RIB_SIZE_Z],
    }),
    part({
      center: [ZERO, LOWER_RIB_CENTER_Y, LOWER_RIB_CENTER_Z],
      color: WITHER_BONE_COLOR,
      id: 'lower-rib',
      role: 'rib',
      size: [LOWER_RIB_SIZE_X, LOWER_RIB_SIZE_Y, LOWER_RIB_SIZE_Z],
    }),
    part({
      center: [ZERO, UPPER_TAIL_CENTER_Y, UPPER_TAIL_CENTER_Z],
      color: WITHER_BODY_COLOR,
      id: 'upper-tail',
      role: 'tail',
      rotation: [UPPER_TAIL_ROTATION_X, ZERO, ZERO],
      size: [UPPER_TAIL_SIZE_X, UPPER_TAIL_SIZE_Y, UPPER_TAIL_SIZE_Z],
    }),
    part({
      center: [ZERO, TAIL_TIP_CENTER_Y, TAIL_TIP_CENTER_Z],
      color: WITHER_HEAD_COLOR,
      id: 'tail-tip',
      role: 'tail',
      rotation: [TAIL_TIP_ROTATION_X, ZERO, ZERO],
      size: [TAIL_TIP_SIZE_X, TAIL_TIP_SIZE_Y, TAIL_TIP_SIZE_Z],
    }),
  ],
}

const NORMAL_SKULL_COLOR_R = 54
const NORMAL_SKULL_COLOR_G = 57
const NORMAL_SKULL_COLOR_B = 61
const NORMAL_SKULL_COLOR: WitherVisualColor = [NORMAL_SKULL_COLOR_R, NORMAL_SKULL_COLOR_G, NORMAL_SKULL_COLOR_B]

const BLUE_SKULL_COLOR_R = 72
const BLUE_SKULL_COLOR_G = 139
const BLUE_SKULL_COLOR_B = 170
const BLUE_SKULL_COLOR: WitherVisualColor = [BLUE_SKULL_COLOR_R, BLUE_SKULL_COLOR_G, BLUE_SKULL_COLOR_B]

const BLUE_SKULL_SIZE = 0.52

const BLUE_SKULL_EYES_SIZE_X = 0.27
const BLUE_SKULL_EYES_SIZE_Y = 0.07
const BLUE_SKULL_EYES_SIZE_Z = 0.03
const BLUE_SKULL_EYES_CENTER_Y = 0.08
const BLUE_SKULL_EYES_CENTER_Z = -0.275
const BLUE_SKULL_EYES_COLOR_R = 184
const BLUE_SKULL_EYES_COLOR_G = 239
const BLUE_SKULL_EYES_COLOR_B = 255

const BLUE_AURA_SIZE_X = 0.13
const BLUE_AURA_SIZE_Y = 0.13
const BLUE_AURA_SIZE_Z = 0.7
const BLUE_AURA_CENTER_Z = 0.38
const BLUE_AURA_COLOR_R = 94
const BLUE_AURA_COLOR_G = 191
const BLUE_AURA_COLOR_B = 225

const NORMAL_SKULL_SIZE = 0.48

const NORMAL_SKULL_EYES_SIZE_X = 0.25
const NORMAL_SKULL_EYES_SIZE_Y = 0.06
const NORMAL_SKULL_EYES_SIZE_Z = 0.03
const NORMAL_SKULL_EYES_CENTER_Y = 0.07
const NORMAL_SKULL_EYES_CENTER_Z = -0.255
const NORMAL_SKULL_EYES_COLOR_R = 194
const NORMAL_SKULL_EYES_COLOR_G = 202
const NORMAL_SKULL_EYES_COLOR_B = 210

export const WITHER_SKULL_VISUAL_DESCRIPTORS: Readonly<
  Record<WitherSkullVisualVariant, WitherSkullVisualDescriptor>
> = {
  blue: {
    kind: 'wither_skull',
    parts: [
      part({
        center: [ZERO, ZERO, ZERO],
        color: BLUE_SKULL_COLOR,
        id: 'blue-skull',
        role: 'projectile',
        size: [BLUE_SKULL_SIZE, BLUE_SKULL_SIZE, BLUE_SKULL_SIZE],
      }),
      part({
        center: [ZERO, BLUE_SKULL_EYES_CENTER_Y, BLUE_SKULL_EYES_CENTER_Z],
        color: [BLUE_SKULL_EYES_COLOR_R, BLUE_SKULL_EYES_COLOR_G, BLUE_SKULL_EYES_COLOR_B],
        id: 'blue-skull-eyes',
        role: 'eye',
        size: [BLUE_SKULL_EYES_SIZE_X, BLUE_SKULL_EYES_SIZE_Y, BLUE_SKULL_EYES_SIZE_Z],
      }),
      part({
        center: [ZERO, ZERO, BLUE_AURA_CENTER_Z],
        color: [BLUE_AURA_COLOR_R, BLUE_AURA_COLOR_G, BLUE_AURA_COLOR_B],
        id: 'blue-aura',
        role: 'armour',
        size: [BLUE_AURA_SIZE_X, BLUE_AURA_SIZE_Y, BLUE_AURA_SIZE_Z],
      }),
    ],
    variant: 'blue',
  },
  normal: {
    kind: 'wither_skull',
    parts: [
      part({
        center: [ZERO, ZERO, ZERO],
        color: NORMAL_SKULL_COLOR,
        id: 'skull',
        role: 'projectile',
        size: [NORMAL_SKULL_SIZE, NORMAL_SKULL_SIZE, NORMAL_SKULL_SIZE],
      }),
      part({
        center: [ZERO, NORMAL_SKULL_EYES_CENTER_Y, NORMAL_SKULL_EYES_CENTER_Z],
        color: [NORMAL_SKULL_EYES_COLOR_R, NORMAL_SKULL_EYES_COLOR_G, NORMAL_SKULL_EYES_COLOR_B],
        id: 'skull-eyes',
        role: 'eye',
        size: [NORMAL_SKULL_EYES_SIZE_X, NORMAL_SKULL_EYES_SIZE_Y, NORMAL_SKULL_EYES_SIZE_Z],
      }),
    ],
    variant: 'normal',
  },
}

const finiteOrZero = (value: number): number => {
  if (Number.isFinite(value)) {
    return value
  }
  return ZERO
}

/**
 * `x`/`y`/`z` keys here construct a `WitherVisualPosition` and must match its
 * field names exactly (see that type's doc comment) -- left un-renamed for the
 * same reason.
 */
const copyPosition = (value: WitherVisualPosition): WitherVisualPosition => ({
  x: finiteOrZero(value.x),
  y: finiteOrZero(value.y),
  z: finiteOrZero(value.z),
})

const directionAngles = (direction: WitherVisualPosition): readonly [yaw: number, pitch: number] => {
  const directionX = finiteOrZero(direction.x)
  const directionY = finiteOrZero(direction.y)
  const directionZ = finiteOrZero(direction.z)
  const horizontalLength = Math.hypot(directionX, directionZ)
  if (horizontalLength === ZERO && directionY === ZERO) {
    return [ZERO, ZERO]
  }
  if (horizontalLength === ZERO) {
    return [ZERO, Math.atan2(directionY, horizontalLength)]
  }
  return [Math.atan2(-directionX, -directionZ), Math.atan2(directionY, horizontalLength)]
}

const withColor = (
  source: WitherVisualPartDescriptor,
  color: WitherVisualColor,
): WitherVisualPartDescriptor => ({ ...source, color })

const CENTER_ARMOUR_CREST_SIZE_X = 0.48
const CENTER_ARMOUR_CREST_SIZE_Y = 0.12
const CENTER_ARMOUR_CREST_SIZE_Z = 0.78
const CENTER_ARMOUR_CREST_CENTER_Y = 2.73
const CENTER_ARMOUR_CREST_CENTER_Z = -0.04
const CENTER_ARMOUR_CREST_COLOR_R = 118
const CENTER_ARMOUR_CREST_COLOR_G = 151
const CENTER_ARMOUR_CREST_COLOR_B = 168

/** Shared by `left-armour-crest` and `right-armour-crest`, mirrored across x. */
const SIDE_ARMOUR_CREST_SIZE_X = 0.36
const SIDE_ARMOUR_CREST_SIZE_Y = 0.1
const SIDE_ARMOUR_CREST_SIZE_Z = 0.62
const SIDE_ARMOUR_CREST_CENTER_X = 0.78
const SIDE_ARMOUR_CREST_CENTER_Y = 2.39
const SIDE_ARMOUR_CREST_CENTER_Z = 0.02
const SIDE_ARMOUR_CREST_COLOR_R = 105
const SIDE_ARMOUR_CREST_COLOR_G = 139
const SIDE_ARMOUR_CREST_COLOR_B = 158

const armourParts: ReadonlyArray<WitherVisualPartDescriptor> = [
  part({
    center: [ZERO, CENTER_ARMOUR_CREST_CENTER_Y, CENTER_ARMOUR_CREST_CENTER_Z],
    color: [CENTER_ARMOUR_CREST_COLOR_R, CENTER_ARMOUR_CREST_COLOR_G, CENTER_ARMOUR_CREST_COLOR_B],
    id: 'center-armour-crest',
    role: 'armour',
    size: [CENTER_ARMOUR_CREST_SIZE_X, CENTER_ARMOUR_CREST_SIZE_Y, CENTER_ARMOUR_CREST_SIZE_Z],
  }),
  part({
    center: [-SIDE_ARMOUR_CREST_CENTER_X, SIDE_ARMOUR_CREST_CENTER_Y, SIDE_ARMOUR_CREST_CENTER_Z],
    color: [SIDE_ARMOUR_CREST_COLOR_R, SIDE_ARMOUR_CREST_COLOR_G, SIDE_ARMOUR_CREST_COLOR_B],
    id: 'left-armour-crest',
    role: 'armour',
    size: [SIDE_ARMOUR_CREST_SIZE_X, SIDE_ARMOUR_CREST_SIZE_Y, SIDE_ARMOUR_CREST_SIZE_Z],
  }),
  part({
    center: [SIDE_ARMOUR_CREST_CENTER_X, SIDE_ARMOUR_CREST_CENTER_Y, SIDE_ARMOUR_CREST_CENTER_Z],
    color: [SIDE_ARMOUR_CREST_COLOR_R, SIDE_ARMOUR_CREST_COLOR_G, SIDE_ARMOUR_CREST_COLOR_B],
    id: 'right-armour-crest',
    role: 'armour',
    size: [SIDE_ARMOUR_CREST_SIZE_X, SIDE_ARMOUR_CREST_SIZE_Y, SIDE_ARMOUR_CREST_SIZE_Z],
  }),
]

const ARMOURED_EYE_COLOR_R = 155
const ARMOURED_EYE_COLOR_G = 220
const ARMOURED_EYE_COLOR_B = 240
const ARMOURED_EYE_COLOR: WitherVisualColor = [ARMOURED_EYE_COLOR_R, ARMOURED_EYE_COLOR_G, ARMOURED_EYE_COLOR_B]

const ARMOURED_BODY_COLOR_R = 58
const ARMOURED_BODY_COLOR_G = 84
const ARMOURED_BODY_COLOR_B = 96
const ARMOURED_BODY_COLOR: WitherVisualColor = [ARMOURED_BODY_COLOR_R, ARMOURED_BODY_COLOR_G, ARMOURED_BODY_COLOR_B]

const CHARGING_FLASH_EYE_COLOR_R = 118
const CHARGING_FLASH_EYE_COLOR_G = 181
const CHARGING_FLASH_EYE_COLOR_B = 255
const CHARGING_FLASH_EYE_COLOR: WitherVisualColor = [
  CHARGING_FLASH_EYE_COLOR_R,
  CHARGING_FLASH_EYE_COLOR_G,
  CHARGING_FLASH_EYE_COLOR_B,
]

const CHARGING_FLASH_BODY_COLOR_R = 222
const CHARGING_FLASH_BODY_COLOR_G = 231
const CHARGING_FLASH_BODY_COLOR_B = 244
const CHARGING_FLASH_BODY_COLOR: WitherVisualColor = [
  CHARGING_FLASH_BODY_COLOR_R,
  CHARGING_FLASH_BODY_COLOR_G,
  CHARGING_FLASH_BODY_COLOR_B,
]

/** `eye`-role parts get `eyeColor`, every other role gets `otherColor`. */
const roleColor = (
  role: WitherVisualPartRole,
  eyeColor: WitherVisualColor,
  otherColor: WitherVisualColor,
): WitherVisualColor => {
  if (role === 'eye') {
    return eyeColor
  }
  return otherColor
}

/** How many times per second the charging flash toggles. */
const WITHER_CHARGE_FLASH_HZ = 8
/** The flash toggles on every other tick of `WITHER_CHARGE_FLASH_HZ`. */
const WITHER_CHARGE_FLASH_PARITY = 2

const witherPartsForPhase = (
  phase: WitherVisualPhase,
  chargingFlashOn: boolean,
): ReadonlyArray<WitherVisualPartDescriptor> => {
  if (phase === 'armoured') {
    return [
      ...WITHER_VISUAL_DESCRIPTOR.parts.map((source) =>
        withColor(source, roleColor(source.role, ARMOURED_EYE_COLOR, ARMOURED_BODY_COLOR)),
      ),
      ...armourParts,
    ]
  }
  if (chargingFlashOn) {
    return WITHER_VISUAL_DESCRIPTOR.parts.map((source) =>
      withColor(source, roleColor(source.role, CHARGING_FLASH_EYE_COLOR, CHARGING_FLASH_BODY_COLOR)),
    )
  }
  return WITHER_VISUAL_DESCRIPTOR.parts
}

/** Plan one Wither frame solely from its simulation state. */
export const planWitherVisual = (state: WitherVisualStateInput): WitherVisualPlan => {
  const position = copyPosition(state.feetPosition)
  const [yawRadians] = directionAngles(state.velocity)
  if (state.phase === 'dead') {
    return {
      chargingFlashOn: false,
      kind: 'wither',
      parts: [],
      phase: state.phase,
      position,
      visible: false,
      yawRadians,
    }
  }

  const remaining = Math.max(ZERO, finiteOrZero(state.chargeRemainingSecs))
  const chargingFlashOn =
    state.phase === 'charging' &&
    Math.floor(remaining * WITHER_CHARGE_FLASH_HZ) % WITHER_CHARGE_FLASH_PARITY === ZERO
  const parts = witherPartsForPhase(state.phase, chargingFlashOn)

  return {
    chargingFlashOn,
    kind: 'wither',
    parts,
    phase: state.phase,
    position,
    visible: true,
    yawRadians,
  }
}

const pitchPart = (
  source: WitherVisualPartDescriptor,
  pitchRadians: number,
): WitherVisualPartDescriptor => {
  const cosine = Math.cos(pitchRadians)
  const sine = Math.sin(pitchRadians)
  const [centerX, centerY, centerZ] = source.center
  const [rotationX, rotationY, rotationZ] = source.rotation
  return {
    ...source,
    center: [centerX, centerY * cosine - centerZ * sine, centerY * sine + centerZ * cosine],
    rotation: [rotationX + pitchRadians, rotationY, rotationZ],
  }
}

/** Plan a projectile transform, deriving yaw and pitch from its direction. */
export const planWitherSkullVisual = (
  projectile: WitherSkullVisualInput,
): WitherSkullVisualPlan => {
  const [yawRadians, pitchRadians] = directionAngles(projectile.direction)
  const descriptor = WITHER_SKULL_VISUAL_DESCRIPTORS[projectile.variant]
  return {
    kind: 'wither_skull',
    parts: descriptor.parts.map((source) => pitchPart(source, pitchRadians)),
    pitchRadians,
    position: copyPosition(projectile.origin),
    variant: projectile.variant,
    yawRadians,
  }
}
