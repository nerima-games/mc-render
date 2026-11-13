import { Result, Schema } from 'effect'
import entityTextureAtlas from './entity-models/generated/textures.json' with { type: 'json' }
import type { EntityModelKind } from './entity-models/types.js'
import { EntityModelKindSchema } from './entity-model-catalog.js'

export type EntityTextureUvCoordinates = readonly [uMinimum: number, vMinimum: number, uMaximum: number, vMaximum: number]

export type UnsupportedEntityTexture = Readonly<{
  readonly _tag: 'UnsupportedEntityTexture'
  readonly kind: EntityModelKind
}>

export type InvalidEntityTextureCoordinates = Readonly<{
  readonly _tag: 'InvalidEntityTextureCoordinates'
  readonly kind: EntityModelKind
}>

export type EntityTextureResolutionIssue = UnsupportedEntityTexture | InvalidEntityTextureCoordinates

const UnsupportedEntityTextureSchema: Schema.Codec<UnsupportedEntityTexture, Readonly<{
  readonly _tag: 'UnsupportedEntityTexture'
  readonly kind: string
}>> = Schema.Struct({
  _tag: Schema.Literal('UnsupportedEntityTexture'),
  kind: EntityModelKindSchema,
})

const InvalidEntityTextureCoordinatesSchema: Schema.Codec<InvalidEntityTextureCoordinates, Readonly<{
  readonly _tag: 'InvalidEntityTextureCoordinates'
  readonly kind: string
}>> = Schema.Struct({
  _tag: Schema.Literal('InvalidEntityTextureCoordinates'),
  kind: EntityModelKindSchema,
})

export const EntityTextureResolutionIssueSchema: Schema.Codec<
  EntityTextureResolutionIssue,
  Schema.Codec.Encoded<typeof UnsupportedEntityTextureSchema> |
    Schema.Codec.Encoded<typeof InvalidEntityTextureCoordinatesSchema>
> = Schema.Union([UnsupportedEntityTextureSchema, InvalidEntityTextureCoordinatesSchema])

export type EntityModelTextureEntry = Readonly<{
  readonly kind: string
  readonly tile: number
  readonly uv: ReadonlyArray<number>
  readonly motif: string
  readonly primaryColor: ReadonlyArray<number>
  readonly accentColor: ReadonlyArray<number>
}>

export type EntityModelTextureAtlas = Readonly<{
  readonly width: number
  readonly height: number
  readonly tileSize: number
  readonly columns: number
  readonly rows: number
  readonly entries: ReadonlyArray<EntityModelTextureEntry>
  readonly pixels: string
}>

export const ENTITY_MODEL_TEXTURE_ATLAS: EntityModelTextureAtlas = entityTextureAtlas

const textureEntryByKind = new Map(ENTITY_MODEL_TEXTURE_ATLAS.entries.map((entry) => [entry.kind, entry]))

export const entityTextureUvForKind = (
  kind: EntityModelKind,
): Result.Result<EntityTextureUvCoordinates, EntityTextureResolutionIssue> => {
  const entry = textureEntryByKind.get(kind)
  if (entry === undefined) {
    return Result.fail({ _tag: 'UnsupportedEntityTexture', kind })
  }
  if (entry.uv.length !== 4) {
    return Result.fail({ _tag: 'InvalidEntityTextureCoordinates', kind })
  }
  const uMinimum = entry.uv[0]
  const vMinimum = entry.uv[1]
  const uMaximum = entry.uv[2]
  const vMaximum = entry.uv[3]
  if (uMinimum === undefined || vMinimum === undefined || uMaximum === undefined || vMaximum === undefined ||
    ![uMinimum, vMinimum, uMaximum, vMaximum].every(Number.isFinite) ||
    uMinimum < 0 || vMinimum < 0 || uMaximum > 1 || vMaximum > 1 ||
    uMinimum >= uMaximum || vMinimum >= vMaximum) {
    return Result.fail({ _tag: 'InvalidEntityTextureCoordinates', kind })
  }
  return Result.succeed([uMinimum, vMinimum, uMaximum, vMaximum])
}

export const entityTextureAtlasPixels = (): Uint8Array => {
  const decoded = atob(ENTITY_MODEL_TEXTURE_ATLAS.pixels)
  const pixels = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index += 1) {
    pixels[index] = decoded.charCodeAt(index)
  }
  return pixels
}
