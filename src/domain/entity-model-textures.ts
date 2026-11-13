import { Result, Schema } from 'effect'
import type { EntityModelKind } from './entity-models/types.js'
import { EntityModelKindSchema } from './entity-model-catalog.js'
import entityTextureAtlas from './entity-models/generated/textures.json' with { type: 'json' }

export type EntityTextureUvCoordinates = readonly [uMinimum: number, vMinimum: number, uMaximum: number, vMaximum: number]

const UV_ATLAS_MINIMUM = 0
const UV_ATLAS_MAXIMUM = 1
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_GROUP_LENGTH = 4
const BASE64_GROUP_BYTE_LENGTH = 3
const BASE64_SYMBOL_BIT_LENGTH = 6
const BASE64_BYTE_BIT_LENGTH = 8
const BASE64_BYTE_MASK = 0xff
const BASE64_SINGLE_PADDING_LENGTH = 1
const BASE64_DOUBLE_PADDING_LENGTH = 2
const BASE64_UNPADDED_LENGTH = 0

type Base64DecoderState = {
  bitBuffer: number
  bitsAvailable: number
  outputOffset: number
}

const appendBase64Symbol = (
  character: string,
  pixels: Uint8Array,
  state: Base64DecoderState,
): void => {
  const value = BASE64_ALPHABET.indexOf(character)
  if (value >= BASE64_UNPADDED_LENGTH) {
    state.bitBuffer = (state.bitBuffer << BASE64_SYMBOL_BIT_LENGTH) | value
    state.bitsAvailable += BASE64_SYMBOL_BIT_LENGTH
    if (state.bitsAvailable >= BASE64_BYTE_BIT_LENGTH) {
      state.bitsAvailable -= BASE64_BYTE_BIT_LENGTH
      pixels[state.outputOffset] = (state.bitBuffer >> state.bitsAvailable) & BASE64_BYTE_MASK
      state.outputOffset += 1
    }
  }
}

export const EntityTextureUvCoordinatesSchema: Schema.Codec<EntityTextureUvCoordinates> = Schema.Tuple([
  Schema.Finite,
  Schema.Finite,
  Schema.Finite,
  Schema.Finite,
]).check(Schema.makeFilter<EntityTextureUvCoordinates>((coordinates) => {
  const [uMinimum, vMinimum, uMaximum, vMaximum] = coordinates
  return uMinimum >= UV_ATLAS_MINIMUM && vMinimum >= UV_ATLAS_MINIMUM &&
    uMaximum <= UV_ATLAS_MAXIMUM && vMaximum <= UV_ATLAS_MAXIMUM &&
    uMinimum < uMaximum && vMinimum < vMaximum || 'Entity texture UV coordinates must be ordered inside the unit atlas'
}))

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
  const coordinates = Schema.decodeUnknownResult(EntityTextureUvCoordinatesSchema)(entry.uv)
  if (Result.isFailure(coordinates)) {
    return Result.fail({ _tag: 'InvalidEntityTextureCoordinates', kind })
  }
  return Result.succeed(coordinates.success)
}

export const entityTextureAtlasPixels = (): Uint8Array => {
  const encoded = ENTITY_MODEL_TEXTURE_ATLAS.pixels
  let paddingLength = BASE64_UNPADDED_LENGTH
  if (encoded.endsWith('==')) {
    paddingLength = BASE64_DOUBLE_PADDING_LENGTH
  } else if (encoded.endsWith('=')) {
    paddingLength = BASE64_SINGLE_PADDING_LENGTH
  }
  const pixels = new Uint8Array(
    encoded.length / BASE64_GROUP_LENGTH * BASE64_GROUP_BYTE_LENGTH - paddingLength,
  )
  const state = { bitBuffer: 0, bitsAvailable: 0, outputOffset: 0 }
  for (const character of encoded) {
    appendBase64Symbol(character, pixels, state)
  }

  return pixels
}
