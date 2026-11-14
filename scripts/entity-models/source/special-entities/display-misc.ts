// SPDX-License-Identifier: CC0-1.0
import { Brand } from 'effect'
import type {
  EntityModelColor,
  EntityModelDescriptor,
  EntityModelKind,
  EntityModelPartDescriptor,
  EntityModelPartIdentifier,
  EntityModelPartRole,
  EntityModelVector,
} from '../types.js'

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

const WOOD: EntityModelColor = [0.42, 0.25, 0.13]
const WOOD_LIGHT: EntityModelColor = [0.68, 0.44, 0.24]
const STONE: EntityModelColor = [0.48, 0.51, 0.53]
const STONE_LIGHT: EntityModelColor = [0.72, 0.74, 0.73]
const GLASS: EntityModelColor = [0.43, 0.82, 0.91]
const GLOW: EntityModelColor = [0.57, 0.96, 1]
const GOLD: EntityModelColor = [0.96, 0.68, 0.17]
const GOLD_LIGHT: EntityModelColor = [1, 0.88, 0.38]
const PURPLE: EntityModelColor = [0.48, 0.16, 0.78]
const PURPLE_LIGHT: EntityModelColor = [0.75, 0.42, 0.96]
const GREEN: EntityModelColor = [0.16, 0.66, 0.35]
const GREEN_LIGHT: EntityModelColor = [0.48, 0.92, 0.47]
const RED: EntityModelColor = [0.82, 0.17, 0.12]
const WHITE: EntityModelColor = [0.94, 0.91, 0.78]
const BLUE: EntityModelColor = [0.15, 0.42, 0.86]
const BROWN: EntityModelColor = [0.37, 0.21, 0.1]

export const DISPLAY_MISC_ENTITY_MODELS: ReadonlyArray<EntityModelDescriptor> = [
  model(
    'block_display',
    part('glass-core', 'display-block', [0.9, 0.9, 0.9], [0, 0.08, 0], GLASS),
    part('top-face', 'top-face', [0.72, 0.08, 0.72], [0, 0.55, 0], GLOW),
    part('front-inset', 'front-inset', [0.56, 0.56, 0.07], [0, 0.08, 0.48], BLUE),
    part('left-edge', 'edge', [0.08, 0.78, 0.08], [-0.47, 0.08, 0.47], WHITE),
    part('right-edge', 'edge', [0.08, 0.78, 0.08], [0.47, 0.08, 0.47], WHITE),
  ),
  model(
    'interaction',
    part('frame-left', 'target-frame', [0.09, 1.6, 0.08], [-0.72, 0, 0], GLOW),
    part('frame-right', 'target-frame', [0.09, 1.6, 0.08], [0.72, 0, 0], GLOW),
    part('frame-top', 'target-frame', [1.52, 0.09, 0.08], [0, 0.76, 0], GLASS),
    part('frame-bottom', 'target-frame', [1.52, 0.09, 0.08], [0, -0.76, 0], GLASS),
    part('center-dot', 'target-center', [0.17, 0.17, 0.1], [0, 0, 0.08], WHITE),
  ),
  model(
    'item_display',
    part('pedestal-base', 'display-pedestal', [0.62, 0.14, 0.62], [0, -0.52, 0], STONE),
    part('pedestal-stem', 'display-stem', [0.16, 0.62, 0.16], [0, -0.14, 0], GOLD),
    part('item-center', 'display-item', [0.58, 0.7, 0.42], [0, 0.45, 0], PURPLE),
    part('item-cap', 'display-highlight', [0.3, 0.18, 0.26], [0, 0.86, 0], PURPLE_LIGHT),
    part('support-left', 'display-support', [0.08, 0.32, 0.08], [-0.34, 0.27, 0], GOLD_LIGHT),
    part('support-right', 'display-support', [0.08, 0.32, 0.08], [0.34, 0.27, 0], GOLD_LIGHT),
  ),
  model(
    'marker',
    part('marker-stem', 'marker-stem', [0.14, 1.25, 0.14], [0, 0, 0], RED),
    part('marker-crossbar', 'marker-crossbar', [0.72, 0.12, 0.14], [0, 0.37, 0], GOLD_LIGHT),
    part('marker-cap', 'marker-cap', [0.3, 0.22, 0.3], [0, 0.72, 0], WHITE),
    part('marker-foot', 'marker-foot', [0.54, 0.12, 0.54], [0, -0.68, 0], STONE),
  ),
  model(
    'text_display',
    part('panel-back', 'text-panel', [1.25, 0.82, 0.1], [0, 0, -0.04], WOOD),
    part('panel-face', 'text-face', [1.12, 0.68, 0.06], [0, 0, 0.04], STONE_LIGHT),
    part('text-line-one', 'text-line', [0.84, 0.08, 0.04], [0, 0.2, 0.09], BLUE),
    part('text-line-two', 'text-line', [0.66, 0.07, 0.04], [-0.08, 0, 0.09], PURPLE),
    part('text-line-three', 'text-line', [0.76, 0.07, 0.04], [0.04, -0.2, 0.09], GREEN),
    part('panel-pin', 'text-pin', [0.12, 0.12, 0.08], [0.53, 0.35, 0.08], GOLD),
  ),
  model(
    'area_effect_cloud',
    part('cloud-center', 'cloud-mist', [0.72, 0.16, 0.72], [0, 0, 0], PURPLE_LIGHT),
    part('cloud-north', 'cloud-puff', [0.54, 0.13, 0.48], [0, 0.06, -0.52], GLASS),
    part('cloud-south', 'cloud-puff', [0.57, 0.15, 0.46], [0, -0.03, 0.52], PURPLE),
    part('cloud-east', 'cloud-puff', [0.48, 0.14, 0.54], [0.52, 0.02, 0], BLUE),
    part('cloud-west', 'cloud-puff', [0.48, 0.12, 0.54], [-0.52, 0.03, 0], GLASS),
    part('cloud-rim', 'cloud-rim', [1.58, 0.07, 0.08], [0, -0.11, 0], GLOW),
  ),
  model(
    'armor_stand',
    part('stand-base', 'stand-base', [0.56, 0.1, 0.56], [0, -0.85, 0], STONE),
    part('stand-post', 'stand-post', [0.12, 0.38, 0.12], [0, -0.58, 0], WOOD_LIGHT),
    part('torso', 'torso', [0.48, 0.62, 0.24], [0, 0.05, 0], WOOD),
    part('head', 'head', [0.38, 0.4, 0.38], [0, 0.62, 0], WOOD_LIGHT),
    part('left-arm', 'arm', [0.13, 0.66, 0.15], [-0.36, 0.08, 0], WOOD_LIGHT),
    part('right-arm', 'arm', [0.13, 0.66, 0.15], [0.36, 0.08, 0], WOOD_LIGHT),
    part('left-leg', 'leg', [0.16, 0.58, 0.18], [-0.16, -0.52, 0], BROWN),
    part('right-leg', 'leg', [0.16, 0.58, 0.18], [0.16, -0.52, 0], BROWN),
  ),
  model(
    'end_crystal',
    part('crystal-base', 'crystal-base', [0.7, 0.14, 0.7], [0, -0.73, 0], PURPLE),
    part('crystal-core', 'crystal-core', [0.42, 0.8, 0.42], [0, -0.15, 0], PURPLE_LIGHT),
    part('crystal-upper', 'crystal-facet', [0.62, 0.5, 0.5], [0, 0.43, 0], GLASS),
    part('crystal-crown', 'crystal-crown', [0.34, 0.28, 0.34], [0, 0.82, 0], GLOW),
    part('crystal-ring-front', 'crystal-ring', [0.95, 0.07, 0.08], [0, 0.05, 0.28], PURPLE),
    {
      ...part('crystal-ring-side', 'crystal-ring', [0.08, 0.07, 0.95], [0.28, 0.05, 0], PURPLE),
      rotation: [0.16, 0, 0],
    },
  ),
  model(
    'evoker_fangs',
    part('fang-jaw', 'fang-jaw', [0.72, 0.12, 0.5], [0, -0.36, 0], BROWN),
    part('fang-left', 'fang-tooth', [0.14, 0.74, 0.16], [-0.25, 0.02, 0.08], WHITE),
    part('fang-right', 'fang-tooth', [0.14, 0.74, 0.16], [0.25, 0.02, 0.08], WHITE),
    part('fang-tip-left', 'fang-tip', [0.2, 0.22, 0.2], [-0.25, 0.48, 0.08], GOLD_LIGHT),
    part('fang-tip-right', 'fang-tip', [0.2, 0.22, 0.2], [0.25, 0.48, 0.08], GOLD_LIGHT),
    part('fang-back-spur', 'fang-spur', [0.12, 0.46, 0.12], [0, 0.04, -0.22], RED),
  ),
  model(
    'experience_orb',
    part('orb-core', 'orb-core', [0.32, 0.32, 0.32], [0, 0, 0], GREEN),
    part('orb-face', 'orb-face', [0.16, 0.16, 0.06], [0, 0, 0.18], GOLD_LIGHT),
    part('orb-shard-top', 'orb-shard', [0.12, 0.34, 0.12], [0, 0.26, 0], GREEN_LIGHT),
    part('orb-shard-left', 'orb-shard', [0.3, 0.1, 0.12], [-0.24, 0.02, 0], GOLD),
    part('orb-shard-right', 'orb-shard', [0.3, 0.1, 0.12], [0.24, -0.03, 0], GREEN_LIGHT),
    part('orb-shard-back', 'orb-shard', [0.12, 0.12, 0.32], [0, -0.1, -0.23], GOLD),
  ),
  model(
    'eye_of_ender',
    part('eye-pupil', 'eye-pupil', [0.42, 0.42, 0.3], [0, 0, 0], PURPLE),
    part('eye-iris', 'eye-iris', [0.26, 0.26, 0.08], [0, 0, 0.18], GREEN_LIGHT),
    part('eye-glint', 'eye-glint', [0.08, 0.08, 0.04], [-0.07, 0.08, 0.24], WHITE),
    part('eye-ring-top', 'eye-ring', [0.66, 0.08, 0.12], [0, 0.25, 0], GREEN),
    part('eye-ring-bottom', 'eye-ring', [0.66, 0.08, 0.12], [0, -0.25, 0], GREEN),
    part('eye-ring-left', 'eye-ring', [0.1, 0.44, 0.12], [-0.28, 0, 0], GOLD),
    part('eye-ring-right', 'eye-ring', [0.1, 0.44, 0.12], [0.28, 0, 0], GOLD),
  ),
  model(
    'falling_block',
    part('block-dirt', 'falling-block', [0.86, 0.84, 0.86], [0, 0, 0], BROWN),
    part('block-top', 'grass-cap', [0.92, 0.12, 0.92], [0, 0.47, 0], GREEN),
    part('block-pebble-left', 'stone-chip', [0.18, 0.14, 0.08], [-0.22, 0.06, 0.46], STONE),
    part('block-pebble-right', 'stone-chip', [0.12, 0.18, 0.08], [0.26, -0.2, 0.46], STONE_LIGHT),
    part('block-root', 'root', [0.12, 0.27, 0.1], [0.36, -0.54, 0.22], WOOD_LIGHT),
  ),
  model(
    'glow_item_frame',
    part('frame-top', 'glow-frame', [1.06, 0.1, 0.12], [0, 0.52, 0], GLOW),
    part('frame-bottom', 'glow-frame', [1.06, 0.1, 0.12], [0, -0.52, 0], GLOW),
    part('frame-left', 'glow-frame', [0.1, 0.94, 0.12], [-0.48, 0, 0], GLASS),
    part('frame-right', 'glow-frame', [0.1, 0.94, 0.12], [0.48, 0, 0], GLASS),
    part('frame-item', 'glow-item', [0.4, 0.4, 0.14], [0, 0, 0.1], GOLD_LIGHT),
    part('frame-bloom', 'glow-halo', [0.22, 0.22, 0.1], [0, 0, 0.2], WHITE),
  ),
  model(
    'item',
    part('item-body', 'dropped-item', [0.36, 0.44, 0.32], [0, 0, 0], GOLD),
    part('item-top', 'item-top', [0.28, 0.14, 0.26], [0, 0.29, 0], GOLD_LIGHT),
    part('item-band', 'item-band', [0.39, 0.08, 0.34], [0, -0.04, 0], RED),
    part('item-side', 'item-mark', [0.08, 0.18, 0.12], [0.2, 0.05, 0.16], WHITE),
    part('item-shadow', 'item-shadow', [0.43, 0.06, 0.38], [0, -0.27, 0], BROWN),
  ),
  model(
    'item_frame',
    part('wood-top', 'frame-rail', [0.98, 0.12, 0.12], [0, 0.48, 0], WOOD_LIGHT),
    part('wood-bottom', 'frame-rail', [0.98, 0.12, 0.12], [0, -0.48, 0], WOOD),
    part('wood-left', 'frame-rail', [0.12, 0.84, 0.12], [-0.43, 0, 0], WOOD),
    part('wood-right', 'frame-rail', [0.12, 0.84, 0.12], [0.43, 0, 0], WOOD_LIGHT),
    part('frame-corner', 'frame-corner', [0.17, 0.17, 0.13], [-0.43, 0.48, 0.02], GOLD),
    part('framed-item', 'framed-item', [0.3, 0.3, 0.08], [0, 0, 0.1], BLUE),
  ),
  model(
    'leash_knot',
    part('knot-center', 'rope-knot', [0.24, 0.22, 0.2], [0, 0, 0], RED),
    part('knot-loop-left', 'rope-loop', [0.4, 0.1, 0.1], [-0.24, 0.08, 0], WOOD_LIGHT),
    part('knot-loop-right', 'rope-loop', [0.4, 0.1, 0.1], [0.24, -0.08, 0], WOOD),
    part('knot-tail-left', 'rope-tail', [0.1, 0.4, 0.1], [-0.08, -0.25, 0], WOOD_LIGHT),
    part('knot-tail-right', 'rope-tail', [0.1, 0.34, 0.1], [0.12, -0.22, 0], WOOD),
  ),
  model(
    'lightning_bolt',
    part('bolt-upper', 'lightning-segment', [0.28, 0.62, 0.22], [-0.16, 0.52, 0], GOLD_LIGHT),
    part('bolt-middle', 'lightning-segment', [0.25, 0.72, 0.2], [0.1, 0.05, 0.02], WHITE),
    part('bolt-lower', 'lightning-segment', [0.24, 0.72, 0.2], [-0.12, -0.52, -0.02], GOLD),
    part('bolt-flare-left', 'lightning-flare', [0.1, 0.26, 0.12], [-0.31, 0.62, 0.02], WHITE),
    part('bolt-flare-right', 'lightning-flare', [0.1, 0.24, 0.12], [0.3, -0.4, 0], WHITE),
  ),
  model(
    'painting',
    part('painting-frame', 'painting-frame', [1.28, 1.02, 0.1], [0, 0, -0.05], WOOD),
    part('painting-canvas', 'painting-canvas', [1.1, 0.84, 0.06], [0, 0, 0.03], BLUE),
    part('painting-sky', 'painting-sky', [1.02, 0.3, 0.04], [0, 0.25, 0.08], GLASS),
    part('painting-hill', 'painting-hill', [0.82, 0.28, 0.04], [-0.08, -0.15, 0.09], GREEN),
    part('painting-sun', 'painting-sun', [0.18, 0.18, 0.04], [0.34, 0.25, 0.09], GOLD_LIGHT),
    part('painting-frame-pin', 'painting-pin', [0.08, 0.08, 0.08], [-0.57, 0.45, 0.02], GOLD),
  ),
]
