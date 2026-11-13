import type { EntityModelDescriptor, EntityModelPartDescriptor } from './types.js'

const PLAYER_SKIN = [205, 153, 105] as const
const PLAYER_HAIR = [74, 46, 31] as const
const PLAYER_SHIRT = [47, 91, 158] as const
const PLAYER_SLEEVE = [42, 82, 145] as const
const PLAYER_PANTS = [42, 57, 104] as const
const PLAYER_BOOT = [58, 43, 34] as const
const PLAYER_EYE = [31, 36, 45] as const

const VILLAGER_SKIN = [184, 142, 102] as const
const VILLAGER_ROBE = [117, 86, 57] as const
const VILLAGER_SLEEVE = [139, 103, 69] as const
const VILLAGER_BROW = [79, 58, 43] as const
const VILLAGER_NOSE = [157, 114, 77] as const
const VILLAGER_BELT = [78, 55, 39] as const
const VILLAGER_SHOE = [57, 43, 33] as const
const VILLAGER_EYE = [38, 32, 29] as const

const TRADER_SKIN = [197, 151, 109] as const
const TRADER_HOOD = [35, 104, 116] as const
const TRADER_ROBE = [36, 117, 128] as const
const TRADER_SLEEVE = [27, 88, 103] as const
const TRADER_TRIM = [202, 165, 79] as const
const TRADER_NOSE = [164, 119, 81] as const
const TRADER_BOOT = [66, 53, 43] as const
const TRADER_EYE = [39, 38, 35] as const

const part = (
  id: string,
  role: string,
  size: EntityModelPartDescriptor['size'],
  center: EntityModelPartDescriptor['center'],
  color: EntityModelPartDescriptor['color'],
): EntityModelPartDescriptor => ({ id, role, size, center, color })

const player: EntityModelDescriptor = {
  kind: 'player',
  parts: [
    part('head', 'head', [0.5, 0.5, 0.5], [0, 1.55, 0], PLAYER_SKIN),
    part('hair', 'hair', [0.52, 0.14, 0.52], [0, 1.87, 0], PLAYER_HAIR),
    part('left-eye', 'eye', [0.075, 0.05, 0.035], [-0.11, 1.57, -0.265], PLAYER_EYE),
    part('right-eye', 'eye', [0.075, 0.05, 0.035], [0.11, 1.57, -0.265], PLAYER_EYE),
    part('shirt', 'body', [0.55, 0.7, 0.31], [0, 0.95, 0], PLAYER_SHIRT),
    part('left-sleeve', 'arm', [0.2, 0.42, 0.29], [-0.38, 1.09, 0], PLAYER_SLEEVE),
    part('right-sleeve', 'arm', [0.2, 0.42, 0.29], [0.38, 1.09, 0], PLAYER_SLEEVE),
    part('left-hand', 'hand', [0.2, 0.2, 0.26], [-0.38, 0.78, 0], PLAYER_SKIN),
    part('right-hand', 'hand', [0.2, 0.2, 0.26], [0.38, 0.78, 0], PLAYER_SKIN),
    part('left-trouser-leg', 'leg', [0.24, 0.72, 0.28], [-0.14, 0.36, 0], PLAYER_PANTS),
    part('right-trouser-leg', 'leg', [0.24, 0.72, 0.28], [0.14, 0.36, 0], PLAYER_PANTS),
    part('left-boot', 'boot', [0.25, 0.16, 0.3], [-0.14, 0.08, -0.015], PLAYER_BOOT),
    part('right-boot', 'boot', [0.25, 0.16, 0.3], [0.14, 0.08, -0.015], PLAYER_BOOT),
  ],
}

const villager: EntityModelDescriptor = {
  kind: 'villager',
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
  kind: 'wandering_trader',
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
