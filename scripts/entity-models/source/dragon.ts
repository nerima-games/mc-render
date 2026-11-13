import { Brand } from 'effect'
import type {
  EntityModelColor,
  EntityModelDescriptor,
  EntityModelKind,
  EntityModelPartDescriptor,
  EntityModelPartIdentifier,
  EntityModelPartRole,
  EntityModelVector,
} from './types.js'

const modelKind = Brand.nominal<EntityModelKind>()
const partIdentifier = Brand.nominal<EntityModelPartIdentifier>()
const partRole = Brand.nominal<EntityModelPartRole>()

const part = (
  id: string,
  role: string,
  size: EntityModelVector,
  center: EntityModelVector,
  color: EntityModelColor,
  rotation?: EntityModelVector,
): EntityModelPartDescriptor =>
  rotation === undefined
    ? { id: partIdentifier(id), role: partRole(role), size, center, color }
    : { id: partIdentifier(id), role: partRole(role), size, center, color, rotation }

const BODY: EntityModelColor = [0.11, 0.07, 0.2]
const BODY_HIGHLIGHT: EntityModelColor = [0.22, 0.12, 0.34]
const BELLY: EntityModelColor = [0.34, 0.2, 0.43]
const WING: EntityModelColor = [0.35, 0.1, 0.48]
const WING_HIGHLIGHT: EntityModelColor = [0.48, 0.16, 0.62]
const HORN: EntityModelColor = [0.27, 0.2, 0.36]
const EYE: EntityModelColor = [0.96, 0.12, 0.8]

const enderDragon: EntityModelDescriptor = {
  kind: modelKind('ender_dragon'),
  parts: [
    part('torso', 'body', [1.38, 1.1, 1.62], [0, 1.95, -0.16], BODY),
    part('shoulders', 'body', [1.62, 0.68, 0.9], [0, 2.21, 0.43], BODY_HIGHLIGHT),
    part('belly', 'body', [0.92, 0.34, 1.35], [0, 1.42, -0.08], BELLY),
    part('neck-base', 'neck', [0.84, 0.66, 0.94], [0, 2.16, 0.9], BODY),
    part('neck-front', 'neck', [0.68, 0.55, 0.9], [0, 2.29, 1.59], BODY_HIGHLIGHT),
    part('neck-ridge', 'neck', [0.72, 0.16, 1.3], [0, 2.62, 1.2], HORN),
    part('head', 'head', [0.96, 0.7, 0.82], [0, 2.55, 2.14], BODY),
    part('muzzle', 'head', [0.62, 0.4, 0.72], [0, 2.38, 2.74], BODY_HIGHLIGHT),
    part('jaw', 'head', [0.58, 0.17, 0.66], [0, 2.16, 2.62], HORN),
    part('brow', 'head', [0.72, 0.14, 0.28], [0, 2.83, 2.31], HORN),
    part('eye-left', 'eye', [0.12, 0.13, 0.07], [-0.34, 2.57, 2.57], EYE),
    part('eye-right', 'eye', [0.12, 0.13, 0.07], [0.34, 2.57, 2.57], EYE),
    part('horn-left', 'horn', [0.18, 0.58, 0.18], [-0.64, 3.02, 2.05], HORN, [0, 0, -0.38]),
    part('horn-right', 'horn', [0.18, 0.58, 0.18], [0.64, 3.02, 2.05], HORN, [0, 0, 0.38]),
    part('spine-front', 'spine', [0.16, 0.32, 0.2], [0, 2.79, 0.43], HORN),
    part('spine-middle', 'spine', [0.17, 0.38, 0.22], [0, 2.78, -0.23], HORN),
    part('spine-back', 'spine', [0.14, 0.3, 0.2], [0, 2.65, -0.82], HORN),
    part('left-wing-root', 'wing', [1.72, 0.12, 1.76], [-1.43, 2.55, -0.05], WING),
    part('left-wing-outer', 'wing', [1.72, 0.1, 1.42], [-3.1, 2.62, 0.04], WING_HIGHLIGHT),
    part('left-wing-leading-edge', 'wing', [3.58, 0.18, 0.22], [-2.24, 2.72, 0.77], HORN, [0, 0, -0.07]),
    part('left-wing-trailing-edge', 'wing', [3.2, 0.14, 0.18], [-2.04, 2.49, -0.92], WING_HIGHLIGHT, [0, 0, 0.05]),
    part('left-wing-tip', 'wing', [0.24, 0.22, 1.16], [-3.97, 2.79, -0.08], HORN, [0, 0, -0.2]),
    part('right-wing-root', 'wing', [1.72, 0.12, 1.76], [1.43, 2.55, -0.05], WING),
    part('right-wing-outer', 'wing', [1.72, 0.1, 1.42], [3.1, 2.62, 0.04], WING_HIGHLIGHT),
    part('right-wing-leading-edge', 'wing', [3.58, 0.18, 0.22], [2.24, 2.72, 0.77], HORN, [0, 0, 0.07]),
    part('right-wing-trailing-edge', 'wing', [3.2, 0.14, 0.18], [2.04, 2.49, -0.92], WING_HIGHLIGHT, [0, 0, -0.05]),
    part('right-wing-tip', 'wing', [0.24, 0.22, 1.16], [3.97, 2.79, -0.08], HORN, [0, 0, 0.2]),
    part('foreleg-left', 'leg', [0.29, 0.72, 0.36], [-0.76, 1.23, 0.5], BODY_HIGHLIGHT, [0, 0, -0.14]),
    part('forefoot-left', 'leg', [0.34, 0.18, 0.4], [-0.8, 0.78, 0.57], HORN),
    part('foreleg-right', 'leg', [0.29, 0.72, 0.36], [0.76, 1.23, 0.5], BODY_HIGHLIGHT, [0, 0, 0.14]),
    part('forefoot-right', 'leg', [0.34, 0.18, 0.4], [0.8, 0.78, 0.57], HORN),
    part('hindleg-left', 'leg', [0.45, 0.8, 0.52], [-0.65, 0.83, -0.58], BODY_HIGHLIGHT, [0, 0, -0.16]),
    part('hindfoot-left', 'leg', [0.5, 0.2, 0.58], [-0.68, 0.24, -0.65], HORN),
    part('hindleg-right', 'leg', [0.45, 0.8, 0.52], [0.65, 0.83, -0.58], BODY_HIGHLIGHT, [0, 0, 0.16]),
    part('hindfoot-right', 'leg', [0.5, 0.2, 0.58], [0.68, 0.24, -0.65], HORN),
    part('tail-base', 'tail', [0.58, 0.46, 0.88], [0, 1.79, -1.28], BODY),
    part('tail-middle', 'tail', [0.4, 0.34, 0.92], [0, 1.62, -2.12], BODY_HIGHLIGHT, [0.08, 0, 0]),
    part('tail-tip', 'tail', [0.23, 0.23, 0.88], [0, 1.43, -2.95], BODY, [0.16, 0, 0]),
    part('tail-spade', 'tail', [0.2, 0.38, 0.42], [0, 1.25, -3.55], HORN, [0.2, 0, 0]),
  ],
}

export const DRAGON_ENTITY_MODELS: ReadonlyArray<EntityModelDescriptor> = [enderDragon]
