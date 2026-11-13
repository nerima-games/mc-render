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

const OAK: EntityModelColor = [132, 89, 48]
const OAK_LIGHT: EntityModelColor = [164, 116, 68]
const OAK_DARK: EntityModelColor = [91, 58, 34]
const IRON: EntityModelColor = [113, 119, 125]
const IRON_DARK: EntityModelColor = [58, 62, 67]
const CHEST_GOLD: EntityModelColor = [210, 157, 52]
const COMMAND_PURPLE: EntityModelColor = [128, 91, 150]
const COMMAND_GREEN: EntityModelColor = [101, 147, 80]
const FURNACE_STONE: EntityModelColor = [91, 91, 94]
const FIRE: EntityModelColor = [231, 105, 35]
const HOPPER: EntityModelColor = [74, 78, 82]
const SPAWNER_BLUE: EntityModelColor = [57, 111, 133]
const SPAWNER_CORE: EntityModelColor = [112, 170, 118]
const TNT_RED: EntityModelColor = [174, 48, 39]
const TNT_WHITE: EntityModelColor = [222, 214, 190]

const part = (
  id: string,
  role: string,
  size: EntityModelPartDescriptor['size'],
  center: EntityModelPartDescriptor['center'],
  color: EntityModelPartDescriptor['color'],
): EntityModelPartDescriptor => ({ id: partIdentifier(id), role: partRole(role), size, center, color })

const boatHull = (): EntityModelPartDescriptor[] => [
  part('hull-floor', 'hull-floor', [0.88, 0.14, 1.55], [0, 0.16, 0], OAK_DARK),
  part('left-hull', 'hull-side', [0.14, 0.3, 1.8], [-0.48, 0.31, 0], OAK),
  part('right-hull', 'hull-side', [0.14, 0.3, 1.8], [0.48, 0.31, 0], OAK),
  part('bow', 'hull-end', [0.86, 0.28, 0.14], [0, 0.29, -0.84], OAK_LIGHT),
  part('stern', 'hull-end', [0.86, 0.28, 0.14], [0, 0.29, 0.84], OAK),
]

const minecartFrame = (): EntityModelPartDescriptor[] => [
  part('cart-floor', 'cart-floor', [0.92, 0.14, 1.12], [0, 0.52, 0], IRON),
  part('left-bucket-wall', 'cart-wall', [0.12, 0.42, 1.06], [-0.48, 0.77, 0], IRON_DARK),
  part('right-bucket-wall', 'cart-wall', [0.12, 0.42, 1.06], [0.48, 0.77, 0], IRON_DARK),
  part('front-bucket-wall', 'cart-wall', [0.84, 0.42, 0.12], [0, 0.77, -0.5], IRON_DARK),
  part('back-bucket-wall', 'cart-wall', [0.84, 0.42, 0.12], [0, 0.77, 0.5], IRON_DARK),
  part('left-front-wheel', 'wheel', [0.16, 0.36, 0.36], [-0.55, 0.23, -0.34], IRON_DARK),
  part('left-back-wheel', 'wheel', [0.16, 0.36, 0.36], [-0.55, 0.23, 0.34], IRON_DARK),
  part('right-front-wheel', 'wheel', [0.16, 0.36, 0.36], [0.55, 0.23, -0.34], IRON_DARK),
  part('right-back-wheel', 'wheel', [0.16, 0.36, 0.36], [0.55, 0.23, 0.34], IRON_DARK),
]

const chest = (prefix: string, centerY: number): EntityModelPartDescriptor[] => [
  part(`${prefix}-body`, 'chest', [0.62, 0.48, 0.64], [0, centerY, 0], OAK),
  part(`${prefix}-lid`, 'chest-lid', [0.66, 0.12, 0.68], [0, centerY + 0.3, 0], OAK_LIGHT),
  part(`${prefix}-latch`, 'chest-latch', [0.12, 0.18, 0.045], [0, centerY + 0.12, -0.345], CHEST_GOLD),
]

const boat: EntityModelDescriptor = {
  kind: modelKind('boat'),
  parts: [
    ...boatHull(),
    {
      ...part('left-oar', 'oar', [0.1, 0.08, 0.88], [-0.83, 0.48, -0.04], OAK_LIGHT),
      rotation: [0, 0.16, 0],
    },
    {
      ...part('right-oar', 'oar', [0.1, 0.08, 0.88], [0.83, 0.48, 0.04], OAK_LIGHT),
      rotation: [0, -0.16, 0],
    },
  ],
}

const chestBoat: EntityModelDescriptor = {
  kind: modelKind('chest_boat'),
  parts: [
    ...boatHull(),
    ...chest('boat-cargo', 0.66),
    {
      ...part('left-oar', 'oar', [0.1, 0.08, 0.88], [-0.83, 0.48, -0.04], OAK_LIGHT),
      rotation: [0, 0.16, 0],
    },
    {
      ...part('right-oar', 'oar', [0.1, 0.08, 0.88], [0.83, 0.48, 0.04], OAK_LIGHT),
      rotation: [0, -0.16, 0],
    },
  ],
}

const chestMinecart: EntityModelDescriptor = {
  kind: modelKind('chest_minecart'),
  parts: [...minecartFrame(), ...chest('cart-cargo', 1.04)],
}

const commandBlockMinecart: EntityModelDescriptor = {
  kind: modelKind('command_block_minecart'),
  parts: [
    ...minecartFrame(),
    part('command-block', 'command-block', [0.72, 0.68, 0.72], [0, 1.09, 0], COMMAND_PURPLE),
    part('command-screen', 'command-face', [0.48, 0.4, 0.045], [0, 1.1, -0.382], COMMAND_GREEN),
    part('command-glyph', 'command-glyph', [0.25, 0.07, 0.035], [0, 1.1, -0.408], CHEST_GOLD),
    part('command-side-panel', 'command-panel', [0.045, 0.35, 0.42], [-0.382, 1.09, 0], COMMAND_GREEN),
  ],
}

const furnaceMinecart: EntityModelDescriptor = {
  kind: modelKind('furnace_minecart'),
  parts: [
    ...minecartFrame(),
    part('furnace-body', 'furnace-block', [0.74, 0.68, 0.74], [0, 1.08, 0], FURNACE_STONE),
    part('furnace-mouth', 'furnace-mouth', [0.4, 0.34, 0.045], [0, 1.04, -0.392], IRON_DARK),
    part('furnace-fire', 'furnace-fire', [0.22, 0.17, 0.035], [0, 0.97, -0.42], FIRE),
    part('furnace-top-vent', 'furnace-vent', [0.26, 0.045, 0.22], [0, 1.44, 0], IRON_DARK),
  ],
}

const hopperMinecart: EntityModelDescriptor = {
  kind: modelKind('hopper_minecart'),
  parts: [
    ...minecartFrame(),
    part('hopper-front-rim', 'hopper-rim', [0.82, 0.12, 0.15], [0, 1.16, -0.34], HOPPER),
    part('hopper-back-rim', 'hopper-rim', [0.82, 0.12, 0.15], [0, 1.16, 0.34], HOPPER),
    part('hopper-left-rim', 'hopper-rim', [0.15, 0.12, 0.55], [-0.34, 1.16, 0], HOPPER),
    part('hopper-right-rim', 'hopper-rim', [0.15, 0.12, 0.55], [0.34, 1.16, 0], HOPPER),
    part('hopper-front-slope', 'hopper-funnel', [0.16, 0.48, 0.58], [-0.23, 0.88, 0], HOPPER),
    part('hopper-back-slope', 'hopper-funnel', [0.16, 0.48, 0.58], [0.23, 0.88, 0], HOPPER),
    part('hopper-neck', 'hopper-neck', [0.28, 0.22, 0.28], [0, 0.52, 0], IRON_DARK),
  ],
}

const spawnerMinecart: EntityModelDescriptor = {
  kind: modelKind('spawner_minecart'),
  parts: [
    ...minecartFrame(),
    part('spawner-top', 'spawner-cage-bar', [0.74, 0.08, 0.74], [0, 1.47, 0], IRON_DARK),
    part('spawner-bottom', 'spawner-cage-bar', [0.74, 0.08, 0.74], [0, 0.69, 0], IRON_DARK),
    part('spawner-left-bar', 'spawner-cage-bar', [0.08, 0.7, 0.08], [-0.33, 1.08, -0.33], SPAWNER_BLUE),
    part('spawner-right-bar', 'spawner-cage-bar', [0.08, 0.7, 0.08], [0.33, 1.08, -0.33], SPAWNER_BLUE),
    part('spawner-back-left-bar', 'spawner-cage-bar', [0.08, 0.7, 0.08], [-0.33, 1.08, 0.33], SPAWNER_BLUE),
    part('spawner-back-right-bar', 'spawner-cage-bar', [0.08, 0.7, 0.08], [0.33, 1.08, 0.33], SPAWNER_BLUE),
    part('spawner-core', 'spawner-core', [0.3, 0.3, 0.3], [0, 1.08, 0], SPAWNER_CORE),
    part('spawner-flame', 'spawner-flame', [0.15, 0.12, 0.045], [0, 1.08, -0.18], FIRE),
  ],
}

const minecart: EntityModelDescriptor = {
  kind: modelKind('minecart'),
  parts: minecartFrame(),
}

const tntMinecart: EntityModelDescriptor = {
  kind: modelKind('tnt_minecart'),
  parts: [
    ...minecartFrame(),
    part('tnt-cargo', 'tnt-cargo', [0.72, 0.64, 0.72], [0, 1.08, 0], TNT_RED),
    part('tnt-band-front', 'tnt-band', [0.7, 0.16, 0.035], [0, 1.08, -0.38], TNT_WHITE),
    part('tnt-band-back', 'tnt-band', [0.7, 0.16, 0.035], [0, 1.08, 0.38], TNT_WHITE),
    part('tnt-band-left', 'tnt-band', [0.035, 0.16, 0.7], [-0.38, 1.08, 0], TNT_WHITE),
    part('tnt-band-right', 'tnt-band', [0.035, 0.16, 0.7], [0.38, 1.08, 0], TNT_WHITE),
  ],
}

const tnt: EntityModelDescriptor = {
  kind: modelKind('tnt'),
  parts: [
    part('primed-tnt-body', 'tnt-block', [0.8, 0.8, 0.8], [0, 0.72, 0], TNT_RED),
    part('primed-tnt-band-front', 'tnt-label-band', [0.76, 0.18, 0.04], [0, 0.72, -0.42], TNT_WHITE),
    part('primed-tnt-band-back', 'tnt-label-band', [0.76, 0.18, 0.04], [0, 0.72, 0.42], TNT_WHITE),
    part('primed-tnt-band-left', 'tnt-label-band', [0.04, 0.18, 0.76], [-0.42, 0.72, 0], TNT_WHITE),
    part('primed-tnt-band-right', 'tnt-label-band', [0.04, 0.18, 0.76], [0.42, 0.72, 0], TNT_WHITE),
    part('tnt-fuse', 'fuse', [0.11, 0.24, 0.11], [0.22, 1.23, 0.08], OAK_LIGHT),
    part('fuse-spark', 'fuse-spark', [0.12, 0.12, 0.12], [0.22, 1.41, 0.08], FIRE),
  ],
}

export const VEHICLES_TNT_ENTITY_MODELS: ReadonlyArray<EntityModelDescriptor> = [
  boat,
  chestBoat,
  chestMinecart,
  commandBlockMinecart,
  furnaceMinecart,
  hopperMinecart,
  minecart,
  spawnerMinecart,
  tntMinecart,
  tnt,
]
