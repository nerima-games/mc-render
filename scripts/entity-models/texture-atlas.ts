// SPDX-License-Identifier: CC0-1.0
import type { EntityModelColor, EntityModelDescriptor, EntityModelPartDescriptor } from '../../src/domain/entity-models/types.js'

export const ENTITY_TEXTURE_TILE_SIZE: number = 16
export const ENTITY_TEXTURE_COLUMNS: number = 16
export const ENTITY_TEXTURE_ROWS: number = 8
export const ENTITY_TEXTURE_GUTTER: number = 2
export const ENTITY_TEXTURE_CELL_SIZE: number = ENTITY_TEXTURE_TILE_SIZE + ENTITY_TEXTURE_GUTTER * 2
export const ENTITY_TEXTURE_ATLAS_WIDTH: number = ENTITY_TEXTURE_COLUMNS * ENTITY_TEXTURE_CELL_SIZE
export const ENTITY_TEXTURE_ATLAS_HEIGHT: number = ENTITY_TEXTURE_ROWS * ENTITY_TEXTURE_CELL_SIZE

export type EntityTextureSourceModel = Readonly<{
  readonly model: EntityModelDescriptor
  readonly group: string
  readonly colorEncoding: 'unit-rgb' | 'byte-rgb'
}>

export type EntityTextureEntry = Readonly<{
  readonly kind: string
  readonly tile: number
  readonly uv: readonly [number, number, number, number]
  readonly motif: string
  readonly primaryColor: EntityModelColor
  readonly accentColor: EntityModelColor
}>

export type EntityTextureAtlas = Readonly<{
  readonly width: number
  readonly height: number
  readonly tileSize: number
  readonly columns: number
  readonly rows: number
  readonly entries: ReadonlyArray<EntityTextureEntry>
  readonly pixels: ReadonlyArray<number>
}>

type Motif = 'bands' | 'checks' | 'crackle' | 'dapple' | 'feather' | 'fur' | 'metal' | 'patches' | 'scales' | 'shell' | 'spots' | 'streaks' | 'waves' | 'wood' | 'woven'

const COLOR_CHANNEL_MAXIMUM = 255
const COLOR_CHANNEL_MINIMUM = 0
const RED = 0
const GREEN = 1
const BLUE = 2
const ALPHA = 3
const OPAQUE = 255
const WHITE_CHANNEL = 255
const ACCENT_RATIO_CEILING = 224
const SHADOW_CHANNEL = 105
const HIGHLIGHT_CHANNEL = 220
const PRIMARY_PART_ROLE = 'body'
const TILE_BACKGROUND = 0
const TILE_ACCENT = 1
const TILE_SHADOW = 2
const TILE_HIGHLIGHT = 3
const PIXEL_BYTES = 4
const PIXEL_STEP = 1
const STABLE_HASH_MULTIPLIER = 31
const STABLE_HASH_MODULUS = 2 ** 32

const MOTIF_BY_KIND: Readonly<Record<string, Motif>> = {
  armadillo: 'shell',
  bee: 'bands',
  boat: 'wood',
  camel: 'dapple',
  cat: 'spots',
  chicken: 'feather',
  cow: 'patches',
  creeper: 'crackle',
  ender_dragon: 'scales',
  enderman: 'streaks',
  ghast: 'waves',
  horse: 'dapple',
  iron_golem: 'metal',
  mooshroom: 'patches',
  panda: 'patches',
  parrot: 'feather',
  pig: 'spots',
  salmon: 'scales',
  sheep: 'fur',
  snow_golem: 'checks',
  spider: 'spots',
  strider: 'bands',
  turtle: 'shell',
  tropical_fish: 'scales',
  villager: 'woven',
  wandering_trader: 'woven',
  wolf: 'fur',
}

const DEFAULT_MOTIFS: Readonly<Record<string, Motif>> = {
  'display-misc': 'metal',
  animals: 'fur',
  dragon: 'scales',
  'hostile-mobs': 'checks',
  'neutral-mobs': 'checks',
  projectiles: 'streaks',
  'vehicles-tnt': 'wood',
  'villagers-player': 'woven',
}

const stableHash = (value: string): number => {
  let hash = 0
  for (const character of value) {
    hash = (hash * STABLE_HASH_MULTIPLIER + (character.codePointAt(0) ?? 0)) % STABLE_HASH_MODULUS
  }
  return hash
}

const sourceColorBytes = (part: EntityModelPartDescriptor, encoding: EntityTextureSourceModel['colorEncoding']): EntityModelColor =>
  part.color.map((channel) => Math.round(encoding === 'unit-rgb' ? channel * COLOR_CHANNEL_MAXIMUM : channel)) as unknown as EntityModelColor

const partArea = ({ size }: EntityModelPartDescriptor): number => size[0] * size[1] * size[2]

const colorDistance = (left: EntityModelColor, right: EntityModelColor): number => Math.sqrt(
  (left[RED] - right[RED]) ** 2 + (left[GREEN] - right[GREEN]) ** 2 + (left[BLUE] - right[BLUE]) ** 2,
)

const generatedAccent = (kind: string, primary: EntityModelColor): EntityModelColor => {
  const hue = stableHash(kind) % 360
  const chroma = 180
  const sector = Math.floor(hue / 60)
  const offset = Math.round(chroma * (1 - Math.abs((hue / 60) % 2 - 1)))
  const colors = [
    [chroma, offset, 0], [offset, chroma, 0], [0, chroma, offset],
    [0, offset, chroma], [offset, 0, chroma], [chroma, 0, offset],
  ] as const
  const generated = colors[sector] ?? [chroma, offset, 0]
  if (colorDistance(primary, generated) > 90) {
    return generated
  }
  return [
    COLOR_CHANNEL_MAXIMUM - primary[RED],
    COLOR_CHANNEL_MAXIMUM - primary[GREEN],
    COLOR_CHANNEL_MAXIMUM - primary[BLUE],
  ]
}

const paletteFor = (
  { model, colorEncoding }: EntityTextureSourceModel,
): Readonly<{ primary: EntityModelColor; accent: EntityModelColor }> => {
  const primaryPart = model.parts.find((part) => String(part.role) === PRIMARY_PART_ROLE) ??
    [...model.parts].toSorted((left, right) => partArea(right) - partArea(left))[0]
  const primary: EntityModelColor = primaryPart === undefined ? [120, 120, 120] : sourceColorBytes(primaryPart, colorEncoding)
  const [accentCandidate] = model.parts
    .map((part) => sourceColorBytes(part, colorEncoding))
    .toSorted((left, right) => colorDistance(right, primary) - colorDistance(left, primary))
  const accent = accentCandidate !== undefined && colorDistance(accentCandidate, primary) >= 48
    ? accentCandidate
    : generatedAccent(String(model.kind), primary)
  return { accent, primary }
}

const motifFor = (kind: string, group: string, variant: number): Motif => {
  const specific = MOTIF_BY_KIND[kind]
  if (specific !== undefined) {
    return specific
  }
  const families: ReadonlyArray<Motif> = ['bands', 'checks', 'dapple', 'fur', 'scales', 'spots', 'streaks', 'waves']
  if (group === 'animals' || group === 'hostile-mobs' || group === 'neutral-mobs' || group === 'projectiles') {
    return families[variant % families.length] ?? 'fur'
  }
  return DEFAULT_MOTIFS[group] ?? 'checks'
}

type MotifPattern = (x: number, y: number) => number

const PATTERN_BY_MOTIF: Readonly<Record<Motif, MotifPattern>> = {
  bands: (_x, y) => y % 5 === 0 || y % 5 === 1 ? TILE_ACCENT : TILE_BACKGROUND,
  checks: (x, y) => (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0 ? TILE_ACCENT : TILE_BACKGROUND,
  crackle: (x, y) => (x + y * 3) % 11 === 0 || (x * 2 + y) % 13 === 0 ? TILE_HIGHLIGHT : TILE_SHADOW,
  dapple: (x, y) => (x % 7 === 2 || x % 7 === 3) && (y % 6 === 2 || y % 6 === 3) ? TILE_ACCENT : TILE_BACKGROUND,
  feather: (x, y) => y % 4 === 0 ? TILE_ACCENT : x % 5 === 0 ? TILE_HIGHLIGHT : TILE_BACKGROUND,
  fur: (x) => x % 6 === 0 ? TILE_SHADOW : x % 6 === 1 ? TILE_HIGHLIGHT : TILE_BACKGROUND,
  metal: (x, y) => (x % 6 === 1 && y % 6 === 1) ? TILE_HIGHLIGHT : (x % 6 === 0 || y % 6 === 0) ? TILE_SHADOW : TILE_BACKGROUND,
  patches: (x, y) => ((x + Math.floor(y / 3) * 2) % 8 < 3) ? TILE_ACCENT : TILE_BACKGROUND,
  scales: (x, y) => y % 4 === 0 || (x + Math.floor(y / 4) * 2) % 6 === 0 ? TILE_HIGHLIGHT : TILE_BACKGROUND,
  shell: (x, y) => x % 5 === 0 || y % 5 === 0 ? TILE_SHADOW : (x + y) % 7 === 0 ? TILE_HIGHLIGHT : TILE_BACKGROUND,
  spots: (x, y) => x % 6 === 2 && y % 6 === 2 ? TILE_ACCENT : TILE_BACKGROUND,
  streaks: (x, y) => (x + y * 2) % 7 < 2 ? TILE_HIGHLIGHT : TILE_BACKGROUND,
  waves: (x, y) => (y + Math.floor(x / 3)) % 6 < 2 ? TILE_ACCENT : TILE_BACKGROUND,
  wood: (x, y) => x % 5 === 0 ? TILE_SHADOW : (x + y * 2) % 13 === 0 ? TILE_HIGHLIGHT : TILE_BACKGROUND,
  woven: (x, y) => x % 4 === 0 || y % 5 === 0 ? TILE_ACCENT : TILE_BACKGROUND,
}

const patternAt = (motif: Motif, x: number, y: number, variant: number): number => {
  const shiftedX = x + variant % 3
  const shiftedY = y + Math.floor(variant / 3) % 3
  return PATTERN_BY_MOTIF[motif](shiftedX, shiftedY)
}

const textureRatio = (accent: EntityModelColor, primary: EntityModelColor): EntityModelColor =>
  primary.map((channel, index) => {
    const accentChannel = accent[index] ?? channel
    const ratio = channel <= COLOR_CHANNEL_MINIMUM ? WHITE_CHANNEL : accentChannel / channel * WHITE_CHANNEL
    return Math.max(COLOR_CHANNEL_MINIMUM, Math.min(ACCENT_RATIO_CEILING, Math.round(ratio)))
  }) as unknown as EntityModelColor

const pixelColorFor = (
  mark: number,
  accentRatio: EntityModelColor,
): EntityModelColor => {
  if (mark === TILE_ACCENT) {
    return accentRatio
  }
  if (mark === TILE_SHADOW) {
    return [SHADOW_CHANNEL, SHADOW_CHANNEL, SHADOW_CHANNEL]
  }
  if (mark === TILE_HIGHLIGHT) {
    return [HIGHLIGHT_CHANNEL, HIGHLIGHT_CHANNEL, HIGHLIGHT_CHANNEL]
  }
  return [WHITE_CHANNEL, WHITE_CHANNEL, WHITE_CHANNEL]
}

const writePixel = (pixels: Uint8Array, width: number, x: number, y: number, color: EntityModelColor): void => {
  const offset = (y * width + x) * PIXEL_BYTES
  pixels[offset + RED] = color[RED]
  pixels[offset + GREEN] = color[GREEN]
  pixels[offset + BLUE] = color[BLUE]
  pixels[offset + ALPHA] = OPAQUE
}

const fillTile = (
  pixels: Uint8Array,
  entry: EntityTextureEntry,
  accentRatio: EntityModelColor,
): void => {
  const column = entry.tile % ENTITY_TEXTURE_COLUMNS
  const row = Math.floor(entry.tile / ENTITY_TEXTURE_COLUMNS)
  const left = column * ENTITY_TEXTURE_CELL_SIZE + ENTITY_TEXTURE_GUTTER
  const top = row * ENTITY_TEXTURE_CELL_SIZE + ENTITY_TEXTURE_GUTTER
  const variant = stableHash(entry.kind) % 12
  const motif = entry.motif as Motif
  for (let y = 0; y < ENTITY_TEXTURE_TILE_SIZE; y += PIXEL_STEP) {
    for (let x = 0; x < ENTITY_TEXTURE_TILE_SIZE; x += PIXEL_STEP) {
      writePixel(pixels, ENTITY_TEXTURE_ATLAS_WIDTH, left + x, top + y, pixelColorFor(patternAt(motif, x, y, variant), accentRatio))
    }
  }
  for (let y = -ENTITY_TEXTURE_GUTTER; y < ENTITY_TEXTURE_TILE_SIZE + ENTITY_TEXTURE_GUTTER; y += PIXEL_STEP) {
    for (let x = -ENTITY_TEXTURE_GUTTER; x < ENTITY_TEXTURE_TILE_SIZE + ENTITY_TEXTURE_GUTTER; x += PIXEL_STEP) {
      const isTilePixel = x >= 0 && x < ENTITY_TEXTURE_TILE_SIZE && y >= 0 && y < ENTITY_TEXTURE_TILE_SIZE
      if (!isTilePixel) {
        const nearestX = Math.max(0, Math.min(ENTITY_TEXTURE_TILE_SIZE - 1, x))
        const nearestY = Math.max(0, Math.min(ENTITY_TEXTURE_TILE_SIZE - 1, y))
        const color = pixelColorFor(patternAt(motif, nearestX, nearestY, variant), accentRatio)
        writePixel(pixels, ENTITY_TEXTURE_ATLAS_WIDTH, left + x, top + y, color)
      }
    }
  }
}

export const entityTextureCoordinatesForTile = (tile: number): readonly [number, number, number, number] => {
  const column = tile % ENTITY_TEXTURE_COLUMNS
  const row = Math.floor(tile / ENTITY_TEXTURE_COLUMNS)
  const left = column * ENTITY_TEXTURE_CELL_SIZE + ENTITY_TEXTURE_GUTTER
  const top = row * ENTITY_TEXTURE_CELL_SIZE + ENTITY_TEXTURE_GUTTER
  const right = left + ENTITY_TEXTURE_TILE_SIZE
  const bottom = top + ENTITY_TEXTURE_TILE_SIZE
  return [
    (left + 0.5) / ENTITY_TEXTURE_ATLAS_WIDTH,
    1 - (bottom - 0.5) / ENTITY_TEXTURE_ATLAS_HEIGHT,
    (right - 0.5) / ENTITY_TEXTURE_ATLAS_WIDTH,
    1 - (top + 0.5) / ENTITY_TEXTURE_ATLAS_HEIGHT,
  ]
}

export const makeEntityTextureAtlas = (models: ReadonlyArray<EntityTextureSourceModel>): EntityTextureAtlas => {
  const orderedModels = [...models].toSorted(({ model: left }, { model: right }) => String(left.kind).localeCompare(String(right.kind), 'en'))
  const pixels = new Uint8Array(ENTITY_TEXTURE_ATLAS_WIDTH * ENTITY_TEXTURE_ATLAS_HEIGHT * PIXEL_BYTES)
  const entries = orderedModels.map((source, tile): EntityTextureEntry => {
    const { model, group } = source
    const { accent, primary } = paletteFor(source)
    const motif = motifFor(String(model.kind), group, stableHash(String(model.kind)))
    return {
      accentColor: accent,
      kind: String(model.kind),
      motif,
      primaryColor: primary,
      tile,
      uv: entityTextureCoordinatesForTile(tile),
    }
  })
  for (const entry of entries) {
    fillTile(pixels, entry, textureRatio(entry.accentColor, entry.primaryColor))
  }
  return {
    columns: ENTITY_TEXTURE_COLUMNS,
    entries,
    height: ENTITY_TEXTURE_ATLAS_HEIGHT,
    pixels: [...pixels],
    rows: ENTITY_TEXTURE_ROWS,
    tileSize: ENTITY_TEXTURE_TILE_SIZE,
    width: ENTITY_TEXTURE_ATLAS_WIDTH,
  }
}

export const entityTexturePixelsForPng = (atlas: EntityTextureAtlas): Uint8Array => new Uint8Array(atlas.pixels)
