import { Brand } from 'effect'
import type {
  EntityModelColor,
  EntityModelDescriptor,
  EntityModelKind,
  EntityModelPartDescriptor,
  EntityModelPartIdentifier,
  EntityModelPartRole,
} from './types.js'

const modelKind = Brand.nominal<EntityModelKind>()
const partIdentifier = Brand.nominal<EntityModelPartIdentifier>()
const partRole = Brand.nominal<EntityModelPartRole>()

const PLAYER_SKIN: EntityModelColor = [205, 153, 105]
const PLAYER_HAIR: EntityModelColor = [74, 46, 31]
const PLAYER_SHIRT: EntityModelColor = [47, 91, 158]
const PLAYER_SLEEVE: EntityModelColor = [42, 82, 145]
const PLAYER_PANTS: EntityModelColor = [42, 57, 104]
const PLAYER_BOOT: EntityModelColor = [58, 43, 34]
const PLAYER_EYE: EntityModelColor = [31, 36, 45]

const VILLAGER_SKIN: EntityModelColor = [184, 142, 102]
const VILLAGER_ROBE: EntityModelColor = [117, 86, 57]
const VILLAGER_SLEEVE: EntityModelColor = [139, 103, 69]
const VILLAGER_BROW: EntityModelColor = [79, 58, 43]
const VILLAGER_NOSE: EntityModelColor = [157, 114, 77]
const VILLAGER_BELT: EntityModelColor = [78, 55, 39]
const VILLAGER_SHOE: EntityModelColor = [57, 43, 33]
const VILLAGER_EYE: EntityModelColor = [38, 32, 29]

const TRADER_SKIN: EntityModelColor = [197, 151, 109]
const TRADER_HOOD: EntityModelColor = [35, 104, 116]
const TRADER_ROBE: EntityModelColor = [36, 117, 128]
const TRADER_SLEEVE: EntityModelColor = [27, 88, 103]
const TRADER_TRIM: EntityModelColor = [202, 165, 79]
const TRADER_NOSE: EntityModelColor = [164, 119, 81]
const TRADER_BOOT: EntityModelColor = [66, 53, 43]
const TRADER_EYE: EntityModelColor = [39, 38, 35]

const part = (
  id: string,
  role: string,
  size: EntityModelPartDescriptor['size'],
  center: EntityModelPartDescriptor['center'],
  color: EntityModelPartDescriptor['color'],
): EntityModelPartDescriptor => ({ id: partIdentifier(id), role: partRole(role), size, center, color })

const player: EntityModelDescriptor = {
  kind: modelKind('player'),
  parts: [
    part('head', 'head', [0.5, 0.5, 0.5], [0, 1.55, 0], PLAYER_SKIN),
    part('hair', 'hair', [0.52, 0.14, 0.52], [0, 1.87, 0], PLAYER_HAIR),
    part('left-eye', 'eye', [0.075, 0.05, 0.035], [-0.11, 1.57, -0.265], PLAYER_EYE),
    part('right-eye', 'eye', [0.075, 0.05, 0.035], [0.11, 1.57, -0.265], PLAYER_EYE),
    part('shirt', 'body', [0.55, 0.7, 0.31], [0, 0.95, 0], PLAYER_SHIRT),
    {
      ...part('left-sleeve', 'arm', [0.2, 0.42, 0.29], [-0.38, 1.09, 0], PLAYER_SLEEVE),
      rotation: [0, 0, 0.08],
    },
    {
      ...part('right-sleeve', 'arm', [0.2, 0.42, 0.29], [0.38, 1.09, 0], PLAYER_SLEEVE),
      rotation: [0, 0, -0.08],
    },
    part('left-hand', 'hand', [0.2, 0.2, 0.26], [-0.38, 0.78, 0], PLAYER_SKIN),
    part('right-hand', 'hand', [0.2, 0.2, 0.26], [0.38, 0.78, 0], PLAYER_SKIN),
    part('left-trouser-leg', 'leg', [0.24, 0.72, 0.28], [-0.14, 0.36, 0], PLAYER_PANTS),
    part('right-trouser-leg', 'leg', [0.24, 0.72, 0.28], [0.14, 0.36, 0], PLAYER_PANTS),
    part('left-boot', 'boot', [0.25, 0.16, 0.3], [-0.14, 0.08, -0.015], PLAYER_BOOT),
    part('right-boot', 'boot', [0.25, 0.16, 0.3], [0.14, 0.08, -0.015], PLAYER_BOOT),
  ],
}

const villager: EntityModelDescriptor = {
  kind: modelKind('villager'),
  parts: [
    part('head', 'head', [0.56, 0.54, 0.5], [0, 1.48, 0], VILLAGER_SKIN),
    part('left-eye', 'eye', [0.065, 0.045, 0.03], [-0.105, 1.51, -0.265], VILLAGER_EYE),
    part('right-eye', 'eye', [0.065, 0.045, 0.03], [0.105, 1.51, -0.265], VILLAGER_EYE),
    part('unibrow', 'brow', [0.43, 0.075, 0.045], [0, 1.66, -0.27], VILLAGER_BROW),
    part('nose', 'snout', [0.14, 0.2, 0.25], [0, 1.42, -0.37], VILLAGER_NOSE),
    part('robe', 'robe', [0.72, 0.94, 0.48], [0, 0.75, 0], VILLAGER_ROBE),
    part('folded-sleeves', 'arm', [0.64, 0.22, 0.28], [0, 1.1, -0.28], VILLAGER_SLEEVE),
    part('belt', 'belt', [0.72, 0.14, 0.5], [0, 0.67, -0.01], VILLAGER_BELT),
    part('left-leg', 'leg', [0.22, 0.5, 0.26], [-0.15, 0.25, 0], VILLAGER_SHOE),
    part('right-leg', 'leg', [0.22, 0.5, 0.26], [0.15, 0.25, 0], VILLAGER_SHOE),
  ],
}

const wanderingTrader: EntityModelDescriptor = {
  kind: modelKind('wandering_trader'),
  parts: [
    part('face', 'head', [0.5, 0.5, 0.48], [0, 1.55, 0], TRADER_SKIN),
    part('hood', 'hood', [0.56, 0.17, 0.54], [0, 1.87, 0], TRADER_HOOD),
    part('left-eye', 'eye', [0.06, 0.045, 0.03], [-0.1, 1.57, -0.255], TRADER_EYE),
    part('right-eye', 'eye', [0.06, 0.045, 0.03], [0.1, 1.57, -0.255], TRADER_EYE),
    part('nose', 'snout', [0.13, 0.18, 0.23], [0, 1.48, -0.36], TRADER_NOSE),
    part('blue-coat', 'body', [0.7, 0.94, 0.46], [0, 0.81, 0], TRADER_ROBE),
    part('gold-collar', 'collar', [0.74, 0.12, 0.48], [0, 1.34, -0.015], TRADER_TRIM),
    part('crossed-sleeves', 'arm', [0.64, 0.2, 0.28], [0, 1.14, -0.27], TRADER_SLEEVE),
    part('gold-sash', 'belt', [0.72, 0.13, 0.48], [0, 0.7, -0.015], TRADER_TRIM),
    part('left-boot', 'leg', [0.23, 0.52, 0.27], [-0.15, 0.26, -0.015], TRADER_BOOT),
    part('right-boot', 'leg', [0.23, 0.52, 0.27], [0.15, 0.26, -0.015], TRADER_BOOT),
  ],
}

export const VILLAGER_PLAYER_ENTITY_MODELS: ReadonlyArray<EntityModelDescriptor> = [
  player,
  villager,
  wanderingTrader,
]
