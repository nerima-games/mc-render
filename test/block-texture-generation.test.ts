import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import * as FastCheck from 'fast-check'
import { BLOCK_TYPES } from '@nerima-games/mc-kernel'
import {
  ATLAS_LAYOUT,
  atlasTileOrigin,
  generateBlockTextureArtifacts,
  loadAndGenerateBlockTextures,
  mipLevelDimensions,
  SUPPORTED_TEXTURE_PATTERNS,
  type GeneratedTextureArtifacts,
  type TextureGeneratorResult,
} from '../scripts/generate-block-textures'

let generated: TextureGeneratorResult<GeneratedTextureArtifacts> | undefined = undefined

beforeAll(async () => {
  generated = await loadAndGenerateBlockTextures()
})

const artifacts = (): GeneratedTextureArtifacts => {
  if (generated === undefined || generated._tag === 'Failure') {
    throw new Error(generated?.error.message ?? 'Texture artifacts were not generated')
  }
  return generated.value
}

const pixel = (rgba: Uint8Array, x: number, y: number): ReadonlyArray<number> => {
  const offset = (y * ATLAS_LAYOUT.width + x) * 4
  return Array.from(rgba.subarray(offset, offset + 4))
}

const imagePixel = (rgba: Uint8Array, width: number, x: number, y: number): ReadonlyArray<number> => {
  const offset = (y * width + x) * 4
  return Array.from(rgba.subarray(offset, offset + 4))
}

const downsampleRgba2x = (rgba: Uint8Array, width: number): Readonly<{ rgba: Uint8Array; width: number }> => {
  const nextWidth = width / 2
  const next = new Uint8Array(nextWidth * nextWidth * 4)
  for (let y = 0; y < nextWidth; y += 1) {
    for (let x = 0; x < nextWidth; x += 1) {
      const target = (y * nextWidth + x) * 4
      const topLeft = ((y * 2) * width + x * 2) * 4
      const topRight = topLeft + 4
      const bottomLeft = topLeft + width * 4
      const bottomRight = bottomLeft + 4
      for (let channel = 0; channel < 4; channel += 1) {
        const sum = (rgba[topLeft + channel] ?? 0) +
          (rgba[topRight + channel] ?? 0) +
          (rgba[bottomLeft + channel] ?? 0) +
          (rgba[bottomRight + channel] ?? 0)
        next[target + channel] = Math.round(sum / 4)
      }
    }
  }
  return { rgba: next, width: nextWidth }
}

const tileContent = (rgba: Uint8Array, tile: number): Uint8Array => {
  const origin = atlasTileOrigin(tile)
  const content = new Uint8Array(ATLAS_LAYOUT.tilePixels * ATLAS_LAYOUT.tilePixels * 4)
  if (origin._tag === 'Success') {
    for (let y = 0; y < ATLAS_LAYOUT.tilePixels; y += 1) {
      for (let x = 0; x < ATLAS_LAYOUT.tilePixels; x += 1) {
        const sourceOffset = ((origin.value.y + 16 + y) * ATLAS_LAYOUT.width + origin.value.x + 16 + x) * 4
        const targetOffset = (y * ATLAS_LAYOUT.tilePixels + x) * 4
        content.set(rgba.subarray(sourceOffset, sourceOffset + 4), targetOffset)
      }
    }
  }
  return content
}

const visibleColorCount = (rgba: Uint8Array, tile: number): number => {
  const origin = atlasTileOrigin(tile)
  if (origin._tag === 'Failure') {
    return 0
  }
  const colors = new Set<string>()
  for (let y = 0; y < ATLAS_LAYOUT.tilePixels; y += 1) {
    for (let x = 0; x < ATLAS_LAYOUT.tilePixels; x += 1) {
      const color = pixel(rgba, origin.value.x + 16 + x, origin.value.y + 16 + y)
      if (color[3] !== undefined && color[3] > 0) {
        colors.add(color.slice(0, 3).join(','))
      }
    }
  }
  return colors.size
}

const visibleHeight = (rgba: Uint8Array, tile: number): number => {
  const origin = atlasTileOrigin(tile)
  if (origin._tag === 'Failure') {
    return 0
  }
  let firstVisibleRow: number = ATLAS_LAYOUT.tilePixels
  for (let y = 0; y < ATLAS_LAYOUT.tilePixels; y += 1) {
    for (let x = 0; x < ATLAS_LAYOUT.tilePixels; x += 1) {
      const alpha = rgba[((origin.value.y + 16 + y) * ATLAS_LAYOUT.width + origin.value.x + 16 + x) * 4 + 3]
      if (alpha !== undefined && alpha !== 0) {
        firstVisibleRow = Math.min(firstVisibleRow, y)
      }
    }
  }
  return ATLAS_LAYOUT.tilePixels - firstVisibleRow
}

const visiblePixelCount = (rgba: Uint8Array, tile: number): number => {
  const origin = atlasTileOrigin(tile)
  if (origin._tag === 'Failure') {
    return 0
  }
  let count = 0
  for (let y = 0; y < ATLAS_LAYOUT.tilePixels; y += 1) {
    for (let x = 0; x < ATLAS_LAYOUT.tilePixels; x += 1) {
      const alpha = rgba[((origin.value.y + 16 + y) * ATLAS_LAYOUT.width + origin.value.x + 16 + x) * 4 + 3]
      if (alpha !== undefined && alpha !== 0) {
        count += 1
      }
    }
  }
  return count
}

const tileHasVisiblePixel = (rgba: Uint8Array, tile: number): boolean => {
  const origin = atlasTileOrigin(tile)
  if (origin._tag === 'Failure') {
    return false
  }
  for (let y = 0; y < ATLAS_LAYOUT.tilePixels; y += 1) {
    for (let x = 0; x < ATLAS_LAYOUT.tilePixels; x += 1) {
      const alpha = rgba[((origin.value.y + 16 + y) * ATLAS_LAYOUT.width + origin.value.x + 16 + x) * 4 + 3]
      if (alpha !== undefined && alpha !== 0) {
        return true
      }
    }
  }
  return false
}

type RecipeAssignment = Readonly<{ palette: string; pattern: string }>
type RecipeFile = Readonly<{ recipes: Readonly<Record<string, RecipeAssignment>> }>

const RECIPE_GROUPS = ['stone', 'soil-grass', 'wood', 'ore', 'plants', 'liquids'] as const
const MACHINE_TILE_RANGES: ReadonlyArray<readonly [number, number]> = [[91, 102], [226, 258]]

describe('block texture generation', () => {
  it('produces identical atlas, manifest, and detail PNG bytes for the same recipe input', async () => {
    const first = artifacts()
    const second = await loadAndGenerateBlockTextures()
    expect(second._tag).toBe('Success')
    if (second._tag === 'Failure') {
      return
    }
    expect(first.png).toStrictEqual(second.value.png)
    expect(first.manifest).toBe(second.value.manifest)
    expect(first.detailPng).toStrictEqual(second.value.detailPng)
  })

  it('supports every material and functional pattern in the recipe vocabulary', () => {
    expect(SUPPORTED_TEXTURE_PATTERNS).toEqual(expect.arrayContaining([
      'stone-mottle', 'soil-grain', 'grass-cover', 'grass-edge', 'plank-grain',
      'bark-grain', 'wood-rings', 'ore-vein', 'leaf-canopy', 'sand-grain',
      'gravel-pebble', 'glass-pane', 'wool-weave', 'machine-panel', 'furnace',
      'crafting-table', 'chest', 'dispenser', 'dropper', 'rail', 'powered-rail',
      'pressure-plate', 'lever', 'observer', 'repeater', 'comparator', 'furrow', 'redstone-wire',
      'redstone-torch', 'portal-frame', 'portal-frame-filled', 'door',
      'door-open', 'cauldron', 'water-cauldron', 'tnt-wrap', 'brewing-stand',
    ]))
  })

  it('lists distinct palette and pattern assignments for machine tiles', async () => {
    const recipeFiles = await Promise.all(RECIPE_GROUPS.map(async (group) => {
      const source = await readFile(resolve(import.meta.dirname, `../scripts/texture-recipes/${group}.json`), 'utf8')
      return JSON.parse(source) as RecipeFile
    }))
    const recipes = new Map<string, RecipeAssignment>()
    for (const recipeFile of recipeFiles) {
      for (const [blockName, recipe] of Object.entries(recipeFile.recipes)) {
        recipes.set(blockName, recipe)
      }
    }

    const manifest = artifacts().manifestData
    const machineBlockNames = Object.entries(manifest.blockFaces)
      .filter(([, faces]) => Object.values(faces).some((tile) =>
        MACHINE_TILE_RANGES.some(([first, last]) => tile >= first && tile <= last),
      ))
      .map(([blockName]) => blockName)
      .sort()
    const assignments: Record<string, string> = {}
    for (const blockName of machineBlockNames) {
      const recipe = recipes.get(blockName)
      expect(recipe, `Missing recipe assignment for ${blockName}`).toBeDefined()
      if (recipe !== undefined) {
        assignments[blockName] = `${recipe.palette}/${recipe.pattern}`
      }
    }

    const blocksByAssignment = new Map<string, Array<string>>()
    for (const [blockName, assignment] of Object.entries(assignments)) {
      const assignedBlocks = blocksByAssignment.get(assignment) ?? []
      assignedBlocks.push(blockName)
      blocksByAssignment.set(assignment, assignedBlocks)
    }
    const duplicateAssignments = [...blocksByAssignment]
      .filter(([, blockNames]) => blockNames.length > 1)
      .map(([assignment, blockNames]) => ({ assignment, blockNames }))

    expect(assignments).toStrictEqual({
      cactus: 'cactus/stalk',
      comparator: 'redstone-circuit/comparator',
      dispenser: 'machine-steel/dispenser',
      dropper: 'machine-steel/dropper',
      hopper: 'mechanical-iron/machine-panel',
      lever: 'machine-steel/lever',
      observer: 'machine-steel/observer',
      piston_head: 'machine-steel/machine-panel',
      powered_rail: 'mechanical-iron/powered-rail',
      pressure_plate: 'machine-steel/pressure-plate',
      rail: 'mechanical-iron/rail',
      redstone_lamp: 'lamp-unlit/machine-panel',
      redstone_lamp_lit: 'lamp-lit/machine-panel',
      repeater: 'redstone-circuit/repeater',
      stone_button: 'cool-stone/stone-mottle',
    })
    expect(duplicateAssignments).toStrictEqual([])
  })

  it('covers every non-air kernel block with three non-empty faces and contiguous tiles', () => {
    const result = artifacts()
    const blockNames = Object.keys(result.manifestData.blockFaces)
    expect(blockNames).toStrictEqual([...BLOCK_TYPES])
    expect(Object.keys(result.manifestData.blockFaces)).toHaveLength(BLOCK_TYPES.length)
    expect(result.manifestData.blockFaces['air']).toStrictEqual({ top: 0, side: 0, bottom: 0 })
    expect(result.manifestData.tileCount).toBeLessThanOrEqual(ATLAS_LAYOUT.capacity)

    const allocated = new Set<number>()
    for (const blockName of BLOCK_TYPES) {
      const faces = result.manifestData.blockFaces[blockName]
      expect(faces).toBeDefined()
      if (faces !== undefined) {
        for (const role of ['top', 'side', 'bottom'] as const) {
          const tile = faces[role]
          allocated.add(tile)
          if (blockName !== 'air') {
            expect(tileHasVisiblePixel(result.rgba, tile), `${blockName}.${role} tile ${tile}`).toBe(true)
          }
        }
      }
    }
    expect(result.manifestData.blockAlphaModes['copper_ore']).toBe('opaque')
    expect(result.manifestData.blockAlphaModes['deepslate_copper_ore']).toBe('opaque')
    expect(result.manifestData.blockAlphaModes['bookshelf']).toBe('opaque')
    expect(result.manifestData.blockAlphaModes['sticky_piston']).toBe('opaque')
    expect(result.manifestData.blockAlphaModes['redstone_wall_torch']).toBe('cutout')
    for (const stages of Object.values(result.manifestData.variants)) {
      for (const tile of stages) {
        allocated.add(tile)
      }
    }
    for (const blocks of Object.values(result.manifestData.animations)) {
      for (const frames of Object.values(blocks)) {
        for (const tile of frames) {
          allocated.add(tile)
        }
      }
    }
    expect([...allocated].sort((left, right) => left - right)).toStrictEqual(
      Array.from({ length: result.manifestData.tileCount }, (_, index) => index),
    )
  })

  it('reserves stage zero for each crop top face and maps animation groups to block frames', () => {
    const manifest = artifacts().manifestData
    expect(Object.keys(manifest.blockAlphaModes)).toStrictEqual([...BLOCK_TYPES])
    expect(manifest.blockAlphaModes['air']).toBe('cutout')
    expect(manifest.blockAlphaModes['glass']).toBe('translucent')
    expect(manifest.blockAlphaModes['oak_leaves']).toBe('cutout')
    for (const [blockName, stages] of Object.entries(manifest.variants)) {
      const faces = manifest.blockFaces[blockName]
      expect(faces).toBeDefined()
      if (faces !== undefined) {
        const [stageZero] = stages
        expect(stageZero).toBe(faces.top)
      }
      expect(stages.length).toBeGreaterThan(1)
    }
    expect(Object.keys(manifest.animations)).toStrictEqual(['water', 'lava', 'fire', 'portal'])
    const portalAnimations = manifest.animations['portal']
    expect(portalAnimations).toBeDefined()
    if (portalAnimations !== undefined) {
      expect(Object.keys(portalAnimations)).toStrictEqual([
        'end_portal', 'end_gateway', 'nether_portal',
      ])
    }
    for (const blocks of Object.values(manifest.animations)) {
      for (const frames of Object.values(blocks)) {
        expect(frames).toHaveLength(4)
      }
    }
  })

  it('keeps base faces, variants, and animation frames in disjoint tile allocations', () => {
    const manifest = artifacts().manifestData
    const baseFaceTiles = new Set<number>()
    for (const blockName of BLOCK_TYPES.filter((name) => name !== 'air')) {
      const faces = manifest.blockFaces[blockName]
      expect(faces).toBeDefined()
      if (faces !== undefined) {
        for (const role of ['top', 'side', 'bottom'] as const) {
          const tile = faces[role]
          expect(baseFaceTiles.has(tile)).toBe(false)
          baseFaceTiles.add(tile)
        }
      }
    }

    const expectedAnimationBlocks = {
      water: ['water'],
      lava: ['lava'],
      fire: ['fire'],
      portal: ['end_portal', 'nether_portal', 'end_gateway'],
    } as const
    const animationTiles = new Set<number>()
    for (const [group, blockNames] of Object.entries(expectedAnimationBlocks)) {
      const blocks = manifest.animations[group]
      expect(blocks).toBeDefined()
      if (blocks !== undefined) {
        expect(Object.keys(blocks).sort()).toStrictEqual([...blockNames].sort())
        for (const blockName of blockNames) {
          const frames = blocks[blockName]
          expect(frames).toBeDefined()
          if (frames !== undefined) {
            expect(frames).toHaveLength(4)
            for (const tile of frames) {
              expect(baseFaceTiles.has(tile)).toBe(false)
              expect(animationTiles.has(tile)).toBe(false)
              animationTiles.add(tile)
            }
          }
        }
      }
    }

    const cropExtraTiles = new Set<number>()
    for (const [blockName, stages] of Object.entries(manifest.variants)) {
      const faces = manifest.blockFaces[blockName]
      const [stageZero, ...extraStages] = stages
      expect(faces).toBeDefined()
      expect(stageZero).toBeDefined()
      if (faces !== undefined && stageZero !== undefined) {
        expect(stageZero).toBe(faces.top)
      }
      for (const tile of extraStages) {
        expect(baseFaceTiles.has(tile)).toBe(false)
        expect(animationTiles.has(tile)).toBe(false)
        expect(cropExtraTiles.has(tile)).toBe(false)
        cropExtraTiles.add(tile)
      }
    }
  })

  it('renders wheat stage zero shorter than a later stage while reusing its top tile', () => {
    const result = artifacts()
    const wheatStages = result.manifestData.variants['wheat_crop']
    const wheatFaces = result.manifestData.blockFaces['wheat_crop']
    const wheatTop = wheatFaces?.top
    expect(wheatTop).toBeDefined()
    if (wheatStages !== undefined && wheatTop !== undefined) {
      const [stageZero] = wheatStages
      const lastStage = wheatStages.at(-1)
      expect(stageZero).toBeDefined()
      expect(lastStage).toBeDefined()
      if (stageZero !== undefined && lastStage !== undefined) {
        expect(stageZero).toBe(wheatTop)
        expect(visibleHeight(result.rgba, stageZero)).toBeLessThan(visibleHeight(result.rgba, lastStage))
      }
    }
  })

  it('grows potato and nether-wart silhouettes across their variants', () => {
    const result = artifacts()
    for (const blockName of ['potato_crop', 'nether_wart_crop']) {
      const stages = result.manifestData.variants[blockName]
      expect(stages).toBeDefined()
      if (stages !== undefined) {
        const [stageZero] = stages
        const lastStage = stages.at(-1)
        expect(stageZero).toBe(result.manifestData.blockFaces[blockName]?.top)
        expect(stageZero).toBeDefined()
        expect(lastStage).toBeDefined()
        if (stageZero !== undefined && lastStage !== undefined) {
          expect(visiblePixelCount(result.rgba, stageZero)).toBeLessThan(
            visiblePixelCount(result.rgba, lastStage),
          )
        }
      }
    }
  })

  it('keeps explicit pattern alpha opaque for water-cauldron top pixels', () => {
    const result = artifacts()
    const faces = result.manifestData.blockFaces['water_cauldron']
    expect(faces).toBeDefined()
    if (faces !== undefined) {
      const origin = atlasTileOrigin(faces.top)
      expect(origin._tag).toBe('Success')
      if (origin._tag === 'Success') {
        for (let y = 0; y < ATLAS_LAYOUT.tilePixels; y += 1) {
          for (let x = 0; x < ATLAS_LAYOUT.tilePixels; x += 1) {
            const alpha = result.rgba[((origin.value.y + 16 + y) * ATLAS_LAYOUT.width + origin.value.x + 16 + x) * 4 + 3]
            expect(alpha).toBe(255)
          }
        }
      }
    }
  })

  it('lights iron-block top pixels differently from its side pixels', () => {
    const result = artifacts()
    const faces = result.manifestData.blockFaces['iron_block']
    expect(faces).toBeDefined()
    if (faces !== undefined) {
      const top = atlasTileOrigin(faces.top)
      const side = atlasTileOrigin(faces.side)
      expect(top._tag).toBe('Success')
      expect(side._tag).toBe('Success')
      if (top._tag === 'Success' && side._tag === 'Success') {
        const topBasePixel = pixel(result.rgba, top.value.x + 16, top.value.y + 16)
        const sideBasePixel = pixel(result.rgba, side.value.x + 16, side.value.y + 16)
        expect(topBasePixel).not.toStrictEqual(sideBasePixel)
      }
    }
  })

  it('renders material surfaces with several colors across their full 16px faces', () => {
    const result = artifacts()
    for (const blockName of [
      'stone', 'dirt', 'grass_block', 'oak_planks', 'oak_log', 'coal_ore',
      'oak_leaves', 'sand', 'gravel', 'glass',
      ...BLOCK_TYPES.filter((name) => name.endsWith('_wool')),
    ]) {
      const faces = result.manifestData.blockFaces[blockName]
      expect(faces, blockName).toBeDefined()
      if (faces !== undefined) {
        expect(visibleColorCount(result.rgba, faces.top), `${blockName}.top`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('keeps reviewed material and functional outliers as full, distinct surfaces', () => {
    const result = artifacts()
    const reviewedFaces = [
      ['farmland', 'top'],
      ['gold_block', 'top'],
      ['diamond_block', 'side'],
      ['redstone_block', 'bottom'],
      ['lapis_block', 'top'],
      ['emerald_block', 'side'],
      ['end_portal_frame', 'top'],
      ['end_portal_frame_filled', 'top'],
      ['door', 'side'],
      ['door_open', 'side'],
      ['cauldron', 'top'],
      ['water_cauldron', 'top'],
      ['tnt', 'top'],
      ['wither_skeleton_skull', 'side'],
    ] as const
    for (const [blockName, role] of reviewedFaces) {
      const faces = result.manifestData.blockFaces[blockName]
      expect(faces, blockName).toBeDefined()
      if (faces !== undefined) {
        expect(visiblePixelCount(result.rgba, faces[role]), `${blockName}.${role} coverage`)
          .toBeGreaterThan(180)
        expect(visibleColorCount(result.rgba, faces[role]), `${blockName}.${role} colors`)
          .toBeGreaterThanOrEqual(3)
      }
    }

    const redstoneWire = result.manifestData.blockFaces['redstone_wire']
    const redstoneTorch = result.manifestData.blockFaces['redstone_torch']
    const brewingStand = result.manifestData.blockFaces['brewing_stand']
    expect(redstoneWire).toBeDefined()
    expect(redstoneTorch).toBeDefined()
    expect(brewingStand).toBeDefined()
    if (redstoneWire !== undefined && redstoneTorch !== undefined && brewingStand !== undefined) {
      expect(visiblePixelCount(result.rgba, redstoneWire.top)).toBeGreaterThan(24)
      expect(visibleColorCount(result.rgba, redstoneWire.top)).toBeGreaterThanOrEqual(2)
      expect(visiblePixelCount(result.rgba, redstoneTorch.side)).toBeGreaterThan(24)
      expect(visibleColorCount(result.rgba, redstoneTorch.side)).toBeGreaterThanOrEqual(3)
      expect(visiblePixelCount(result.rgba, brewingStand.side)).toBeGreaterThan(24)
      expect(visibleColorCount(result.rgba, brewingStand.side)).toBeGreaterThanOrEqual(3)
    }

    const {
      door,
      door_open: openDoor,
      end_portal_frame: portalFrame,
      end_portal_frame_filled: filledPortalFrame,
      cauldron,
      water_cauldron: waterCauldron,
    } = result.manifestData.blockFaces
    expect(door).toBeDefined()
    expect(openDoor).toBeDefined()
    expect(portalFrame).toBeDefined()
    expect(filledPortalFrame).toBeDefined()
    expect(cauldron).toBeDefined()
    expect(waterCauldron).toBeDefined()
    if (
      door !== undefined && openDoor !== undefined &&
      portalFrame !== undefined && filledPortalFrame !== undefined &&
      cauldron !== undefined && waterCauldron !== undefined
    ) {
      expect(tileContent(result.rgba, door.side)).not.toStrictEqual(tileContent(result.rgba, openDoor.side))
      expect(tileContent(result.rgba, portalFrame.top)).not.toStrictEqual(
        tileContent(result.rgba, filledPortalFrame.top),
      )
      expect(tileContent(result.rgba, cauldron.top)).not.toStrictEqual(
        tileContent(result.rgba, waterCauldron.top),
      )
    }
  })

  it('zooms every assigned tile by nearest-neighbour and labels it with its tile ID', () => {
    const result = artifacts()
    const scale = 4
    const coreSize = ATLAS_LAYOUT.tilePixels * scale
    const columns = 16
    const cellHeight = coreSize + 10
    const rows = Math.ceil(result.manifestData.tileCount / columns)
    expect(result.detailWidth).toBe(columns * coreSize)
    expect(result.detailHeight).toBe(rows * cellHeight)
    expect(result.detailPng.readUInt32BE(16)).toBe(result.detailWidth)
    expect(result.detailPng.readUInt32BE(20)).toBe(result.detailHeight)

    const stoneTile = result.manifestData.blockFaces['stone']?.top
    expect(stoneTile).toBeDefined()
    if (stoneTile !== undefined) {
      const atlasOrigin = atlasTileOrigin(stoneTile)
      expect(atlasOrigin._tag).toBe('Success')
      if (atlasOrigin._tag === 'Success') {
        const left = (stoneTile % columns) * coreSize
        const top = Math.floor(stoneTile / columns) * cellHeight
        for (let y = 0; y < ATLAS_LAYOUT.tilePixels; y += 1) {
          for (let x = 0; x < ATLAS_LAYOUT.tilePixels; x += 1) {
            const source = pixel(
              result.rgba,
              atlasOrigin.value.x + ATLAS_LAYOUT.gutterPixels + x,
              atlasOrigin.value.y + ATLAS_LAYOUT.gutterPixels + y,
            )
            for (let scaleY = 0; scaleY < scale; scaleY += 1) {
              for (let scaleX = 0; scaleX < scale; scaleX += 1) {
                expect(imagePixel(
                  result.detailRgba,
                  result.detailWidth,
                  left + x * scale + scaleX,
                  top + y * scale + scaleY,
                )).toStrictEqual(source)
              }
            }
          }
        }
      }
    }

    const firstTileTop = 0
    expect(imagePixel(result.detailRgba, result.detailWidth, 0, firstTileTop))
      .not.toStrictEqual(imagePixel(result.detailRgba, result.detailWidth, 8, firstTileTop))
    const labelTop = ATLAS_LAYOUT.tilePixels * scale
    const labelPixels = Array.from({ length: 64 }, (_, x) =>
      imagePixel(result.detailRgba, result.detailWidth, x, labelTop),
    )
    expect(labelPixels.some((color) => color[0] === 239 && color[1] === 242 && color[2] === 246)).toBe(true)
  })

  it('returns typed failures for arbitrary invalid recipe input without throwing', () => {
    FastCheck.assert(
      FastCheck.property(FastCheck.jsonValue(), (input) => {
        const result = generateBlockTextureArtifacts(input)
        expect(result._tag).toBe('Failure')
        if (result._tag === 'Failure') {
          expect(result.error._tag).toBe('InvalidRecipeInput')
        }
      }),
      { numRuns: 100 },
    )
  })

  it('maps every valid tile index to a bounded cell and rejects adjacent invalid indices', () => {
    FastCheck.assert(
      FastCheck.property(FastCheck.integer({ min: 0, max: ATLAS_LAYOUT.capacity - 1 }), (tile) => {
        const origin = atlasTileOrigin(tile)
        expect(origin._tag).toBe('Success')
        if (origin._tag === 'Success') {
          expect(origin.value.x).toBe((tile % ATLAS_LAYOUT.columns) * ATLAS_LAYOUT.cellPixels)
          expect(origin.value.y).toBe(Math.floor(tile / ATLAS_LAYOUT.columns) * ATLAS_LAYOUT.cellPixels)
          expect(origin.value.x + ATLAS_LAYOUT.cellPixels).toBeLessThanOrEqual(ATLAS_LAYOUT.width)
          expect(origin.value.y + ATLAS_LAYOUT.cellPixels).toBeLessThanOrEqual(ATLAS_LAYOUT.height)
        }
      }),
      { numRuns: 100 },
    )
    for (const tile of [-1, ATLAS_LAYOUT.capacity, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(atlasTileOrigin(tile)._tag).toBe('Failure')
    }
    expect(atlasTileOrigin(0)._tag).toBe('Success')
    expect(atlasTileOrigin(ATLAS_LAYOUT.capacity - 1)._tag).toBe('Success')
  })

  it('uses the full mip chain and rejects levels outside its boundaries', () => {
    const expected = [1536, 768, 384, 192, 96, 48, 24, 12, 6, 3, 1]
    expect(ATLAS_LAYOUT.mipLevels).toBe(expected.length)
    FastCheck.assert(
      FastCheck.property(FastCheck.integer({ min: 0, max: ATLAS_LAYOUT.mipLevels - 1 }), (level) => {
        const dimensions = mipLevelDimensions(level)
        expect(dimensions._tag).toBe('Success')
        if (dimensions._tag === 'Success') {
          expect(dimensions.value).toStrictEqual({ width: expected[level], height: expected[level] })
        }
      }),
      { numRuns: 100 },
    )
    for (const level of [-1, ATLAS_LAYOUT.mipLevels, 0.5, Number.NaN]) {
      expect(mipLevelDimensions(level)._tag).toBe('Failure')
    }
  })

  it('extrudes every source edge across its complete 16px gutter', () => {
    const result = artifacts()
    const stoneFaces = result.manifestData.blockFaces['stone']
    expect(stoneFaces).toBeDefined()
    if (stoneFaces !== undefined) {
      const origin = atlasTileOrigin(stoneFaces.top)
      expect(origin._tag).toBe('Success')
      if (origin._tag === 'Success') {
        FastCheck.assert(
          FastCheck.property(
            FastCheck.integer({ min: 0, max: ATLAS_LAYOUT.cellPixels - 1 }),
            FastCheck.integer({ min: 0, max: ATLAS_LAYOUT.cellPixels - 1 }),
            (x, y) => {
              const sourceX = Math.min(15, Math.max(0, x - ATLAS_LAYOUT.gutterPixels))
              const sourceY = Math.min(15, Math.max(0, y - ATLAS_LAYOUT.gutterPixels))
              expect(pixel(result.rgba, origin.value.x + x, origin.value.y + y)).toStrictEqual(
                pixel(result.rgba, origin.value.x + ATLAS_LAYOUT.gutterPixels + sourceX, origin.value.y + ATLAS_LAYOUT.gutterPixels + sourceY),
              )
            },
          ),
          { numRuns: 100 },
        )
      }
    }
  })

  it('keeps gutter colors out of artwork pixels in generated mip levels 0 through 4', () => {
    const result = artifacts()
    const atlasMips = [{ rgba: result.rgba, width: ATLAS_LAYOUT.width }]
    for (let level = 1; level <= 4; level += 1) {
      const previous = atlasMips[level - 1]
      if (previous !== undefined) {
        atlasMips.push(downsampleRgba2x(previous.rgba, previous.width))
      }
    }

    for (let tile = 0; tile < result.manifestData.tileCount; tile += 1) {
      let isolatedArtwork = tileContent(result.rgba, tile)
      let artworkWidth = ATLAS_LAYOUT.tilePixels
      const tileColumn = tile % ATLAS_LAYOUT.columns
      const tileRow = Math.floor(tile / ATLAS_LAYOUT.columns)

      for (let level = 0; level <= 4; level += 1) {
        const atlasMip = atlasMips[level]
        if (atlasMip !== undefined) {
          const scale = 2 ** level
          const cellPixels = ATLAS_LAYOUT.cellPixels / scale
          const gutterPixels = ATLAS_LAYOUT.gutterPixels / scale
          const cellX = tileColumn * cellPixels
          const cellY = tileRow * cellPixels
          const atlasArtwork = new Uint8Array(isolatedArtwork.length)
          let destinationOffset = 0
          for (let y = 0; y < artworkWidth; y += 1) {
            for (let x = 0; x < artworkWidth; x += 1) {
              const sourceOffset = ((cellY + gutterPixels + y) * atlasMip.width + cellX + gutterPixels + x) * 4
              atlasArtwork.set(atlasMip.rgba.subarray(sourceOffset, sourceOffset + 4), destinationOffset)
              destinationOffset += 4
            }
          }
          expect(atlasArtwork).toStrictEqual(isolatedArtwork)
        }

        if (level < 4) {
          const nextArtwork = downsampleRgba2x(isolatedArtwork, artworkWidth)
          isolatedArtwork = nextArtwork.rgba
          artworkWidth = nextArtwork.width
        }
      }
    }
  })

  it('matches the checked-in atlas, manifest, and detail PNG byte-for-byte', async () => {
    const result = artifacts()
    const [png, manifest, detailPng] = await Promise.all([
      readFile(resolve(import.meta.dirname, '../src/assets/block-textures/atlas.png')),
      readFile(resolve(import.meta.dirname, '../src/assets/block-textures/manifest.json')),
      readFile(resolve(import.meta.dirname, '../docs/block-texture-detail.png')),
    ])
    expect(png).toStrictEqual(result.png)
    expect(manifest.toString('utf8')).toBe(result.manifest)
    expect(detailPng).toStrictEqual(result.detailPng)
  })
})
