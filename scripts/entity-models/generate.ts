import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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

const generatedModelsFor = (group: ModelGroup): ReadonlyArray<GeneratedModel> =>
  group.models.map((model) => ({
    kind: model.kind,
    parts: model.parts.map((part) => generatedPartFor(part, group)),
  }))

const outputFiles = (): ReadonlyArray<Readonly<{ path: string; contents: string }>> => {
  const modelFiles = MODEL_GROUPS.map((group) => ({
    path: resolve(ROOT_DIRECTORY, `src/domain/entity-models/generated/${group.name}.json`),
    contents: `${JSON.stringify(generatedModelsFor(group), null, 2)}\n`,
  }))
  const manifest = {
    schemaVersion: 1,
    license: 'CC0-1.0',
    provenance: 'Original cuboid geometry and flat-color palettes authored for this project. No external model, texture, or game artwork was used.',
    generator: 'scripts/entity-models/generate.ts',
    outputColorEncoding: 'RGB byte channels in [0,255], written to the renderer Uint8 color buffer',
    sources: MODEL_GROUPS.map(({ name, sourcePath, colorEncoding }) => ({ name, sourcePath, colorEncoding })),
    outputs: MODEL_GROUPS.map(({ name }) => `src/domain/entity-models/generated/${name}.json`),
  }
  return [
    ...modelFiles,
    { path: MANIFEST_PATH, contents: `${JSON.stringify(manifest, null, 2)}\n` },
  ]
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
  const outputs = outputFiles()
  try {
    if (checkOnly) {
      const existingOutputs = await Promise.all(
        outputs.map(({ path }) => readFile(path, 'utf8')),
      )
      for (const [index, output] of outputs.entries()) {
        const existing = existingOutputs[index]
        if (existing !== output.contents) {
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
