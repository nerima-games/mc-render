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

const NEAR_DUPLICATE_PIXEL_THRESHOLD = 8
// Black and white bound alpha-composited channel differences over any opaque background.
const ITEM_ICON_COMPARISON_BACKGROUNDS = [[0, 0, 0], [255, 255, 255]] as const
const MIN_COMPOSITED_RGB_CHANNEL_DIFFERENCE = 2

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

const differentPixelCount = (left: Uint8Array, right: Uint8Array): number => {
  let different = 0
  for (let pixelOffset = 0; pixelOffset < left.length; pixelOffset += CHANNELS) {
    const leftAlpha = left[pixelOffset + 3] ?? 0
    const rightAlpha = right[pixelOffset + 3] ?? 0
    let hasVisibleDifference = false
    for (let channel = 0; channel < 3; channel += 1) {
      let maximumDifference = 0
      for (const backgroundRgb of ITEM_ICON_COMPARISON_BACKGROUNDS) {
        const background = backgroundRgb[channel] ?? 0
        const leftComposite = (
          (left[pixelOffset + channel] ?? 0) * leftAlpha + background * (255 - leftAlpha)
        ) / 255
        const rightComposite = (
          (right[pixelOffset + channel] ?? 0) * rightAlpha + background * (255 - rightAlpha)
        ) / 255
        maximumDifference = Math.max(maximumDifference, Math.abs(leftComposite - rightComposite))
      }
      if (maximumDifference >= MIN_COMPOSITED_RGB_CHANNEL_DIFFERENCE) {
        hasVisibleDifference = true
      }
    }
    if (hasVisibleDifference) {
      different += 1
    }
  }
  return different
}

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

  it('ignores hidden and subthreshold RGB differences but counts visible color and alpha differences', () => {
    const transparentPixels = new Uint8Array(TILE_PIXELS * TILE_PIXELS * CHANNELS)
    const hiddenRgbDifferences = new Uint8Array(transparentPixels)
    for (let pixel = 0; pixel < 9; pixel += 1) {
      const offset = pixel * CHANNELS
      hiddenRgbDifferences.set([pixel + 1, pixel + 2, pixel + 3, 0], offset)
    }
    expect(differentPixelCount(transparentPixels, hiddenRgbDifferences)).toBe(0)

    const opaqueGrayPixels = new Uint8Array(transparentPixels)
    opaqueGrayPixels.set([128, 128, 128, 255], 0)
    expect(differentPixelCount(opaqueGrayPixels, transparentPixels)).toBe(1)

    const visiblePixels = new Uint8Array(transparentPixels)
    visiblePixels.set([24, 32, 40, 255], 0)
    const subthresholdVisibleColor = new Uint8Array(visiblePixels)
    subthresholdVisibleColor[0] = 25
    const thresholdVisibleColor = new Uint8Array(visiblePixels)
    thresholdVisibleColor[0] = 26
    const differentVisibleAlpha = new Uint8Array(visiblePixels)
    differentVisibleAlpha[3] = 240

    expect(differentPixelCount(visiblePixels, subthresholdVisibleColor)).toBe(0)
    expect(differentPixelCount(visiblePixels, thresholdVisibleColor)).toBe(1)
    expect(differentPixelCount(visiblePixels, differentVisibleAlpha)).toBe(1)
  })

  it('treats nine subthreshold alpha-composited channel changes as near duplicates', () => {
    const rasterWithRedAdjustment = (redAdjustment: number): Uint8Array => {
      const raster = new Uint8Array(TILE_PIXELS * TILE_PIXELS * CHANNELS)
      for (let pixel = 0; pixel < 9; pixel += 1) {
        const offset = pixel * CHANNELS
        raster.set([10 + redAdjustment, 20, 30, 88], offset)
      }
      return raster
    }

    const source = rasterWithRedAdjustment(0)
    const redPlusOne = rasterWithRedAdjustment(1)
    const redPlusThree = rasterWithRedAdjustment(3)
    for (const candidate of [redPlusOne, redPlusThree]) {
      const differingPixels = differentPixelCount(source, candidate)
      expect(differingPixels).toBe(0)
      expect(differingPixels).toBeLessThanOrEqual(NEAR_DUPLICATE_PIXEL_THRESHOLD)
    }
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
        const differentPixels = differentPixelCount(left.pixels, right.pixels)
        if (differentPixels <= NEAR_DUPLICATE_PIXEL_THRESHOLD) {
          tooSimilar.push(`${left.itemId}/${right.itemId}: ${differentPixels} differing pixels`)
        }
      }
    }
    expect(
      tooSimilar,
      `duplicate or near-duplicate icons (threshold ${NEAR_DUPLICATE_PIXEL_THRESHOLD} pixels):\n${tooSimilar.join('\n')}`,
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
