// SPDX-License-Identifier: CC0-1.0
import { Brand } from 'effect'
import type {
  EntityModelColor,
  EntityModelDescriptor,
  EntityModelKind,
  EntityModelPartDescriptor,
  EntityModelPartIdentifier,
  EntityModelPartRole,
} from '../types.js'

const modelKind = Brand.nominal<EntityModelKind>()
const partIdentifier = Brand.nominal<EntityModelPartIdentifier>()
const partRole = Brand.nominal<EntityModelPartRole>()

const part = (
  id: string,
  role: string,
  size: EntityModelPartDescriptor['size'],
  center: EntityModelPartDescriptor['center'],
  color: EntityModelPartDescriptor['color'],
): EntityModelPartDescriptor => ({ id: partIdentifier(id), role: partRole(role), size, center, color })

const partVerticalHalfExtent = ({ size, rotation }: EntityModelPartDescriptor): number => {
  const [sizeX, sizeY, sizeZ] = size
  const [rotationX, , rotationZ] = rotation ?? [0, 0, 0]
  // The renderer applies descriptor Euler rotations in YXZ order.
  return (
    Math.abs(Math.cos(rotationX) * Math.sin(rotationZ)) * sizeX / 2 +
    Math.abs(Math.cos(rotationX) * Math.cos(rotationZ)) * sizeY / 2 +
    Math.abs(Math.sin(rotationX)) * sizeZ / 2
  )
}

const partMinimumY = (modelPart: EntityModelPartDescriptor): number =>
  modelPart.center[1] - partVerticalHalfExtent(modelPart)

const groundModel = (model: EntityModelDescriptor): EntityModelDescriptor => {
  const lowestPart = model.parts.reduce((lowest, modelPart) =>
    partMinimumY(modelPart) < partMinimumY(lowest) ? modelPart : lowest)
  const minimumY = partMinimumY(lowestPart)
  const verticalOffset = partVerticalHalfExtent(lowestPart) - lowestPart.center[1]
  return {
    ...model,
    parts: model.parts.map((modelPart): EntityModelPartDescriptor => {
      const isLowest = partMinimumY(modelPart) === minimumY
      return {
        ...modelPart,
        center: [
          modelPart.center[0],
          isLowest ? partVerticalHalfExtent(modelPart) : modelPart.center[1] + verticalOffset,
          modelPart.center[2],
        ],
      }
    }),
  }
}

const model = (kind: string, ...parts: EntityModelPartDescriptor[]): EntityModelDescriptor =>
  groundModel({ kind: modelKind(kind), parts })

const WOOD: EntityModelColor = [132, 91, 53]
const WOOD_LIGHT: EntityModelColor = [181, 137, 79]
const IRON: EntityModelColor = [174, 181, 187]
const IRON_DARK: EntityModelColor = [73, 81, 88]
const FEATHER: EntityModelColor = [224, 218, 201]
const SPECTRAL: EntityModelColor = [242, 194, 66]
const ENDER: EntityModelColor = [30, 118, 75]
const ENDER_GLOW: EntityModelColor = [107, 230, 169]
const FIRE: EntityModelColor = [238, 96, 28]
const FIRE_GOLD: EntityModelColor = [255, 184, 48]
const FIRE_CORE: EntityModelColor = [255, 228, 112]
const BREEZE: EntityModelColor = [113, 220, 210]
const WIND: EntityModelColor = [171, 241, 230]
const SNOW: EntityModelColor = [240, 248, 255]
const ICE: EntityModelColor = [157, 211, 232]
const BOTTLE: EntityModelColor = [115, 183, 178]
const POTION: EntityModelColor = [172, 42, 144]
const CORK: EntityModelColor = [115, 72, 43]
const ROCKET: EntityModelColor = [188, 50, 48]
const ROCKET_BAND: EntityModelColor = [239, 218, 185]
const FISH_RED: EntityModelColor = [207, 52, 44]
const FISH_WHITE: EntityModelColor = [235, 226, 202]
const SPIT: EntityModelColor = [224, 224, 207]
const SHULKER: EntityModelColor = [147, 84, 173]
const SHULKER_LIGHT: EntityModelColor = [211, 165, 226]
const SKULL: EntityModelColor = [49, 47, 51]
const SKULL_DARK: EntityModelColor = [16, 15, 18]

const arrow: EntityModelDescriptor = model(
  'arrow',
  part('shaft', 'arrow-shaft', [0.09, 0.09, 0.86], [0, 0, 0], WOOD),
  part('arrowhead', 'arrowhead', [0.24, 0.18, 0.28], [0, 0, -0.57], IRON),
  {
    ...part('left-fletching', 'fletching', [0.05, 0.3, 0.2], [-0.1, 0, 0.39], FEATHER),
    rotation: [0, 0, 0.12],
  },
  {
    ...part('right-fletching', 'fletching', [0.05, 0.3, 0.2], [0.1, 0, 0.39], FEATHER),
    rotation: [0, 0, -0.12],
  },
)

const breezeWindCharge: EntityModelDescriptor = model(
  'breeze_wind_charge',
  part('gust-core', 'gust-core', [0.56, 0.56, 0.56], [0, 0, 0], BREEZE),
  part('upper-gust', 'gust-curl', [0.18, 0.66, 0.18], [0.3, 0.19, 0], WIND),
  part('lower-gust', 'gust-curl', [0.18, 0.66, 0.18], [-0.3, -0.19, 0], WIND),
  part('front-gust', 'gust-curl', [0.18, 0.18, 0.66], [0, 0.3, 0.19], BREEZE),
  part('back-gust', 'gust-curl', [0.18, 0.18, 0.66], [0, -0.3, -0.19], BREEZE),
)

const dragonFireball: EntityModelDescriptor = model(
  'dragon_fireball',
  part('dragon-orb', 'dragon-orb', [1.22, 1.22, 1.22], [0, 0, 0], [103, 31, 22]),
  part('inner-flame', 'flame-core', [0.8, 0.8, 0.8], [0, 0, -0.08], [205, 68, 31]),
  part('front-flare', 'flame-flare', [0.38, 0.56, 0.38], [0, 0.1, -0.67], FIRE_GOLD),
  part('upper-flare', 'flame-flare', [0.3, 0.48, 0.32], [0.18, 0.62, 0], FIRE),
  part('lower-flare', 'flame-flare', [0.28, 0.42, 0.28], [-0.16, -0.62, 0.04], FIRE_GOLD),
)

const egg: EntityModelDescriptor = model(
  'egg',
  part('egg-shell', 'egg-shell', [0.48, 0.66, 0.48], [0, 0, 0], [239, 232, 211]),
  part('speckle-top', 'shell-speckle', [0.14, 0.09, 0.08], [0.11, 0.2, -0.19], [171, 151, 117]),
  part('speckle-side', 'shell-speckle', [0.08, 0.13, 0.07], [-0.2, -0.05, -0.15], [186, 164, 124]),
  part('speckle-bottom', 'shell-speckle', [0.12, 0.07, 0.09], [0.1, -0.23, 0.16], [171, 151, 117]),
)

const enderPearl: EntityModelDescriptor = model(
  'ender_pearl',
  part('pearl-orb', 'pearl-orb', [0.54, 0.54, 0.54], [0, 0, 0], ENDER),
  part('pearl-glint', 'orb-glint', [0.16, 0.18, 0.045], [-0.1, 0.12, -0.28], ENDER_GLOW),
  part('pearl-shadow', 'orb-shadow', [0.14, 0.23, 0.05], [0.12, -0.15, -0.27], [13, 72, 49]),
)

const experienceBottle: EntityModelDescriptor = model(
  'experience_bottle',
  part('bottle-body', 'bottle-bulb', [0.38, 0.4, 0.34], [0, -0.12, 0], [62, 180, 179]),
  part('bottle-shoulder', 'bottle-shoulder', [0.3, 0.16, 0.28], [0, 0.13, 0], BOTTLE),
  part('bottle-neck', 'bottle-neck', [0.16, 0.23, 0.16], [0, 0.31, 0], [80, 160, 158]),
  part('bottle-lip', 'bottle-lip', [0.22, 0.08, 0.22], [0, 0.45, 0], [196, 231, 213]),
  part('bottle-shine', 'bottle-glint', [0.055, 0.21, 0.045], [-0.1, -0.1, -0.18], [204, 246, 225]),
)

const fireball: EntityModelDescriptor = model(
  'fireball',
  part('fire-orb', 'fire-orb', [0.86, 0.86, 0.86], [0, 0, 0], FIRE),
  part('fire-core', 'fire-core', [0.52, 0.52, 0.52], [0, 0, -0.13], FIRE_CORE),
  part('left-flame', 'flame-trail', [0.2, 0.44, 0.28], [-0.48, 0.08, 0.05], FIRE_GOLD),
  part('right-flame', 'flame-trail', [0.2, 0.44, 0.28], [0.48, -0.08, 0.05], FIRE),
  part('top-flame', 'flame-trail', [0.32, 0.26, 0.2], [0, 0.48, 0.05], FIRE_GOLD),
)

const fireworkRocket: EntityModelDescriptor = model(
  'firework_rocket',
  part('rocket-body', 'rocket-body', [0.26, 0.94, 0.26], [0, 0.02, 0], ROCKET),
  part('rocket-nose', 'rocket-nose', [0.26, 0.2, 0.26], [0, 0.59, 0], ROCKET_BAND),
  part('rocket-band', 'rocket-band', [0.29, 0.13, 0.29], [0, -0.26, 0], ROCKET_BAND),
  part('left-fin', 'rocket-fin', [0.12, 0.27, 0.2], [-0.17, -0.32, 0], WOOD_LIGHT),
  part('right-fin', 'rocket-fin', [0.12, 0.27, 0.2], [0.17, -0.32, 0], WOOD_LIGHT),
  part('exhaust', 'rocket-exhaust', [0.17, 0.34, 0.17], [0, -0.67, 0], FIRE_GOLD),
)

const fishingBobber: EntityModelDescriptor = model(
  'fishing_bobber',
  part('bobber-float', 'bobber-float', [0.3, 0.42, 0.3], [0, 0.04, 0], FISH_WHITE),
  part('bobber-cap', 'bobber-cap', [0.32, 0.19, 0.32], [0, 0.28, 0], FISH_RED),
  part('bobber-tip', 'bobber-tip', [0.12, 0.13, 0.12], [0, 0.43, 0], FISH_WHITE),
  part('bobber-keel', 'bobber-keel', [0.12, 0.2, 0.12], [0, -0.27, 0], IRON_DARK),
  part('bobber-hook', 'bobber-hook', [0.09, 0.23, 0.09], [0.09, -0.44, 0.04], IRON),
)

const llamaSpit: EntityModelDescriptor = model(
  'llama_spit',
  part('spit-main', 'spit-glob', [0.34, 0.34, 0.48], [0, 0, 0], SPIT),
  part('spit-front', 'spit-glob', [0.2, 0.22, 0.2], [0, 0, -0.29], [247, 247, 231]),
  part('spit-left', 'spit-droplet', [0.16, 0.16, 0.2], [-0.23, 0.14, 0.1], [190, 191, 175]),
  part('spit-right', 'spit-droplet', [0.14, 0.13, 0.18], [0.21, -0.13, 0.08], [207, 208, 192]),
)

const potion: EntityModelDescriptor = model(
  'potion',
  part('potion-base', 'potion-base', [0.32, 0.37, 0.28], [0, -0.16, 0], POTION),
  part('potion-shoulder', 'potion-shoulder', [0.38, 0.15, 0.32], [0, 0.08, 0], BOTTLE),
  part('potion-neck', 'potion-neck', [0.19, 0.22, 0.18], [0, 0.27, 0], [109, 179, 178]),
  part('potion-cork', 'potion-cork', [0.22, 0.13, 0.22], [0, 0.45, 0], CORK),
  part('potion-label', 'potion-label', [0.22, 0.17, 0.035], [0, -0.12, -0.16], [236, 187, 226]),
  part('potion-glint', 'potion-glint', [0.055, 0.16, 0.04], [-0.12, -0.13, -0.16], [217, 224, 219]),
)

const shulkerBullet: EntityModelDescriptor = model(
  'shulker_bullet',
  part('bullet-core', 'bullet-core', [0.34, 0.34, 0.34], [0, 0, 0], SHULKER),
  part('bullet-shell', 'bullet-shell', [0.54, 0.54, 0.54], [0, 0, 0], SHULKER_LIGHT),
  part('bullet-front', 'bullet-face', [0.18, 0.18, 0.06], [0, 0, -0.3], [246, 228, 248]),
  part('bullet-tail', 'bullet-tail', [0.11, 0.11, 0.38], [0, 0, 0.39], SHULKER),
)

const smallFireball: EntityModelDescriptor = model(
  'small_fireball',
  part('small-fire-orb', 'small-fire-orb', [0.48, 0.48, 0.48], [0, 0, 0], [240, 133, 35]),
  part('small-fire-core', 'small-fire-core', [0.28, 0.28, 0.28], [0, 0, -0.08], [255, 224, 128]),
  part('small-fire-tail', 'small-flame-trail', [0.18, 0.36, 0.18], [0.22, 0.03, 0.31], [249, 76, 29]),
  part('small-fire-tip', 'small-flame-trail', [0.14, 0.27, 0.14], [-0.2, -0.06, 0.28], [255, 190, 56]),
)

const snowball: EntityModelDescriptor = model(
  'snowball',
  part('snow-core', 'snowball-core', [0.46, 0.46, 0.46], [0, 0, 0], SNOW),
  part('snow-shadow', 'snowball-shadow', [0.21, 0.18, 0.07], [0.13, -0.1, -0.22], ICE),
  part('snow-crystal', 'snowflake-mark', [0.08, 0.24, 0.06], [-0.1, 0.1, -0.25], [255, 255, 255]),
)

const spectralArrow: EntityModelDescriptor = model(
  'spectral_arrow',
  part('spectral-shaft', 'spectral-shaft', [0.1, 0.1, 0.9], [0, 0, 0], SPECTRAL),
  part('spectral-head', 'spectral-arrowhead', [0.28, 0.22, 0.3], [0, 0, -0.6], IRON),
  part('spectral-left-fletching', 'spectral-fletching', [0.07, 0.36, 0.22], [-0.12, 0, 0.42], [255, 232, 137]),
  part('spectral-right-fletching', 'spectral-fletching', [0.07, 0.36, 0.22], [0.12, 0, 0.42], [255, 232, 137]),
  part('spectral-aura', 'arrow-aura', [0.19, 0.19, 0.72], [0, 0, 0.03], [255, 224, 118]),
)

const trident: EntityModelDescriptor = model(
  'trident',
  part('trident-shaft', 'trident-shaft', [0.12, 1.18, 0.12], [0, -0.04, 0], [48, 135, 132]),
  part('trident-crossbar', 'trident-crossbar', [0.64, 0.1, 0.12], [0, 0.58, 0], [64, 174, 164]),
  part('left-prong', 'trident-prong', [0.1, 0.54, 0.12], [-0.25, 0.88, 0], [92, 204, 188]),
  part('center-prong', 'trident-prong', [0.12, 0.68, 0.14], [0, 0.99, 0], [133, 225, 205]),
  part('right-prong', 'trident-prong', [0.1, 0.54, 0.12], [0.25, 0.88, 0], [92, 204, 188]),
  part('trident-butt', 'trident-butt', [0.2, 0.14, 0.2], [0, -0.69, 0], [176, 129, 69]),
)

const windCharge: EntityModelDescriptor = model(
  'wind_charge',
  part('wind-orb', 'wind-charge-orb', [0.48, 0.48, 0.48], [0, 0, 0], [189, 238, 229]),
  part('horizontal-ring', 'wind-ring', [0.86, 0.1, 0.1], [0, 0.08, 0], WIND),
  part('vertical-ring', 'wind-ring', [0.1, 0.86, 0.1], [-0.03, 0, 0], BREEZE),
  part('depth-ring', 'wind-ring', [0.1, 0.1, 0.86], [0.03, 0, 0], [132, 214, 207]),
  part('wind-core', 'wind-core', [0.2, 0.2, 0.2], [0, 0, -0.26], [250, 255, 250]),
)

const witherSkull: EntityModelDescriptor = model(
  'wither_skull',
  part('skull-cranium', 'skull-cranium', [0.7, 0.66, 0.6], [0, 0.08, 0], SKULL),
  part('skull-jaw', 'skull-jaw', [0.52, 0.2, 0.48], [0, -0.31, -0.01], [76, 72, 78]),
  part('left-eye-socket', 'skull-eye-socket', [0.17, 0.16, 0.07], [-0.18, 0.12, -0.32], SKULL_DARK),
  part('right-eye-socket', 'skull-eye-socket', [0.17, 0.16, 0.07], [0.18, 0.12, -0.32], SKULL_DARK),
  part('nose', 'skull-nose', [0.13, 0.14, 0.12], [0, -0.03, -0.34], [111, 106, 113]),
  part('smoke-trail', 'skull-smoke', [0.3, 0.35, 0.32], [0, 0.28, 0.43], [106, 98, 107]),
)

export const PROJECTILE_ENTITY_MODELS: ReadonlyArray<EntityModelDescriptor> = [
  arrow,
  breezeWindCharge,
  dragonFireball,
  egg,
  enderPearl,
  experienceBottle,
  fireball,
  fireworkRocket,
  fishingBobber,
  llamaSpit,
  potion,
  shulkerBullet,
  smallFireball,
  snowball,
  spectralArrow,
  trident,
  windCharge,
  witherSkull,
]
