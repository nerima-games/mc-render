import { createHash } from 'node:crypto'
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

const iconFingerprint = (rgba: Uint8Array, tileIndex: number): string => {
  const left = (tileIndex % ATLAS_COLUMNS) * TILE_CELL_PIXELS + TILE_GUTTER_PIXELS
  const top = Math.floor(tileIndex / ATLAS_COLUMNS) * TILE_CELL_PIXELS + TILE_GUTTER_PIXELS
  const hash = createHash('sha256')
  for (let y = 0; y < TILE_PIXELS; y += 1) {
    const offset = ((top + y) * ATLAS_PIXELS + left) * CHANNELS
    hash.update(rgba.subarray(offset, offset + TILE_PIXELS * CHANNELS))
  }
  return hash.digest('hex')
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

  it('keeps every registered item icon raster distinguishable', () => {
    const artifacts = generatedItemIcons(generateItemIconArtifacts(generatedBlockTextures()))
    const itemByFingerprint = new Map<string, string>()
    const duplicates: Array<string> = []
    for (let index = 0; index < ITEM_TYPES.length; index += 1) {
      const itemId = ITEM_TYPES[index]
      if (itemId !== undefined) {
        const fingerprint = iconFingerprint(artifacts.rgba, index)
        const duplicate = itemByFingerprint.get(fingerprint)
        if (duplicate !== undefined) {
          duplicates.push(`${itemId} duplicates ${duplicate}`)
        }
        itemByFingerprint.set(fingerprint, itemId)
      }
    }
    expect(duplicates).toStrictEqual([])
    expect(itemByFingerprint.size).toBe(ITEM_TYPES.length)
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
