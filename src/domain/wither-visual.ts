/** Renderer-independent Wither and Wither-skull silhouettes and transforms. */

export type WitherVisualPhase = 'charging' | 'airborne' | 'armoured' | 'dead'
export type WitherSkullVisualVariant = 'normal' | 'blue'

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

export type WitherVisualVector = readonly [x: number, y: number, z: number]
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

const part = (
  id: string,
  role: WitherVisualPartRole,
  size: WitherVisualVector,
  center: WitherVisualVector,
  color: WitherVisualColor,
  rotation: WitherVisualVector = [0, 0, 0],
): WitherVisualPartDescriptor => ({ center, color, id, role, rotation, size })

const WITHER_BODY_COLOR: WitherVisualColor = [44, 47, 51]
const WITHER_BONE_COLOR: WitherVisualColor = [70, 73, 77]
const WITHER_HEAD_COLOR: WitherVisualColor = [35, 37, 41]
const WITHER_EYE_COLOR: WitherVisualColor = [184, 198, 211]

export const WITHER_VISUAL_DESCRIPTOR: WitherVisualDescriptor = {
  kind: 'wither',
  parts: [
    part('center-head', 'head', [0.78, 0.72, 0.72], [0, 2.35, -0.08], WITHER_HEAD_COLOR),
    part('left-head', 'head', [0.62, 0.58, 0.58], [-0.78, 2.08, 0.02], WITHER_HEAD_COLOR),
    part('right-head', 'head', [0.62, 0.58, 0.58], [0.78, 2.08, 0.02], WITHER_HEAD_COLOR),
    part('center-eyes', 'eye', [0.4, 0.08, 0.04], [0, 2.4, -0.46], WITHER_EYE_COLOR),
    part('left-eyes', 'eye', [0.32, 0.07, 0.04], [-0.78, 2.12, -0.29], WITHER_EYE_COLOR),
    part('right-eyes', 'eye', [0.32, 0.07, 0.04], [0.78, 2.12, -0.29], WITHER_EYE_COLOR),
    part('shoulders', 'body', [1.2, 0.4, 0.5], [0, 1.58, 0.18], WITHER_BODY_COLOR),
    part('spine', 'body', [0.28, 1.18, 0.3], [0, 1.05, 0.24], WITHER_BODY_COLOR),
    part('upper-rib', 'rib', [1.35, 0.16, 0.34], [0, 1.3, 0.23], WITHER_BONE_COLOR),
    part('middle-rib', 'rib', [1.12, 0.15, 0.32], [0, 1.02, 0.25], WITHER_BONE_COLOR),
    part('lower-rib', 'rib', [0.88, 0.14, 0.3], [0, 0.75, 0.28], WITHER_BONE_COLOR),
    part('upper-tail', 'tail', [0.26, 0.72, 0.26], [0, 0.42, 0.38], WITHER_BODY_COLOR, [0.24, 0, 0]),
    part('tail-tip', 'tail', [0.18, 0.48, 0.18], [0, 0.08, 0.56], WITHER_HEAD_COLOR, [0.42, 0, 0]),
  ],
}

const NORMAL_SKULL_COLOR: WitherVisualColor = [54, 57, 61]
const BLUE_SKULL_COLOR: WitherVisualColor = [72, 139, 170]

export const WITHER_SKULL_VISUAL_DESCRIPTORS: Readonly<
  Record<WitherSkullVisualVariant, WitherSkullVisualDescriptor>
> = {
  blue: {
    kind: 'wither_skull',
    parts: [
      part('blue-skull', 'projectile', [0.52, 0.52, 0.52], [0, 0, 0], BLUE_SKULL_COLOR),
      part('blue-skull-eyes', 'eye', [0.27, 0.07, 0.03], [0, 0.08, -0.275], [184, 239, 255]),
      part('blue-aura', 'armour', [0.13, 0.13, 0.7], [0, 0, 0.38], [94, 191, 225]),
    ],
    variant: 'blue',
  },
  normal: {
    kind: 'wither_skull',
    parts: [
      part('skull', 'projectile', [0.48, 0.48, 0.48], [0, 0, 0], NORMAL_SKULL_COLOR),
      part('skull-eyes', 'eye', [0.25, 0.06, 0.03], [0, 0.07, -0.255], [194, 202, 210]),
    ],
    variant: 'normal',
  },
}

const finiteOrZero = (value: number): number => Number.isFinite(value) ? value : 0

const copyPosition = (value: WitherVisualPosition): WitherVisualPosition => ({
  x: finiteOrZero(value.x),
  y: finiteOrZero(value.y),
  z: finiteOrZero(value.z),
})

const directionAngles = (direction: WitherVisualPosition): readonly [yaw: number, pitch: number] => {
  const x = finiteOrZero(direction.x)
  const y = finiteOrZero(direction.y)
  const z = finiteOrZero(direction.z)
  const horizontalLength = Math.hypot(x, z)
  if (horizontalLength === 0 && y === 0) {return [0, 0]}
  return [horizontalLength === 0 ? 0 : Math.atan2(-x, -z), Math.atan2(y, horizontalLength)]
}

const withColor = (
  source: WitherVisualPartDescriptor,
  color: WitherVisualColor,
): WitherVisualPartDescriptor => ({ ...source, color })

const armourParts: ReadonlyArray<WitherVisualPartDescriptor> = [
  part('center-armour-crest', 'armour', [0.48, 0.12, 0.78], [0, 2.73, -0.04], [118, 151, 168]),
  part('left-armour-crest', 'armour', [0.36, 0.1, 0.62], [-0.78, 2.39, 0.02], [105, 139, 158]),
  part('right-armour-crest', 'armour', [0.36, 0.1, 0.62], [0.78, 2.39, 0.02], [105, 139, 158]),
]

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

  const remaining = Math.max(0, finiteOrZero(state.chargeRemainingSecs))
  const chargingFlashOn = state.phase === 'charging' && Math.floor(remaining * 8) % 2 === 0
  let {parts} = WITHER_VISUAL_DESCRIPTOR
  if (state.phase === 'armoured') {
    parts = [
      ...parts.map((source) => withColor(
        source,
        source.role === 'eye' ? [155, 220, 240] : [58, 84, 96],
      )),
      ...armourParts,
    ]
  } else if (chargingFlashOn) {
    parts = parts.map((source) => withColor(
      source,
      source.role === 'eye' ? [118, 181, 255] : [222, 231, 244],
    ))
  }

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
  const [x, y, z] = source.center
  return {
    ...source,
    center: [x, y * cosine - z * sine, y * sine + z * cosine],
    rotation: [source.rotation[0] + pitchRadians, source.rotation[1], source.rotation[2]],
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
