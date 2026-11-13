// SPDX-License-Identifier: CC0-1.0
import { Buffer } from 'node:buffer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Euler, Box3, Vector3 } from 'three'
import { Result, Schema } from 'effect'
import collisionDimensionInput from './collision-dimensions.json' with { type: 'json' }
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
const ROOT_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const MANIFEST_PATH = resolve(ROOT_DIRECTORY, 'assets/entity-models/manifest.json')
const BOUNDS_REPORT_PATH = resolve(ROOT_DIRECTORY, 'docs/entity-model-bounds.md')
const ENTITY_TEXTURE_ATLAS_PATH = resolve(ROOT_DIRECTORY, 'assets/entity-models/entity-textures.png')
const ENTITY_TEXTURE_DATA_PATH = resolve(ROOT_DIRECTORY, 'src/domain/entity-models/generated/textures.json')
const ENTITY_TEXTURE_COUNT = 128
const MODEL_BOUNDS_RELATIVE_TOLERANCE = 0.1
const MODEL_BOUNDS_FIT_ATTEMPTS = 8

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
type CollisionDimensionStatus = 'fixed' | 'baseline' | 'variable' | 'configurable' | 'none' | 'unavailable'
type CollisionDimension = Readonly<{
  kind: string
  status: CollisionDimensionStatus
  width: number | null
  height: number | null
  state?: string | undefined
}>
type CollisionDimensionInput = Readonly<{
  source: string
  edition: string
  versionNote: string
  entities: ReadonlyArray<CollisionDimension>
}>
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

const COLLISION_DIMENSION_STATUS_SCHEMA = Schema.Literals([
  'fixed',
  'baseline',
  'variable',
  'configurable',
  'none',
  'unavailable',
])
const POSITIVE_COLLISION_DIMENSION_SCHEMA = Schema.Finite.check(Schema.isGreaterThan(ZERO))
const OPTIONAL_COLLISION_DIMENSION_SCHEMA = Schema.Union([
  POSITIVE_COLLISION_DIMENSION_SCHEMA,
  Schema.Null,
])
const COLLISION_DIMENSION_SCHEMA = Schema.Struct({
  kind: Schema.String,
  status: COLLISION_DIMENSION_STATUS_SCHEMA,
  state: Schema.optional(Schema.String),
  width: OPTIONAL_COLLISION_DIMENSION_SCHEMA,
  height: OPTIONAL_COLLISION_DIMENSION_SCHEMA,
})
const COLLISION_DIMENSION_INPUT_SCHEMA = Schema.Struct({
  source: Schema.String,
  edition: Schema.String,
  versionNote: Schema.String,
  entities: Schema.Array(COLLISION_DIMENSION_SCHEMA),
})

const collisionDimensionSchemaResult = Schema.decodeUnknownResult(COLLISION_DIMENSION_INPUT_SCHEMA)(
  collisionDimensionInput,
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

const relativeDimensionError = (actual: number, expected: number): number =>
  Math.abs(actual - expected) / expected

const scaleModelParts = (
  parts: ReadonlyArray<EntityModelPartDescriptor>,
  horizontalScale: number,
  verticalScale: number,
): ReadonlyArray<EntityModelPartDescriptor> => parts.map((part) => ({
  ...part,
  size: [part.size[ZERO] * horizontalScale, part.size[ONE] * verticalScale, part.size[TWO] * horizontalScale] as EntityModelVector,
  center: [part.center[ZERO] * horizontalScale, part.center[ONE] * verticalScale, part.center[TWO] * horizontalScale] as EntityModelVector,
}))

const fitModelToCollisionDimensions = (
  model: EntityModelDescriptor,
  dimensions: CollisionDimension,
): Result.Result<FittedEntityModel, string> => {
  let parts = model.parts
  for (let attempt = 0; attempt < MODEL_BOUNDS_FIT_ATTEMPTS; attempt += 1) {
    const bounds = modelBoundsFor(parts)
    const width = modelWidthFor(bounds)
    const height = bounds.maxY - bounds.minY
    const horizontalScale = dimensions.width !== null &&
        relativeDimensionError(width, dimensions.width) > MODEL_BOUNDS_RELATIVE_TOLERANCE
      ? dimensions.width / width
      : ONE
    const verticalScale = dimensions.height !== null &&
        relativeDimensionError(height, dimensions.height) > MODEL_BOUNDS_RELATIVE_TOLERANCE
      ? dimensions.height / height
      : ONE
    if (horizontalScale === ONE && verticalScale === ONE) {
      break
    }
    parts = scaleModelParts(parts, horizontalScale, verticalScale)
  }

  const minimumY = modelBoundsFor(parts).minY
  const groundedParts = parts.map((part) => ({
    ...part,
    center: [part.center[ZERO], part.center[ONE] - minimumY, part.center[TWO]] as EntityModelVector,
  }))
  const bounds = modelBoundsFor(groundedParts)
  const width = modelWidthFor(bounds)
  const height = bounds.maxY - bounds.minY
  if (dimensions.width !== null &&
    relativeDimensionError(width, dimensions.width) > MODEL_BOUNDS_RELATIVE_TOLERANCE) {
    return Result.fail(`${model.kind}: model width ${width} is outside 10% of collision width ${dimensions.width}`)
  }
  if (dimensions.height !== null &&
    relativeDimensionError(height, dimensions.height) > MODEL_BOUNDS_RELATIVE_TOLERANCE) {
    return Result.fail(`${model.kind}: model height ${height} is outside 10% of collision height ${dimensions.height}`)
  }
  return Result.succeed({ model: { ...model, parts: groundedParts }, bounds })
}

const validateCollisionDimensions = (
  models: ReadonlyArray<EntityModelDescriptor>,
  dimensions: ReadonlyArray<CollisionDimension>,
): string | undefined => {
  const modelKinds = new Set<string>()
  for (const model of models) {
    if (modelKinds.has(model.kind)) {
      return `duplicate entity model kind: ${model.kind}`
    }
    modelKinds.add(model.kind)
  }
  const dimensionKinds = new Set<string>()
  for (const dimension of dimensions) {
    if (dimensionKinds.has(dimension.kind)) {
      return `duplicate collision dimension kind: ${dimension.kind}`
    }
    dimensionKinds.add(dimension.kind)
    if (dimension.status === 'baseline' && (dimension.state === undefined || dimension.width === null || dimension.height === null)) {
      return `${dimension.kind}: baseline collision dimensions require a state label, width, and height`
    }
    if ((dimension.status === 'none' || dimension.status === 'unavailable' || dimension.status === 'configurable') &&
      (dimension.width !== null || dimension.height !== null)) {
      return `${dimension.kind}: ${dimension.status} dimensions must not provide numeric width or height`
    }
    if (dimension.status === 'fixed' && (dimension.width === null || dimension.height === null)) {
      return `${dimension.kind}: fixed collision dimensions require both width and height`
    }
  }
  const missingDimensions = [...modelKinds].filter((kind) => !dimensionKinds.has(kind))
  const missingModels = [...dimensionKinds].filter((kind) => !modelKinds.has(kind))
  if (missingDimensions.length > 0 || missingModels.length > 0) {
    return `model and collision dimension kinds differ; missing dimensions: ${missingDimensions.join(', ')}; missing models: ${missingModels.join(', ')}`
  }
  return undefined
}

const fitAllModels = (
  models: ReadonlyArray<EntityModelDescriptor>,
  dimensions: ReadonlyArray<CollisionDimension>,
): Result.Result<ReadonlyMap<string, FittedEntityModel>, string> => {
  const dimensionsByKind = new Map(dimensions.map((dimension) => [dimension.kind, dimension]))
  const fittedModels = new Map<string, FittedEntityModel>()
  for (const model of models) {
    const collisionDimensions = dimensionsByKind.get(model.kind)
    if (collisionDimensions === undefined) {
      return Result.fail(`${model.kind}: collision dimensions are missing`)
    }
    const fitted = fitModelToCollisionDimensions(model, collisionDimensions)
    if (Result.isFailure(fitted)) {
      return Result.fail(fitted.failure)
    }
    fittedModels.set(model.kind, fitted.success)
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

const formattedMeasurement = (value: number): string => value.toFixed(3)

const collisionDimensionLabel = (dimension: CollisionDimension): string => {
  if (dimension.state !== undefined) {
    return `${dimension.status}: ${dimension.state}`
  }
  return dimension.status
}

const collisionDimensionDisplay = (dimension: CollisionDimension, value: number | null): string => {
  if (value !== null) {
    return formattedMeasurement(value)
  }
  switch (dimension.status) {
    case 'none': return 'None'
    case 'unavailable': return 'N/A'
    case 'configurable':
    case 'variable': return 'Varies'
    case 'fixed':
    case 'baseline': return 'N/A'
  }
}

const entityBoundsReport = (
  fittedModels: ReadonlyMap<string, FittedEntityModel>,
  dimensions: CollisionDimensionInput,
): Result.Result<string, string> => {
  const dimensionsByKind = new Map(dimensions.entities.map((dimension) => [dimension.kind, dimension]))
  const sortedModels = [...fittedModels.entries()].toSorted(([kindA], [kindB]) => kindA.localeCompare(kindB, 'en'))
  const rows: Array<string> = []
  for (const [kind, fitted] of sortedModels) {
    const dimension = dimensionsByKind.get(kind)
    if (dimension === undefined) {
      return Result.fail(`${kind}: collision reference is missing while rendering the bounds table`)
    }
    const { bounds } = fitted
    rows.push(`| ${kind} | ${formattedMeasurement(bounds.minY)} | ${formattedMeasurement(modelWidthFor(bounds))} | ${formattedMeasurement(bounds.maxY - bounds.minY)} | ${formattedMeasurement(bounds.maxX - bounds.minX)} × ${formattedMeasurement(bounds.maxZ - bounds.minZ)} | ${collisionDimensionDisplay(dimension, dimension.width)} | ${collisionDimensionDisplay(dimension, dimension.height)} | ${collisionDimensionLabel(dimension)} |`)
  }
  return Result.succeed([
    '# Entity model bounds',
    '',
    'Measurements are in blocks. Model width is the larger horizontal span; height is the static AABB height after applying each part rotation in the renderer’s `YXZ` order.',
    '',
    `Collision reference: ${dimensions.edition} values from [Minecraft Wiki: Collision / Hitbox](${dimensions.source}). This reference data and its generated comparison report use [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/), separate from the original CC0 model and texture assets. The pinned kernel API provides entity kind identifiers but no per-kind width or height. ${dimensions.versionNote}`,
    '',
    `Fixed and named baseline dimensions are checked within ±${Math.round(MODEL_BOUNDS_RELATIVE_TOLERANCE * 100)}% in test/entity-model-bounds.test.ts. Varies, None, and N/A remain explicit and are not converted to invented numeric dimensions.`,
    '',
    '| Kind | Model min Y | Model width | Model height | Model X × Z | Reference width | Reference height | Reference state |',
    '|---|---:|---:|---:|---:|---:|---:|---|',
    ...rows,
    '',
  ].join('\n'))
}

type GeneratedFile = Readonly<{ path: string; contents: string | Uint8Array }>

const outputFiles = (
  fittedModels: ReadonlyMap<string, FittedEntityModel>,
  dimensions: CollisionDimensionInput,
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
  const boundsReport = entityBoundsReport(fittedModels, dimensions)
  if (Result.isFailure(boundsReport)) {
    return Result.fail(boundsReport.failure)
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
        'src/domain/entity-models/generated/**',
        'assets/entity-models/manifest.json',
        'assets/entity-models/entity-textures.png',
      ],
      excludes: [
        'scripts/entity-models/collision-dimensions.json',
        'docs/entity-model-bounds.md',
      ],
      repositoryLicense: 'MIT',
      repositoryRelationship: 'CC0-1.0 applies to the listed original entity-model scripts and generated model/texture assets. Collision reference data and its generated comparison report remain under their source license; other repository-owned files remain under MIT.',
      referenceData: {
        path: 'scripts/entity-models/collision-dimensions.json',
        derivedReport: 'docs/entity-model-bounds.md',
        source: dimensions.source,
        attribution: 'Minecraft Wiki contributors, Collision / Hitbox',
        license: 'CC BY-NC-SA 3.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/3.0/',
      },
    },
    provenance: 'Original cuboid geometry, color palettes, and pixel-art texture atlas authored for this project. No external model, texture, or game artwork was used.',
    generator: 'scripts/entity-models/generate.ts',
    collisionDimensionReference: {
      input: 'scripts/entity-models/collision-dimensions.json',
      source: dimensions.source,
      edition: dimensions.edition,
      versionNote: dimensions.versionNote,
      license: 'CC BY-NC-SA 3.0',
      attribution: 'Minecraft Wiki contributors, Collision / Hitbox',
      comparisonTolerance: MODEL_BOUNDS_RELATIVE_TOLERANCE,
    },
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
    reports: ['docs/entity-model-bounds.md'],
  }
  return Result.succeed([
    ...modelFiles,
    { path: MANIFEST_PATH, contents: `${JSON.stringify(manifest, null, 2)}\n` },
    { path: BOUNDS_REPORT_PATH, contents: boundsReport.success },
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
  if (Result.isFailure(collisionDimensionSchemaResult)) {
    console.error(`EntityCollisionDimensionsSchemaError: ${String(collisionDimensionSchemaResult.failure)}`)
    return 1
  }
  const dimensions = collisionDimensionSchemaResult.success
  const allModels = MODEL_GROUPS.flatMap(({ models }) => models)
  const collisionCoverageFailure = validateCollisionDimensions(allModels, dimensions.entities)
  if (collisionCoverageFailure !== undefined) {
    console.error(`EntityCollisionDimensionCoverageError: ${collisionCoverageFailure}`)
    return 1
  }
  const fittedModels = fitAllModels(allModels, dimensions.entities)
  if (Result.isFailure(fittedModels)) {
    console.error(`EntityModelBoundsFitError: ${fittedModels.failure}`)
    return 1
  }
  const preparedOutputs = outputFiles(fittedModels.success, dimensions)
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
