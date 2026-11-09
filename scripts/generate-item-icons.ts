import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'
import {
  ITEM_TYPES,
  PLACEABLE_ITEM_TYPES,
  blockOfPlaceableItem,
  type PlaceableItemType,
} from '@nerima-games/mc-kernel'
import {
  ATLAS_COLUMNS,
  ATLAS_MIP_LEVEL_COUNT,
  ATLAS_PIXELS,
  TILE_CELL_PIXELS,
  TILE_GUTTER_PIXELS,
  TILE_PIXELS,
} from '../src/domain/texture-atlas.js'
import {
  type GeneratedTextureArtifacts,
  loadAndGenerateBlockTextures,
} from './generate-block-textures.js'

const CHANNELS = 4
const ATLAS_ROWS = ATLAS_COLUMNS
const ATLAS_CAPACITY = ATLAS_COLUMNS * ATLAS_ROWS
const ITEM_ICON_DIRECTORY = resolve(import.meta.dirname, '../src/assets/item-icons')
const ITEM_ICON_ATLAS_PATH = resolve(ITEM_ICON_DIRECTORY, 'atlas.png')
const ITEM_ICON_MANIFEST_PATH = resolve(ITEM_ICON_DIRECTORY, 'manifest.json')
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const FIRST_PIXEL = 0
const LAST_PIXEL = TILE_PIXELS - 1
type ItemIconAtlasLayout = Readonly<{
  width: number
  height: number
  columns: number
  rows: number
  tilePixels: number
  gutterPixels: number
  cellPixels: number
  capacity: number
  mipLevels: number
}>
const ATLAS_LAYOUT: ItemIconAtlasLayout = Object.freeze({
  width: ATLAS_PIXELS,
  height: ATLAS_PIXELS,
  columns: ATLAS_COLUMNS,
  rows: ATLAS_ROWS,
  tilePixels: TILE_PIXELS,
  gutterPixels: TILE_GUTTER_PIXELS,
  cellPixels: TILE_CELL_PIXELS,
  capacity: ATLAS_CAPACITY,
  mipLevels: ATLAS_MIP_LEVEL_COUNT,
})

type Rgba = readonly [number, number, number, number]
type ColorName =
  | 'ink'
  | 'wood'
  | 'woodLight'
  | 'leather'
  | 'stone'
  | 'iron'
  | 'gold'
  | 'copper'
  | 'diamond'
  | 'emerald'
  | 'lapis'
  | 'amethyst'
  | 'red'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'salmon'
  | 'fish'
  | 'brown'
  | 'orange'
  | 'cooked'
  | 'netherite'
  | 'yellow'
  | 'cyan'
  | 'magenta'
  | 'lightBlue'
  | 'gray'
  | 'lightGray'
  | 'lime'
  | 'black'
  | 'cream'
  | 'white'
type ItemIconManifest = Readonly<{
  schemaVersion: 1
  layout: typeof ATLAS_LAYOUT
  tileCount: number
  itemIcons: Readonly<Record<string, number>>
}>

export type ItemIconGeneratorError = Readonly<{
  _tag: 'AtlasCapacityExceeded' | 'BlockTextureGenerationFailed' | 'ArtifactReadError' | 'ArtifactWriteError'
  message: string
}>

export type ItemIconGeneratorResult<Value> =
  | Readonly<{ _tag: 'Success'; value: Value }>
  | Readonly<{ _tag: 'Failure'; error: ItemIconGeneratorError }>

export type GeneratedItemIconArtifacts = Readonly<{
  png: Buffer
  manifest: string
  manifestData: ItemIconManifest
  rgba: Uint8Array
}>

const success = <Value>(value: Value): ItemIconGeneratorResult<Value> => ({ _tag: 'Success', value })
const failure = (
  _tag: ItemIconGeneratorError['_tag'],
  message: string,
): ItemIconGeneratorResult<never> => ({ _tag: 'Failure', error: { _tag, message } })

const COLORS: Readonly<Record<ColorName, Rgba>> = {
  ink: [26, 28, 35, 255],
  wood: [137, 83, 47, 255],
  woodLight: [196, 139, 67, 255],
  leather: [139, 79, 52, 255],
  stone: [132, 140, 145, 255],
  iron: [188, 201, 204, 255],
  gold: [242, 191, 61, 255],
  copper: [197, 111, 65, 255],
  diamond: [70, 207, 190, 255],
  emerald: [48, 180, 103, 255],
  lapis: [60, 99, 190, 255],
  amethyst: [164, 111, 206, 255],
  red: [192, 66, 68, 255],
  green: [78, 148, 75, 255],
  blue: [73, 131, 202, 255],
  purple: [144, 85, 183, 255],
  pink: [217, 127, 148, 255],
  salmon: [238, 126, 104, 255],
  fish: [157, 190, 204, 255],
  brown: [143, 98, 62, 255],
  orange: [232, 134, 45, 255],
  cooked: [168, 94, 54, 255],
  netherite: [78, 61, 91, 255],
  yellow: [238, 213, 66, 255],
  cyan: [69, 185, 185, 255],
  magenta: [198, 93, 187, 255],
  lightBlue: [123, 172, 220, 255],
  gray: [119, 124, 128, 255],
  lightGray: [185, 185, 178, 255],
  lime: [137, 205, 61, 255],
  black: [43, 45, 52, 255],
  cream: [244, 221, 162, 255],
  white: [234, 237, 227, 255],
}

const COLOR_NAMES: ReadonlyArray<ColorName> = Object.keys(COLORS) as Array<ColorName>
const includesAny = (item: string, terms: ReadonlyArray<string>): boolean =>
  terms.some((term) => item.includes(term))

const hashString = (value: string): number => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

type ColorRule = Readonly<{ terms: ReadonlyArray<string>; color: ColorName }>
const COLOR_RULES: ReadonlyArray<ColorRule> = [
  { terms: ['netherite'], color: 'netherite' },
  { terms: ['salmon'], color: 'salmon' },
  { terms: ['cod', 'tropical_fish', 'pufferfish'], color: 'fish' },
  { terms: ['enchanted'], color: 'purple' },
  { terms: ['golden', 'gold'], color: 'gold' },
  { terms: ['apple'], color: 'red' },
  { terms: ['brown'], color: 'brown' },
  { terms: ['orange'], color: 'orange' },
  { terms: ['yellow'], color: 'yellow' },
  { terms: ['light_blue'], color: 'lightBlue' },
  { terms: ['light_gray'], color: 'lightGray' },
  { terms: ['lime'], color: 'lime' },
  { terms: ['cyan'], color: 'cyan' },
  { terms: ['magenta'], color: 'magenta' },
  { terms: ['gray', 'grey'], color: 'gray' },
  { terms: ['black'], color: 'black' },
  { terms: ['white'], color: 'white' },
  { terms: ['wood', 'stick', 'oak', 'book'], color: 'woodLight' },
  { terms: ['copper'], color: 'copper' },
  { terms: ['diamond'], color: 'diamond' },
  { terms: ['emerald'], color: 'emerald' },
  { terms: ['lapis', 'blue'], color: 'lapis' },
  { terms: ['amethyst', 'purple'], color: 'amethyst' },
  { terms: ['red', 'beetroot'], color: 'red' },
  { terms: ['green'], color: 'green' },
  { terms: ['pink'], color: 'pink' },
  { terms: ['leather'], color: 'leather' },
  { terms: ['iron', 'steel'], color: 'iron' },
  { terms: ['stone', 'coal', 'flint'], color: 'stone' },
]

const colorFor = (item: string): Rgba => {
  for (const rule of COLOR_RULES) {
    if (rule.terms.some((term) => item.includes(term))) {
      return COLORS[rule.color]
    }
  }
  const colorIndex = hashString(item) % COLOR_NAMES.length
  const name = COLOR_NAMES[colorIndex]
  return name === undefined ? COLORS.cream : COLORS[name]
}

const pixelOffset = (x: number, y: number): number => (y * TILE_PIXELS + x) * CHANNELS

const setPixel = (pixels: Uint8Array, x: number, y: number, color: Rgba): void => {
  if (x < FIRST_PIXEL || x > LAST_PIXEL || y < FIRST_PIXEL || y > LAST_PIXEL) {
    return
  }
  const offset = pixelOffset(x, y)
  pixels.set(color, offset)
}

const drawRect = (
  pixels: Uint8Array,
  left: number,
  top: number,
  width: number,
  height: number,
  color: Rgba,
): void => {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      setPixel(pixels, x, y, color)
    }
  }
}

const drawLine = (
  pixels: Uint8Array,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  color: Rgba,
): void => {
  const distance = Math.max(Math.abs(endX - startX), Math.abs(endY - startY))
  for (let step = 0; step <= distance; step += 1) {
    const progress = distance === 0 ? 0 : step / distance
    setPixel(
      pixels,
      Math.round(startX + (endX - startX) * progress),
      Math.round(startY + (endY - startY) * progress),
      color,
    )
  }
}

const sourcePixel = (
  atlas: Uint8Array,
  tileIndex: number,
  x: number,
  y: number,
): Rgba => {
  const tileX = tileIndex % ATLAS_COLUMNS
  const tileY = Math.floor(tileIndex / ATLAS_COLUMNS)
  const sourceX = tileX * TILE_CELL_PIXELS + TILE_GUTTER_PIXELS + x
  const sourceY = tileY * TILE_CELL_PIXELS + TILE_GUTTER_PIXELS + y
  const offset = (sourceY * ATLAS_PIXELS + sourceX) * CHANNELS
  return [atlas[offset] ?? 0, atlas[offset + 1] ?? 0, atlas[offset + 2] ?? 0, atlas[offset + 3] ?? 0]
}

const sampleTile = (
  atlas: Uint8Array,
  tileIndex: number,
  u: number,
  v: number,
): Rgba => sourcePixel(
  atlas,
  tileIndex,
  Math.max(FIRST_PIXEL, Math.min(LAST_PIXEL, Math.round(u * LAST_PIXEL))),
  Math.max(FIRST_PIXEL, Math.min(LAST_PIXEL, Math.round(v * LAST_PIXEL))),
)

const pointInTopFace = (x: number, y: number): boolean =>
  Math.abs(x - 8) / 6 + Math.abs(y - 4) / 3 <= 1

const renderBlockIcon = (
  blockTextures: GeneratedTextureArtifacts,
  blockName: string,
): Uint8Array | undefined => {
  const faces = blockTextures.manifestData.blockFaces[blockName]
  if (faces === undefined) {
    return undefined
  }
  const pixels = new Uint8Array(TILE_PIXELS * TILE_PIXELS * CHANNELS)
  for (let y = 1; y <= 7; y += 1) {
    for (let x = 2; x <= 14; x += 1) {
      if (pointInTopFace(x, y)) {
        const u = (x - 2) / 12
        const v = (y - 1) / 6
        setPixel(pixels, x, y, sampleTile(blockTextures.rgba, faces.top, u, v))
      }
    }
  }
  for (let y = 4; y <= 14; y += 1) {
    for (let x = 2; x <= 8; x += 1) {
      const u = (x - 2) / 6
      const v = (y - 4 - (x - 2) * (4 / 6)) / 6
      if (v >= 0 && v <= 1) {
        setPixel(pixels, x, y, sampleTile(blockTextures.rgba, faces.side, u, v))
      }
    }
    for (let x = 8; x <= 14; x += 1) {
      const u = (x - 8) / 6
      const v = (y - 8 + u * 4) / 6
      if (v >= 0 && v <= 1) {
        setPixel(pixels, x, y, sampleTile(blockTextures.rgba, faces.side, u, v))
      }
    }
  }
  drawLine(pixels, 2, 4, 8, 1, COLORS.ink)
  drawLine(pixels, 8, 1, 14, 4, COLORS.ink)
  drawLine(pixels, 2, 4, 8, 8, COLORS.ink)
  drawLine(pixels, 14, 4, 8, 8, COLORS.ink)
  drawLine(pixels, 2, 4, 2, 10, COLORS.ink)
  drawLine(pixels, 8, 8, 8, 14, COLORS.ink)
  drawLine(pixels, 14, 4, 14, 10, COLORS.ink)
  drawLine(pixels, 2, 10, 8, 14, COLORS.ink)
  drawLine(pixels, 14, 10, 8, 14, COLORS.ink)
  return pixels
}

const renderSword = (pixels: Uint8Array, item: string, color: Rgba): void => {
  drawLine(pixels, 3, 13, 9, 7, COLORS.wood)
  drawLine(pixels, 4, 14, 10, 8, COLORS.ink)
  drawLine(pixels, 8, 8, 12, 12, COLORS.ink)
  drawLine(pixels, 7, 9, 11, 13, COLORS.woodLight)
  for (let offset = 0; offset < 4; offset += 1) {
    drawLine(pixels, 9 - offset, 6 - offset, 12 - offset, 3 - offset, COLORS.ink)
    drawLine(pixels, 10 - offset, 5 - offset, 13 - offset, 2 - offset, color)
  }
  drawLine(pixels, 10, 5, 12, 3, COLORS.white)
  if (item.includes('wooden')) {
    drawLine(pixels, 10, 5, 13, 2, COLORS.woodLight)
  }
}

const renderTool = (pixels: Uint8Array, item: string, color: Rgba): void => {
  drawLine(pixels, 3, 13, 11, 5, COLORS.wood)
  drawLine(pixels, 4, 14, 12, 6, COLORS.ink)
  if (item.includes('pickaxe')) {
    drawLine(pixels, 5, 5, 10, 2, COLORS.ink)
    drawLine(pixels, 10, 2, 14, 4, COLORS.ink)
    drawLine(pixels, 6, 5, 10, 3, color)
    drawLine(pixels, 10, 3, 13, 4, color)
    drawLine(pixels, 7, 6, 11, 4, color)
  } else if (item.includes('axe')) {
    drawRect(pixels, 7, 2, 8, 6, COLORS.ink)
    drawRect(pixels, 8, 3, 6, 4, color)
    drawRect(pixels, 9, 4, 4, 2, color)
    drawLine(pixels, 8, 3, 13, 3, COLORS.white)
    drawLine(pixels, 8, 6, 13, 6, COLORS.cream)
    if (item.startsWith('wooden_')) {
      drawRect(pixels, 8, 5, 2, 2, COLORS.woodLight)
    }
  } else if (item.includes('shovel')) {
    drawRect(pixels, 9, 2, 5, 5, COLORS.ink)
    drawRect(pixels, 10, 2, 3, 4, color)
    setPixel(pixels, 11, 3, COLORS.white)
  } else if (item.includes('hoe')) {
    drawRect(pixels, 8, 2, 7, 3, COLORS.ink)
    drawRect(pixels, 9, 3, 5, 2, color)
    setPixel(pixels, 13, 3, COLORS.white)
  } else {
    drawRect(pixels, 8, 2, 6, 5, COLORS.ink)
    drawRect(pixels, 9, 3, 4, 3, color)
  }
}

const renderBow = (pixels: Uint8Array, color: Rgba): void => {
  drawLine(pixels, 4, 2, 8, 3, color)
  drawLine(pixels, 8, 3, 11, 6, color)
  drawLine(pixels, 11, 6, 11, 10, color)
  drawLine(pixels, 11, 10, 8, 13, color)
  drawLine(pixels, 8, 13, 4, 14, color)
  drawLine(pixels, 4, 2, 4, 14, COLORS.cream)
  drawLine(pixels, 4, 8, 14, 8, COLORS.iron)
}

const renderBottle = (pixels: Uint8Array, item: string, color: Rgba): void => {
  const emptyBottle = item === 'glass_bottle'
  const liquid = item.includes('poison') ? COLORS.green
    : item.includes('healing') ? COLORS.red
      : item.includes('regeneration') ? COLORS.orange
        : item.includes('swiftness') ? COLORS.blue
          : item.includes('strength') ? COLORS.purple
            : item.includes('water') || item.includes('glass_bottle') ? COLORS.fish
              : item.includes('honey') ? COLORS.gold
                : color
  drawRect(pixels, 6, 2, 4, 3, COLORS.woodLight)
  drawRect(pixels, 5, 5, 6, 2, COLORS.iron)
  drawRect(pixels, 4, 7, 8, 6, COLORS.iron)
  drawRect(pixels, 5, 8, 6, 5, emptyBottle ? COLORS.ink : liquid)
  drawRect(pixels, 5, 13, 6, 1, COLORS.ink)
  drawLine(pixels, 5, 8, 10, 8, COLORS.white)
  setPixel(pixels, 6, 7, COLORS.white)
  if (emptyBottle) {
    drawLine(pixels, 6, 9, 6, 11, COLORS.iron)
    drawLine(pixels, 9, 10, 9, 12, COLORS.iron)
  }
  if (item.includes('healing')) {
    drawRect(pixels, 7, 9, 2, 3, COLORS.white)
    drawRect(pixels, 6, 10, 4, 1, COLORS.white)
  } else if (item.includes('regeneration')) {
    drawLine(pixels, 6, 9, 9, 12, COLORS.gold)
    drawLine(pixels, 9, 9, 6, 12, COLORS.gold)
  } else if (item.includes('swiftness')) {
    drawLine(pixels, 6, 9, 9, 9, COLORS.white)
    drawLine(pixels, 7, 11, 10, 11, COLORS.white)
  } else if (item.includes('poison')) {
    setPixel(pixels, 7, 9, COLORS.ink)
    setPixel(pixels, 9, 10, COLORS.ink)
    setPixel(pixels, 7, 12, COLORS.ink)
  } else if (item.includes('strength')) {
    drawLine(pixels, 6, 12, 9, 9, COLORS.gold)
    drawLine(pixels, 7, 12, 10, 9, COLORS.gold)
  }
  if (item.endsWith('_ii')) {
    drawRect(pixels, 5, 9, 6, 3, liquid)
    drawLine(pixels, 6, 10, 6, 11, COLORS.ink)
    drawLine(pixels, 9, 10, 9, 11, COLORS.ink)
    setPixel(pixels, 8, 10, COLORS.gold)
  } else if (item.endsWith('_long')) {
    drawRect(pixels, 5, 9, 6, 3, COLORS.cream)
    drawLine(pixels, 6, 10, 10, 10, COLORS.white)
    drawLine(pixels, 6, 11, 10, 11, COLORS.blue)
  }
}

const renderBook = (pixels: Uint8Array, item: string, color: Rgba): void => {
  const cover = item.includes('enchanted') ? COLORS.purple
    : item === 'written_book' ? COLORS.red
      : item === 'writable_book' ? COLORS.blue
        : color
  drawRect(pixels, 3, 2, 10, 12, COLORS.ink)
  drawRect(pixels, 4, 2, 8, 11, COLORS.cream)
  drawRect(pixels, 3, 3, 2, 10, cover)
  drawRect(pixels, 5, 3, 7, 2, cover)
  if (item === 'written_book') {
    drawRect(pixels, 7, 7, 3, 3, COLORS.red)
    setPixel(pixels, 8, 8, COLORS.gold)
    drawLine(pixels, 5, 11, 10, 11, COLORS.woodLight)
  } else if (item === 'writable_book') {
    drawLine(pixels, 6, 11, 10, 7, COLORS.blue)
    drawLine(pixels, 5, 12, 6, 11, COLORS.ink)
    drawLine(pixels, 5, 7, 6, 7, COLORS.woodLight)
  } else {
    drawLine(pixels, 5, 7, 10, 7, COLORS.woodLight)
    drawLine(pixels, 5, 9, 10, 9, COLORS.woodLight)
    drawLine(pixels, 5, 11, 9, 11, COLORS.woodLight)
    if (item.includes('enchanted')) {
      setPixel(pixels, 6, 5, COLORS.white)
      setPixel(pixels, 9, 4, COLORS.white)
      setPixel(pixels, 10, 6, COLORS.gold)
    }
  }
}

const renderArmor = (pixels: Uint8Array, item: string, color: Rgba): void => {
  if (item.includes('helmet')) {
    drawRect(pixels, 4, 4, 8, 6, color)
    drawRect(pixels, 3, 8, 10, 2, COLORS.ink)
    drawRect(pixels, 5, 6, 2, 2, COLORS.white)
  } else if (item === 'elytra') {
    drawLine(pixels, 8, 4, 3, 7, color)
    drawLine(pixels, 3, 7, 5, 13, color)
    drawLine(pixels, 5, 13, 8, 10, color)
    drawLine(pixels, 8, 4, 13, 7, color)
    drawLine(pixels, 13, 7, 11, 13, color)
    drawLine(pixels, 11, 13, 8, 10, color)
    drawLine(pixels, 8, 4, 8, 13, COLORS.ink)
    drawLine(pixels, 4, 8, 7, 10, COLORS.cream)
    drawLine(pixels, 12, 8, 9, 10, COLORS.cream)
  } else if (item.includes('chestplate')) {
    drawRect(pixels, 5, 3, 6, 3, color)
    drawRect(pixels, 3, 6, 10, 7, color)
    drawRect(pixels, 7, 6, 2, 6, COLORS.ink)
    drawRect(pixels, 2, 7, 2, 4, color)
    drawRect(pixels, 12, 7, 2, 4, color)
  } else if (item.includes('leggings')) {
    drawRect(pixels, 4, 3, 8, 4, color)
    drawRect(pixels, 4, 7, 3, 7, color)
    drawRect(pixels, 9, 7, 3, 7, color)
  } else {
    drawRect(pixels, 4, 5, 4, 6, color)
    drawRect(pixels, 9, 5, 4, 6, color)
    drawRect(pixels, 3, 11, 5, 2, COLORS.ink)
    drawRect(pixels, 8, 11, 5, 2, COLORS.ink)
  }
  drawLine(pixels, 4, 4, 7, 2, COLORS.cream)
}

const isFishItem = (item: string): boolean =>
  includesAny(item, ['cod', 'salmon', 'tropical_fish', 'pufferfish'])

const isStewItem = (item: string): boolean => item.includes('stew') || item === 'beetroot_soup'

const isMeatItem = (item: string): boolean =>
  includesAny(item, ['beef', 'porkchop', 'chicken', 'mutton', 'rabbit'])

const renderPotato = (pixels: Uint8Array, item: string): void => {
  const baked = item === 'baked_potato'
  const poisonous = item.includes('poisonous')
  const fill = baked ? COLORS.cooked : poisonous ? COLORS.green : COLORS.wood
  const highlight = poisonous ? COLORS.green : baked ? COLORS.cooked : COLORS.woodLight
  drawRect(pixels, 4, 5, 8, 7, fill)
  drawRect(pixels, 5, 4, 6, 9, highlight)
  for (const [x, y] of [[6, 6], [10, 8], [7, 11]] as const) {
    setPixel(pixels, x, y, COLORS.ink)
  }
  if (baked) {
    drawLine(pixels, 5, 6, 10, 11, COLORS.gold)
  }
  if (poisonous) {
    drawLine(pixels, 5, 5, 8, 8, COLORS.purple)
    drawLine(pixels, 10, 5, 7, 10, COLORS.ink)
    setPixel(pixels, 11, 10, COLORS.red)
  }
}

const renderCarrot = (pixels: Uint8Array, item: string): void => {
  const golden = item.includes('golden')
  drawLine(pixels, 4, 12, 12, 4, golden ? COLORS.gold : COLORS.orange)
  drawLine(pixels, 5, 12, 13, 4, COLORS.ink)
  drawLine(pixels, 4, 4, 7, 2, COLORS.green)
  drawLine(pixels, 4, 5, 3, 8, COLORS.green)
  drawLine(pixels, 5, 4, 8, 3, COLORS.green)
  if (golden) {
    drawLine(pixels, 7, 9, 9, 7, COLORS.cream)
    drawLine(pixels, 9, 7, 11, 7, COLORS.cream)
  }
}

const renderMelonSlice = (pixels: Uint8Array, item: string): void => {
  const glistering = item.includes('glistering')
  drawRect(pixels, 3, 10, 10, 3, COLORS.green)
  drawLine(pixels, 4, 9, 12, 9, COLORS.green)
  drawLine(pixels, 4, 8, 11, 3, glistering ? COLORS.emerald : COLORS.red)
  drawLine(pixels, 5, 8, 12, 4, COLORS.red)
  setPixel(pixels, 7, 7, COLORS.ink)
  setPixel(pixels, 9, 6, COLORS.ink)
  setPixel(pixels, 11, 5, COLORS.ink)
  if (glistering) {
    drawLine(pixels, 7, 6, 8, 5, COLORS.gold)
    drawLine(pixels, 9, 8, 10, 7, COLORS.white)
    setPixel(pixels, 6, 4, COLORS.yellow)
    setPixel(pixels, 12, 10, COLORS.gold)
  }
}

const renderPumpkinPie = (pixels: Uint8Array): void => {
  drawLine(pixels, 4, 11, 12, 3, COLORS.orange)
  drawLine(pixels, 4, 12, 13, 3, COLORS.ink)
  drawLine(pixels, 4, 12, 12, 12, COLORS.cream)
  drawLine(pixels, 5, 10, 10, 5, COLORS.gold)
  setPixel(pixels, 7, 8, COLORS.wood)
}

const renderBerries = (pixels: Uint8Array, item: string): void => {
  const glowing = item.includes('glow')
  const berry = glowing ? COLORS.orange : COLORS.red
  drawLine(pixels, 8, 3, 8, 7, COLORS.green)
  drawLine(pixels, 8, 5, 5, 4, COLORS.green)
  drawLine(pixels, 8, 5, 11, 4, COLORS.green)
  for (const [x, y] of [[5, 7], [8, 8], [11, 7], [6, 11], [10, 11]] as const) {
    setPixel(pixels, x, y, berry)
    setPixel(pixels, x, y + 1, COLORS.ink)
  }
  if (glowing) {
    drawLine(pixels, 4, 5, 3, 4, COLORS.yellow)
    drawLine(pixels, 12, 5, 13, 4, COLORS.yellow)
    drawLine(pixels, 5, 12, 4, 13, COLORS.gold)
    drawLine(pixels, 11, 12, 12, 13, COLORS.gold)
    setPixel(pixels, 8, 10, COLORS.white)
  } else {
    drawLine(pixels, 5, 6, 7, 4, COLORS.green)
    drawLine(pixels, 9, 5, 11, 6, COLORS.green)
    drawLine(pixels, 7, 12, 9, 13, COLORS.red)
  }
}

const renderBread = (pixels: Uint8Array): void => {
  drawRect(pixels, 3, 5, 10, 7, COLORS.wood)
  drawRect(pixels, 4, 4, 8, 7, COLORS.woodLight)
  drawLine(pixels, 5, 5, 10, 5, COLORS.cream)
  drawLine(pixels, 5, 8, 10, 8, COLORS.gold)
  drawLine(pixels, 5, 12, 12, 12, COLORS.ink)
}

const renderCookie = (pixels: Uint8Array): void => {
  drawRect(pixels, 4, 4, 8, 8, COLORS.woodLight)
  drawRect(pixels, 3, 6, 10, 4, COLORS.woodLight)
  drawLine(pixels, 5, 4, 10, 4, COLORS.cream)
  for (const [x, y] of [[5, 7], [9, 6], [7, 10], [11, 9]] as const) {
    setPixel(pixels, x, y, COLORS.ink)
  }
}

const renderBeetroot = (pixels: Uint8Array): void => {
  drawRect(pixels, 5, 5, 6, 7, COLORS.red)
  drawRect(pixels, 4, 7, 8, 4, COLORS.red)
  drawLine(pixels, 8, 4, 8, 2, COLORS.green)
  drawLine(pixels, 8, 3, 5, 2, COLORS.green)
  drawLine(pixels, 8, 3, 11, 2, COLORS.green)
  setPixel(pixels, 7, 7, COLORS.pink)
}

const renderBasicPlantFood = (pixels: Uint8Array, color: Rgba): void => {
  drawRect(pixels, 4, 4, 8, 8, color)
  drawRect(pixels, 3, 6, 10, 4, color)
  drawLine(pixels, 5, 5, 10, 5, COLORS.cream)
  setPixel(pixels, 7, 3, COLORS.green)
  setPixel(pixels, 8, 2, COLORS.green)
}

const renderPlantFood = (pixels: Uint8Array, item: string, color: Rgba): void => {
  if (item.includes('potato')) {
    renderPotato(pixels, item)
  } else if (item.includes('carrot')) {
    renderCarrot(pixels, item)
  } else if (item.includes('melon_slice')) {
    renderMelonSlice(pixels, item)
  } else if (item.includes('pumpkin')) {
    renderPumpkinPie(pixels)
  } else if (item.includes('berries')) {
    renderBerries(pixels, item)
  } else if (item.includes('bread')) {
    renderBread(pixels)
  } else if (item.includes('cookie')) {
    renderCookie(pixels)
  } else if (item === 'beetroot') {
    renderBeetroot(pixels)
  } else {
    renderBasicPlantFood(pixels, color)
  }
}

const renderFish = (pixels: Uint8Array, item: string): void => {
  const cooked = item.startsWith('cooked_')
  const body = cooked ? COLORS.cooked
    : item.includes('salmon') ? COLORS.salmon
      : item.includes('tropical') ? COLORS.blue
        : item.includes('puffer') ? COLORS.gold
          : COLORS.fish
  if (item.includes('pufferfish')) {
    drawRect(pixels, 5, 5, 7, 7, body)
    drawRect(pixels, 4, 7, 9, 3, body)
    drawLine(pixels, 4, 5, 2, 3, COLORS.gold)
    drawLine(pixels, 3, 8, 1, 8, COLORS.gold)
    drawLine(pixels, 4, 11, 2, 13, COLORS.gold)
    setPixel(pixels, 10, 7, COLORS.ink)
    setPixel(pixels, 11, 7, COLORS.white)
    return
  }
  drawLine(pixels, 3, 8, 1, 5, COLORS.ink)
  drawLine(pixels, 1, 5, 1, 11, COLORS.ink)
  drawLine(pixels, 1, 11, 3, 8, COLORS.ink)
  drawRect(pixels, 3, 5, 8, 7, body)
  drawRect(pixels, 4, 4, 6, 9, body)
  drawLine(pixels, 10, 5, 13, 8, COLORS.ink)
  drawLine(pixels, 13, 8, 10, 11, COLORS.ink)
  setPixel(pixels, 11, 7, COLORS.white)
  setPixel(pixels, 11, 8, COLORS.ink)
  if (item.includes('salmon')) {
    drawLine(pixels, 5, 5, 8, 11, COLORS.cream)
    drawLine(pixels, 7, 4, 10, 10, COLORS.red)
  } else if (item.includes('tropical')) {
    drawLine(pixels, 5, 5, 5, 11, COLORS.yellow)
    drawLine(pixels, 8, 5, 8, 11, COLORS.pink)
    setPixel(pixels, 3, 6, COLORS.green)
  } else {
    drawLine(pixels, 6, 5, 6, 11, cooked ? COLORS.cream : COLORS.ink)
    drawLine(pixels, 8, 5, 8, 10, cooked ? COLORS.gold : COLORS.cream)
  }
}

const meatFill = (item: string, cooked: boolean, color: Rgba): Rgba => {
  if (cooked) {
    if (item.includes('porkchop')) {
      return COLORS.copper
    }
    if (item.includes('chicken')) {
      return COLORS.gold
    }
    if (item.includes('mutton')) {
      return COLORS.cooked
    }
    if (item.includes('rabbit')) {
      return COLORS.brown
    }
    return COLORS.wood
  }
  if (item.includes('rabbit')) {
    return COLORS.pink
  }
  if (item.includes('porkchop')) {
    return COLORS.salmon
  }
  if (item.includes('mutton')) {
    return COLORS.cream
  }
  return color
}

const renderMeat = (pixels: Uint8Array, item: string, color: Rgba): void => {
  const cooked = item.startsWith('cooked_')
  const fill = meatFill(item, cooked, color)
  if (item.includes('chicken')) {
    drawRect(pixels, 5, 5, 6, 7, fill)
    drawRect(pixels, 4, 7, 8, 4, fill)
    drawLine(pixels, 10, 11, 12, 13, COLORS.cream)
    setPixel(pixels, 13, 12, COLORS.white)
    setPixel(pixels, 12, 14, COLORS.white)
  } else if (item.includes('porkchop')) {
    drawRect(pixels, 4, 5, 8, 7, fill)
    drawRect(pixels, 5, 4, 6, 9, fill)
    drawLine(pixels, 9, 10, 12, 13, COLORS.cream)
    drawLine(pixels, 6, 6, 10, 6, cooked ? COLORS.gold : COLORS.cream)
    drawLine(pixels, 6, 9, 9, 9, cooked ? COLORS.wood : COLORS.red)
    drawLine(pixels, 7, 11, 10, 11, cooked ? COLORS.ink : COLORS.pink)
    setPixel(pixels, 12, 12, COLORS.white)
  } else if (item.includes('mutton')) {
    drawRect(pixels, 4, 5, 8, 7, fill)
    drawRect(pixels, 5, 4, 6, 9, fill)
    drawLine(pixels, 5, 6, 10, 6, cooked ? COLORS.gold : COLORS.cream)
    drawLine(pixels, 6, 9, 11, 9, cooked ? COLORS.cooked : COLORS.ink)
    drawLine(pixels, 5, 11, 8, 11, cooked ? COLORS.woodLight : COLORS.pink)
  } else if (item.includes('rabbit')) {
    drawRect(pixels, 5, 5, 6, 6, fill)
    drawRect(pixels, 4, 7, 8, 3, fill)
    drawLine(pixels, 10, 10, 12, 12, COLORS.cream)
    setPixel(pixels, 13, 11, COLORS.white)
    setPixel(pixels, 12, 13, COLORS.white)
    if (cooked) {
      drawLine(pixels, 5, 6, 9, 6, COLORS.gold)
      drawLine(pixels, 6, 9, 10, 9, COLORS.wood)
    } else {
      setPixel(pixels, 6, 6, COLORS.white)
      setPixel(pixels, 9, 8, COLORS.red)
    }
  } else {
    drawRect(pixels, 3, 6, 10, 6, fill)
    drawRect(pixels, 4, 5, 8, 8, fill)
    drawLine(pixels, 5, 6, 10, 6, cooked ? COLORS.gold : COLORS.pink)
    drawLine(pixels, 5, 9, 11, 11, cooked ? COLORS.cooked : COLORS.cream)
  }
  drawLine(pixels, 5, 12, 11, 12, COLORS.ink)
}

const renderApple = (pixels: Uint8Array, item: string): void => {
  const enchanted = item.includes('enchanted')
  const fill = item.includes('golden') ? COLORS.gold : COLORS.red
  drawRect(pixels, 4, 5, 8, 7, fill)
  drawRect(pixels, 3, 7, 10, 4, fill)
  drawRect(pixels, 6, 4, 4, 2, fill)
  drawLine(pixels, 8, 4, 9, 2, COLORS.wood)
  drawLine(pixels, 9, 3, 12, 2, COLORS.green)
  drawLine(pixels, 5, 6, 6, 6, COLORS.white)
  if (item.includes('golden')) {
    drawLine(pixels, 4, 9, 11, 9, COLORS.cream)
    setPixel(pixels, 6, 11, COLORS.orange)
  }
  if (enchanted) {
    drawLine(pixels, 5, 5, 11, 11, COLORS.purple)
    setPixel(pixels, 10, 5, COLORS.white)
    setPixel(pixels, 6, 10, COLORS.amethyst)
  }
}

const renderStew = (pixels: Uint8Array, item: string): void => {
  const broth = item.includes('beetroot') ? COLORS.red
    : item.includes('rabbit') ? COLORS.gold
      : COLORS.brown
  drawRect(pixels, 4, 5, 8, 5, broth)
  drawRect(pixels, 3, 7, 10, 3, broth)
  drawLine(pixels, 3, 10, 5, 13, COLORS.ink)
  drawLine(pixels, 5, 13, 11, 13, COLORS.ink)
  drawLine(pixels, 11, 13, 13, 10, COLORS.ink)
  drawLine(pixels, 4, 5, 11, 5, COLORS.cream)
  if (item.includes('rabbit')) {
    setPixel(pixels, 6, 7, COLORS.green)
    setPixel(pixels, 9, 8, COLORS.red)
    setPixel(pixels, 11, 6, COLORS.white)
  } else if (item.includes('mushroom')) {
    drawRect(pixels, 5, 6, 2, 2, COLORS.cream)
    drawRect(pixels, 9, 7, 2, 2, COLORS.red)
  } else {
    drawRect(pixels, 6, 6, 4, 2, COLORS.pink)
  }
}

const renderFood = (pixels: Uint8Array, item: string, color: Rgba): void => {
  if (item.includes('apple')) {
    renderApple(pixels, item)
  } else if (isFishItem(item)) {
    renderFish(pixels, item)
  } else if (isStewItem(item)) {
    renderStew(pixels, item)
  } else if (isMeatItem(item)) {
    renderMeat(pixels, item, color)
  } else {
    renderPlantFood(pixels, item, color)
  }
}

const renderArrow = (pixels: Uint8Array, color: Rgba): void => {
  drawLine(pixels, 3, 12, 11, 4, COLORS.wood)
  drawLine(pixels, 4, 13, 12, 5, COLORS.cream)
  drawLine(pixels, 10, 5, 13, 2, color)
  drawLine(pixels, 13, 2, 13, 6, color)
  drawLine(pixels, 13, 6, 10, 5, color)
  drawLine(pixels, 3, 12, 2, 9, COLORS.white)
  drawLine(pixels, 4, 13, 5, 14, COLORS.white)
}

const renderEye = (pixels: Uint8Array): void => {
  drawRect(pixels, 3, 6, 10, 5, COLORS.emerald)
  setPixel(pixels, 4, 5, COLORS.emerald)
  setPixel(pixels, 12, 5, COLORS.emerald)
  setPixel(pixels, 4, 11, COLORS.emerald)
  setPixel(pixels, 12, 11, COLORS.emerald)
  drawRect(pixels, 6, 5, 4, 7, COLORS.cream)
  drawRect(pixels, 7, 6, 3, 5, COLORS.purple)
  drawRect(pixels, 8, 7, 2, 3, COLORS.ink)
  setPixel(pixels, 8, 7, COLORS.white)
}

const renderBanner = (pixels: Uint8Array, color: Rgba): void => {
  drawLine(pixels, 4, 2, 4, 14, COLORS.wood)
  drawRect(pixels, 5, 2, 7, 9, COLORS.ink)
  drawRect(pixels, 6, 3, 5, 7, color)
  drawLine(pixels, 6, 3, 10, 3, COLORS.white)
  drawLine(pixels, 6, 9, 10, 9, COLORS.ink)
}

const renderDye = (pixels: Uint8Array, color: Rgba): void => {
  drawLine(pixels, 8, 2, 12, 6, color)
  drawLine(pixels, 12, 6, 8, 13, color)
  drawLine(pixels, 8, 13, 4, 7, color)
  drawLine(pixels, 4, 7, 8, 2, COLORS.ink)
  drawRect(pixels, 6, 5, 5, 5, color)
  setPixel(pixels, 7, 6, COLORS.white)
  setPixel(pixels, 9, 9, COLORS.ink)
}

const renderFishingRod = (pixels: Uint8Array): void => {
  drawLine(pixels, 3, 13, 6, 10, COLORS.wood)
  drawLine(pixels, 4, 14, 7, 10, COLORS.ink)
  drawLine(pixels, 6, 10, 9, 5, COLORS.woodLight)
  drawLine(pixels, 9, 5, 11, 3, COLORS.woodLight)
  drawLine(pixels, 11, 3, 13, 7, COLORS.cream)
  drawLine(pixels, 13, 7, 12, 10, COLORS.white)
  setPixel(pixels, 11, 11, COLORS.red)
  setPixel(pixels, 12, 12, COLORS.ink)
}

const renderDial = (pixels: Uint8Array, item: string): void => {
  const face = item === 'clock' ? COLORS.gold : COLORS.cream
  drawRect(pixels, 4, 4, 8, 8, COLORS.ink)
  drawRect(pixels, 5, 3, 6, 10, face)
  drawRect(pixels, 3, 5, 10, 6, face)
  setPixel(pixels, 8, 4, COLORS.white)
  setPixel(pixels, 8, 11, COLORS.ink)
  setPixel(pixels, 5, 7, COLORS.ink)
  setPixel(pixels, 11, 7, COLORS.ink)
  if (item === 'clock') {
    drawLine(pixels, 8, 8, 8, 5, COLORS.red)
    drawLine(pixels, 8, 8, 11, 9, COLORS.wood)
    setPixel(pixels, 9, 6, COLORS.orange)
  } else {
    drawLine(pixels, 8, 8, 11, 5, COLORS.red)
    drawLine(pixels, 8, 8, 5, 10, COLORS.blue)
    setPixel(pixels, 8, 8, COLORS.ink)
  }
}

const renderGenericMachinery = (pixels: Uint8Array, item: string): boolean => {
  if (item === 'hopper') {
    drawRect(pixels, 4, 3, 8, 2, COLORS.iron)
    drawLine(pixels, 4, 5, 6, 11, COLORS.ink)
    drawLine(pixels, 12, 5, 10, 11, COLORS.ink)
    drawLine(pixels, 6, 11, 10, 11, COLORS.ink)
    drawLine(pixels, 7, 11, 7, 14, COLORS.iron)
    drawLine(pixels, 9, 11, 9, 14, COLORS.ink)
    return true
  }
  if (item === 'anvil') {
    drawRect(pixels, 3, 5, 10, 3, COLORS.iron)
    drawRect(pixels, 5, 8, 6, 3, COLORS.stone)
    drawRect(pixels, 4, 11, 8, 2, COLORS.ink)
    drawRect(pixels, 2, 3, 12, 2, COLORS.ink)
    drawRect(pixels, 4, 4, 8, 1, COLORS.white)
    return true
  }
  if (item === 'fishing_rod') {
    renderFishingRod(pixels)
    return true
  }
  if (item === 'clock' || item === 'compass') {
    renderDial(pixels, item)
    return true
  }
  if (item === 'fire_charge') {
    drawRect(pixels, 5, 5, 6, 7, COLORS.red)
    drawRect(pixels, 6, 3, 4, 9, COLORS.orange)
    drawLine(pixels, 8, 3, 8, 1, COLORS.gold)
    drawLine(pixels, 5, 10, 4, 13, COLORS.red)
    drawLine(pixels, 11, 10, 12, 13, COLORS.purple)
    setPixel(pixels, 8, 7, COLORS.white)
    return true
  }
  if (item === 'popped_chorus_fruit') {
    drawLine(pixels, 8, 2, 8, 13, COLORS.purple)
    drawLine(pixels, 3, 5, 12, 10, COLORS.purple)
    drawLine(pixels, 12, 5, 4, 10, COLORS.amethyst)
    drawRect(pixels, 6, 6, 5, 4, COLORS.pink)
    setPixel(pixels, 8, 7, COLORS.white)
    setPixel(pixels, 7, 9, COLORS.ink)
    return true
  }
  return false
}

const renderGenericDrops = (pixels: Uint8Array, item: string): boolean => {
  if (item === 'feather') {
    drawLine(pixels, 4, 13, 12, 3, COLORS.cream)
    drawLine(pixels, 5, 13, 13, 3, COLORS.ink)
    drawLine(pixels, 5, 10, 3, 8, COLORS.white)
    drawLine(pixels, 7, 8, 4, 5, COLORS.white)
    drawLine(pixels, 9, 6, 7, 3, COLORS.white)
    return true
  }
  if (item === 'rotten_flesh') {
    drawRect(pixels, 4, 5, 8, 7, COLORS.red)
    drawRect(pixels, 5, 4, 6, 9, COLORS.brown)
    drawLine(pixels, 5, 6, 9, 6, COLORS.ink)
    drawLine(pixels, 7, 10, 11, 10, COLORS.pink)
    setPixel(pixels, 10, 7, COLORS.green)
    return true
  }
  if (item === 'gunpowder') {
    drawRect(pixels, 4, 7, 8, 6, COLORS.brown)
    drawRect(pixels, 5, 5, 6, 3, COLORS.cream)
    drawLine(pixels, 5, 6, 11, 6, COLORS.ink)
    for (const [x, y] of [[5, 4], [8, 3], [11, 5], [7, 9], [10, 11]] as const) {
      setPixel(pixels, x, y, COLORS.stone)
    }
    return true
  }
  if (item === 'stick') {
    drawLine(pixels, 4, 13, 12, 3, COLORS.wood)
    drawLine(pixels, 5, 13, 13, 3, COLORS.woodLight)
    drawLine(pixels, 4, 13, 5, 14, COLORS.ink)
    return true
  }
  if (item === 'ghast_tear') {
    drawLine(pixels, 8, 2, 12, 7, COLORS.white)
    drawLine(pixels, 12, 7, 10, 12, COLORS.white)
    drawLine(pixels, 10, 12, 6, 13, COLORS.white)
    drawLine(pixels, 6, 13, 4, 8, COLORS.white)
    drawLine(pixels, 4, 8, 8, 2, COLORS.purple)
    drawRect(pixels, 7, 5, 3, 4, COLORS.cream)
    setPixel(pixels, 8, 7, COLORS.blue)
    return true
  }
  if (item === 'coal' || item === 'charcoal') {
    drawLine(pixels, 4, 7, 7, 4, COLORS.ink)
    drawLine(pixels, 7, 4, 11, 5, item === 'coal' ? COLORS.stone : COLORS.brown)
    drawLine(pixels, 11, 5, 13, 9, COLORS.ink)
    drawLine(pixels, 13, 9, 9, 12, item === 'coal' ? COLORS.stone : COLORS.wood)
    drawLine(pixels, 9, 12, 4, 10, COLORS.ink)
    drawLine(pixels, 4, 10, 4, 7, COLORS.ink)
    if (item === 'charcoal') {
      drawLine(pixels, 6, 8, 10, 7, COLORS.woodLight)
      drawLine(pixels, 7, 10, 11, 9, COLORS.brown)
    } else {
      setPixel(pixels, 7, 6, COLORS.white)
      setPixel(pixels, 10, 10, COLORS.stone)
    }
    return true
  }
  if (item === 'glowstone_dust') {
    drawLine(pixels, 4, 7, 8, 3, COLORS.gold)
    drawLine(pixels, 8, 3, 12, 7, COLORS.white)
    drawLine(pixels, 12, 7, 8, 12, COLORS.gold)
    drawLine(pixels, 8, 12, 4, 7, COLORS.orange)
    setPixel(pixels, 8, 6, COLORS.white)
    setPixel(pixels, 6, 9, COLORS.yellow)
    setPixel(pixels, 10, 9, COLORS.yellow)
    return true
  }
  return false
}

const renderGenericMaterials = (pixels: Uint8Array, item: string): boolean => {
  if (item === 'wheat_seeds') {
    drawLine(pixels, 8, 13, 8, 4, COLORS.wood)
    drawLine(pixels, 8, 7, 5, 4, COLORS.green)
    drawLine(pixels, 8, 9, 11, 6, COLORS.green)
    setPixel(pixels, 6, 3, COLORS.yellow)
    setPixel(pixels, 10, 5, COLORS.gold)
    setPixel(pixels, 5, 8, COLORS.green)
    return true
  }
  if (item === 'blaze_rod') {
    drawRect(pixels, 6, 4, 4, 10, COLORS.orange)
    drawRect(pixels, 7, 3, 2, 11, COLORS.gold)
    drawLine(pixels, 6, 6, 9, 6, COLORS.red)
    drawLine(pixels, 6, 10, 9, 10, COLORS.red)
    setPixel(pixels, 5, 4, COLORS.yellow)
    setPixel(pixels, 10, 8, COLORS.yellow)
    return true
  }
  if (item === 'sugar') {
    drawLine(pixels, 4, 11, 8, 5, COLORS.cream)
    drawLine(pixels, 8, 5, 12, 11, COLORS.white)
    drawLine(pixels, 4, 11, 12, 11, COLORS.white)
    setPixel(pixels, 6, 8, COLORS.white)
    setPixel(pixels, 9, 9, COLORS.cream)
    setPixel(pixels, 8, 3, COLORS.white)
    return true
  }
  if (item === 'ink_sac') {
    drawRect(pixels, 5, 5, 6, 7, COLORS.black)
    drawRect(pixels, 4, 7, 8, 4, COLORS.ink)
    drawLine(pixels, 8, 5, 6, 2, COLORS.black)
    drawLine(pixels, 8, 5, 10, 2, COLORS.black)
    drawLine(pixels, 5, 11, 11, 11, COLORS.purple)
    setPixel(pixels, 7, 7, COLORS.blue)
    return true
  }
  if (item === 'blaze_powder') {
    drawLine(pixels, 4, 10, 8, 4, COLORS.orange)
    drawLine(pixels, 8, 4, 12, 10, COLORS.gold)
    drawLine(pixels, 5, 12, 11, 12, COLORS.red)
    drawLine(pixels, 8, 3, 8, 1, COLORS.yellow)
    setPixel(pixels, 5, 7, COLORS.white)
    setPixel(pixels, 11, 7, COLORS.white)
    return true
  }
  if (item.includes('smithing_template')) {
    drawRect(pixels, 4, 2, 8, 12, COLORS.ink)
    drawRect(pixels, 5, 3, 6, 10, COLORS.purple)
    drawRect(pixels, 6, 4, 4, 3, COLORS.iron)
    drawRect(pixels, 6, 9, 4, 2, COLORS.gold)
    setPixel(pixels, 8, 8, COLORS.white)
    return true
  }
  if (item === 'spider_eye') {
    drawRect(pixels, 4, 5, 8, 7, COLORS.red)
    drawRect(pixels, 5, 4, 6, 9, COLORS.red)
    drawLine(pixels, 4, 7, 2, 5, COLORS.ink)
    drawLine(pixels, 4, 10, 2, 12, COLORS.ink)
    drawLine(pixels, 12, 7, 14, 5, COLORS.ink)
    drawLine(pixels, 12, 10, 14, 12, COLORS.ink)
    drawRect(pixels, 7, 6, 3, 4, COLORS.ink)
    setPixel(pixels, 8, 7, COLORS.white)
    return true
  }
  if (item === 'shulker_shell') {
    drawRect(pixels, 4, 5, 8, 7, COLORS.purple)
    drawRect(pixels, 5, 4, 6, 9, COLORS.pink)
    drawLine(pixels, 3, 7, 13, 7, COLORS.ink)
    drawLine(pixels, 5, 10, 10, 10, COLORS.purple)
    drawLine(pixels, 6, 5, 10, 5, COLORS.white)
    setPixel(pixels, 8, 8, COLORS.cream)
    return true
  }
  return false
}

const renderGenericHashIcon = (pixels: Uint8Array, item: string, color: Rgba): void => {
  const hash = hashString(item)
  const shape = hash % 4
  if (shape === 0) {
    drawRect(pixels, 5, 3, 6, 10, color)
    drawRect(pixels, 4, 5, 8, 6, color)
    drawLine(pixels, 6, 4, 9, 4, COLORS.white)
  } else if (shape === 1) {
    drawLine(pixels, 4, 12, 8, 3, color)
    drawLine(pixels, 8, 3, 12, 12, color)
    drawLine(pixels, 4, 12, 12, 12, color)
    drawLine(pixels, 5, 11, 11, 11, COLORS.cream)
  } else if (shape === 2) {
    drawRect(pixels, 4, 4, 8, 8, color)
    drawRect(pixels, 3, 6, 10, 4, color)
    drawLine(pixels, 5, 5, 10, 5, COLORS.cream)
    drawLine(pixels, 5, 11, 10, 11, COLORS.ink)
  } else {
    drawLine(pixels, 8, 2, 8, 14, color)
    drawLine(pixels, 3, 8, 13, 8, color)
    drawLine(pixels, 4, 4, 12, 12, COLORS.cream)
    drawLine(pixels, 12, 4, 4, 12, COLORS.ink)
  }
}

const renderGeneric = (pixels: Uint8Array, item: string, color: Rgba): void => {
  if (renderGenericMachinery(pixels, item)) {
    return
  }
  if (renderGenericDrops(pixels, item)) {
    return
  }
  if (renderGenericMaterials(pixels, item)) {
    return
  }
  renderGenericHashIcon(pixels, item, color)
}

const isToolItem = (item: string): boolean =>
  includesAny(item, ['pickaxe', 'axe', 'shovel', 'hoe']) || item === 'shears'

const isArmorItem = (item: string): boolean =>
  includesAny(item, ['helmet', 'chestplate', 'leggings', 'boots']) || item === 'elytra' || item === 'shield'

const isBottleItem = (item: string): boolean =>
  item.includes('potion') || item === 'water_bottle' || item === 'honey_bottle' ||
  item === 'glass_bottle' || item === 'dragon_breath'

const isBookItem = (item: string): boolean =>
  item.includes('book') || item === 'paper' || item === 'written_book' || item === 'writable_book'

const isFoodItem = (item: string): boolean => includesAny(item, [
  'beef', 'pork', 'chicken', 'mutton', 'rabbit', 'fish', 'salmon', 'cod', 'apple',
  'bread', 'carrot', 'potato', 'melon', 'cookie', 'pie', 'berries', 'stew', 'beetroot',
])

const isMetalItem = (item: string): boolean =>
  includesAny(item, ['ingot', 'nugget', 'scrap']) || item === 'brick'

const isGemItem = (item: string): boolean =>
  includesAny(item, ['diamond', 'emerald', 'amethyst', 'pearl', 'shard']) || item === 'nether_star'

const isOreItem = (item: string): boolean => item.includes('ore') || item.includes('raw_')

const renderMetal = (pixels: Uint8Array, item: string, color: Rgba): void => {
  if (item.includes('nugget')) {
    drawRect(pixels, 6, 6, 4, 5, color)
    drawRect(pixels, 7, 5, 3, 7, color)
    drawLine(pixels, 7, 6, 8, 6, COLORS.white)
    setPixel(pixels, 9, 10, COLORS.ink)
  } else if (item.includes('scrap')) {
    drawLine(pixels, 4, 7, 7, 4, color)
    drawLine(pixels, 7, 4, 11, 5, color)
    drawLine(pixels, 11, 5, 13, 9, color)
    drawLine(pixels, 13, 9, 9, 12, color)
    drawLine(pixels, 9, 12, 4, 10, color)
    drawLine(pixels, 4, 10, 4, 7, COLORS.ink)
    setPixel(pixels, 7, 7, COLORS.gold)
    setPixel(pixels, 10, 9, COLORS.ink)
  } else {
    drawRect(pixels, 3, 5, 10, 7, color)
    drawRect(pixels, 4, 4, 8, 8, color)
    drawLine(pixels, 5, 4, 10, 4, COLORS.white)
    drawLine(pixels, 4, 10, 11, 10, COLORS.ink)
    setPixel(pixels, 6, 7, COLORS.cream)
    setPixel(pixels, 10, 8, COLORS.ink)
  }
}

const renderGem = (pixels: Uint8Array, color: Rgba): void => {
  drawLine(pixels, 8, 2, 13, 7, color)
  drawLine(pixels, 13, 7, 8, 13, color)
  drawLine(pixels, 8, 13, 3, 7, color)
  drawLine(pixels, 3, 7, 8, 2, color)
  drawLine(pixels, 4, 7, 12, 7, COLORS.ink)
  drawLine(pixels, 6, 4, 10, 4, COLORS.white)
}

const renderPrismarineShard = (pixels: Uint8Array): void => {
  drawLine(pixels, 4, 12, 6, 4, COLORS.cyan)
  drawLine(pixels, 6, 4, 8, 12, COLORS.white)
  drawLine(pixels, 8, 12, 10, 3, COLORS.blue)
  drawLine(pixels, 10, 3, 12, 11, COLORS.cream)
  drawLine(pixels, 4, 12, 12, 11, COLORS.ink)
}

const renderBucket = (pixels: Uint8Array, item: string): void => {
  drawLine(pixels, 4, 5, 12, 5, COLORS.iron)
  drawLine(pixels, 5, 5, 6, 13, COLORS.iron)
  drawLine(pixels, 11, 5, 10, 13, COLORS.iron)
  drawLine(pixels, 6, 13, 10, 13, COLORS.iron)
  drawLine(pixels, 6, 4, 10, 4, COLORS.ink)
  if (item.includes('water')) {
    drawRect(pixels, 6, 9, 4, 3, COLORS.blue)
  }
  if (item.includes('lava')) {
    drawRect(pixels, 6, 9, 4, 3, COLORS.red)
  }
}

const renderOre = (pixels: Uint8Array, item: string, color: Rgba): void => {
  drawRect(pixels, 4, 5, 8, 7, COLORS.stone)
  drawRect(pixels, 5, 4, 7, 9, COLORS.stone)
  drawLine(pixels, 6, 5, 10, 5, COLORS.iron)
  drawLine(pixels, 4, 11, 10, 12, COLORS.ink)
  if (item.includes('raw_')) {
    drawRect(pixels, 6, 6, 3, 4, color)
    drawRect(pixels, 9, 8, 3, 3, color)
    setPixel(pixels, 6, 7, COLORS.white)
    setPixel(pixels, 10, 9, COLORS.ink)
  } else {
    setPixel(pixels, 6, 6, color)
    setPixel(pixels, 9, 8, color)
    setPixel(pixels, 7, 10, color)
    setPixel(pixels, 10, 6, COLORS.cream)
  }
}

const renderNonCubePlaceableIcon = (item: string): boolean =>
  item.endsWith('_banner') || item === 'hopper' || item === 'anvil'

const renderNonPlaceableIcon = (item: string): Uint8Array => {
  const pixels = new Uint8Array(TILE_PIXELS * TILE_PIXELS * CHANNELS)
  const color = colorFor(item)
  if (item.endsWith('_banner')) {
    renderBanner(pixels, color)
  } else if (item.endsWith('_dye')) {
    renderDye(pixels, color)
  } else if (item === 'arrow') {
    renderArrow(pixels, color)
  } else if (item === 'eye_of_ender') {
    renderEye(pixels)
  } else if (item === 'bow') {
    renderBow(pixels, color)
  } else if (item.includes('sword')) {
    renderSword(pixels, item, color)
  } else if (isToolItem(item)) {
    renderTool(pixels, item, color)
  } else if (isArmorItem(item)) {
    renderArmor(pixels, item, color)
  } else if (isBottleItem(item)) {
    renderBottle(pixels, item, color)
  } else if (isBookItem(item)) {
    renderBook(pixels, item, color)
  } else if (isFoodItem(item)) {
    renderFood(pixels, item, color)
  } else if (isMetalItem(item)) {
    renderMetal(pixels, item, color)
  } else if (isGemItem(item)) {
    if (item === 'prismarine_shard') {
      renderPrismarineShard(pixels)
    } else {
      renderGem(pixels, color)
    }
  } else if (item.includes('bucket')) {
    renderBucket(pixels, item)
  } else if (isOreItem(item)) {
    renderOre(pixels, item, color)
  } else {
    renderGeneric(pixels, item, color)
  }
  return pixels
}

const writeExtrudedTile = (atlas: Uint8Array, tileIndex: number, source: Uint8Array): void => {
  const tileX = tileIndex % ATLAS_COLUMNS
  const tileY = Math.floor(tileIndex / ATLAS_COLUMNS)
  const originX = tileX * TILE_CELL_PIXELS
  const originY = tileY * TILE_CELL_PIXELS
  for (let y = 0; y < TILE_CELL_PIXELS; y += 1) {
    const sourceY = Math.max(FIRST_PIXEL, Math.min(LAST_PIXEL, y - TILE_GUTTER_PIXELS))
    for (let x = 0; x < TILE_CELL_PIXELS; x += 1) {
      const sourceX = Math.max(FIRST_PIXEL, Math.min(LAST_PIXEL, x - TILE_GUTTER_PIXELS))
      const sourceOffset = pixelOffset(sourceX, sourceY)
      const targetOffset = ((originY + y) * ATLAS_PIXELS + originX + x) * CHANNELS
      atlas.set(source.subarray(sourceOffset, sourceOffset + CHANNELS), targetOffset)
    }
  }
}

const CRC_TABLE = new Uint32Array(256)
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  CRC_TABLE[index] = value >>> 0
}

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const pngChunk = (type: string, data: Uint8Array): Buffer => {
  const typeBytes = Buffer.from(type, 'ascii')
  const chunk = Buffer.allocUnsafe(data.byteLength + 12)
  chunk.writeUInt32BE(data.byteLength, 0)
  typeBytes.copy(chunk, 4)
  Buffer.from(data).copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.byteLength)), 8 + data.byteLength)
  return chunk
}

const encodePng = (rgba: Uint8Array): Buffer => {
  const rowSize = ATLAS_PIXELS * CHANNELS
  const scanlines = Buffer.allocUnsafe((rowSize + 1) * ATLAS_PIXELS)
  for (let y = 0; y < ATLAS_PIXELS; y += 1) {
    const targetOffset = y * (rowSize + 1)
    scanlines[targetOffset] = 0
    scanlines.set(rgba.subarray(y * rowSize, (y + 1) * rowSize), targetOffset + 1)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(ATLAS_PIXELS, 0)
  header.writeUInt32BE(ATLAS_PIXELS, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const placeableItems = new Set<string>(PLACEABLE_ITEM_TYPES)

export const generateItemIconArtifacts = (
  blockTextures: GeneratedTextureArtifacts,
): ItemIconGeneratorResult<GeneratedItemIconArtifacts> => {
  if (ITEM_TYPES.length > ATLAS_CAPACITY) {
    return failure(
      'AtlasCapacityExceeded',
      `Generation needs ${ITEM_TYPES.length} tiles, capacity is ${ATLAS_CAPACITY}`,
    )
  }
  const rgba = new Uint8Array(ATLAS_PIXELS * ATLAS_PIXELS * CHANNELS)
  const itemIcons: Record<string, number> = {}
  for (const [tileIndex, item] of ITEM_TYPES.entries()) {
    const isPlaceable = placeableItems.has(item)
    const icon = isPlaceable && !renderNonCubePlaceableIcon(item)
      ? renderBlockIcon(blockTextures, blockOfPlaceableItem(item as PlaceableItemType))
      : renderNonPlaceableIcon(item)
    if (icon === undefined) {
      return failure('BlockTextureGenerationFailed', `Missing block texture for placeable item ${item}`)
    }
    itemIcons[item] = tileIndex
    writeExtrudedTile(rgba, tileIndex, icon)
  }
  const manifestData: ItemIconManifest = {
    schemaVersion: 1,
    layout: ATLAS_LAYOUT,
    tileCount: ITEM_TYPES.length,
    itemIcons,
  }
  const manifest = `${JSON.stringify(manifestData, null, 2)}\n`
  return success({ png: encodePng(rgba), manifest, manifestData, rgba })
}

export const loadAndGenerateItemIconArtifacts = async (): Promise<
  ItemIconGeneratorResult<GeneratedItemIconArtifacts>
> => {
  const blockTextures = await loadAndGenerateBlockTextures()
  if (blockTextures._tag === 'Failure') {
    return failure('BlockTextureGenerationFailed', blockTextures.error.message)
  }
  return generateItemIconArtifacts(blockTextures.value)
}

const readExistingArtifacts = async (): Promise<
  ItemIconGeneratorResult<Readonly<{ png: Buffer; manifest: Buffer }>>
> => {
  try {
    const [png, manifest] = await Promise.all([
      readFile(ITEM_ICON_ATLAS_PATH),
      readFile(ITEM_ICON_MANIFEST_PATH),
    ])
    return success({ png, manifest })
  } catch (error: unknown) {
    return failure('ArtifactReadError', String(error))
  }
}

const runCli = async (args: ReadonlyArray<string>): Promise<number> => {
  const check = args.includes('--check')
  if (args.some((arg) => arg !== '--check')) {
    console.error('Supported option: --check')
    return 2
  }
  const generated = await loadAndGenerateItemIconArtifacts()
  if (generated._tag === 'Failure') {
    console.error(`${generated.error._tag}: ${generated.error.message}`)
    return 1
  }
  if (check) {
    const current = await readExistingArtifacts()
    if (current._tag === 'Failure') {
      console.error(`ArtifactReadError: ${current.error.message}`)
      return 1
    }
    if (
      !current.value.png.equals(generated.value.png) ||
      !current.value.manifest.equals(Buffer.from(generated.value.manifest))
    ) {
      console.error('Item icon artifacts are stale. Run pnpm exec tsx scripts/generate-item-icons.ts.')
      return 1
    }
    console.log(`Verified ${generated.value.manifestData.tileCount} item icons in ${ITEM_ICON_ATLAS_PATH}`)
    return 0
  }
  try {
    await mkdir(dirname(ITEM_ICON_ATLAS_PATH), { recursive: true })
    await Promise.all([
      writeFile(ITEM_ICON_ATLAS_PATH, generated.value.png),
      writeFile(ITEM_ICON_MANIFEST_PATH, generated.value.manifest),
    ])
  } catch (error: unknown) {
    console.error(`ArtifactWriteError: ${String(error)}`)
    return 1
  }
  console.log(`Generated ${generated.value.manifestData.tileCount} item icons in ${ITEM_ICON_ATLAS_PATH}`)
  return 0
}

const entrypoint = pathToFileURL(resolve(process.argv[1] ?? '')).href
if (import.meta.url === entrypoint) {
  process.exitCode = await runCli(process.argv.slice(2))
}
