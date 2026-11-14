// SPDX-License-Identifier: CC0-1.0
import { Buffer } from 'node:buffer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Euler, Box3, Vector3 } from 'three'
import { Result, Schema } from 'effect'
import modelDesignDimensionsInput from './model-design-dimensions.json' with { type: 'json' }
import { encodeRgbaPng } from './png-encoder.js'
import {
  entityTexturePixelsForPng,
  makeEntityTextureAtlas,
  type EntityTextureSourceModel,
} from './texture-atlas.js'
import {
  ANIMAL_ENTITY_MODELS,
} from './source/animals.js'
import { DISPLAY_MISC_ENTITY_MODELS } from './source/special-entities/display-misc.js'
import { DRAGON_ENTITY_MODELS } from './source/dragon.js'
import { HOSTILE_ENTITY_MODELS } from './source/hostile-mobs.js'
import { NEUTRAL_MOB_ENTITY_MODELS } from './source/special-entities/neutral-mobs.js'
import { PROJECTILE_ENTITY_MODELS } from './source/special-entities/projectiles.js'
import { VEHICLES_TNT_ENTITY_MODELS } from './source/vehicles-tnt.js'
import { VILLAGER_PLAYER_ENTITY_MODELS } from './source/villagers-player.js'
import type {
  EntityModelColor,
  EntityModelDescriptor,
  EntityModelPartDescriptor,
  EntityModelVector,
} from './source/types.js'

const COLOR_BYTE_MAXIMUM = 255
const ZERO = 0
const ONE = 1
const TWO = 2
const MODEL_DESIGN_CLEARANCE_SCALE = 0.999
const ROOT_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const MANIFEST_PATH = resolve(ROOT_DIRECTORY, 'assets/entity-models/manifest.json')
const ENTITY_TEXTURE_ATLAS_PATH = resolve(ROOT_DIRECTORY, 'assets/entity-models/entity-textures.png')
const ENTITY_TEXTURE_DATA_PATH = resolve(ROOT_DIRECTORY, 'src/domain/entity-models/generated/textures.json')
const ENTITY_TEXTURE_COUNT = 128

type ColorEncoding = 'unit-rgb' | 'byte-rgb'
type ModelGroup = Readonly<{
  name: string
  sourcePath: string
  colorEncoding: ColorEncoding
  models: ReadonlyArray<EntityModelDescriptor>
}>

type GeneratedVector = Readonly<{ x: number; y: number; z: number }>
type GeneratedColor = Readonly<{ red: number; green: number; blue: number }>
type GeneratedPart = Readonly<{
  id: string
  role: string
  size: GeneratedVector
  center: GeneratedVector
  color: GeneratedColor
  rotation: GeneratedVector | null
}>
type GeneratedModel = Readonly<{ kind: string; parts: ReadonlyArray<GeneratedPart> }>
type EntityModelDesignDimension = Readonly<{ width: number; height: number }>
type ModelBounds = Readonly<{ minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }>
type FittedEntityModel = Readonly<{ model: EntityModelDescriptor; bounds: ModelBounds }>

const MODEL_GROUPS: ReadonlyArray<ModelGroup> = [
  {
    name: 'animals',
    sourcePath: 'scripts/entity-models/source/animals.ts',
    colorEncoding: 'unit-rgb',
    models: ANIMAL_ENTITY_MODELS,
  },
  {
    name: 'display-misc',
    sourcePath: 'scripts/entity-models/source/special-entities/display-misc.ts',
    colorEncoding: 'unit-rgb',
    models: DISPLAY_MISC_ENTITY_MODELS,
  },
  {
    name: 'dragon',
    sourcePath: 'scripts/entity-models/source/dragon.ts',
    colorEncoding: 'unit-rgb',
    models: DRAGON_ENTITY_MODELS,
  },
  {
    name: 'hostile-mobs',
    sourcePath: 'scripts/entity-models/source/hostile-mobs.ts',
    colorEncoding: 'unit-rgb',
    models: HOSTILE_ENTITY_MODELS,
  },
  {
    name: 'neutral-mobs',
    sourcePath: 'scripts/entity-models/source/special-entities/neutral-mobs.ts',
    colorEncoding: 'unit-rgb',
    models: NEUTRAL_MOB_ENTITY_MODELS,
  },
  {
    name: 'projectiles',
    sourcePath: 'scripts/entity-models/source/special-entities/projectiles.ts',
    colorEncoding: 'byte-rgb',
    models: PROJECTILE_ENTITY_MODELS,
  },
  {
    name: 'vehicles-tnt',
    sourcePath: 'scripts/entity-models/source/vehicles-tnt.ts',
    colorEncoding: 'byte-rgb',
    models: VEHICLES_TNT_ENTITY_MODELS,
  },
  {
    name: 'villagers-player',
    sourcePath: 'scripts/entity-models/source/villagers-player.ts',
    colorEncoding: 'byte-rgb',
    models: VILLAGER_PLAYER_ENTITY_MODELS,
  },
]

const ENTITY_MODEL_DESIGN_DIMENSION_SCHEMA = Schema.Struct({
  width: Schema.Finite.check(Schema.isGreaterThan(ZERO)),
  height: Schema.Finite.check(Schema.isGreaterThan(ZERO)),
})
const ENTITY_MODEL_DESIGN_DIMENSIONS_SCHEMA = Schema.Struct({
  license: Schema.Literal('CC0-1.0'),
  provenance: Schema.String,
  units: Schema.Literal('blocks'),
  dimensions: Schema.Record(Schema.String, ENTITY_MODEL_DESIGN_DIMENSION_SCHEMA),
})
const modelDesignDimensionsSchemaResult = Schema.decodeUnknownResult(ENTITY_MODEL_DESIGN_DIMENSIONS_SCHEMA)(
  modelDesignDimensionsInput,
)

const modelBoundsFor = (parts: ReadonlyArray<EntityModelPartDescriptor>): ModelBounds => {
  const bounds = new Box3()
  const cornerSigns = [-ONE, ONE] as const
  for (const part of parts) {
    const [sizeX, sizeY, sizeZ] = part.size
    const [centerX, centerY, centerZ] = part.center
    const [rotationX, rotationY, rotationZ] = part.rotation ?? [ZERO, ZERO, ZERO]
    const rotation = new Euler(rotationX, rotationY, rotationZ, 'YXZ')
    for (const signX of cornerSigns) {
      for (const signY of cornerSigns) {
        for (const signZ of cornerSigns) {
          bounds.expandByPoint(
            new Vector3(signX * sizeX / TWO, signY * sizeY / TWO, signZ * sizeZ / TWO)
              .applyEuler(rotation)
              .add(new Vector3(centerX, centerY, centerZ)),
          )
        }
      }
    }
  }
  return {
    minX: bounds.min.x,
    minY: bounds.min.y,
    minZ: bounds.min.z,
    maxX: bounds.max.x,
    maxY: bounds.max.y,
    maxZ: bounds.max.z,
  }
}

const modelWidthFor = (bounds: ModelBounds): number =>
  Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)

const scaleModelParts = (
  parts: ReadonlyArray<EntityModelPartDescriptor>,
  horizontalScale: number,
  verticalScale: number,
): ReadonlyArray<EntityModelPartDescriptor> => parts.map((part) => {
  const [sizeX, sizeY, sizeZ] = part.size
  const [centerX, centerY, centerZ] = part.center
  return {
    ...part,
    size: [sizeX * horizontalScale, sizeY * verticalScale, sizeZ * horizontalScale] as EntityModelVector,
    center: [centerX * horizontalScale, centerY * verticalScale, centerZ * horizontalScale] as EntityModelVector,
  }
})

const fitModelToDesignDimensions = (
  model: EntityModelDescriptor,
  dimension: EntityModelDesignDimension,
): FittedEntityModel => {
  const sourceBounds = modelBoundsFor(model.parts)
  const sourceWidth = modelWidthFor(sourceBounds)
  const sourceHeight = sourceBounds.maxY - sourceBounds.minY
  // Non-uniform fitting can slightly widen rotated parts beyond the authored AABB.
  const horizontalScale = dimension.width / sourceWidth * MODEL_DESIGN_CLEARANCE_SCALE
  const verticalScale = dimension.height / sourceHeight * MODEL_DESIGN_CLEARANCE_SCALE
  const parts = scaleModelParts(model.parts, horizontalScale, verticalScale)
  const minimumY = modelBoundsFor(parts).minY
  const groundedParts = parts.map((part) => ({
    ...part,
    center: [part.center[ZERO], part.center[ONE] - minimumY, part.center[TWO]] as EntityModelVector,
  }))
  const bounds = modelBoundsFor(groundedParts)
  return { model: { ...model, parts: groundedParts }, bounds }
}

const validateModelDesignDimensions = (
  models: ReadonlyArray<EntityModelDescriptor>,
  dimensions: Readonly<Record<string, EntityModelDesignDimension>>,
): string | undefined => {
  const modelKinds = new Set<string>()
  for (const model of models) {
    if (modelKinds.has(model.kind)) {
      return `duplicate entity model kind: ${model.kind}`
    }
    modelKinds.add(model.kind)
  }
  const dimensionKinds = new Set(Object.keys(dimensions))
  const missingDimensions = [...modelKinds].filter((kind) => !dimensionKinds.has(kind))
  const missingModels = [...dimensionKinds].filter((kind) => !modelKinds.has(kind))
  if (missingDimensions.length > 0 || missingModels.length > 0) {
    return `model and design dimension kinds differ; missing dimensions: ${missingDimensions.join(', ')}; missing models: ${missingModels.join(', ')}`
  }
  return undefined
}

const fitAllModels = (
  models: ReadonlyArray<EntityModelDescriptor>,
  dimensions: Readonly<Record<string, EntityModelDesignDimension>>,
): Result.Result<ReadonlyMap<string, FittedEntityModel>, string> => {
  const fittedModels = new Map<string, FittedEntityModel>()
  for (const model of models) {
    const dimension = dimensions[model.kind]
    if (dimension === undefined) {
      return Result.fail(`${model.kind}: model design dimension is missing`)
    }
    fittedModels.set(model.kind, fitModelToDesignDimensions(model, dimension))
  }
  const extraDimensions = Object.keys(dimensions).filter((kind) => !models.some((model) => model.kind === kind))
  if (extraDimensions.length > 0) {
    return Result.fail(`design dimensions without models: ${extraDimensions.join(', ')}`)
  }
  return Result.succeed(fittedModels)
}

const finiteVector = (vector: readonly number[]): boolean => vector.every(Number.isFinite)

const colorByte = (value: number, encoding: ColorEncoding): number =>
  Math.round(encoding === 'unit-rgb' ? value * COLOR_BYTE_MAXIMUM : value)

const outputColor = (color: EntityModelColor, encoding: ColorEncoding): EntityModelColor => [
  colorByte(color[ZERO], encoding),
  colorByte(color[ONE], encoding),
  colorByte(color[TWO], encoding),
]

const generatedVector = (vector: EntityModelVector): GeneratedVector => ({
  x: vector[ZERO],
  y: vector[ONE],
  z: vector[TWO],
})

const generatedColor = (color: EntityModelColor, encoding: ColorEncoding): GeneratedColor => {
  const [red, green, blue] = outputColor(color, encoding)
  return { red, green, blue }
}

const validSourceColor = (color: EntityModelColor, encoding: ColorEncoding): boolean =>
  color.every((value) => Number.isFinite(value)) &&
  (encoding === 'unit-rgb'
    ? color.every((value) => value >= ZERO && value <= ONE)
    : color.every((value) => Number.isInteger(value) && value >= ZERO && value <= COLOR_BYTE_MAXIMUM))

const validatePart = (part: EntityModelPartDescriptor, group: ModelGroup, kind: string): string | undefined => {
  if (!finiteVector(part.size) || part.size.some((value) => value <= ZERO)) {
    return `${group.name}/${kind}/${part.id}: size must contain positive finite values`
  }
  if (!finiteVector(part.center)) {
    return `${group.name}/${kind}/${part.id}: center must contain finite values`
  }
  if (part.rotation !== undefined && !finiteVector(part.rotation)) {
    return `${group.name}/${kind}/${part.id}: rotation must contain finite values`
  }
  if (!validSourceColor(part.color, group.colorEncoding)) {
    return `${group.name}/${kind}/${part.id}: source color does not match ${group.colorEncoding}`
  }
  const color = outputColor(part.color, group.colorEncoding)
  if (color.some((value) =>
    !Number.isInteger(value) || !Number.isFinite(value) || value < ZERO || value > COLOR_BYTE_MAXIMUM,
  )) {
    return `${group.name}/${kind}/${part.id}: converted color must be an RGB byte triplet`
  }
  return undefined
}

const validateGroup = (group: ModelGroup): string | undefined => {
  const kinds = new Set<string>()
  for (const model of group.models) {
    if (model.kind.length === ZERO) {
      return `${group.name}: model kind must not be empty`
    }
    if (kinds.has(model.kind)) {
      return `${group.name}: duplicate model kind ${model.kind}`
    }
    kinds.add(model.kind)
    if (model.parts.length === ZERO) {
      return `${group.name}/${model.kind}: model must contain parts`
    }
    const partIds = new Set<string>()
    for (const part of model.parts) {
      if (part.id.length === ZERO) {
        return `${group.name}/${model.kind}: part identifier must not be empty`
      }
      if (part.role.length === ZERO) {
        return `${group.name}/${model.kind}/${part.id}: part role must not be empty`
      }
      if (partIds.has(part.id)) {
        return `${group.name}/${model.kind}: duplicate part identifier ${part.id}`
      }
      partIds.add(part.id)
      const failure = validatePart(part, group, model.kind)
      if (failure !== undefined) {
        return failure
      }
    }
  }
  return undefined
}

const generatedPartFor = (part: EntityModelPartDescriptor, group: ModelGroup): GeneratedPart => {
  const descriptor = {
    id: part.id,
    role: part.role,
    size: generatedVector(part.size),
    center: generatedVector(part.center),
    color: generatedColor(part.color, group.colorEncoding),
  }
  return {
    ...descriptor,
    rotation: part.rotation === undefined ? null : generatedVector(part.rotation),
  }
}

const generatedModelsFor = (
  group: ModelGroup,
  fittedModels: ReadonlyMap<string, FittedEntityModel>,
): Result.Result<ReadonlyArray<GeneratedModel>, string> => {
  const generated: Array<GeneratedModel> = []
  for (const model of group.models) {
    const fitted = fittedModels.get(model.kind)
    if (fitted === undefined) {
      return Result.fail(`${model.kind}: fitted entity model is missing`)
    }
    generated.push({
      kind: model.kind,
      parts: fitted.model.parts.map((part) => generatedPartFor(part, group)),
    })
  }
  return Result.succeed(generated)
}

type GeneratedFile = Readonly<{ path: string; contents: string | Uint8Array }>

const outputFiles = (
  fittedModels: ReadonlyMap<string, FittedEntityModel>,
): Result.Result<ReadonlyArray<GeneratedFile>, string> => {
  const modelFiles: Array<GeneratedFile> = []
  for (const group of MODEL_GROUPS) {
    const generated = generatedModelsFor(group, fittedModels)
    if (Result.isFailure(generated)) {
      return Result.fail(generated.failure)
    }
    modelFiles.push({
      path: resolve(ROOT_DIRECTORY, `src/domain/entity-models/generated/${group.name}.json`),
      contents: `${JSON.stringify(generated.success, null, 2)}\n`,
    })
  }
  const textureModels: ReadonlyArray<EntityTextureSourceModel> = MODEL_GROUPS.flatMap(({ colorEncoding, models, name }) =>
    models.map((model) => ({ colorEncoding, group: name, model })),
  )
  if (textureModels.length !== ENTITY_TEXTURE_COUNT) {
    return Result.fail(`Entity texture catalog requires ${ENTITY_TEXTURE_COUNT} models, received ${textureModels.length}`)
  }
  const textureAtlas = makeEntityTextureAtlas(textureModels)
  const textureData = `${JSON.stringify({
    ...textureAtlas,
    pixels: Buffer.from(entityTexturePixelsForPng(textureAtlas)).toString('base64'),
  }, null, 2)}\n`
  const texturePng = encodeRgbaPng(
    textureAtlas.width,
    textureAtlas.height,
    entityTexturePixelsForPng(textureAtlas),
  )
  const manifest = {
    schemaVersion: 1,
    license: 'CC0-1.0',
    licenseScope: {
      identifier: 'CC0-1.0',
      appliesTo: [
        'scripts/entity-models/generate.ts',
        'scripts/entity-models/png-encoder.ts',
        'scripts/entity-models/texture-atlas.ts',
        'scripts/entity-models/source/**/*.ts',
        'scripts/entity-models/model-design-dimensions.json',
        'src/domain/entity-models/generated/**',
        'assets/entity-models/entity-textures.png',
      ],
      repositoryLicense: 'MIT',
      repositoryRelationship: 'CC0-1.0 applies to the listed original entity-model scripts, source designs, design-dimension table, and generated model and texture assets. Other repository-owned files remain under MIT.',
    },
    provenance: 'Original cuboid geometry, color palettes, pixel-art textures, and art-directed model dimensions authored for this project. No external model, texture, dimension table, or game artwork was used.',
    generator: 'scripts/entity-models/generate.ts',
    modelDesignDimensions: 'scripts/entity-models/model-design-dimensions.json',
    outputColorEncoding: 'RGB byte channels in [0,255], written to the renderer Uint8 color buffer',
    sources: MODEL_GROUPS.map(({ name, sourcePath, colorEncoding }) => ({ name, sourcePath, colorEncoding })),
    outputs: MODEL_GROUPS.map(({ name }) => `src/domain/entity-models/generated/${name}.json`),
    textureAtlas: {
      source: 'scripts/entity-models/texture-atlas.ts',
      png: 'assets/entity-models/entity-textures.png',
      runtimeData: 'src/domain/entity-models/generated/textures.json',
      kindCount: textureAtlas.entries.length,
      dimensions: `${textureAtlas.width}x${textureAtlas.height}`,
      tileSize: `${textureAtlas.tileSize}x${textureAtlas.tileSize}`,
    },
  }
  return Result.succeed([
    ...modelFiles,
    { path: MANIFEST_PATH, contents: `${JSON.stringify(manifest, null, 2)}\n` },
    { path: ENTITY_TEXTURE_DATA_PATH, contents: textureData },
    { path: ENTITY_TEXTURE_ATLAS_PATH, contents: texturePng },
  ])
}

const runCli = async (arguments_: ReadonlyArray<string>): Promise<number> => {
  const checkOnly = arguments_.includes('--check')
  for (const group of MODEL_GROUPS) {
    const failure = validateGroup(group)
    if (failure !== undefined) {
      console.error(failure)
      return 1
    }
  }
  if (Result.isFailure(modelDesignDimensionsSchemaResult)) {
    console.error(`EntityModelDesignDimensionsSchemaError: ${String(modelDesignDimensionsSchemaResult.failure)}`)
    return 1
  }
  const design = modelDesignDimensionsSchemaResult.success
  const allModels = MODEL_GROUPS.flatMap(({ models }) => models)
  const dimensionCoverageFailure = validateModelDesignDimensions(allModels, design.dimensions)
  if (dimensionCoverageFailure !== undefined) {
    console.error(`EntityModelDesignDimensionCoverageError: ${dimensionCoverageFailure}`)
    return 1
  }
  const fittedModels = fitAllModels(allModels, design.dimensions)
  if (Result.isFailure(fittedModels)) {
    console.error(`EntityModelDesignDimensionError: ${fittedModels.failure}`)
    return 1
  }
  const preparedOutputs = outputFiles(fittedModels.success)
  if (Result.isFailure(preparedOutputs)) {
    console.error(`EntityModelGenerationError: ${preparedOutputs.failure}`)
    return 1
  }
  const outputs = preparedOutputs.success
  try {
    if (checkOnly) {
      const existingOutputs = await Promise.all(outputs.map(({ path }) => readFile(path)))
      for (const [index, output] of outputs.entries()) {
        const existing = existingOutputs[index]
        const expected = Buffer.from(output.contents)
        if (existing === undefined || !existing.equals(expected)) {
          console.error(`Generated model asset is stale: ${output.path}`)
          return 1
        }
      }
      console.log(`Verified ${outputs.length} generated entity-model files`)
      return 0
    }
    await Promise.all(outputs.map(async ({ path, contents }) => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, contents)
    }))
  } catch (error: unknown) {
    console.error(`EntityModelGenerationError: ${String(error)}`)
    return 1
  }
  console.log(`Generated ${outputs.length} entity-model files`)
  return 0
}

const entrypoint = pathToFileURL(resolve(process.argv[1] ?? '')).href
if (import.meta.url === entrypoint) {
  process.exitCode = await runCli(process.argv.slice(2))
}
