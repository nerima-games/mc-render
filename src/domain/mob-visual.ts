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

export type MobVisualVector = readonly [x: number, y: number, z: number]
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

const part = (
  id: string,
  role: MobVisualPartRole,
  size: MobVisualVector,
  center: MobVisualVector,
  color: MobVisualColor,
  motion: MobPartMotion = 'static',
  motionIndex = 0,
): MobVisualPartDescriptor => ({ id, role, size, center, color, motion, motionIndex })

const biped = (
  kind: MobVisualKind,
  temperament: MobTemperament,
  scale: MobVisualVector,
  colors: {
    readonly head: MobVisualColor
    readonly body: MobVisualColor
    readonly limbs: MobVisualColor
  },
  slender = false,
  extras: ReadonlyArray<MobVisualPartDescriptor> = [],
): MobVisualDescriptor => {
  const limbWidth = slender ? 0.14 : 0.2
  return {
    kind,
    temperament,
    scale,
    parts: [
      part('head', 'head', [0.5, 0.5, 0.5], [0, 1.55, 0], colors.head),
      part('body', 'body', [0.55, 0.7, 0.3], [0, 0.95, 0], colors.body, 'body'),
      part('left-arm', 'arm', [limbWidth, 0.75, limbWidth], [-0.4, 0.95, 0], colors.limbs, 'left_limb'),
      part('right-arm', 'arm', [limbWidth, 0.75, limbWidth], [0.4, 0.95, 0], colors.limbs, 'right_limb'),
      part('left-leg', 'leg', [limbWidth, 0.8, limbWidth], [-0.16, 0.4, 0], colors.limbs, 'right_limb'),
      part('right-leg', 'leg', [limbWidth, 0.8, limbWidth], [0.16, 0.4, 0], colors.limbs, 'left_limb'),
      ...extras,
    ],
  }
}

const quadruped = (
  kind: MobVisualKind,
  bodyColor: MobVisualColor,
  headColor: MobVisualColor,
  scale: MobVisualVector,
  extras: ReadonlyArray<MobVisualPartDescriptor> = [],
): MobVisualDescriptor => ({
  kind,
  temperament: 'passive',
  scale,
  parts: [
    part('body', 'body', [0.9, 0.65, 1.25], [0, 0.85, 0], bodyColor, 'body'),
    part('head', 'head', [0.65, 0.65, 0.55], [0, 1.05, -0.82], headColor),
    part('front-left-leg', 'leg', [0.18, 0.65, 0.18], [-0.3, 0.35, -0.38], headColor, 'left_limb'),
    part('front-right-leg', 'leg', [0.18, 0.65, 0.18], [0.3, 0.35, -0.38], headColor, 'right_limb'),
    part('back-left-leg', 'leg', [0.18, 0.65, 0.18], [-0.3, 0.35, 0.38], headColor, 'right_limb'),
    part('back-right-leg', 'leg', [0.18, 0.65, 0.18], [0.3, 0.35, 0.38], headColor, 'left_limb'),
    ...extras,
  ],
})

const spiderLegs = (color: MobVisualColor): ReadonlyArray<MobVisualPartDescriptor> =>
  [-0.48, -0.16, 0.16, 0.48].flatMap((z, index) => [
    part(`left-leg-${String(index + 1)}`, 'leg', [0.85, 0.12, 0.12], [-0.65, 0.34, z], color, 'left_spider_leg', index),
    part(`right-leg-${String(index + 1)}`, 'leg', [0.85, 0.12, 0.12], [0.65, 0.34, z], color, 'right_spider_leg', index),
  ])

const blazeRods = (color: MobVisualColor): ReadonlyArray<MobVisualPartDescriptor> =>
  Array.from({ length: 12 }, (_, index) => {
    const angle = (index % 4) * (Math.PI / 2)
    const radius = index < 4 ? 0.62 : index < 8 ? 0.48 : 0.36
    const y = index < 4 ? 1.25 : index < 8 ? 0.8 : 0.4
    return part(
      `rod-${String(index + 1)}`,
      'blaze_rod',
      [0.13, 0.5, 0.13],
      [Math.cos(angle) * radius, y, Math.sin(angle) * radius],
      color,
      'blaze_orbit',
      index,
    )
  })

const descriptors: Readonly<Record<MobVisualKind, MobVisualDescriptor>> = {
  zombie: biped('zombie', 'hostile', [1, 1, 1], {
    head: [95, 155, 85], body: [65, 95, 145], limbs: [80, 130, 75],
  }),
  skeleton: biped('skeleton', 'hostile', [0.95, 1.05, 0.95], {
    head: [218, 214, 194], body: [205, 202, 184], limbs: [225, 222, 205],
  }, true),
  zombified_piglin: biped(
    'zombified_piglin',
    'hostile',
    [1.05, 1.02, 1],
    { head: [212, 132, 125], body: [125, 75, 62], limbs: [161, 118, 92] },
    false,
    [part('snout', 'snout', [0.32, 0.22, 0.18], [0, 1.5, -0.32], [191, 112, 111])],
  ),
  enderman: biped(
    'enderman',
    'hostile',
    [0.85, 1.58, 0.85],
    { head: [31, 27, 35], body: [24, 21, 28], limbs: [19, 17, 23] },
    true,
    [
      part('left-eye', 'eye', [0.13, 0.06, 0.02], [-0.13, 1.58, -0.26], [196, 58, 210]),
      part('right-eye', 'eye', [0.13, 0.06, 0.02], [0.13, 1.58, -0.26], [196, 58, 210]),
    ],
  ),
  creeper: {
    kind: 'creeper', temperament: 'hostile', scale: [1, 1, 1], parts: [
      part('head', 'head', [0.62, 0.62, 0.62], [0, 1.42, 0], [72, 167, 65]),
      part('body', 'body', [0.48, 0.8, 0.42], [0, 0.78, 0], [65, 146, 59], 'body'),
      part('front-left-leg', 'leg', [0.22, 0.48, 0.22], [-0.2, 0.24, -0.16], [55, 126, 51], 'left_limb'),
      part('front-right-leg', 'leg', [0.22, 0.48, 0.22], [0.2, 0.24, -0.16], [55, 126, 51], 'right_limb'),
      part('back-left-leg', 'leg', [0.22, 0.48, 0.22], [-0.2, 0.24, 0.16], [55, 126, 51], 'right_limb'),
      part('back-right-leg', 'leg', [0.22, 0.48, 0.22], [0.2, 0.24, 0.16], [55, 126, 51], 'left_limb'),
    ],
  },
  spider: {
    kind: 'spider', temperament: 'hostile', scale: [1.15, 1, 1.15], parts: [
      part('abdomen', 'body', [0.85, 0.52, 1], [0, 0.48, 0.25], [50, 42, 47], 'body'),
      part('head', 'head', [0.65, 0.45, 0.58], [0, 0.48, -0.55], [42, 35, 39]),
      part('eyes', 'eye', [0.38, 0.09, 0.03], [0, 0.53, -0.86], [176, 35, 29]),
      ...spiderLegs([38, 31, 35]),
    ],
  },
  cow: quadruped('cow', [105, 70, 49], [126, 87, 61], [1.12, 1.12, 1.12], [
    part('left-horn', 'horn', [0.12, 0.22, 0.12], [-0.25, 1.42, -0.82], [222, 210, 166]),
    part('right-horn', 'horn', [0.12, 0.22, 0.12], [0.25, 1.42, -0.82], [222, 210, 166]),
  ]),
  pig: quadruped('pig', [222, 144, 151], [235, 161, 167], [0.9, 0.9, 0.9], [
    part('snout', 'snout', [0.4, 0.25, 0.18], [0, 0.98, -1.11], [207, 119, 132]),
  ]),
  sheep: quadruped('sheep', [229, 225, 209], [106, 97, 86], [1.05, 1.05, 1.05], [
    part('wool-cap', 'body', [0.7, 0.25, 0.62], [0, 1.31, -0.77], [235, 232, 218]),
  ]),
  chicken: {
    kind: 'chicken', temperament: 'passive', scale: [0.72, 0.72, 0.72], parts: [
      part('body', 'body', [0.75, 0.78, 0.72], [0, 0.72, 0], [231, 227, 211], 'body'),
      part('head', 'head', [0.48, 0.48, 0.44], [0, 1.25, -0.14], [242, 238, 218]),
      part('beak', 'beak', [0.26, 0.16, 0.24], [0, 1.18, -0.46], [225, 166, 50]),
      part('left-wing', 'wing', [0.12, 0.48, 0.52], [-0.43, 0.78, 0], [211, 207, 193], 'left_wing'),
      part('right-wing', 'wing', [0.12, 0.48, 0.52], [0.43, 0.78, 0], [211, 207, 193], 'right_wing'),
      part('left-leg', 'leg', [0.1, 0.48, 0.1], [-0.18, 0.24, 0], [188, 133, 44], 'left_limb'),
      part('right-leg', 'leg', [0.1, 0.48, 0.1], [0.18, 0.24, 0], [188, 133, 44], 'right_limb'),
    ],
  },
  blaze: {
    kind: 'blaze', temperament: 'hostile', scale: [1, 1.15, 1], parts: [
      part('head', 'head', [0.62, 0.62, 0.62], [0, 1.5, 0], [233, 175, 45], 'body'),
      part('eyes', 'eye', [0.36, 0.08, 0.03], [0, 1.52, -0.33], [69, 42, 24]),
      ...blazeRods([208, 139, 32]),
    ],
  },
}

export const UNKNOWN_MOB_VISUAL: MobVisualDescriptor = {
  kind: 'unknown',
  temperament: 'neutral',
  scale: [1, 1, 1],
  parts: [
    part('body', 'body', [0.65, 0.9, 0.5], [0, 0.65, 0], [154, 82, 57], 'body'),
    part('head', 'head', [0.52, 0.52, 0.52], [0, 1.35, 0], [185, 111, 72]),
  ],
}

const knownKinds = new Set<string>(MOB_VISUAL_KINDS)

export const mobVisualDescriptor = (kind: string): MobVisualDescriptor =>
  knownKinds.has(kind) ? descriptors[kind as MobVisualKind] : UNKNOWN_MOB_VISUAL

const finiteOr = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) ? value : fallback

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

const scaleVector = (vector: MobVisualVector, scale: MobVisualVector): MobVisualVector => [
  vector[0] * scale[0],
  vector[1] * scale[1],
  vector[2] * scale[2],
]

/** Resolve a mob kind and animation sample into immutable cuboid transforms. */
export const planMobVisual = (
  kind: string,
  input: MobAnimationInput = { state: 'idle' },
): MobVisualPlan => {
  const descriptor = mobVisualDescriptor(kind)
  const phaseRadians = finiteOr(input.phaseRadians, 0)
  const progress = clamp01(
    finiteOr(input.progress, input.state === 'hurt' || input.state === 'death' ? 1 : 0),
  )
  const animation = { state: input.state, phaseRadians, progress } as const
  const stride = animation.state === 'walk' ? Math.sin(phaseRadians) * 0.65 : 0
  const idleBob = animation.state === 'idle' ? Math.sin(phaseRadians * 0.5) * 0.025 : 0
  const hurtLean = animation.state === 'hurt' ? 0.24 * progress : 0
  const deathLean = animation.state === 'death' ? (Math.PI / 2) * progress : 0
  const rootLean = hurtLean + deathLean

  const parts = descriptor.parts.map((source): MobVisualPartPlan => {
    let [x, y, z] = scaleVector(source.center, descriptor.scale)
    let rotationX = 0
    let rotationY = 0
    let rotationZ = 0
    switch (source.motion) {
      case 'body':
        y += idleBob
        break
      case 'left_limb':
        rotationX = stride
        break
      case 'right_limb':
        rotationX = -stride
        break
      case 'left_spider_leg':
        rotationY = (source.motionIndex - 1.5) * 0.18
        rotationZ = -0.72 - Math.sin(phaseRadians + source.motionIndex) * 0.12
        break
      case 'right_spider_leg':
        rotationY = -(source.motionIndex - 1.5) * 0.18
        rotationZ = 0.72 + Math.sin(phaseRadians + source.motionIndex) * 0.12
        break
      case 'left_wing':
        rotationZ = -0.18 - Math.abs(Math.sin(phaseRadians)) * 0.65
        break
      case 'right_wing':
        rotationZ = 0.18 + Math.abs(Math.sin(phaseRadians)) * 0.65
        break
      case 'blaze_orbit': {
        const orbit = phaseRadians * 0.55 + (source.motionIndex % 4) * (Math.PI / 2)
        const radius = Math.hypot(x, z)
        x = Math.cos(orbit) * radius
        z = Math.sin(orbit) * radius
        y += Math.sin(phaseRadians + source.motionIndex * 0.7) * 0.08
        rotationY = orbit
        break
      }
      case 'static':
        break
    }
    const leanedX = x * Math.cos(rootLean) - y * Math.sin(rootLean)
    const leanedY = x * Math.sin(rootLean) + y * Math.cos(rootLean)
    return {
      id: source.id,
      role: source.role,
      size: scaleVector(source.size, descriptor.scale),
      center: [leanedX, leanedY, z],
      rotation: [rotationX, rotationY, rotationZ + rootLean],
      color: source.color,
    }
  })

  return { descriptorKind: descriptor.kind, temperament: descriptor.temperament, animation, parts }
}
