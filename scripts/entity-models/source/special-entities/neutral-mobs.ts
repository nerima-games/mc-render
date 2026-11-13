import { Brand } from 'effect'
import type {
  EntityModelColor,
  EntityModelDescriptor,
  EntityModelKind,
  EntityModelPartDescriptor,
  EntityModelPartIdentifier,
  EntityModelPartRole,
  EntityModelVector,
} from "../types.js"

const modelKind = Brand.nominal<EntityModelKind>()
const partIdentifier = Brand.nominal<EntityModelPartIdentifier>()
const partRole = Brand.nominal<EntityModelPartRole>()

const part = (
  id: string,
  role: string,
  size: EntityModelVector,
  center: EntityModelVector,
  color: EntityModelColor,
): EntityModelPartDescriptor => ({ id: partIdentifier(id), role: partRole(role), size, center, color })

const model = (kind: string, ...parts: EntityModelPartDescriptor[]): EntityModelDescriptor => ({ kind: modelKind(kind), parts })

const caveSpiderLegs = [
  part("leg-front-left", "leg", [0.56, 0.08, 0.1], [-0.48, 0.29, 0.33], [0.15, 0.22, 0.3]),
  part("leg-front-right", "leg", [0.56, 0.08, 0.1], [0.48, 0.29, 0.33], [0.15, 0.22, 0.3]),
  part("leg-mid-front-left", "leg", [0.62, 0.08, 0.1], [-0.51, 0.3, 0.12], [0.15, 0.22, 0.3]),
  part("leg-mid-front-right", "leg", [0.62, 0.08, 0.1], [0.51, 0.3, 0.12], [0.15, 0.22, 0.3]),
  part("leg-mid-back-left", "leg", [0.62, 0.08, 0.1], [-0.51, 0.3, -0.1], [0.15, 0.22, 0.3]),
  part("leg-mid-back-right", "leg", [0.62, 0.08, 0.1], [0.51, 0.3, -0.1], [0.15, 0.22, 0.3]),
  part("leg-back-left", "leg", [0.55, 0.08, 0.1], [-0.46, 0.28, -0.32], [0.15, 0.22, 0.3]),
  part("leg-back-right", "leg", [0.55, 0.08, 0.1], [0.46, 0.28, -0.32], [0.15, 0.22, 0.3]),
]

const spiderLegs = [
  part("leg-front-left", "leg", [0.76, 0.1, 0.12], [-0.61, 0.38, 0.47], [0.29, 0.18, 0.13]),
  part("leg-front-right", "leg", [0.76, 0.1, 0.12], [0.61, 0.38, 0.47], [0.29, 0.18, 0.13]),
  part("leg-mid-front-left", "leg", [0.84, 0.1, 0.12], [-0.67, 0.4, 0.19], [0.29, 0.18, 0.13]),
  part("leg-mid-front-right", "leg", [0.84, 0.1, 0.12], [0.67, 0.4, 0.19], [0.29, 0.18, 0.13]),
  part("leg-mid-back-left", "leg", [0.84, 0.1, 0.12], [-0.67, 0.4, -0.19], [0.29, 0.18, 0.13]),
  part("leg-mid-back-right", "leg", [0.84, 0.1, 0.12], [0.67, 0.4, -0.19], [0.29, 0.18, 0.13]),
  part("leg-back-left", "leg", [0.74, 0.1, 0.12], [-0.6, 0.37, -0.47], [0.29, 0.18, 0.13]),
  part("leg-back-right", "leg", [0.74, 0.1, 0.12], [0.6, 0.37, -0.47], [0.29, 0.18, 0.13]),
]

export const NEUTRAL_MOB_ENTITY_MODELS: ReadonlyArray<EntityModelDescriptor> = [
  model(
    "cave_spider",
    part("abdomen", "abdomen", [0.48, 0.28, 0.52], [0, 0.36, -0.3], [0.12, 0.18, 0.25]),
    part("thorax", "body", [0.39, 0.29, 0.4], [0, 0.39, 0.08], [0.18, 0.28, 0.36]),
    part("head", "head", [0.34, 0.29, 0.34], [0, 0.42, 0.4], [0.12, 0.18, 0.25]),
    part("eye-left", "eye", [0.08, 0.07, 0.035], [-0.09, 0.47, 0.575], [0.12, 0.8, 0.9]),
    part("eye-right", "eye", [0.08, 0.07, 0.035], [0.09, 0.47, 0.575], [0.12, 0.8, 0.9]),
    part("fang-left", "fang", [0.055, 0.12, 0.055], [-0.1, 0.32, 0.53], [0.65, 0.76, 0.78]),
    part("fang-right", "fang", [0.055, 0.12, 0.055], [0.1, 0.32, 0.53], [0.65, 0.76, 0.78]),
    ...caveSpiderLegs,
  ),
  model(
    "enderman",
    part("torso", "torso", [0.44, 0.86, 0.3], [0, 1.3, 0], [0.08, 0.07, 0.1]),
    part("head", "head", [0.56, 0.56, 0.56], [0, 2.11, 0], [0.07, 0.06, 0.09]),
    part("eye-left", "eye", [0.12, 0.055, 0.035], [-0.15, 2.14, 0.29], [0.76, 0.15, 0.82]),
    part("eye-right", "eye", [0.12, 0.055, 0.035], [0.15, 2.14, 0.29], [0.76, 0.15, 0.82]),
    part("left-arm", "arm", [0.16, 1.12, 0.17], [-0.39, 1.27, 0], [0.09, 0.07, 0.11]),
    part("right-arm", "arm", [0.16, 1.12, 0.17], [0.39, 1.27, 0], [0.09, 0.07, 0.11]),
    part("left-leg", "leg", [0.19, 1.03, 0.2], [-0.14, 0.52, 0], [0.09, 0.07, 0.11]),
    part("right-leg", "leg", [0.19, 1.03, 0.2], [0.14, 0.52, 0], [0.09, 0.07, 0.11]),
    part("held-block", "carried-block", [0.38, 0.38, 0.38], [0.58, 0.69, 0.06], [0.35, 0.19, 0.54]),
  ),
  model(
    "iron_golem",
    part("body", "torso", [0.92, 1.1, 0.55], [0, 1.22, 0], [0.69, 0.68, 0.64]),
    part("shoulders", "shoulders", [1.28, 0.48, 0.64], [0, 1.81, 0], [0.77, 0.75, 0.69]),
    part("head", "head", [0.53, 0.58, 0.51], [0, 2.29, 0], [0.78, 0.75, 0.69]),
    part("nose", "nose", [0.14, 0.32, 0.16], [0, 2.21, 0.32], [0.51, 0.4, 0.34]),
    part("eye-left", "eye", [0.08, 0.07, 0.04], [-0.13, 2.34, 0.27], [0.12, 0.08, 0.07]),
    part("eye-right", "eye", [0.08, 0.07, 0.04], [0.13, 2.34, 0.27], [0.12, 0.08, 0.07]),
    part("left-arm", "arm", [0.24, 0.94, 0.28], [-0.77, 1.18, 0], [0.67, 0.66, 0.62]),
    part("right-arm", "arm", [0.24, 0.94, 0.28], [0.77, 1.18, 0], [0.67, 0.66, 0.62]),
    part("left-leg", "leg", [0.35, 0.66, 0.38], [-0.26, 0.36, 0], [0.62, 0.61, 0.57]),
    part("right-leg", "leg", [0.35, 0.66, 0.38], [0.26, 0.36, 0], [0.62, 0.61, 0.57]),
    part("vine-left", "vine", [0.08, 0.44, 0.08], [-0.39, 1.52, 0.3], [0.2, 0.43, 0.16]),
    part("vine-right", "vine", [0.08, 0.32, 0.08], [0.43, 1.24, 0.3], [0.2, 0.43, 0.16]),
  ),
  model(
    "piglin",
    part("tunic", "torso", [0.53, 0.68, 0.36], [0, 0.94, 0], [0.38, 0.22, 0.14]),
    part("belt", "belt", [0.55, 0.14, 0.38], [0, 0.61, 0], [0.7, 0.48, 0.12]),
    part("head", "piglin-head", [0.49, 0.46, 0.43], [0, 1.56, 0], [0.79, 0.48, 0.39]),
    part("snout", "snout", [0.28, 0.2, 0.2], [0, 1.48, 0.29], [0.9, 0.62, 0.52]),
    part("nostrils", "nostrils", [0.12, 0.055, 0.035], [0, 1.49, 0.4], [0.28, 0.12, 0.1]),
    part("left-ear", "ear", [0.14, 0.48, 0.13], [-0.36, 1.89, 0.02], [0.69, 0.36, 0.29]),
    part("right-ear", "ear", [0.14, 0.48, 0.13], [0.36, 1.89, 0.02], [0.69, 0.36, 0.29]),
    part("left-eye", "eye", [0.07, 0.075, 0.04], [-0.12, 1.63, 0.23], [0.17, 0.09, 0.07]),
    part("right-eye", "eye", [0.07, 0.075, 0.04], [0.12, 1.63, 0.23], [0.17, 0.09, 0.07]),
    {
      ...part("left-arm", "arm", [0.17, 0.62, 0.19], [-0.37, 0.98, 0], [0.68, 0.37, 0.3]),
      rotation: [0, 0, 0.1],
    },
    {
      ...part("right-arm", "arm", [0.17, 0.62, 0.19], [0.37, 0.98, 0], [0.68, 0.37, 0.3]),
      rotation: [0, 0, -0.1],
    },
    part("left-leg", "leg", [0.21, 0.48, 0.22], [-0.14, 0.24, 0], [0.56, 0.3, 0.24]),
    part("right-leg", "leg", [0.21, 0.48, 0.22], [0.14, 0.24, 0], [0.56, 0.3, 0.24]),
  ),
  model(
    "snow_golem",
    part("lower-snowball", "snow-body", [0.82, 0.65, 0.72], [0, 0.46, 0], [0.91, 0.94, 0.97]),
    part("upper-snowball", "snow-body", [0.65, 0.62, 0.63], [0, 1.08, 0], [0.96, 0.97, 1]),
    part("pumpkin", "pumpkin-head", [0.58, 0.56, 0.57], [0, 1.67, 0], [0.91, 0.39, 0.08]),
    part("carved-face", "face", [0.42, 0.23, 0.06], [0, 1.65, 0.31], [0.28, 0.17, 0.08]),
    part("left-eye", "eye", [0.09, 0.08, 0.035], [-0.12, 1.71, 0.35], [0.12, 0.08, 0.04]),
    part("right-eye", "eye", [0.09, 0.08, 0.035], [0.12, 1.71, 0.35], [0.12, 0.08, 0.04]),
    part("mouth", "mouth", [0.15, 0.07, 0.035], [0, 1.56, 0.35], [0.2, 0.1, 0.04]),
    part("left-stick-arm", "stick-arm", [0.83, 0.08, 0.09], [-0.73, 1.02, 0], [0.39, 0.25, 0.12]),
    part("right-stick-arm", "stick-arm", [0.83, 0.08, 0.09], [0.73, 1.02, 0], [0.39, 0.25, 0.12]),
    part("button-upper", "coal-button", [0.1, 0.1, 0.07], [0, 1.19, 0.34], [0.12, 0.13, 0.14]),
    part("button-lower", "coal-button", [0.1, 0.1, 0.07], [0, 0.83, 0.38], [0.12, 0.13, 0.14]),
  ),
  model(
    "spider",
    part("abdomen", "abdomen", [0.65, 0.4, 0.72], [0, 0.51, -0.4], [0.24, 0.14, 0.1]),
    part("thorax", "body", [0.5, 0.38, 0.51], [0, 0.53, 0.08], [0.34, 0.21, 0.15]),
    part("head", "head", [0.39, 0.33, 0.39], [0, 0.55, 0.49], [0.27, 0.16, 0.12]),
    part("eye-left", "eye", [0.1, 0.09, 0.04], [-0.12, 0.61, 0.69], [0.8, 0.09, 0.06]),
    part("eye-right", "eye", [0.1, 0.09, 0.04], [0.12, 0.61, 0.69], [0.8, 0.09, 0.06]),
    part("fang-left", "fang", [0.07, 0.14, 0.06], [-0.12, 0.41, 0.64], [0.67, 0.55, 0.42]),
    part("fang-right", "fang", [0.07, 0.14, 0.06], [0.12, 0.41, 0.64], [0.67, 0.55, 0.42]),
    ...spiderLegs,
  ),
  model(
    "zombified_piglin",
    part("ragged-tunic", "torso", [0.52, 0.68, 0.35], [0, 0.94, 0], [0.31, 0.39, 0.21]),
    part("exposed-ribs", "ribcage", [0.38, 0.42, 0.08], [0, 1.03, 0.22], [0.82, 0.74, 0.53]),
    part("head", "undead-piglin-head", [0.48, 0.45, 0.42], [0, 1.56, 0], [0.48, 0.57, 0.31]),
    part("snout", "snout", [0.27, 0.18, 0.19], [0, 1.47, 0.29], [0.64, 0.57, 0.36]),
    part("nostrils", "nostrils", [0.12, 0.05, 0.035], [0, 1.48, 0.39], [0.25, 0.2, 0.12]),
    part("left-ear", "ear", [0.13, 0.45, 0.12], [-0.35, 1.88, 0.01], [0.43, 0.48, 0.28]),
    part("right-ear", "ear", [0.13, 0.45, 0.12], [0.35, 1.88, 0.01], [0.43, 0.48, 0.28]),
    part("left-eye", "eye", [0.07, 0.075, 0.04], [-0.12, 1.63, 0.22], [0.74, 0.68, 0.43]),
    part("right-eye", "eye", [0.07, 0.075, 0.04], [0.12, 1.63, 0.22], [0.16, 0.08, 0.06]),
    part("left-arm", "arm", [0.17, 0.62, 0.19], [-0.37, 0.98, 0], [0.37, 0.48, 0.28]),
    part("right-arm", "arm", [0.17, 0.62, 0.19], [0.37, 0.98, 0], [0.37, 0.48, 0.28]),
    part("left-leg", "leg", [0.21, 0.48, 0.22], [-0.14, 0.24, 0], [0.31, 0.4, 0.22]),
    part("right-leg", "leg", [0.21, 0.48, 0.22], [0.14, 0.24, 0], [0.31, 0.4, 0.22]),
    part("golden-blade", "golden-weapon", [0.1, 0.82, 0.08], [0.53, 0.92, 0.15], [0.91, 0.67, 0.16]),
    part("blade-guard", "weapon-guard", [0.34, 0.08, 0.08], [0.53, 0.84, 0.15], [0.72, 0.48, 0.1]),
  ),
]
