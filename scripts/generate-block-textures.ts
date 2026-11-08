import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'
import { BLOCK_TYPES } from '@nerima-games/mc-kernel'

const FACE_ROLES = ['top', 'side', 'bottom'] as const
const SWATCHES = ['shade', 'shadow', 'base', 'light', 'accent'] as const
const RECIPE_GROUPS = ['stone', 'soil-grass', 'wood', 'ore', 'plants', 'liquids'] as const
const ANIMATION_GROUPS = ['water', 'lava', 'fire', 'portal'] as const
const PATTERNS = [
  'cluster', 'strata', 'soil', 'grass-top', 'grass-edge', 'wood-grain', 'wood-end',
  'ore-speckle', 'foliage', 'flower', 'stalk', 'metal-panel', 'brick', 'ripple',
  'flow', 'flame', 'portal', 'gem', 'cloth', 'glass', 'flat',
  'end-rod', 'skull',
  'stone-mottle', 'soil-grain', 'grass-cover', 'plank-grain', 'bark-grain',
  'wood-rings', 'ore-vein', 'leaf-canopy', 'sand-grain', 'gravel-pebble',
  'glass-pane', 'wool-weave', 'machine-panel', 'furnace', 'crafting-table',
  'chest', 'dispenser', 'dropper', 'rail', 'powered-rail', 'pressure-plate',
  'lever', 'observer', 'repeater', 'comparator', 'furrow', 'redstone-wire', 'redstone-torch',
  'portal-frame', 'portal-frame-filled', 'door', 'door-open', 'cauldron',
  'water-cauldron', 'tnt-wrap', 'brewing-stand',
] as const

type FaceRole = (typeof FACE_ROLES)[number]
type Swatch = (typeof SWATCHES)[number]
type PatternName = (typeof PATTERNS)[number]
type AlphaMode = 'opaque' | 'cutout' | 'translucent'
type AnimationGroup = (typeof ANIMATION_GROUPS)[number]
type Palette = Readonly<Record<Swatch, string>>

export const SUPPORTED_TEXTURE_PATTERNS: ReadonlyArray<PatternName> = PATTERNS

type ResolvedRecipe = {
  readonly palette: Palette
  readonly pattern: PatternName
  readonly alpha: AlphaMode
  readonly faces: Readonly<Partial<Record<FaceRole, PatternName>>>
  readonly variants?: number
  readonly animation?: Readonly<{ group: AnimationGroup; frames: number }>
}

export type TextureManifest = {
  readonly schemaVersion: 1
  readonly layout: Readonly<{
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
  readonly tileCount: number
  readonly blockFaces: Readonly<Record<string, Readonly<Record<FaceRole, number>>>>
  readonly blockAlphaModes: Readonly<Record<string, AlphaMode>>
  readonly variants: Readonly<Record<string, ReadonlyArray<number>>>
  readonly animations: Readonly<Record<string, Readonly<Record<string, ReadonlyArray<number>>>>>
}

export type TextureGeneratorError = Readonly<{
  _tag: 'InvalidRecipeInput' | 'InvalidTileIndex' | 'InvalidMipLevel' | 'AtlasCapacityExceeded' | 'ArtifactReadError'
  message: string
}>

export type TextureGeneratorResult<A> =
  | Readonly<{ _tag: 'Success'; value: A }>
  | Readonly<{ _tag: 'Failure'; error: TextureGeneratorError }>

export type GeneratedTextureArtifacts = Readonly<{
  png: Buffer
  manifest: string
  manifestData: TextureManifest
  rgba: Uint8Array
  detailPng: Buffer
  detailRgba: Uint8Array
  detailWidth: number
  detailHeight: number
}>

export type AtlasLayout = Readonly<{
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

export const ATLAS_LAYOUT: AtlasLayout = Object.freeze({
  width: 1536,
  height: 1536,
  columns: 32,
  rows: 32,
  tilePixels: 16,
  gutterPixels: 16,
  cellPixels: 48,
  capacity: 1024,
  mipLevels: 11,
})

const ATLAS_PIXELS = ATLAS_LAYOUT.width * ATLAS_LAYOUT.height
const ART_PIXELS = ATLAS_LAYOUT.tilePixels * ATLAS_LAYOUT.tilePixels
const CHANNELS = 4
const DETAIL_SCALE = 4
const DETAIL_TILE_PIXELS = ATLAS_LAYOUT.tilePixels * DETAIL_SCALE
const DETAIL_COLUMNS = 16
const DETAIL_LABEL_HEIGHT = 10
const DETAIL_CELL_HEIGHT = DETAIL_TILE_PIXELS + DETAIL_LABEL_HEIGHT
const DETAIL_WIDTH = DETAIL_COLUMNS * DETAIL_TILE_PIXELS
const ROOT = resolve(import.meta.dirname, '..')
const RECIPE_DIRECTORY = resolve(ROOT, 'scripts/texture-recipes')
const ATLAS_PATH = resolve(ROOT, 'src/assets/block-textures/atlas.png')
const MANIFEST_PATH = resolve(ROOT, 'src/assets/block-textures/manifest.json')
const DETAIL_PREVIEW_PATH = resolve(ROOT, 'docs/block-texture-detail.png')
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const CRC_TABLE = new Uint32Array(256)

for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  CRC_TABLE[index] = value >>> 0
}

const success = <A>(value: A): TextureGeneratorResult<A> => ({ _tag: 'Success', value })
const failure = (
  _tag: TextureGeneratorError['_tag'],
  message: string,
): TextureGeneratorResult<never> => ({ _tag: 'Failure', error: { _tag, message } })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOnlyKeys = (value: Record<string, unknown>, allowed: ReadonlyArray<string>): boolean =>
  Object.keys(value).every((key) => allowed.includes(key))

const isPatternName = (value: unknown): value is PatternName =>
  typeof value === 'string' && PATTERNS.includes(value as PatternName)

const isAlphaMode = (value: unknown): value is AlphaMode =>
  value === 'opaque' || value === 'cutout' || value === 'translucent'

const isAnimationGroup = (value: unknown): value is AnimationGroup =>
  typeof value === 'string' && ANIMATION_GROUPS.includes(value as AnimationGroup)

const isRecipeGroup = (value: unknown): value is (typeof RECIPE_GROUPS)[number] =>
  typeof value === 'string' && RECIPE_GROUPS.includes(value as (typeof RECIPE_GROUPS)[number])

const isHexColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)

const isPalette = (value: unknown): value is Palette => {
  if (!isRecord(value) || !hasOnlyKeys(value, SWATCHES)) {
    return false
  }
  return SWATCHES.every((swatch) => isHexColor(value[swatch]))
}

const parseFacePatterns = (
  blockName: string,
  rawFaces: unknown,
): TextureGeneratorResult<Partial<Record<FaceRole, PatternName>>> => {
  if (rawFaces === undefined) {
    return success({})
  }
  if (!isRecord(rawFaces) || !hasOnlyKeys(rawFaces, FACE_ROLES)) {
    return failure('InvalidRecipeInput', `Recipe ${blockName} has an invalid face map`)
  }

  const faces: Partial<Record<FaceRole, PatternName>> = {}
  for (const role of FACE_ROLES) {
    const facePattern = rawFaces[role]
    if (facePattern !== undefined) {
      if (!isPatternName(facePattern)) {
        return failure('InvalidRecipeInput', `Recipe ${blockName}.${role} has an unknown pattern`)
      }
      faces[role] = facePattern
    }
  }
  return success(faces)
}

const parseVariants = (blockName: string, value: unknown): TextureGeneratorResult<number | undefined> => {
  if (value === undefined) {
    return success(undefined)
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 2) {
    return failure('InvalidRecipeInput', `Recipe ${blockName} variants must be an integer count of at least two`)
  }
  return success(value)
}

const parseAnimation = (
  blockName: string,
  value: unknown,
): TextureGeneratorResult<ResolvedRecipe['animation']> => {
  if (value === undefined) {
    return success(undefined)
  }
  if (!isRecord(value) || !hasOnlyKeys(value, ['group', 'frames'])) {
    return failure('InvalidRecipeInput', `Recipe ${blockName} has an invalid animation`)
  }
  const { group, frames } = value
  if (!isAnimationGroup(group) || typeof frames !== 'number' || !Number.isSafeInteger(frames) || frames < 1) {
    return failure('InvalidRecipeInput', `Recipe ${blockName} has an invalid animation`)
  }
  return success({ group, frames })
}

const parseRecipe = (
  blockName: string,
  raw: unknown,
  palettes: Readonly<Record<string, Palette>>,
): TextureGeneratorResult<ResolvedRecipe> => {
  if (!isRecord(raw) || !hasOnlyKeys(raw, ['palette', 'pattern', 'alpha', 'faces', 'variants', 'animation'])) {
    return failure('InvalidRecipeInput', `Recipe ${blockName} must be an object with only supported fields`)
  }

  const {
    palette: paletteName,
    pattern,
    alpha,
    faces: rawFaces,
    variants: rawVariants,
    animation: rawAnimation,
  } = raw
  if (typeof paletteName !== 'string') {
    return failure('InvalidRecipeInput', `Recipe ${blockName} references an unknown palette`)
  }
  const palette = palettes[paletteName]
  if (palette === undefined) {
    return failure('InvalidRecipeInput', `Recipe ${blockName} references an unknown palette`)
  }

  if (!isPatternName(pattern)) {
    return failure('InvalidRecipeInput', `Recipe ${blockName} has an unknown pattern`)
  }
  if (!isAlphaMode(alpha)) {
    return failure('InvalidRecipeInput', `Recipe ${blockName} has an unknown alpha mode`)
  }

  const faces = parseFacePatterns(blockName, rawFaces)
  if (faces._tag === 'Failure') {
    return faces
  }
  const variants = parseVariants(blockName, rawVariants)
  if (variants._tag === 'Failure') {
    return variants
  }
  const animation = parseAnimation(blockName, rawAnimation)
  if (animation._tag === 'Failure') {
    return animation
  }

  return success({
    palette,
    pattern,
    alpha,
    faces: faces.value,
    ...(variants.value === undefined ? {} : { variants: variants.value }),
    ...(animation.value === undefined ? {} : { animation: animation.value }),
  })
}

const normalizeRecipeFiles = (input: unknown): TextureGeneratorResult<Readonly<Record<string, ResolvedRecipe>>> => {
  if (!Array.isArray(input)) {
    return failure('InvalidRecipeInput', 'Recipe input must be an array of group files')
  }

  const expectedNames = BLOCK_TYPES.filter((blockName) => blockName !== 'air')
  const recipes: Record<string, ResolvedRecipe> = {}
  const groups = new Set<string>()

  for (const rawFile of input) {
    const group = isRecord(rawFile) ? rawFile['group'] : undefined
    if (
      !isRecord(rawFile) ||
      !hasOnlyKeys(rawFile, ['group', 'palettes', 'recipes']) ||
      !isRecipeGroup(group)
    ) {
      return failure('InvalidRecipeInput', 'Each recipe file must name a supported group')
    }
    if (groups.has(group)) {
      return failure('InvalidRecipeInput', `Duplicate recipe group ${group}`)
    }
    groups.add(group)
    const rawPalettes = rawFile['palettes']
    const rawRecipes = rawFile['recipes']
    if (!isRecord(rawPalettes) || !isRecord(rawRecipes)) {
      return failure('InvalidRecipeInput', `Recipe group ${group} needs palette and recipe objects`)
    }

    const palettes: Record<string, Palette> = {}
    for (const [paletteName, rawPalette] of Object.entries(rawPalettes)) {
      if (!isPalette(rawPalette)) {
        return failure('InvalidRecipeInput', `Palette ${group}.${paletteName} needs five hex swatches`)
      }
      palettes[paletteName] = {
        shade: rawPalette.shade,
        shadow: rawPalette.shadow,
        base: rawPalette.base,
        light: rawPalette.light,
        accent: rawPalette.accent,
      }
    }

    for (const [blockName, rawRecipe] of Object.entries(rawRecipes)) {
      if (blockName === 'air' || !expectedNames.includes(blockName as (typeof expectedNames)[number])) {
        return failure('InvalidRecipeInput', `Recipe name ${blockName} is not a non-air kernel block`)
      }
      if (recipes[blockName] !== undefined) {
        return failure('InvalidRecipeInput', `Duplicate block recipe ${blockName}`)
      }
      const parsed = parseRecipe(blockName, rawRecipe, palettes)
      if (parsed._tag === 'Failure') {
        return parsed
      }
      recipes[blockName] = parsed.value
    }
  }

  for (const group of RECIPE_GROUPS) {
    if (!groups.has(group)) {
      return failure('InvalidRecipeInput', `Missing recipe group ${group}`)
    }
  }
  const missing = expectedNames.filter((blockName) => recipes[blockName] === undefined)
  if (missing.length > 0) {
    return failure('InvalidRecipeInput', `Missing block recipes: ${missing.join(', ')}`)
  }

  return success(recipes)
}

export const atlasTileOrigin = (tileIndex: number): TextureGeneratorResult<Readonly<{ x: number; y: number }>> => {
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= ATLAS_LAYOUT.capacity) {
    return failure('InvalidTileIndex', `Tile index must be between 0 and ${ATLAS_LAYOUT.capacity - 1}`)
  }
  return success({
    x: (tileIndex % ATLAS_LAYOUT.columns) * ATLAS_LAYOUT.cellPixels,
    y: Math.floor(tileIndex / ATLAS_LAYOUT.columns) * ATLAS_LAYOUT.cellPixels,
  })
}

export const mipLevelDimensions = (
  level: number,
): TextureGeneratorResult<Readonly<{ width: number; height: number }>> => {
  if (!Number.isInteger(level) || level < 0 || level >= ATLAS_LAYOUT.mipLevels) {
    return failure('InvalidMipLevel', `Mip level must be between 0 and ${ATLAS_LAYOUT.mipLevels - 1}`)
  }
  let width: number = ATLAS_LAYOUT.width
  let height: number = ATLAS_LAYOUT.height
  for (let index = 0; index < level; index += 1) {
    width = Math.max(1, Math.floor(width / 2))
    height = Math.max(1, Math.floor(height / 2))
  }
  return success({ width, height })
}

const hashSeed = (value: string): number => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const createRandom = (initialSeed: number): (() => number) => {
  let seed = initialSeed
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let value = seed
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const parseColor = (hex: string): Readonly<{ red: number; green: number; blue: number }> => ({
  red: Number.parseInt(hex.slice(1, 3), 16),
  green: Number.parseInt(hex.slice(3, 5), 16),
  blue: Number.parseInt(hex.slice(5, 7), 16),
})

type GrowthStage = Readonly<{ stage: number; count: number }>

type DrawingContext = Readonly<{
  pixels: Uint8Array
  recipe: ResolvedRecipe
  face: FaceRole
  random: () => number
  growthStage: GrowthStage | undefined
  frame: number | undefined
  defaultAlpha: number
  set: (x: number, y: number, color: number, alpha?: number) => void
  fill: (color: number, alpha?: number) => void
  rect: (x: number, y: number, width: number, height: number, color: number, alpha?: number) => void
  line: (x1: number, y1: number, x2: number, y2: number, color: number, alpha?: number) => void
}>

type PatternRenderer = (context: DrawingContext) => void

const faceSwatchIndex = (face: FaceRole, index: number): number => {
  if (face === 'top') {
    return index <= 1 ? 2 : index === 2 ? 3 : 4
  }
  if (face === 'side') {
    return index === 0 ? 1 : index === 1 ? 2 : index === 2 ? 2 : index === 3 ? 3 : 4
  }
  return index <= 1 ? 0 : index <= 3 ? 1 : 2
}

const pixelAlphaForMode = (mode: AlphaMode, requested: number | undefined, defaultAlpha: number): number => {
  const alpha = requested ?? (mode === 'cutout' ? 255 : defaultAlpha)
  if (mode === 'opaque') {
    return 255
  }
  if (mode === 'cutout') {
    return alpha === 0 ? 0 : 255
  }
  return alpha
}

const createDrawingContext = (
  recipe: ResolvedRecipe,
  face: FaceRole,
  seedText: string,
  growthStage: GrowthStage | undefined,
  frame: number | undefined,
): DrawingContext => {
  const pixels = new Uint8Array(ART_PIXELS * CHANNELS)
  const colors = SWATCHES.map((swatch) => parseColor(recipe.palette[swatch]))
  const random = createRandom(hashSeed(seedText))
  const defaultAlpha = recipe.alpha === 'opaque' ? 255 : recipe.alpha === 'translucent' ? 152 : 0
  const set = (x: number, y: number, requestedColor: number, alpha?: number): void => {
    if (x < 0 || x >= 16 || y < 0 || y >= 16) {
      return
    }
    const color = colors[faceSwatchIndex(face, requestedColor)]
    if (color === undefined) {
      return
    }
    const offset = (y * 16 + x) * CHANNELS
    pixels[offset] = color.red
    pixels[offset + 1] = color.green
    pixels[offset + 2] = color.blue
    pixels[offset + 3] = pixelAlphaForMode(recipe.alpha, alpha, defaultAlpha)
  }
  const fill = (color: number, alpha?: number): void => {
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        set(x, y, color, alpha)
      }
    }
  }
  const rect = (x: number, y: number, width: number, height: number, color: number, alpha?: number): void => {
    for (let row = y; row < y + height; row += 1) {
      for (let column = x; column < x + width; column += 1) {
        set(column, row, color, alpha)
      }
    }
  }
  const line = (x1: number, y1: number, x2: number, y2: number, color: number, alpha?: number): void => {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1)
    for (let step = 0; step <= steps; step += 1) {
      const x = Math.round(x1 + ((x2 - x1) * step) / steps)
      const y = Math.round(y1 + ((y2 - y1) * step) / steps)
      set(x, y, color, alpha)
    }
  }
  return { pixels, recipe, face, random, growthStage, frame, defaultAlpha, set, fill, rect, line }
}

const growthProgress = (growthStage: GrowthStage | undefined): number =>
  growthStage === undefined ? 1 : growthStage.stage / (growthStage.count - 1)

const renderCluster: PatternRenderer = (context) => {
  const { growthStage, random, set } = context
  const progress = growthProgress(growthStage)
  const count = growthStage === undefined ? 4 + Math.floor(random() * 4) : 1 + Math.floor(progress * 5)
  for (let index = 0; index < count; index += 1) {
    const centerX = growthStage === undefined
      ? 2 + Math.floor(random() * 12)
      : 8 + Math.round(((index % 3) - 1) * progress * 3)
    const centerY = growthStage === undefined
      ? 2 + Math.floor(random() * 12)
      : 14 - Math.round(progress * 8) - (index % 3) * Math.floor(progress * 2)
    const radiusX = growthStage === undefined ? 1 + Math.floor(random() * 2) : 1 + Math.floor(progress * 1.2)
    const radiusY = growthStage === undefined ? 1 + Math.floor(random() * 2) : 1 + Math.floor(progress * 1.2)
    const color = index % 3 === 0 ? 3 : index % 3 === 1 ? 1 : 4
    for (let y = centerY - radiusY; y <= centerY + radiusY; y += 1) {
      for (let x = centerX - radiusX; x <= centerX + radiusX; x += 1) {
        if (Math.abs(x - centerX) + Math.abs(y - centerY) <= radiusX + radiusY) {
          set(x, y, color)
        }
      }
    }
  }
}

const renderStrata: PatternRenderer = ({ random, set }) => {
  for (let y = 2; y < 16; y += 4) {
    const offset = Math.floor(random() * 4)
    for (let x = 0; x < 16; x += 1) {
      if ((x + offset) % 7 !== 0) {
        set(x, y, y % 8 === 2 ? 3 : 1)
      }
      if ((x + offset) % 9 === 0 && y + 1 < 16) {
        set(x, y + 1, 0)
      }
    }
  }
}

const renderSoil: PatternRenderer = ({ random, set }) => {
  for (let index = 0; index < 22; index += 1) {
    const x = Math.floor(random() * 16)
    const y = Math.floor(random() * 16)
    set(x, y, index % 5 === 0 ? 4 : index % 2 === 0 ? 1 : 3)
    if (index % 4 === 0) {
      set(x + 1, y, 1)
    }
  }
}

const renderGrassTop: PatternRenderer = ({ fill, random, rect }) => {
  fill(3)
  for (let index = 0; index < 12; index += 1) {
    const x = Math.floor(random() * 16)
    const y = Math.floor(random() * 16)
    rect(x, y, 1 + Math.floor(random() * 2), 1, index % 3 === 0 ? 4 : 2)
  }
}

const renderGrassEdge: PatternRenderer = ({ random, set }) => {
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const grassDepth = 3 + ((x * 5 + Math.floor(random() * 4)) % 3)
      set(x, y, y < grassDepth ? (y === grassDepth - 1 ? 3 : 2) : 1)
    }
  }
  for (let index = 0; index < 10; index += 1) {
    const x = Math.floor(random() * 16)
    const y = 5 + Math.floor(random() * 10)
    set(x, y, index % 2 === 0 ? 3 : 4)
  }
}

const renderWoodGrain: PatternRenderer = ({ random, set, line }) => {
  for (let y = 1; y < 16; y += 4) {
    const offset = Math.floor(random() * 4)
    line(0, y, 15, y, 1)
    for (let x = offset; x < 16; x += 5) {
      if (x < 15) {
        line(x, y + 1, x, Math.min(y + 3, 15), 3)
      }
    }
  }
  if (random() > 0.35) {
    const x = 4 + Math.floor(random() * 8)
    const y = 4 + Math.floor(random() * 8)
    set(x, y, 0)
    set(x + 1, y, 3)
    set(x, y + 1, 1)
  }
}

const renderWoodEnd: PatternRenderer = ({ set }) => {
  for (let radius = 7; radius >= 1; radius -= 2) {
    const color = radius % 4 === 3 ? 1 : radius % 4 === 1 ? 3 : 2
    for (let y = 1; y < 15; y += 1) {
      for (let x = 1; x < 15; x += 1) {
        if (Math.max(Math.abs(x - 8), Math.abs(y - 8)) === radius) {
          set(x, y, color)
        }
      }
    }
  }
  set(8, 8, 0)
  set(7, 8, 1)
  set(8, 7, 3)
}

const renderOreSpeckle: PatternRenderer = ({ random, rect, set }) => {
  for (let index = 0; index < 6; index += 1) {
    const x = 1 + Math.floor(random() * 13)
    const y = 1 + Math.floor(random() * 13)
    const width = 2 + Math.floor(random() * 2)
    rect(x, y, width, 1 + Math.floor(random() * 2), index % 3 === 0 ? 4 : 3)
    set(x, y, 4)
  }
  for (let index = 0; index < 12; index += 1) {
    set(Math.floor(random() * 16), Math.floor(random() * 16), 1)
  }
}

const renderFoliage: PatternRenderer = (context) => {
  const { growthStage, random, set, line } = context
  const offset = Math.floor(random() * 3)
  const progress = growthProgress(growthStage)
  const top = growthStage === undefined ? 1 : 15 - (4 + Math.round(progress * 10))
  for (let y = top; y < 15; y += 1) {
    const width = growthStage === undefined
      ? y < 4 || y > 11 ? 3 + Math.floor(random() * 3) : 5 + Math.floor(random() * 3)
      : Math.min(9, 3 + Math.round(progress * 5) + (y > top + 1 && y < 14 ? 1 : 0))
    const left = Math.floor((16 - width) / 2) + ((y + offset) % 3 === 0 ? 1 : 0)
    for (let x = left; x < left + width; x += 1) {
      if ((x * 3 + y * 5 + offset) % 7 !== 0) {
        set(x, y, (x + y) % 5 === 0 ? 4 : (x + y) % 3 === 0 ? 3 : 2)
      }
    }
  }
  const stemStart = growthStage === undefined ? 10 : top + Math.max(1, Math.floor((15 - top) * 0.55))
  line(7, stemStart, 8, 15, 1)
}

const renderFlower: PatternRenderer = ({ line, random, rect, set }) => {
  line(8, 7, 8, 15, 2)
  line(8, 12, 5, 10, 3)
  line(8, 13, 11, 11, 3)
  const petalColor = 3 + Math.floor(random() * 2)
  rect(6, 2, 3, 2, petalColor)
  rect(5, 4, 5, 2, petalColor)
  rect(6, 6, 3, 2, petalColor)
  set(7, 4, 1)
  set(8, 4, 1)
}

const renderStalk: PatternRenderer = (context) => {
  const { growthStage, random, set, line } = context
  const progress = growthProgress(growthStage)
  const top = Math.max(2, 14 - Math.round(progress * 11))
  line(8, top, 8, 15, 2)
  for (let y = top + 2; y < 15; y += 4) {
    const side = ((y + Math.floor(random() * 2)) % 2) === 0 ? -1 : 1
    line(8, y, 8 + side * 3, y - 2, 3)
    line(8 + side * 3, y - 2, 8 + side * 4, y - 1, 4)
  }
  if (progress > 0.7) {
    set(7, top, 4)
    set(8, top, 3)
    set(9, top, 4)
  }
}

type NoiseProfile = Readonly<{ shadow: number; base: number; light: number }>

const fillNoiseSurface = (
  { random, set }: DrawingContext,
  { shadow, base, light }: NoiseProfile,
): void => {
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const variation = random() + ((x * 7 + y * 11) % 5) * 0.012
      const color = variation < shadow
        ? 1
        : variation < base
          ? 2
          : variation < light
            ? 3
            : 4
      set(x, y, color)
    }
  }
}

const renderStoneMottle: PatternRenderer = (context) => {
  const { random, set } = context
  const patchColors = [1, 2, 3, 4, 2] as const
  const patchAnchors = [[2, 2], [13, 2], [2, 13], [13, 13], [8, 8]] as const
  const patchCenters = patchColors.map((color, index) => {
    const anchor = patchAnchors[index] ?? [8, 8]
    return {
      x: Math.max(0, Math.min(15, anchor[0] + Math.floor(random() * 3) - 1)),
      y: Math.max(0, Math.min(15, anchor[1] + Math.floor(random() * 3) - 1)),
    color,
    }
  })
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      let nearestDistance = Number.POSITIVE_INFINITY
      let patchColor = 2
      for (const center of patchCenters) {
        const distance = Math.abs(x - center.x) + Math.abs(y - center.y)
        if (distance < nearestDistance) {
          nearestDistance = distance
          patchColor = center.color
        }
      }
      set(x, y, patchColor)
    }
  }
  for (let grain = 0; grain < 24; grain += 1) {
    const x = Math.floor(random() * 16)
    const y = Math.floor(random() * 16)
    set(x, y, grain % 3 === 0 ? 0 : grain % 2 === 0 ? 3 : 1)
  }
}

const renderSoilGrain: PatternRenderer = (context) => {
  fillNoiseSurface(context, { shadow: 0.16, base: 0.66, light: 0.93 })
  const { random, rect } = context
  for (let index = 0; index < 20; index += 1) {
    const x = Math.floor(random() * 16)
    const y = Math.floor(random() * 16)
    rect(x, y, 1 + Math.floor(random() * 2), 1, index % 4 === 0 ? 4 : 1)
  }
}

const renderGrassCover: PatternRenderer = (context) => {
  fillNoiseSurface(context, { shadow: 0.08, base: 0.34, light: 0.78 })
  const { random, set } = context
  for (let index = 0; index < 30; index += 1) {
    const x = Math.floor(random() * 16)
    const y = Math.floor(random() * 16)
    set(x, y, index % 4 === 0 ? 4 : 3)
  }
}

const renderPlankGrain: PatternRenderer = (context) => {
  fillNoiseSurface(context, { shadow: 0.12, base: 0.56, light: 0.91 })
  const { random, line, set } = context
  for (let y = 0; y < 16; y += 5) {
    line(0, y, 15, y, 1)
    const knotX = 2 + Math.floor(random() * 12)
    const knotY = Math.min(y + 2, 15)
    set(knotX, knotY, 0)
    set(knotX + 1, knotY, 3)
    for (let x = 1; x < 15; x += 5) {
      if ((x + y) % 3 !== 0) {
        line(x, y + 1, x + 2, Math.min(y + 3, 15), 3)
      }
    }
  }
}

const renderBarkGrain: PatternRenderer = (context) => {
  fillNoiseSurface(context, { shadow: 0.2, base: 0.58, light: 0.91 })
  const { random, line, set } = context
  for (let x = 1; x < 16; x += 3) {
    const offset = Math.floor(random() * 3) - 1
    line(x, 0, Math.max(0, Math.min(15, x + offset)), 15, x % 2 === 0 ? 1 : 3)
  }
  const knotX = 5 + Math.floor(random() * 6)
  const knotY = 4 + Math.floor(random() * 8)
  set(knotX, knotY, 0)
  set(knotX + 1, knotY, 4)
  set(knotX, knotY + 1, 1)
}

const renderWoodRings: PatternRenderer = (context) => {
  if (context.face === 'side') {
    renderBarkGrain(context)
  } else {
    const { set } = context
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const distance = Math.hypot(x - 7.5, y - 7.5)
        const irregularity = ((x * 5 + y * 3) % 4) * 0.22
        const ring = Math.floor((distance + irregularity) / 1.8)
        set(x, y, ring % 3 === 0 ? 1 : ring % 3 === 1 ? 3 : 2)
      }
    }
    set(7, 7, 4)
    set(8, 8, 1)
  }
}

const renderOreVein: PatternRenderer = (context) => {
  renderStoneMottle(context)
  const { random, set } = context
  for (let cluster = 0; cluster < 5; cluster += 1) {
    const centerX = 2 + Math.floor(random() * 12)
    const centerY = 2 + Math.floor(random() * 12)
    const radius = 1 + Math.floor(random() * 2)
    for (let y = centerY - radius; y <= centerY + radius; y += 1) {
      for (let x = centerX - radius; x <= centerX + radius; x += 1) {
        const distance = Math.abs(x - centerX) + Math.abs(y - centerY)
        if (distance <= radius) {
          set(x, y, distance === radius ? 3 : 4)
        }
      }
    }
  }
}

const renderLeafCanopy: PatternRenderer = (context) => {
  const { recipe, random, set } = context
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const hole = (x * 7 + y * 11) % 17 === 0 || (x * 3 + y * 5) % 29 === 0
      if (!(recipe.alpha === 'cutout' && hole)) {
        const sample = random()
        set(x, y, sample < 0.12 ? 1 : sample < 0.58 ? 2 : sample < 0.91 ? 3 : 4)
      }
    }
  }
}

const renderSandGrain: PatternRenderer = (context) => {
  fillNoiseSurface(context, { shadow: 0.08, base: 0.63, light: 0.94 })
  const { set } = context
  for (let y = 1; y < 16; y += 4) {
    const offset = y % 3
    for (let x = offset; x < 16; x += 5) {
      set(x, y, 4)
      if (x + 1 < 16) {
        set(x + 1, y, 3)
      }
    }
  }
}

const renderGravelPebble: PatternRenderer = (context) => {
  fillNoiseSurface(context, { shadow: 0.18, base: 0.62, light: 0.9 })
  const { random, rect, line } = context
  for (let index = 0; index < 9; index += 1) {
    const x = 1 + Math.floor(random() * 12)
    const y = 1 + Math.floor(random() * 12)
    const width = 2 + Math.floor(random() * 3)
    const height = 2 + Math.floor(random() * 3)
    const color = index % 3 === 0 ? 1 : index % 3 === 1 ? 3 : 4
    rect(x, y, width, height, color)
    line(x, y, x + width - 1, y, 4)
  }
}

const renderGlassPane: PatternRenderer = (context) => {
  const { recipe, fill, rect, line } = context
  const baseAlpha = recipe.alpha === 'translucent' ? 88 : recipe.alpha === 'cutout' ? 255 : undefined
  const edgeAlpha = recipe.alpha === 'translucent' ? 164 : undefined
  fill(2, baseAlpha)
  rect(0, 0, 16, 1, 1, edgeAlpha)
  rect(0, 15, 16, 1, 1, edgeAlpha)
  rect(0, 1, 1, 14, 1, edgeAlpha)
  rect(15, 1, 1, 14, 1, edgeAlpha)
  line(2, 13, 11, 4, 4, recipe.alpha === 'translucent' ? 220 : undefined)
  line(4, 14, 13, 5, 3, recipe.alpha === 'translucent' ? 176 : undefined)
  rect(2, 2, 2, 2, 4, recipe.alpha === 'translucent' ? 220 : undefined)
}

const renderWoolWeave: PatternRenderer = (context) => {
  fillNoiseSurface(context, { shadow: 0.1, base: 0.62, light: 0.93 })
  const { set } = context
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      if ((x + y) % 2 === 0 && x % 4 === 0) {
        set(x, y, 4)
      } else if ((x - y + 16) % 5 === 0) {
        set(x, y, 1)
      }
    }
  }
}

const renderMachinePanel: PatternRenderer = (context) => {
  fillNoiseSurface(context, { shadow: 0.16, base: 0.59, light: 0.89 })
  const { rect, line, set } = context
  rect(1, 1, 14, 14, 1)
  rect(2, 2, 12, 12, 2)
  line(2, 3, 13, 3, 3)
  line(2, 12, 13, 12, 1)
  rect(4, 5, 2, 4, 1)
  rect(7, 5, 5, 4, 3)
  line(7, 10, 12, 10, 4)
  set(2, 2, 4)
  set(13, 2, 4)
  set(2, 13, 1)
  set(13, 13, 1)
}

const renderFurnace: PatternRenderer = (context) => {
  renderStoneMottle(context)
  const { face, rect, line, set } = context
  if (face === 'side') {
    rect(1, 1, 14, 14, 1)
    rect(3, 3, 10, 9, 0)
    rect(4, 4, 8, 6, 2)
    rect(5, 6, 6, 3, 4)
    rect(6, 7, 4, 2, 3)
    line(2, 13, 13, 13, 3)
  } else {
    rect(2, 2, 12, 12, 1)
    rect(4, 4, 8, 8, 2)
    line(5, 6, 10, 6, 1)
    line(5, 9, 10, 9, 3)
    set(7, 7, 4)
    set(8, 8, 1)
  }
}

const renderCraftingTable: PatternRenderer = (context) => {
  renderPlankGrain(context)
  const { face, rect, line, set } = context
  if (face === 'top') {
    rect(1, 1, 6, 6, 3)
    rect(9, 1, 6, 6, 2)
    rect(1, 9, 6, 6, 2)
    rect(9, 9, 6, 6, 3)
    line(7, 1, 7, 14, 1)
    line(1, 8, 14, 8, 1)
    set(7, 7, 4)
    set(8, 8, 4)
  } else {
    rect(2, 2, 12, 4, 1)
    rect(3, 3, 10, 2, 4)
    line(2, 9, 13, 9, 1)
    line(2, 12, 13, 12, 3)
  }
}

const renderChest: PatternRenderer = (context) => {
  renderPlankGrain(context)
  const { face, rect, line, set } = context
  if (face === 'top') {
    rect(1, 1, 14, 14, 2)
    line(1, 7, 14, 7, 1)
    line(2, 8, 13, 8, 3)
    rect(6, 6, 4, 3, 4)
    set(7, 7, 0)
    line(3, 3, 12, 3, 3)
  } else {
    rect(1, 1, 14, 14, 1)
    rect(2, 2, 12, 12, 2)
    line(2, 4, 13, 4, 3)
    line(2, 12, 13, 12, 1)
    rect(7, 6, 3, 5, 4)
    set(8, 8, 0)
  }
}

const renderDispenser: PatternRenderer = (context) => {
  renderStoneMottle(context)
  const { face, rect, line } = context
  if (face === 'side') {
    rect(1, 1, 14, 14, 1)
    rect(2, 2, 12, 12, 2)
    rect(4, 4, 8, 8, 1)
    rect(5, 5, 6, 6, 0)
    rect(6, 6, 4, 4, 1)
    rect(7, 7, 2, 2, 0)
    line(5, 4, 10, 4, 4)
    line(5, 11, 10, 11, 1)
  } else {
    rect(2, 2, 12, 12, 1)
    rect(4, 4, 8, 8, 2)
    rect(6, 6, 4, 4, 0)
    line(6, 5, 9, 5, 4)
    line(6, 10, 9, 10, 1)
  }
}

const renderDropper: PatternRenderer = (context) => {
  renderStoneMottle(context)
  const { face, rect, line } = context
  if (face === 'side') {
    rect(1, 1, 14, 14, 1)
    rect(2, 2, 12, 12, 2)
    line(4, 3, 11, 3, 4)
    line(4, 4, 6, 7, 1)
    line(11, 4, 9, 7, 1)
    line(6, 7, 9, 7, 3)
    rect(6, 8, 4, 4, 0)
    line(5, 12, 10, 12, 4)
    line(5, 13, 10, 13, 1)
  } else {
    rect(2, 2, 12, 12, 1)
    rect(4, 4, 8, 8, 2)
    rect(5, 5, 6, 6, 0)
    line(6, 5, 9, 5, 4)
    line(6, 10, 9, 10, 1)
  }
}

const renderRail: PatternRenderer = (context) => {
  fillNoiseSurface(context, { shadow: 0.13, base: 0.61, light: 0.92 })
  const { face, line, rect } = context
  if (face === 'top') {
    rect(2, 0, 2, 16, 1)
    rect(3, 0, 1, 16, 4)
    rect(12, 0, 2, 16, 1)
    rect(12, 0, 1, 16, 3)
    for (let y = 2; y < 16; y += 4) {
      line(1, y, 14, y, 2)
      line(1, y + 1, 14, y + 1, 1)
    }
  } else {
    line(0, 4, 15, 4, 1)
    line(0, 5, 15, 5, 4)
    line(0, 11, 15, 11, 1)
    line(0, 12, 15, 12, 4)
    for (let x = 2; x < 16; x += 5) {
      rect(x, 3, 1, 11, 2)
    }
  }
}

const renderPoweredRail: PatternRenderer = (context) => {
  renderRail(context)
  const { face, line, rect } = context
  if (face === 'top') {
    line(7, 0, 7, 15, 4)
    line(8, 0, 8, 15, 3)
    for (let y = 3; y < 16; y += 4) {
      rect(5, y, 6, 1, 1)
    }
  } else {
    line(0, 7, 15, 7, 4)
    line(0, 8, 15, 8, 3)
  }
}

const renderPressurePlate: PatternRenderer = (context) => {
  fillNoiseSurface(context, { shadow: 0.14, base: 0.61, light: 0.92 })
  const { face, rect, line } = context
  if (face === 'top') {
    rect(1, 5, 14, 6, 1)
    rect(2, 5, 12, 4, 3)
    line(2, 9, 13, 9, 4)
    line(1, 11, 14, 11, 1)
  } else {
    rect(1, 6, 14, 4, 1)
    line(2, 6, 13, 6, 4)
    line(2, 9, 13, 9, 1)
    rect(3, 4, 2, 2, 3)
    rect(11, 4, 2, 2, 3)
  }
}

const renderLever: PatternRenderer = (context) => {
  fillNoiseSurface(context, { shadow: 0.16, base: 0.6, light: 0.9 })
  const { face, rect, line, set } = context
  rect(3, 10, 10, 4, 1)
  rect(4, 9, 8, 3, 2)
  line(5, 10, 10, 4, 1)
  line(6, 10, 11, 4, 4)
  rect(9, 2, 4, 4, 1)
  rect(10, 2, 3, 3, 4)
  set(face === 'top' ? 4 : 3, 13, 3)
}

const renderObserver: PatternRenderer = (context) => {
  fillNoiseSurface(context, { shadow: 0.16, base: 0.59, light: 0.9 })
  const { face, rect, line, set } = context
  rect(1, 2, 14, 12, 1)
  rect(2, 3, 12, 10, 2)
  if (face === 'side') {
    rect(2, 6, 12, 4, 0)
    line(3, 5, 12, 5, 4)
    line(3, 10, 12, 10, 1)
    set(7, 7, 3)
    set(8, 8, 3)
  } else {
    line(3, 5, 12, 5, 1)
    line(3, 8, 12, 8, 3)
    line(3, 11, 12, 11, 1)
    rect(6, 6, 4, 4, 4)
  }
}

const renderRepeater: PatternRenderer = (context) => {
  fillNoiseSurface(context, { shadow: 0.2, base: 0.58, light: 0.88 })
  const { face, rect, line, set } = context
  rect(1, 3, 14, 10, 1)
  rect(2, 4, 12, 8, 2)
  if (face === 'top') {
    line(3, 8, 12, 8, 1)
    rect(4, 6, 2, 4, 4)
    rect(10, 6, 2, 4, 3)
    set(4, 5, 4)
    set(11, 5, 3)
  } else {
    line(2, 6, 13, 6, 4)
    line(2, 10, 13, 10, 1)
    rect(5, 5, 2, 3, 3)
    rect(9, 7, 2, 3, 4)
  }
}

const renderComparator: PatternRenderer = (context) => {
  fillNoiseSurface(context, { shadow: 0.2, base: 0.58, light: 0.88 })
  const { face, rect, line, set } = context
  rect(1, 3, 14, 10, 1)
  rect(2, 4, 12, 8, 2)
  if (face === 'top') {
    line(3, 9, 12, 9, 1)
    rect(4, 5, 2, 2, 4)
    rect(7, 5, 2, 2, 3)
    rect(10, 5, 2, 2, 4)
    line(5, 8, 8, 10, 3)
    line(10, 8, 8, 10, 3)
  } else {
    line(2, 6, 13, 6, 1)
    line(2, 10, 13, 10, 1)
    set(4, 8, 4)
    set(8, 8, 3)
    set(12, 8, 4)
  }
}

const renderFurrow: PatternRenderer = (context) => {
  fillNoiseSurface(context, { shadow: 0.2, base: 0.68, light: 0.94 })
  const { random, line, set } = context
  for (let y = 2; y < 16; y += 4) {
    const offset = Math.floor(random() * 3) - 1
    const grooveY = y + offset
    line(0, grooveY, 15, grooveY, 1)
    line(0, Math.max(0, grooveY - 1), 15, Math.max(0, grooveY - 1), 3)
    for (let x = 1; x < 16; x += 4) {
      if (random() > 0.35) {
        set(x, grooveY + 1, 4)
      }
    }
  }
}

const renderRedstoneWire: PatternRenderer = ({ face, line, set }) => {
  if (face === 'top') {
    line(0, 7, 15, 7, 3)
    line(0, 8, 15, 8, 2)
    line(4, 7, 4, 3, 3)
    line(4, 3, 10, 3, 3)
    line(10, 3, 10, 7, 3)
    set(1, 6, 4)
    set(14, 9, 4)
  } else if (face === 'side') {
    line(0, 7, 15, 7, 3)
    line(0, 8, 15, 8, 2)
    for (let x = 2; x < 16; x += 4) {
      set(x, 6, 4)
    }
  } else {
    line(0, 6, 15, 6, 2)
    line(0, 7, 15, 7, 3)
    line(7, 0, 7, 15, 3)
  }
}

const renderRedstoneTorch: PatternRenderer = ({ face, rect, line, set }) => {
  if (face === 'side') {
    rect(7, 6, 2, 10, 1)
    line(6, 8, 9, 8, 2)
    rect(6, 3, 4, 3, 3)
    set(7, 2, 4)
    set(8, 2, 4)
    line(6, 4, 9, 4, 4)
  } else if (face === 'top') {
    rect(5, 5, 6, 6, 1)
    rect(6, 6, 4, 4, 3)
    rect(7, 7, 2, 2, 4)
  } else {
    rect(6, 5, 4, 7, 1)
    line(5, 12, 10, 12, 2)
    set(7, 4, 3)
    set(8, 4, 3)
  }
}

const renderPortalFrame: PatternRenderer = (context) => {
  const { face, fill, rect, line, set } = context
  fillNoiseSurface(context, { shadow: 0.18, base: 0.58, light: 0.9 })
  if (face === 'top') {
    rect(1, 1, 14, 14, 1)
    rect(2, 2, 12, 12, 3)
    rect(4, 4, 8, 8, 1)
    rect(5, 5, 6, 6, 0)
    line(3, 3, 12, 3, 4)
    line(3, 12, 12, 12, 2)
    set(2, 7, 4)
    set(13, 8, 4)
  } else {
    fill(2)
    line(0, 2, 15, 2, 3)
    line(0, 13, 15, 13, 1)
    line(3, 3, 12, 3, 4)
  }
}

const renderPortalFrameFilled: PatternRenderer = (context) => {
  renderPortalFrame(context)
  if (context.face === 'top') {
    const { rect, line, set } = context
    rect(6, 6, 4, 4, 2)
    rect(7, 6, 2, 4, 3)
    line(6, 7, 9, 7, 4)
    set(7, 8, 4)
    set(8, 8, 1)
  }
}

const renderDoor: PatternRenderer = (context) => {
  renderPlankGrain(context)
  const { rect, line, set } = context
  rect(1, 0, 2, 16, 1)
  rect(13, 0, 2, 16, 1)
  rect(3, 1, 10, 2, 3)
  rect(3, 13, 10, 2, 1)
  rect(4, 4, 8, 7, 2)
  line(4, 4, 11, 4, 4)
  line(4, 10, 11, 10, 1)
  for (let y = 3; y < 14; y += 5) {
    set(2, y, 4)
    set(3, y, 1)
  }
  set(11, 8, 4)
  set(12, 8, 0)
}

const renderDoorOpen: PatternRenderer = (context) => {
  renderPlankGrain(context)
  const { rect, line, set } = context
  rect(0, 0, 3, 16, 1)
  rect(4, 1, 2, 14, 3)
  line(5, 1, 12, 3, 4)
  line(5, 14, 12, 12, 1)
  line(6, 3, 12, 4, 3)
  line(6, 12, 12, 11, 1)
  for (let y = 4; y < 12; y += 1) {
    const edge = 6 + Math.floor((y - 4) / 2)
    line(edge, y, 13, y, y % 2 === 0 ? 2 : 3)
  }
  set(4, 4, 4)
  set(4, 12, 4)
}

const renderCauldronTop = (context: DrawingContext, filledWithWater: boolean): void => {
  const { fill, rect, line, set } = context
  fill(2)
  rect(1, 1, 14, 14, 1)
  rect(2, 2, 12, 12, 3)
  rect(3, 3, 10, 10, 0)
  rect(4, 4, 8, 8, 1)
  line(2, 2, 13, 2, 4)
  line(2, 13, 13, 13, 1)
  if (filledWithWater) {
    rect(4, 5, 8, 6, 2)
    line(5, 6, 10, 6, 4)
    line(7, 9, 11, 9, 3)
    set(4, 8, 4)
  }
}

const renderCauldron: PatternRenderer = (context) => {
  renderCauldronTop(context, false)
}

const renderWaterCauldron: PatternRenderer = (context) => {
  renderCauldronTop(context, true)
}

const renderTntWrap: PatternRenderer = (context) => {
  const { face, random, rect, set, line } = context
  fillNoiseSurface(context, { shadow: 0.1, base: 0.62, light: 0.9 })
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      if (random() > 0.35) {
        set(x, y, random() > 0.72 ? 3 : 2)
      }
    }
  }
  rect(0, 3, 16, 3, 4)
  rect(0, 10, 16, 3, 0)
  for (let x = 0; x < 16; x += 2) {
    set(x, 4, 0)
    set(x + 1, 5, 1)
    set(x, 11, 4)
    set(x + 1, 12, 1)
  }
  line(0, 2, 15, 2, 3)
  line(0, 13, 15, 13, 1)
  if (face === 'top') {
    line(11, 2, 13, 0, 4)
    set(14, 1, 4)
    set(15, 2, 3)
  }
}

const renderBrewingStand: PatternRenderer = ({ face, rect, line, set }) => {
  if (face === 'side') {
    rect(7, 2, 2, 10, 2)
    line(5, 4, 10, 4, 3)
    line(4, 5, 11, 5, 4)
    line(5, 6, 10, 6, 2)
    rect(6, 11, 4, 2, 1)
    line(3, 13, 12, 13, 3)
    line(1, 15, 14, 15, 1)
    set(7, 1, 4)
    set(8, 1, 4)
  } else if (face === 'top') {
    rect(6, 6, 4, 6, 2)
    line(7, 1, 8, 6, 3)
    line(2, 3, 6, 7, 4)
    line(13, 3, 9, 7, 4)
    rect(1, 1, 3, 2, 1)
    rect(12, 1, 3, 2, 1)
    set(7, 9, 4)
    set(8, 9, 4)
  } else {
    line(7, 2, 8, 11, 2)
    rect(5, 11, 6, 2, 1)
    line(2, 14, 13, 14, 3)
    set(6, 13, 4)
    set(9, 13, 4)
  }
}

const renderBrick: PatternRenderer = ({ line }) => {
  for (let y = 0; y < 16; y += 4) {
    line(0, y, 15, y, 1)
    const offset = y % 8 === 0 ? 0 : 4
    for (let x = offset; x < 16; x += 8) {
      if (x > 0) {
        line(x, y, x, Math.min(y + 3, 15), 1)
      }
      line(x + 1, y + 1, Math.min(x + 6, 15), y + 1, 3)
    }
  }
}

const renderRipple: PatternRenderer = ({ frame, random, set }) => {
  for (let y = 1; y < 16; y += 4) {
    const start = Math.floor(random() * 5)
    for (let x = start; x < 16; x += 1) {
      if ((x + y + (frame ?? 0) * 2) % 8 < 5) {
        set(x, y, x % 4 === 0 ? 4 : 3, 198)
      }
    }
  }
  for (let x = 2 + ((frame ?? 0) % 4); x < 16; x += 6) {
    set(x, 7, 4, 210)
  }
}

const renderFlow: PatternRenderer = ({ frame, set }) => {
  for (let y = 0; y < 16; y += 1) {
    const shift = (y * 3 + (frame ?? 0) * 2) % 7
    for (let x = 0; x < 16; x += 1) {
      if ((x + shift) % 7 < 2) {
        set(x, y, (y + x) % 4 === 0 ? 4 : 3, 188)
      }
    }
  }
}

const renderFlame: PatternRenderer = ({ frame, random, set }) => {
  const flicker = frame ?? Math.floor(random() * 4)
  for (let y = 2; y < 16; y += 1) {
    const width = Math.min(7, Math.floor((y - 1) / 2) + 1)
    const center = 8 + ((y + flicker) % 3) - 1
    for (let x = center - width; x <= center + width; x += 1) {
      if ((x + y + flicker) % 6 !== 0) {
        set(x, y, y < 7 ? 4 : y < 11 ? 3 : 2)
      }
    }
  }
}

const renderPortal: PatternRenderer = ({ frame, recipe, defaultAlpha, fill, set }) => {
  fill(0, recipe.alpha === 'translucent' ? 118 : defaultAlpha)
  for (let y = 1; y < 15; y += 1) {
    for (let x = 1; x < 15; x += 1) {
      const swirl = (x * 3 + y * 5 + (frame ?? 0) * 4) % 11
      if (swirl < 3 || (x + y + (frame ?? 0)) % 9 === 0) {
        set(x, y, swirl === 0 ? 4 : 3, 210)
      }
    }
  }
}

const renderGem: PatternRenderer = ({ set }) => {
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const facet = Math.floor((x + y * 2) / 4) % 4
      const color = facet === 0 ? 4 : facet === 1 ? 3 : facet === 2 ? 2 : 1
      set(x, y, color)
    }
  }
  for (let x = 0; x < 16; x += 4) {
    for (let y = 0; y < 16; y += 1) {
      set(x, y, 4)
      if (x + 1 < 16) {
        set(x + 1, y, 3)
      }
    }
  }
}

const renderCloth: PatternRenderer = ({ line, set }) => {
  for (let y = 1; y < 16; y += 3) {
    line(0, y, 15, y, 1)
  }
  for (let x = 2; x < 16; x += 4) {
    line(x, 0, x, 15, 3)
  }
  for (let y = 2; y < 16; y += 4) {
    for (let x = y % 2; x < 16; x += 5) {
      set(x, y, 4)
    }
  }
}

const renderGlass: PatternRenderer = renderGlassPane

const renderFlat: PatternRenderer = (context) => {
  fillNoiseSurface(context, { shadow: 0.13, base: 0.59, light: 0.9 })
}

const renderEndRod: PatternRenderer = ({ face, rect, line, set }) => {
  if (face === 'side') {
    rect(5, 0, 6, 16, 1)
    rect(6, 1, 4, 14, 2)
    rect(7, 2, 2, 12, 4)
    rect(4, 0, 8, 2, 4)
    rect(4, 14, 8, 2, 1)
    for (let y = 4; y < 13; y += 4) {
      line(6, y, 9, y, 3)
    }
  } else {
    for (let y = 2; y < 14; y += 1) {
      const halfWidth = y < 8 ? y - 1 : 13 - y
      for (let x = 8 - halfWidth; x <= 8 + halfWidth; x += 1) {
        const edge = x === 8 - halfWidth || x === 8 + halfWidth
        set(x, y, edge ? 1 : Math.abs(x - 8) + Math.abs(y - 8) < 4 ? 4 : 3)
      }
    }
    rect(7, 6, 3, 4, 4)
    line(5, 8, 10, 8, face === 'top' ? 2 : 0)
  }
}

const renderSkull: PatternRenderer = (context) => {
  const { face, rect, line, set } = context
  if (face === 'side') {
    fillNoiseSurface(context, { shadow: 0.19, base: 0.66, light: 0.93 })
    rect(2, 3, 4, 4, 0)
    rect(10, 3, 4, 4, 0)
    rect(3, 4, 2, 2, 1)
    rect(11, 4, 2, 2, 1)
    line(7, 6, 8, 10, 0)
    line(6, 10, 9, 10, 1)
    line(3, 9, 5, 12, 3)
    line(12, 9, 10, 12, 3)
    line(4, 13, 11, 13, 1)
    for (let x = 5; x < 12; x += 2) {
      set(x, 14, 4)
    }
  } else if (face === 'bottom') {
    rect(4, 4, 8, 8, 2)
    rect(5, 5, 6, 6, 1)
    rect(7, 7, 2, 3, 0)
    line(5, 12, 10, 12, 0)
  } else {
    for (let y = 2; y < 14; y += 1) {
      const halfWidth = y < 7 ? y + 1 : 7
      for (let x = 8 - halfWidth; x <= 8 + halfWidth; x += 1) {
        set(x, y, y < 5 ? 4 : 3)
      }
    }
    line(4, 7, 11, 7, 2)
    line(8, 4, 8, 11, 4)
  }
}

const PATTERN_RENDERERS: Readonly<Record<PatternName, PatternRenderer>> = {
  cluster: renderCluster,
  strata: renderStrata,
  soil: renderSoil,
  'grass-top': renderGrassTop,
  'grass-edge': renderGrassEdge,
  'wood-grain': renderWoodGrain,
  'wood-end': renderWoodEnd,
  'ore-speckle': renderOreSpeckle,
  foliage: renderFoliage,
  flower: renderFlower,
  stalk: renderStalk,
  'metal-panel': renderMachinePanel,
  brick: renderBrick,
  ripple: renderRipple,
  flow: renderFlow,
  flame: renderFlame,
  portal: renderPortal,
  gem: renderGem,
  cloth: renderCloth,
  glass: renderGlass,
  flat: renderFlat,
  'end-rod': renderEndRod,
  skull: renderSkull,
  'stone-mottle': renderStoneMottle,
  'soil-grain': renderSoilGrain,
  'grass-cover': renderGrassCover,
  'plank-grain': renderPlankGrain,
  'bark-grain': renderBarkGrain,
  'wood-rings': renderWoodRings,
  'ore-vein': renderOreVein,
  'leaf-canopy': renderLeafCanopy,
  'sand-grain': renderSandGrain,
  'gravel-pebble': renderGravelPebble,
  'glass-pane': renderGlassPane,
  'wool-weave': renderWoolWeave,
  'machine-panel': renderMachinePanel,
  furnace: renderFurnace,
  'crafting-table': renderCraftingTable,
  chest: renderChest,
  dispenser: renderDispenser,
  dropper: renderDropper,
  rail: renderRail,
  'powered-rail': renderPoweredRail,
  'pressure-plate': renderPressurePlate,
  lever: renderLever,
  observer: renderObserver,
  repeater: renderRepeater,
  comparator: renderComparator,
  furrow: renderFurrow,
  'redstone-wire': renderRedstoneWire,
  'redstone-torch': renderRedstoneTorch,
  'portal-frame': renderPortalFrame,
  'portal-frame-filled': renderPortalFrameFilled,
  door: renderDoor,
  'door-open': renderDoorOpen,
  cauldron: renderCauldron,
  'water-cauldron': renderWaterCauldron,
  'tnt-wrap': renderTntWrap,
  'brewing-stand': renderBrewingStand,
}

const drawTile = (
  recipe: ResolvedRecipe,
  pattern: PatternName,
  face: FaceRole,
  seedText: string,
  growthStage?: GrowthStage,
  frame?: number,
): Uint8Array => {
  const context = createDrawingContext(recipe, face, seedText, growthStage, frame)
  if (recipe.alpha === 'opaque') {
    context.fill(face === 'bottom' ? 1 : 2)
  }
  if (recipe.alpha === 'translucent') {
    context.fill(face === 'bottom' ? 1 : 2, 132)
  }
  PATTERN_RENDERERS[pattern](context)
  return context.pixels
}
const writeExtrudedTile = (atlas: Uint8Array, tileIndex: number, source: Uint8Array): void => {
  const origin = atlasTileOrigin(tileIndex)
  if (origin._tag === 'Failure') {
    return
  }
  for (let y = 0; y < ATLAS_LAYOUT.cellPixels; y += 1) {
    const sourceY = Math.min(15, Math.max(0, y - ATLAS_LAYOUT.gutterPixels))
    for (let x = 0; x < ATLAS_LAYOUT.cellPixels; x += 1) {
      const sourceX = Math.min(15, Math.max(0, x - ATLAS_LAYOUT.gutterPixels))
      const sourceOffset = (sourceY * 16 + sourceX) * CHANNELS
      const atlasOffset = ((origin.value.y + y) * ATLAS_LAYOUT.width + origin.value.x + x) * CHANNELS
      atlas.set(source.subarray(sourceOffset, sourceOffset + CHANNELS), atlasOffset)
    }
  }
}

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    const tableValue = CRC_TABLE[(crc ^ byte) & 0xff]
    if (tableValue !== undefined) {
      crc = tableValue ^ (crc >>> 8)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

const pngChunk = (type: string, data: Uint8Array): Buffer => {
  const typeBytes = Buffer.from(type, 'ascii')
  const chunk = Buffer.allocUnsafe(data.byteLength + 12)
  chunk.writeUInt32BE(data.byteLength, 0)
  typeBytes.copy(chunk, 4)
  Buffer.from(data).copy(chunk, 8)
  const crcInput = chunk.subarray(4, 8 + data.byteLength)
  chunk.writeUInt32BE(crc32(crcInput), 8 + data.byteLength)
  return chunk
}

const encodePng = (rgba: Uint8Array, width: number, height: number): Buffer => {
  const rowSize = width * CHANNELS
  const scanlines = Buffer.allocUnsafe((rowSize + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const targetOffset = y * (rowSize + 1)
    scanlines[targetOffset] = 0
    scanlines.set(rgba.subarray(y * rowSize, (y + 1) * rowSize), targetOffset + 1)
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const LABEL_SCALE = 2
const LABEL_GLYPH_WIDTH = 3
const LABEL_GLYPH_HEIGHT = 5
const LABEL_GLYPH_SPACING = 1
const DETAIL_CHECKER_SIZE = 8
const DETAIL_LABEL_BACKGROUND = [48, 55, 65] as const
const DETAIL_LABEL_FOREGROUND = [239, 242, 246] as const
const DETAIL_CHECKER_COLORS = [[211, 214, 219], [164, 170, 178]] as const
const DIGIT_GLYPHS: Readonly<Record<string, ReadonlyArray<number>>> = {
  '0': [7, 5, 5, 5, 7],
  '1': [2, 6, 2, 2, 7],
  '2': [7, 1, 7, 4, 7],
  '3': [7, 1, 7, 1, 7],
  '4': [5, 5, 7, 1, 1],
  '5': [7, 4, 7, 1, 7],
  '6': [7, 4, 7, 5, 7],
  '7': [7, 1, 2, 2, 2],
  '8': [7, 5, 7, 5, 7],
  '9': [7, 5, 7, 1, 7],
}

type DetailPreview = Readonly<{ rgba: Uint8Array; width: number; height: number }>

const writeRgb = (pixels: Uint8Array, width: number, x: number, y: number, color: ReadonlyArray<number>): void => {
  const offset = (y * width + x) * CHANNELS
  pixels[offset] = color[0] ?? 0
  pixels[offset + 1] = color[1] ?? 0
  pixels[offset + 2] = color[2] ?? 0
  pixels[offset + 3] = 255
}

const drawTileNumber = (pixels: Uint8Array, width: number, left: number, top: number, tileIndex: number): void => {
  const label = String(tileIndex).padStart(3, '0')
  const glyphPitch = (LABEL_GLYPH_WIDTH + LABEL_GLYPH_SPACING) * LABEL_SCALE
  const labelWidth = label.length * glyphPitch - LABEL_GLYPH_SPACING * LABEL_SCALE
  const startX = left + Math.floor((DETAIL_TILE_PIXELS - labelWidth) / 2)
  for (let digitIndex = 0; digitIndex < label.length; digitIndex += 1) {
    const digit = label[digitIndex]
    const glyph = digit === undefined ? undefined : DIGIT_GLYPHS[digit]
    if (glyph !== undefined) {
      for (let y = 0; y < LABEL_GLYPH_HEIGHT; y += 1) {
        const row = glyph[y]
        if (row !== undefined) {
          for (let x = 0; x < LABEL_GLYPH_WIDTH; x += 1) {
            if ((row & (1 << (LABEL_GLYPH_WIDTH - x - 1))) !== 0) {
              for (let scaleY = 0; scaleY < LABEL_SCALE; scaleY += 1) {
                for (let scaleX = 0; scaleX < LABEL_SCALE; scaleX += 1) {
                  writeRgb(
                    pixels,
                    width,
                    startX + digitIndex * glyphPitch + x * LABEL_SCALE + scaleX,
                    top + y * LABEL_SCALE + scaleY,
                    DETAIL_LABEL_FOREGROUND,
                  )
                }
              }
            }
          }
        }
      }
    }
  }
}

const createTextureDetailPreview = (rgba: Uint8Array, tileCount: number): DetailPreview => {
  const rows = Math.ceil(tileCount / DETAIL_COLUMNS)
  const height = rows * DETAIL_CELL_HEIGHT
  const pixels = new Uint8Array(DETAIL_WIDTH * height * CHANNELS)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < DETAIL_WIDTH; x += 1) {
      const checker = DETAIL_CHECKER_COLORS[
        (Math.floor(x / DETAIL_CHECKER_SIZE) + Math.floor(y / DETAIL_CHECKER_SIZE)) % DETAIL_CHECKER_COLORS.length
      ] ?? DETAIL_CHECKER_COLORS[0]
      writeRgb(pixels, DETAIL_WIDTH, x, y, checker)
    }
  }
  for (let tileIndex = 0; tileIndex < tileCount; tileIndex += 1) {
    const column = tileIndex % DETAIL_COLUMNS
    const row = Math.floor(tileIndex / DETAIL_COLUMNS)
    const left = column * DETAIL_TILE_PIXELS
    const top = row * DETAIL_CELL_HEIGHT
    const atlasX = (tileIndex % ATLAS_LAYOUT.columns) * ATLAS_LAYOUT.cellPixels + ATLAS_LAYOUT.gutterPixels
    const atlasY = Math.floor(tileIndex / ATLAS_LAYOUT.columns) * ATLAS_LAYOUT.cellPixels + ATLAS_LAYOUT.gutterPixels
    for (let y = 0; y < DETAIL_TILE_PIXELS; y += 1) {
      for (let x = 0; x < DETAIL_TILE_PIXELS; x += 1) {
        const sourceX = atlasX + Math.floor(x / DETAIL_SCALE)
        const sourceY = atlasY + Math.floor(y / DETAIL_SCALE)
        const sourceOffset = (sourceY * ATLAS_LAYOUT.width + sourceX) * CHANNELS
        const alpha = rgba[sourceOffset + 3] ?? 0
        const checker = DETAIL_CHECKER_COLORS[
          (Math.floor(x / DETAIL_CHECKER_SIZE) + Math.floor(y / DETAIL_CHECKER_SIZE)) % DETAIL_CHECKER_COLORS.length
        ] ?? DETAIL_CHECKER_COLORS[0]
        const blended = [0, 1, 2].map((channel) => {
          const source = rgba[sourceOffset + channel] ?? 0
          const background = checker[channel] ?? 0
          return Math.round((source * alpha + background * (255 - alpha)) / 255)
        })
        writeRgb(pixels, DETAIL_WIDTH, left + x, top + y, blended)
      }
    }
    for (let labelY = 0; labelY < DETAIL_LABEL_HEIGHT; labelY += 1) {
      for (let labelX = 0; labelX < DETAIL_TILE_PIXELS; labelX += 1) {
        writeRgb(
          pixels,
          DETAIL_WIDTH,
          left + labelX,
          top + DETAIL_TILE_PIXELS + labelY,
          DETAIL_LABEL_BACKGROUND,
        )
      }
    }
    drawTileNumber(pixels, DETAIL_WIDTH, left, top + DETAIL_TILE_PIXELS, tileIndex)
  }
  return { rgba: pixels, width: DETAIL_WIDTH, height }
}

const layoutManifest = (): TextureManifest['layout'] => ({ ...ATLAS_LAYOUT })

type TextureBuildState = {
  readonly rgba: Uint8Array
  readonly blockFaces: Record<string, Record<FaceRole, number>>
  readonly blockAlphaModes: Record<string, AlphaMode>
  readonly variants: Record<string, ReadonlyArray<number>>
  readonly animations: Record<string, Record<string, ReadonlyArray<number>>>
  nextTile: number
}

const requiredTileCount = (recipes: Readonly<Record<string, ResolvedRecipe>>): number => {
  const extraTiles = Object.values(recipes).reduce((total, recipe) => {
    const variants = recipe.variants === undefined ? 0 : recipe.variants - 1
    const frames = recipe.animation === undefined ? 0 : recipe.animation.frames
    return total + variants + frames
  }, 0)
  return 1 + (BLOCK_TYPES.length - 1) * FACE_ROLES.length + extraTiles
}

const createTextureBuildState = (): TextureBuildState => ({
  rgba: new Uint8Array(ATLAS_PIXELS * CHANNELS),
  blockFaces: { air: { top: 0, side: 0, bottom: 0 } },
  blockAlphaModes: { air: 'cutout' },
  variants: {},
  animations: {},
  nextTile: 1,
})

const drawBaseFaces = (
  state: TextureBuildState,
  recipes: Readonly<Record<string, ResolvedRecipe>>,
): TextureGeneratorResult<void> => {
  for (const blockName of BLOCK_TYPES) {
    if (blockName !== 'air') {
      const recipe = recipes[blockName]
      if (recipe === undefined) {
        return failure('InvalidRecipeInput', `Missing normalized recipe ${blockName}`)
      }
      const faces: Record<FaceRole, number> = { top: 0, side: 0, bottom: 0 }
      state.blockAlphaModes[blockName] = recipe.alpha
      for (const face of FACE_ROLES) {
        const tileIndex = state.nextTile
        state.nextTile += 1
        faces[face] = tileIndex
        const pattern = recipe.faces[face] ?? recipe.pattern
        const growthStage = face === 'top' && recipe.variants !== undefined
          ? { stage: 0, count: recipe.variants }
          : undefined
        writeExtrudedTile(
          state.rgba,
          tileIndex,
          drawTile(recipe, pattern, face, `${blockName}:${face}:base`, growthStage),
        )
      }
      state.blockFaces[blockName] = faces
    }
  }
  return success(undefined)
}

const drawCropVariants = (
  state: TextureBuildState,
  recipes: Readonly<Record<string, ResolvedRecipe>>,
): TextureGeneratorResult<void> => {
  for (const blockName of BLOCK_TYPES) {
    const recipe = recipes[blockName]
    if (blockName !== 'air' && recipe?.variants !== undefined) {
      const faces = state.blockFaces[blockName]
      if (faces === undefined) {
        return failure('InvalidRecipeInput', `Missing generated faces for ${blockName}`)
      }
      const stages = [faces.top]
      for (let stage = 1; stage < recipe.variants; stage += 1) {
        const tileIndex = state.nextTile
        state.nextTile += 1
        stages.push(tileIndex)
        const pattern = recipe.faces.top ?? recipe.pattern
        writeExtrudedTile(
          state.rgba,
          tileIndex,
          drawTile(recipe, pattern, 'top', `${blockName}:top:variant:${stage}`, {
            stage,
            count: recipe.variants,
          }),
        )
      }
      state.variants[blockName] = stages
    }
  }
  return success(undefined)
}

const drawAnimationFrames = (
  state: TextureBuildState,
  recipes: Readonly<Record<string, ResolvedRecipe>>,
): void => {
  for (const blockName of BLOCK_TYPES) {
    const recipe = recipes[blockName]
    if (blockName !== 'air' && recipe?.animation !== undefined) {
      const { group, frames } = recipe.animation
      const blockFrames: Array<number> = []
      for (let frame = 0; frame < frames; frame += 1) {
        const tileIndex = state.nextTile
        state.nextTile += 1
        blockFrames.push(tileIndex)
        const pattern = recipe.faces.top ?? recipe.pattern
        writeExtrudedTile(
          state.rgba,
          tileIndex,
          drawTile(recipe, pattern, 'top', `${blockName}:animation:${group}:${frame}`, undefined, frame),
        )
      }
      state.animations[group] ??= {}
      state.animations[group][blockName] = blockFrames
    }
  }
}

const orderedAnimations = (
  animations: Readonly<Record<string, Record<string, ReadonlyArray<number>>>>,
): Record<string, Record<string, ReadonlyArray<number>>> => {
  const sorted: Record<string, Record<string, ReadonlyArray<number>>> = {}
  for (const group of ANIMATION_GROUPS) {
    const blocks = animations[group]
    if (blocks !== undefined) {
      sorted[group] = blocks
    }
  }
  return sorted
}

const createTextureManifest = (state: TextureBuildState): TextureManifest => ({
  schemaVersion: 1,
  layout: layoutManifest(),
  tileCount: state.nextTile,
  blockFaces: state.blockFaces,
  blockAlphaModes: state.blockAlphaModes,
  variants: state.variants,
  animations: orderedAnimations(state.animations),
})

export const generateBlockTextureArtifacts = (input: unknown): TextureGeneratorResult<GeneratedTextureArtifacts> => {
  const normalized = normalizeRecipeFiles(input)
  if (normalized._tag === 'Failure') {
    return normalized
  }

  const tileCount = requiredTileCount(normalized.value)
  if (tileCount > ATLAS_LAYOUT.capacity) {
    return failure('AtlasCapacityExceeded', `Generation needs ${tileCount} tiles, capacity is ${ATLAS_LAYOUT.capacity}`)
  }

  const state = createTextureBuildState()
  const faceResult = drawBaseFaces(state, normalized.value)
  if (faceResult._tag === 'Failure') {
    return faceResult
  }
  const variantResult = drawCropVariants(state, normalized.value)
  if (variantResult._tag === 'Failure') {
    return variantResult
  }
  drawAnimationFrames(state, normalized.value)

  const manifestData = createTextureManifest(state)
  const detailPreview = createTextureDetailPreview(state.rgba, manifestData.tileCount)
  return success({
    png: encodePng(state.rgba, ATLAS_LAYOUT.width, ATLAS_LAYOUT.height),
    manifest: `${JSON.stringify(manifestData, null, 2)}\n`,
    manifestData,
    rgba: state.rgba,
    detailPng: encodePng(detailPreview.rgba, detailPreview.width, detailPreview.height),
    detailRgba: detailPreview.rgba,
    detailWidth: detailPreview.width,
    detailHeight: detailPreview.height,
  })
}
const readRecipeGroup = async (group: (typeof RECIPE_GROUPS)[number]): Promise<TextureGeneratorResult<unknown>> => {
  const path = resolve(RECIPE_DIRECTORY, `${group}.json`)
  try {
    const contents = await readFile(path, 'utf8')
    try {
      return success(JSON.parse(contents))
    } catch (error: unknown) {
      return failure('InvalidRecipeInput', `Recipe group ${group} is not valid JSON: ${String(error)}`)
    }
  } catch (error: unknown) {
    return failure('ArtifactReadError', `Unable to read recipe group ${group}: ${String(error)}`)
  }
}

const readRecipeInputs = async (): Promise<TextureGeneratorResult<ReadonlyArray<unknown>>> => {
  const results = await Promise.all(RECIPE_GROUPS.map((group) => readRecipeGroup(group)))
  const files: Array<unknown> = []
  for (const result of results) {
    if (result._tag === 'Failure') {
      return result
    }
    files.push(result.value)
  }
  return success(files)
}

export const loadAndGenerateBlockTextures = async (): Promise<TextureGeneratorResult<GeneratedTextureArtifacts>> => {
  const inputs = await readRecipeInputs()
  if (inputs._tag === 'Failure') {
    return inputs
  }
  return generateBlockTextureArtifacts(inputs.value)
}

const readExistingArtifacts = async (): Promise<
  TextureGeneratorResult<Readonly<{ png: Buffer; manifest: Buffer; detailPng: Buffer }>>
> => {
  try {
    const [png, manifest, detailPng] = await Promise.all([
      readFile(ATLAS_PATH),
      readFile(MANIFEST_PATH),
      readFile(DETAIL_PREVIEW_PATH),
    ])
    return success({ png, manifest, detailPng })
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
  const generated = await loadAndGenerateBlockTextures()
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
      !current.value.manifest.equals(Buffer.from(generated.value.manifest)) ||
      !current.value.detailPng.equals(generated.value.detailPng)
    ) {
      console.error('Block texture artifacts are stale. Run pnpm textures:generate.')
      return 1
    }
    console.log(`Verified ${generated.value.manifestData.tileCount} tiles in ${ATLAS_PATH}`)
    return 0
  }

  try {
    await mkdir(dirname(ATLAS_PATH), { recursive: true })
    await mkdir(dirname(DETAIL_PREVIEW_PATH), { recursive: true })
    await Promise.all([
      writeFile(ATLAS_PATH, generated.value.png),
      writeFile(MANIFEST_PATH, generated.value.manifest),
      writeFile(DETAIL_PREVIEW_PATH, generated.value.detailPng),
    ])
  } catch (error: unknown) {
    console.error(`ArtifactWriteError: ${String(error)}`)
    return 1
  }
  console.log(`Generated ${generated.value.manifestData.tileCount} tiles in ${ATLAS_PATH}`)
  return 0
}

const entrypoint = pathToFileURL(resolve(process.argv[1] ?? '')).href
if (import.meta.url === entrypoint) {
  process.exitCode = await runCli(process.argv.slice(2))
}
