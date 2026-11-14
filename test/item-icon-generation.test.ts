import { ITEM_TYPES } from '@nerima-games/mc-kernel'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  generateItemIconArtifacts,
  type GeneratedItemIconArtifacts,
  type ItemIconGeneratorResult,
} from '../scripts/generate-item-icons.js'
import {
  loadAndGenerateBlockTextures,
  type GeneratedTextureArtifacts,
  type TextureGeneratorResult,
} from '../scripts/generate-block-textures.js'
import {
  ATLAS_COLUMNS,
  ATLAS_PIXELS,
  TILE_CELL_PIXELS,
  TILE_GUTTER_PIXELS,
  TILE_PIXELS,
} from '../src/domain/texture-atlas.js'

let blockTextures: TextureGeneratorResult<GeneratedTextureArtifacts> | undefined = undefined

const CHANNELS = 4

beforeAll(async () => {
  blockTextures = await loadAndGenerateBlockTextures()
})

const generatedBlockTextures = (): GeneratedTextureArtifacts => {
  if (blockTextures === undefined || blockTextures._tag === 'Failure') {
    throw new Error(blockTextures?.error.message ?? 'Block texture artifacts were not generated')
  }
  return blockTextures.value
}

const generatedItemIcons = (
  result: ItemIconGeneratorResult<GeneratedItemIconArtifacts>,
): GeneratedItemIconArtifacts => {
  if (result._tag === 'Failure') {
    throw new Error(result.error.message)
  }
  return result.value
}

const iconPixels = (rgba: Uint8Array, tileIndex: number): ReadonlyArray<ReadonlyArray<number>> => {
  const left = (tileIndex % ATLAS_COLUMNS) * TILE_CELL_PIXELS + TILE_GUTTER_PIXELS
  const top = Math.floor(tileIndex / ATLAS_COLUMNS) * TILE_CELL_PIXELS + TILE_GUTTER_PIXELS
  const colors: Array<ReadonlyArray<number>> = []
  for (let y = 0; y < TILE_PIXELS; y += 1) {
    for (let x = 0; x < TILE_PIXELS; x += 1) {
      const offset = ((top + y) * ATLAS_PIXELS + left + x) * 4
      const color = Array.from(rgba.subarray(offset, offset + 4))
      if (color[3] !== undefined && color[3] > 0) {
        colors.push(color)
      }
    }
  }
  return colors
}

const MAX_NEAR_DUPLICATE_RMS_CHANNEL_DISTANCE = 6

const iconRaster = (rgba: Uint8Array, tileIndex: number): Uint8Array => {
  const left = (tileIndex % ATLAS_COLUMNS) * TILE_CELL_PIXELS + TILE_GUTTER_PIXELS
  const top = Math.floor(tileIndex / ATLAS_COLUMNS) * TILE_CELL_PIXELS + TILE_GUTTER_PIXELS
  const raster = new Uint8Array(TILE_PIXELS * TILE_PIXELS * CHANNELS)
  for (let y = 0; y < TILE_PIXELS; y += 1) {
    const sourceOffset = ((top + y) * ATLAS_PIXELS + left) * CHANNELS
    raster.set(rgba.subarray(sourceOffset, sourceOffset + TILE_PIXELS * CHANNELS), y * TILE_PIXELS * CHANNELS)
  }
  return raster
}

const rootMeanSquareCompositedChannelDistance = (left: Uint8Array, right: Uint8Array): number => {
  let maximumDistanceSquared = 0
  const pixelCount = left.length / CHANNELS
  for (let channel = 0; channel < 3; channel += 1) {
    let blackDistanceSquared = 0
    let whiteDistanceSquared = 0
    for (let pixelOffset = 0; pixelOffset < left.length; pixelOffset += CHANNELS) {
      const leftAlpha = left[pixelOffset + 3] ?? 0
      const rightAlpha = right[pixelOffset + 3] ?? 0
      const leftValue = left[pixelOffset + channel] ?? 0
      const rightValue = right[pixelOffset + channel] ?? 0
      const blackDifference = (leftValue * leftAlpha - rightValue * rightAlpha) / 255
      const whiteDifference = blackDifference + rightAlpha - leftAlpha
      blackDistanceSquared += blackDifference * blackDifference
      whiteDistanceSquared += whiteDifference * whiteDifference
    }
    maximumDistanceSquared += Math.max(blackDistanceSquared, whiteDistanceSquared)
  }
  return Math.sqrt(maximumDistanceSquared / (pixelCount * 3))
}

const areNearDuplicateItemIcons = (left: Uint8Array, right: Uint8Array): boolean =>
  rootMeanSquareCompositedChannelDistance(left, right) <= MAX_NEAR_DUPLICATE_RMS_CHANNEL_DISTANCE

describe('item icon generation', () => {
  it('produces identical atlas and manifest bytes for the same block texture input', () => {
    const blockSource = generatedBlockTextures()
    const first = generatedItemIcons(generateItemIconArtifacts(blockSource))
    const second = generatedItemIcons(generateItemIconArtifacts(blockSource))
    expect(first.png).toStrictEqual(second.png)
    expect(first.manifest).toBe(second.manifest)
  })

  it('assigns one visible icon tile to every item in kernel registry order', () => {
    const artifacts = generatedItemIcons(generateItemIconArtifacts(generatedBlockTextures()))
    expect(Object.keys(artifacts.manifestData.itemIcons)).toStrictEqual([...ITEM_TYPES])
    expect(artifacts.manifestData.tileCount).toBe(ITEM_TYPES.length)
    for (let index = 0; index < ITEM_TYPES.length; index += 1) {
      const itemId = ITEM_TYPES[index]
      if (itemId !== undefined) {
        expect(artifacts.manifestData.itemIcons[itemId]).toBe(index)
        expect(iconPixels(artifacts.rgba, index).length, `${itemId} has visible pixels`).toBeGreaterThan(0)
      }
    }
  })

  it('measures alpha-composited RGB changes across the full icon', () => {
    const transparentPixels = new Uint8Array(TILE_PIXELS * TILE_PIXELS * CHANNELS)
    const hiddenRgbDifferences = new Uint8Array(transparentPixels)
    for (let pixel = 0; pixel < 9; pixel += 1) {
      const offset = pixel * CHANNELS
      hiddenRgbDifferences.set([pixel + 1, pixel + 2, pixel + 3, 0], offset)
    }
    expect(rootMeanSquareCompositedChannelDistance(transparentPixels, hiddenRgbDifferences)).toBe(0)

    const opaqueGrayPixels = new Uint8Array(transparentPixels)
    opaqueGrayPixels.set([128, 128, 128, 255], 0)
    expect(rootMeanSquareCompositedChannelDistance(opaqueGrayPixels, transparentPixels)).toBeGreaterThan(0)

    const visiblePixels = new Uint8Array(transparentPixels)
    visiblePixels.set([24, 32, 40, 255], 0)
    const oneLevelVisibleColor = new Uint8Array(visiblePixels)
    oneLevelVisibleColor[0] = 25
    const differentVisibleAlpha = new Uint8Array(visiblePixels)
    differentVisibleAlpha[3] = 240

    expect(rootMeanSquareCompositedChannelDistance(visiblePixels, oneLevelVisibleColor)).toBeGreaterThan(0)
    expect(rootMeanSquareCompositedChannelDistance(visiblePixels, differentVisibleAlpha)).toBeGreaterThan(0)
  })

  it('rejects low-contrast changes by area-weighted alpha-composited RGB distance', () => {
    const rasterWithRedAdjustment = (redAdjustment: number, alpha = 88): Uint8Array => {
      const raster = new Uint8Array(TILE_PIXELS * TILE_PIXELS * CHANNELS)
      for (let pixel = 0; pixel < 9; pixel += 1) {
        const offset = pixel * CHANNELS
        raster.set([10 + redAdjustment, 20, 30, alpha], offset)
      }
      return raster
    }

    const source = rasterWithRedAdjustment(0)
    const redPlusOne = rasterWithRedAdjustment(1)
    const redPlusThree = rasterWithRedAdjustment(3)
    const opaqueSource = rasterWithRedAdjustment(0, 255)
    const opaqueRedPlusTwo = rasterWithRedAdjustment(2, 255)
    const opaqueRedPlusFour = rasterWithRedAdjustment(4, 255)
    const opaqueRedPlusEleven = rasterWithRedAdjustment(11, 255)
    const opaqueRedPlusFiftyFive = rasterWithRedAdjustment(55, 255)
    const opaqueRedPlusFiftySix = rasterWithRedAdjustment(56, 255)
    const rasterWithUniformRgbAdjustment = (adjustment: number): Uint8Array => {
      const raster = new Uint8Array(TILE_PIXELS * TILE_PIXELS * CHANNELS)
      for (let pixel = 0; pixel < TILE_PIXELS * TILE_PIXELS; pixel += 1) {
        raster.set([64 + adjustment, 128 + adjustment, 192 + adjustment, 255], pixel * CHANNELS)
      }
      return raster
    }
    for (const candidate of [redPlusOne, redPlusThree]) {
      expect(areNearDuplicateItemIcons(source, candidate)).toBe(true)
    }
    for (const candidate of [opaqueRedPlusTwo, opaqueRedPlusFour, opaqueRedPlusEleven, opaqueRedPlusFiftyFive]) {
      expect(areNearDuplicateItemIcons(opaqueSource, candidate)).toBe(true)
    }
    expect(areNearDuplicateItemIcons(opaqueSource, opaqueRedPlusFiftySix)).toBe(false)
    expect(areNearDuplicateItemIcons(
      rasterWithUniformRgbAdjustment(0),
      rasterWithUniformRgbAdjustment(3),
    )).toBe(true)
    expect(areNearDuplicateItemIcons(
      rasterWithUniformRgbAdjustment(0),
      rasterWithUniformRgbAdjustment(7),
    )).toBe(false)

    const rasterWithAlpha = (alpha: number): Uint8Array => {
      const raster = new Uint8Array(TILE_PIXELS * TILE_PIXELS * CHANNELS)
      for (let pixel = 0; pixel < TILE_PIXELS * TILE_PIXELS; pixel += 1) {
        let red = 42
        if (pixel >= TILE_PIXELS * TILE_PIXELS / 2) {
          red = 213
        }
        raster.set([red, 128, 128, alpha], pixel * CHANNELS)
      }
      return raster
    }
    expect(areNearDuplicateItemIcons(rasterWithAlpha(255), rasterWithAlpha(253))).toBe(true)
  })

  it('keeps registered item icons visually distinct and lists duplicate or near-duplicate pairs', () => {
    const artifacts = generatedItemIcons(generateItemIconArtifacts(generatedBlockTextures()))
    const rasters: Array<Readonly<{ itemId: string; pixels: Uint8Array }>> = []
    for (let index = 0; index < ITEM_TYPES.length; index += 1) {
      const itemId = ITEM_TYPES[index]
      if (itemId !== undefined) {
        rasters.push({ itemId, pixels: iconRaster(artifacts.rgba, index) })
      }
    }
    const tooSimilar: Array<string> = []
    for (const [leftIndex, left] of rasters.entries()) {
      for (const right of rasters.slice(leftIndex + 1)) {
        if (areNearDuplicateItemIcons(left.pixels, right.pixels)) {
          const distance = rootMeanSquareCompositedChannelDistance(left.pixels, right.pixels)
          tooSimilar.push(`${left.itemId}/${right.itemId}: RMS channel distance ${distance}`)
        }
      }
    }
    expect(
      tooSimilar,
      `duplicate or near-duplicate icons (maximum RMS channel distance ${MAX_NEAR_DUPLICATE_RMS_CHANNEL_DISTANCE}):\n${tooSimilar.join('\n')}`,
    ).toStrictEqual([])
    expect(rasters).toHaveLength(ITEM_TYPES.length)
  })

  it('renders a multicolor bookshelf cube from the bookshelf face textures', () => {
    const blockSource = generatedBlockTextures()
    const artifacts = generatedItemIcons(generateItemIconArtifacts(blockSource))
    const bookshelfTile = artifacts.manifestData.itemIcons['bookshelf']
    expect(bookshelfTile).toBe(ITEM_TYPES.indexOf('bookshelf'))
    if (bookshelfTile === undefined) {
      return
    }
    const colorCount = new Set(iconPixels(artifacts.rgba, bookshelfTile).map((color) => color.join(','))).size
    expect(colorCount).toBeGreaterThanOrEqual(4)
  })
})
