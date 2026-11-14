import {
  ATLAS_COLUMNS,
  ATLAS_MIP_LEVEL_COUNT,
  ATLAS_PIXELS,
  ATLAS_ROWS,
  ATLAS_TILE_COUNT,
  type AtlasLayoutInteger,
  AtlasLayoutIntegerSchema,
  type AtlasTileIndex,
  AtlasTileIndexSchema,
  TILE_CELL_PIXELS,
  TILE_GUTTER_PIXELS,
  TILE_PIXELS,
} from './texture-atlas.js'
import { BLOCK_TYPES, type BlockId, type BlockType } from '@nerima-games/mc-kernel'
import { Array as EffectArray, Result, Schema } from 'effect'
import { type FaceRole, type GeometryQuad } from './meshing-vocabulary.js'
import { PlantTextureStageSchema } from '@nerima-games/mc-meshing'
import blockTextureManifest from '../assets/block-textures/manifest.json' with { type: 'json' }
import { tileIndexForVariantStage } from './block-texture-variant.js'

const MANIFEST_SCHEMA_VERSION = 1
const EMPTY_ARRAY_LENGTH = 0
const AIR_TILE_INDEX = 0
const FIRST_BLOCK_TEXTURE_TILE_INDEX = 1
const SIDE_FACE_TILE_OFFSET = 1
const BOTTOM_FACE_TILE_OFFSET = 2
const FACE_TILE_COUNT = 3
const FIRST_VARIANT_STAGE_INDEX = 0
const FIRST_VARIANT_ADDITIONAL_STAGE_INDEX = 1
const TILE_INDEX_INCREMENT = 1
const REQUIRED_ANIMATION_GROUPS = ['fire', 'lava', 'portal', 'water'] as const
const MISSING_TEXTURE_STAGE = Symbol('missing-texture-stage')
const BLOCKS_WITH_TEXTURE_STAGE = new Set(['sapling', 'wheat_crop', 'potato_crop', 'nether_wart_crop'])
const FIRST_TEXTURE_STAGE_ARGUMENT = 0

export type TileAssignment = Readonly<Record<FaceRole, AtlasTileIndex>>
type CompleteBlockFaceMap = Readonly<{ readonly [Block in BlockType]: TileAssignment }>
type AnimationGroup = typeof REQUIRED_ANIMATION_GROUPS[number]
type AlphaMode = 'opaque' | 'cutout' | 'translucent'
type CompleteBlockAlphaModeMap = Readonly<{ readonly [Block in BlockType]: AlphaMode }>
type AnimationFrameSequence = EffectArray.NonEmptyReadonlyArray<AtlasTileIndex>
type AnimationGroupSource = Readonly<Record<string, ReadonlyArray<AtlasTileIndex>>>
type AnimationGroupSources = Readonly<Record<AnimationGroup, AnimationGroupSource>>
type BlockTextureVariantMap = Readonly<Partial<Record<BlockType, ReadonlyArray<AtlasTileIndex>>>>
type BlockTextureAnimationMap = Readonly<{
  readonly fire: Readonly<{ readonly fire: AnimationFrameSequence }>
  readonly lava: Readonly<{ readonly lava: AnimationFrameSequence }>
  readonly portal: Readonly<{
    readonly end_gateway: AnimationFrameSequence
    readonly end_portal: AnimationFrameSequence
    readonly nether_portal: AnimationFrameSequence
  }>
  readonly water: Readonly<{ readonly water: AnimationFrameSequence }>
}>

export type BlockTextureLookupError = Readonly<{
  readonly _tag: 'BlockTextureLookupError'
  readonly blockName: unknown
  readonly reason:
    | 'invalid-tile-index'
    | 'unknown-block'
    | 'missing-texture-stage'
    | 'invalid-texture-stage'
    | 'texture-stage-block-mismatch'
    | 'missing-texture-variant'
  readonly role: FaceRole
}>

export type BlockTextureManifestError = Readonly<{
  readonly _tag: 'BlockTextureManifestError'
  readonly reason: BlockTextureManifestFailureReason
}>

export type BlockTextureManifestFailureReason =
  | 'animation-block'
  | 'animation-coverage'
  | 'animation-group'
  | 'animation-tiles'
  | 'air-face'
  | 'base-face-order'
  | 'block-alpha-modes'
  | 'block-faces'
  | 'layout'
  | 'schema'
  | 'tile-count'
  | 'variant-alias'
  | 'variant-block'
  | 'variant-tiles'
  | 'variant-order'

export type BlockTextureManifestLayout = Readonly<{
  readonly width: AtlasLayoutInteger
  readonly height: AtlasLayoutInteger
  readonly columns: AtlasLayoutInteger
  readonly rows: AtlasLayoutInteger
  readonly tilePixels: AtlasLayoutInteger
  readonly gutterPixels: AtlasLayoutInteger
  readonly cellPixels: AtlasLayoutInteger
  readonly capacity: AtlasLayoutInteger
  readonly mipLevels: AtlasLayoutInteger
}>

export type BlockTextureManifest = Readonly<{
  readonly schemaVersion: typeof MANIFEST_SCHEMA_VERSION
  readonly layout: BlockTextureManifestLayout
  readonly tileCount: AtlasLayoutInteger
  readonly blockFaces: CompleteBlockFaceMap
  readonly blockAlphaModes: CompleteBlockAlphaModeMap
  readonly variants: BlockTextureVariantMap
  readonly animations: BlockTextureAnimationMap
}>

type BlockTextureManifestDecoded = Readonly<{
  readonly schemaVersion: typeof MANIFEST_SCHEMA_VERSION
  readonly layout: BlockTextureManifestLayout
  readonly tileCount: AtlasLayoutInteger
  readonly blockFaces: Readonly<Record<string, TileAssignment>>
  readonly blockAlphaModes: Readonly<Record<string, AlphaMode>>
  readonly variants: Readonly<Record<string, ReadonlyArray<AtlasTileIndex>>>
  readonly animations: Readonly<Record<
    string,
    Readonly<Record<string, ReadonlyArray<AtlasTileIndex>>> | undefined
  >>
}>

type BlockTextureManifestWithCompleteFaces = Omit<BlockTextureManifestDecoded, 'blockFaces' | 'blockAlphaModes'> & Readonly<{
  readonly blockFaces: CompleteBlockFaceMap
  readonly blockAlphaModes: CompleteBlockAlphaModeMap
}>

type BlockTextureManifestLayoutEncoded = Readonly<{
  readonly width: number
  readonly height: number
  readonly columns: number
  readonly rows: number
  readonly tilePixels: number
  readonly gutterPixels: number
  readonly cellPixels: number
  readonly capacity: number
  readonly mipLevels: number
}>

type TileAssignmentEncoded = Readonly<Record<FaceRole, number>>

type BlockTextureManifestEncoded = Readonly<{
  readonly schemaVersion: number
  readonly layout: BlockTextureManifestLayoutEncoded
  readonly tileCount: number
  readonly blockFaces: Readonly<Record<string, TileAssignmentEncoded>>
  readonly blockAlphaModes: Readonly<Record<string, AlphaMode>>
  readonly variants: Readonly<Record<string, ReadonlyArray<number>>>
  readonly animations: Readonly<Record<string, Readonly<Record<string, ReadonlyArray<number>>> | undefined>>
}>

type AnimationFrameSequenceEncoded = EffectArray.NonEmptyReadonlyArray<number>
type BlockTextureAnimationMapEncoded = Readonly<{
  readonly fire: Readonly<{ readonly fire: AnimationFrameSequenceEncoded }>
  readonly lava: Readonly<{ readonly lava: AnimationFrameSequenceEncoded }>
  readonly portal: Readonly<{
    readonly end_gateway: AnimationFrameSequenceEncoded
    readonly end_portal: AnimationFrameSequenceEncoded
    readonly nether_portal: AnimationFrameSequenceEncoded
  }>
  readonly water: Readonly<{ readonly water: AnimationFrameSequenceEncoded }>
}>

type StaticBlockTextureManifestEncoded = Omit<BlockTextureManifestEncoded, 'blockFaces' | 'blockAlphaModes' | 'animations'> & Readonly<{
  readonly blockFaces: Readonly<Record<BlockType, TileAssignmentEncoded>>
  readonly blockAlphaModes: Readonly<Record<BlockType, AlphaMode>>
  readonly animations: BlockTextureAnimationMapEncoded
}>

type StaticBlockTextureManifestDecoded = BlockTextureManifestWithCompleteFaces & Readonly<{
  readonly animations: BlockTextureAnimationMap
}>

export const BlockTextureManifestErrorSchema: Schema.Codec<BlockTextureManifestError> = Schema.Struct({
  _tag: Schema.Literal('BlockTextureManifestError'),
  reason: Schema.Literals([
    'animation-block',
    'animation-coverage',
    'animation-group',
    'animation-tiles',
    'air-face',
    'base-face-order',
    'block-alpha-modes',
    'block-faces',
    'layout',
    'schema',
    'tile-count',
    'variant-alias',
    'variant-block',
    'variant-tiles',
    'variant-order',
  ]),
})

const BlockTextureManifestLayoutSchema: Schema.Codec<BlockTextureManifestLayout, BlockTextureManifestLayoutEncoded> = Schema.Struct({
  capacity: AtlasLayoutIntegerSchema,
  cellPixels: AtlasLayoutIntegerSchema,
  columns: AtlasLayoutIntegerSchema,
  gutterPixels: AtlasLayoutIntegerSchema,
  height: AtlasLayoutIntegerSchema,
  mipLevels: AtlasLayoutIntegerSchema,
  rows: AtlasLayoutIntegerSchema,
  tilePixels: AtlasLayoutIntegerSchema,
  width: AtlasLayoutIntegerSchema,
})

const TileAssignmentSchema: Schema.Codec<TileAssignment, TileAssignmentEncoded> = Schema.Struct({
  bottom: AtlasTileIndexSchema,
  side: AtlasTileIndexSchema,
  top: AtlasTileIndexSchema,
})

const CompleteBlockTextureMapSchema: Schema.Codec<CompleteBlockFaceMap, Readonly<Record<BlockType, TileAssignmentEncoded>>> =
  Schema.Record(Schema.Literals(BLOCK_TYPES), TileAssignmentSchema)

const AlphaModeSchema: Schema.Codec<AlphaMode> = Schema.Literals(['opaque', 'cutout', 'translucent'])

const CompleteBlockAlphaModeMapSchema: Schema.Codec<
  CompleteBlockAlphaModeMap,
  Readonly<Record<BlockType, AlphaMode>>
> = Schema.Record(Schema.Literals(BLOCK_TYPES), AlphaModeSchema)

const AnimationFrameSequenceSchema = Schema.NonEmptyArray(AtlasTileIndexSchema)

const BlockTextureAnimationMapSchema: Schema.Codec<BlockTextureAnimationMap, BlockTextureAnimationMapEncoded> = Schema.Struct({
  fire: Schema.Struct({ fire: AnimationFrameSequenceSchema }),
  lava: Schema.Struct({ lava: AnimationFrameSequenceSchema }),
  portal: Schema.Struct({
    end_gateway: AnimationFrameSequenceSchema,
    end_portal: AnimationFrameSequenceSchema,
    nether_portal: AnimationFrameSequenceSchema,
  }),
  water: Schema.Struct({ water: AnimationFrameSequenceSchema }),
})

const BlockTextureMapSchema: Schema.Codec<
  Readonly<Record<string, TileAssignment>>,
  Readonly<Record<string, TileAssignmentEncoded>>
> = Schema.Record(Schema.String, TileAssignmentSchema)

const BlockTextureManifestShapeSchema: Schema.Codec<BlockTextureManifestDecoded, BlockTextureManifestEncoded> = Schema.Struct({
  animations: Schema.Record(
    Schema.String,
    Schema.Union([Schema.Record(Schema.String, Schema.Array(AtlasTileIndexSchema)), Schema.Undefined]),
  ),
  blockAlphaModes: Schema.Record(Schema.String, AlphaModeSchema),
  blockFaces: BlockTextureMapSchema,
  layout: BlockTextureManifestLayoutSchema,
  schemaVersion: Schema.Literal(MANIFEST_SCHEMA_VERSION),
  tileCount: AtlasLayoutIntegerSchema,
  variants: Schema.Record(Schema.String, Schema.Array(AtlasTileIndexSchema)),
})

export const BlockTextureManifestSchema: Schema.Codec<BlockTextureManifestDecoded, BlockTextureManifestEncoded> =
  BlockTextureManifestShapeSchema

const StaticBlockTextureManifestSchema: Schema.Codec<
  StaticBlockTextureManifestDecoded,
  StaticBlockTextureManifestEncoded
> = Schema.Struct({
  animations: BlockTextureAnimationMapSchema,
  blockAlphaModes: CompleteBlockAlphaModeMapSchema,
  blockFaces: CompleteBlockTextureMapSchema,
  layout: BlockTextureManifestLayoutSchema,
  schemaVersion: Schema.Literal(MANIFEST_SCHEMA_VERSION),
  tileCount: AtlasLayoutIntegerSchema,
  variants: Schema.Record(Schema.String, Schema.Array(AtlasTileIndexSchema)),
})

const manifest = Schema.decodeUnknownSync(StaticBlockTextureManifestSchema)(blockTextureManifest)
const blockTypes = new Set<string>(BLOCK_TYPES)

export const TILE_BY_BLOCK_NAME: Readonly<Record<BlockType, TileAssignment>> = Object.freeze(manifest.blockFaces)

export const BLOCK_TEXTURE_ALPHA_MODES: Readonly<Record<BlockType, AlphaMode>> = Object.freeze(manifest.blockAlphaModes)

export const BLOCK_TEXTURE_VARIANTS: Readonly<Record<string, ReadonlyArray<AtlasTileIndex>>> = Object.freeze(
  Object.fromEntries(
    Object.entries(manifest.variants).map(([variantName, indices]) => [variantName, Object.freeze([...indices])]),
  ),
)

export const ANIMATED_TEXTURE_FRAMES: BlockTextureAnimationMap = Object.freeze({
  fire: Object.freeze({ fire: Object.freeze(manifest.animations.fire.fire) }),
  lava: Object.freeze({ lava: Object.freeze(manifest.animations.lava.lava) }),
  portal: Object.freeze({
    end_gateway: Object.freeze(manifest.animations.portal.end_gateway),
    end_portal: Object.freeze(manifest.animations.portal.end_portal),
    nether_portal: Object.freeze(manifest.animations.portal.nether_portal),
  }),
  water: Object.freeze({ water: Object.freeze(manifest.animations.water.water) }),
})

const manifestFailure = (reason: BlockTextureManifestFailureReason): Result.Result<never, BlockTextureManifestError> =>
  Result.fail({ _tag: 'BlockTextureManifestError', reason })

const isCompleteBlockFaceMap = (
  value: Readonly<Record<string, TileAssignment>>,
): value is CompleteBlockFaceMap =>
  Object.keys(value).length === BLOCK_TYPES.length &&
  BLOCK_TYPES.every((blockName) => Object.hasOwn(value, blockName))

const isCompleteBlockAlphaModeMap = (
  value: Readonly<Record<string, AlphaMode>>,
): value is CompleteBlockAlphaModeMap =>
  Object.keys(value).length === BLOCK_TYPES.length &&
  BLOCK_TYPES.every((blockName) => Object.hasOwn(value, blockName))

const isBlockType = (blockName: string): blockName is BlockType => blockTypes.has(blockName)

const layoutMatchesAtlas = (layout: BlockTextureManifest['layout']): boolean =>
  layout.width === ATLAS_PIXELS &&
  layout.height === ATLAS_PIXELS &&
  layout.columns === ATLAS_COLUMNS &&
  layout.rows === ATLAS_ROWS &&
  layout.tilePixels === TILE_PIXELS &&
  layout.gutterPixels === TILE_GUTTER_PIXELS &&
  layout.cellPixels === TILE_CELL_PIXELS &&
  layout.capacity === ATLAS_TILE_COUNT &&
  layout.mipLevels === ATLAS_MIP_LEVEL_COUNT

/** Decode an untrusted manifest and enforce the allocation order used by the atlas. */
const validateManifestEnvelope = (
  value: BlockTextureManifestWithCompleteFaces,
): Result.Result<BlockTextureManifestWithCompleteFaces, BlockTextureManifestError> => {
  if (!layoutMatchesAtlas(value.layout)) {
    return manifestFailure('layout')
  }
  if (value.tileCount > ATLAS_TILE_COUNT) {
    return manifestFailure('tile-count')
  }
  return Result.succeed(value)
}

type BaseFaceAllocation = Readonly<{
  readonly blockFaces: CompleteBlockFaceMap
  readonly nextTile: number
}>

const nextBaseTileAfterOrderedFaces = (
  blockFaces: CompleteBlockFaceMap,
): Result.Result<number, BlockTextureManifestError> => {
  let nextTile = FIRST_BLOCK_TEXTURE_TILE_INDEX
  for (const blockName of BLOCK_TYPES.filter((candidate) => candidate !== 'air')) {
    const assignment = blockFaces[blockName]
    if (
      assignment.top !== nextTile ||
      assignment.side !== nextTile + SIDE_FACE_TILE_OFFSET ||
      assignment.bottom !== nextTile + BOTTOM_FACE_TILE_OFFSET
    ) {
      return manifestFailure('base-face-order')
    }
    nextTile += FACE_TILE_COUNT
  }
  return Result.succeed(nextTile)
}

const validateBlockFaces = (
  blockFaces: CompleteBlockFaceMap,
): Result.Result<BaseFaceAllocation, BlockTextureManifestError> => {
  if (
    blockFaces.air.top !== AIR_TILE_INDEX ||
    blockFaces.air.side !== AIR_TILE_INDEX ||
    blockFaces.air.bottom !== AIR_TILE_INDEX
  ) {
    return manifestFailure('air-face')
  }
  return Result.map(nextBaseTileAfterOrderedFaces(blockFaces), (nextTile) => ({ blockFaces, nextTile }))
}

type VariantStageAllocation = Readonly<{
  readonly stages: ReadonlyArray<AtlasTileIndex>
  readonly nextTile: number
}>

const decodeVariantBlockName = (blockName: string): Result.Result<BlockType, BlockTextureManifestError> => {
  if (!isBlockType(blockName)) {
    return manifestFailure('variant-block')
  }
  return Result.succeed(blockName)
}

const validateVariantTileSequence = (
  stages: ReadonlyArray<AtlasTileIndex>,
  firstTile: number,
): Result.Result<number, BlockTextureManifestError> => {
  let nextTile = firstTile
  for (const tile of stages.slice(FIRST_VARIANT_ADDITIONAL_STAGE_INDEX)) {
    if (tile !== nextTile) {
      return manifestFailure('variant-order')
    }
    nextTile += TILE_INDEX_INCREMENT
  }
  return Result.succeed(nextTile)
}

type VariantStageInput = Readonly<{
  readonly faceTile: AtlasTileIndex
  readonly indices: ReadonlyArray<AtlasTileIndex>
  readonly nextTile: number
}>

const validateVariantStages = ({ faceTile, indices, nextTile }: VariantStageInput): Result.Result<
  VariantStageAllocation,
  BlockTextureManifestError
> => {
  if (indices.length === EMPTY_ARRAY_LENGTH) {
    return manifestFailure('variant-tiles')
  }
  const stages = Object.freeze([...indices])
  if (stages[FIRST_VARIANT_STAGE_INDEX] !== faceTile) {
    return manifestFailure('variant-alias')
  }
  return Result.map(validateVariantTileSequence(stages, nextTile), (followingTile) => ({
    nextTile: followingTile,
    stages,
  }))
}

type VariantEntryInput = Readonly<{
  readonly variantName: string
  readonly indices: ReadonlyArray<AtlasTileIndex>
  readonly blockFaces: CompleteBlockFaceMap
  readonly nextTile: number
}>

const decodeVariantStages = ({ variantName, indices, blockFaces, nextTile }: VariantEntryInput): Result.Result<
  VariantStageAllocation,
  BlockTextureManifestError
> =>
  Result.flatMap(decodeVariantBlockName(variantName), (blockName) =>
    validateVariantStages({ faceTile: blockFaces[blockName].top, indices, nextTile }),
  )

type VariantAllocation = Readonly<{
  readonly variants: Readonly<Record<string, ReadonlyArray<AtlasTileIndex>>>
  readonly nextTile: number
}>

const decodeVariants = (
  source: BlockTextureManifestDecoded['variants'],
  blockFaces: CompleteBlockFaceMap,
  firstTile: number,
): Result.Result<VariantAllocation, BlockTextureManifestError> => {
  const variants: Record<string, ReadonlyArray<AtlasTileIndex>> = {}
  let nextTile = firstTile
  for (const [variantName, indices] of Object.entries(source)) {
    const allocated = decodeVariantStages({ blockFaces, indices, nextTile, variantName })
    if (Result.isFailure(allocated)) {
      return Result.fail(allocated.failure)
    }
    const { nextTile: followingTile, stages } = allocated.success
    variants[variantName] = stages
    nextTile = followingTile
  }
  return Result.succeed({ nextTile, variants: Object.freeze(variants) })
}

const hasOnlyExpectedAnimationBlocks = (
  blocks: Readonly<Record<string, ReadonlyArray<AtlasTileIndex>>>,
  expected: ReadonlyArray<string>,
): boolean =>
  Object.keys(blocks).every((blockName) => expected.includes(blockName))

const decodeAnimationFrames = (
  blocks: Readonly<Record<string, ReadonlyArray<AtlasTileIndex>>>,
  blockName: string,
): Result.Result<AnimationFrameSequence, BlockTextureManifestError> => {
  const frames = blocks[blockName]
  if (frames === undefined) {
    return manifestFailure('animation-block')
  }
  const decoded = Schema.decodeUnknownResult(AnimationFrameSequenceSchema)(frames)
  if (Result.isFailure(decoded)) {
    return manifestFailure('animation-tiles')
  }
  return Result.succeed(Object.freeze(decoded.success))
}

const decodeAnimationGroupSources = (
  source: BlockTextureManifestDecoded['animations'],
): Result.Result<AnimationGroupSources, BlockTextureManifestError> => {
  const hasRequiredGroups =
    Object.keys(source).length === REQUIRED_ANIMATION_GROUPS.length &&
    REQUIRED_ANIMATION_GROUPS.every((group) => Object.hasOwn(source, group))
  if (!hasRequiredGroups) {
    return manifestFailure('animation-group')
  }
  const { fire, lava, portal, water } = source
  if (fire === undefined || lava === undefined || portal === undefined || water === undefined) {
    return manifestFailure('animation-group')
  }
  return Result.succeed({ fire, lava, portal, water })
}

const hasExpectedAnimationBlockCoverage = ({ fire, lava, portal, water }: AnimationGroupSources): boolean =>
  hasOnlyExpectedAnimationBlocks(fire, ['fire']) &&
  hasOnlyExpectedAnimationBlocks(lava, ['lava']) &&
  hasOnlyExpectedAnimationBlocks(portal, ['end_gateway', 'end_portal', 'nether_portal']) &&
  hasOnlyExpectedAnimationBlocks(water, ['water'])

const decodeAnimationGroupFrames = (
  groups: AnimationGroupSources,
): Result.Result<BlockTextureAnimationMap, BlockTextureManifestError> => {
  if (!hasExpectedAnimationBlockCoverage(groups)) {
    return manifestFailure('animation-block')
  }
  const { fire, lava, portal, water } = groups

  const decoded = Result.all({
    endGateway: decodeAnimationFrames(portal, 'end_gateway'),
    endPortal: decodeAnimationFrames(portal, 'end_portal'),
    fire: decodeAnimationFrames(fire, 'fire'),
    lava: decodeAnimationFrames(lava, 'lava'),
    netherPortal: decodeAnimationFrames(portal, 'nether_portal'),
    water: decodeAnimationFrames(water, 'water'),
  })
  return Result.map(decoded, ({ endGateway, endPortal, fire: fireFrames, lava: lavaFrames, netherPortal, water: waterFrames }) =>
    Object.freeze({
      fire: Object.freeze({ fire: fireFrames }),
      lava: Object.freeze({ lava: lavaFrames }),
      portal: Object.freeze({
        end_gateway: endGateway,
        end_portal: endPortal,
        nether_portal: netherPortal,
      }),
      water: Object.freeze({ water: waterFrames }),
    }),
  )
}

const decodeAnimationGroups = (source: BlockTextureManifestDecoded['animations']):
  Result.Result<BlockTextureAnimationMap, BlockTextureManifestError> =>
  Result.flatMap(decodeAnimationGroupSources(source), decodeAnimationGroupFrames)

const validateAnimationCoverage = (
  animations: BlockTextureAnimationMap,
  tileCount: number,
  nextVariantTile: number,
): Result.Result<void, BlockTextureManifestError> => {
  const animationTiles = [
    ...animations.fire.fire,
    ...animations.lava.lava,
    ...animations.portal.end_gateway,
    ...animations.portal.end_portal,
    ...animations.portal.nether_portal,
    ...animations.water.water,
  ]
    .sort((left, right) => left - right)
  const expectedAnimationTiles = Array.from(
    { length: tileCount - nextVariantTile },
    (_unused, index) => nextVariantTile + index,
  )
  if (
    animationTiles.length !== new Set(animationTiles).size ||
    animationTiles.some((tile, index) => tile !== expectedAnimationTiles[index])
  ) {
    return manifestFailure('animation-coverage')
  }
  return Result.succeed(undefined)
}

const validateManifestAllocations = (
  value: BlockTextureManifestWithCompleteFaces,
): Result.Result<BlockTextureManifest, BlockTextureManifestError> =>
  Result.flatMap(validateBlockFaces(value.blockFaces), (baseFaces) =>
    Result.flatMap(decodeVariants(value.variants, baseFaces.blockFaces, baseFaces.nextTile), (variants) =>
      Result.flatMap(decodeAnimationGroups(value.animations), (animations) =>
        Result.map(validateAnimationCoverage(animations, value.tileCount, variants.nextTile), () => Object.freeze({
          animations,
        blockAlphaModes: value.blockAlphaModes,
          blockFaces: baseFaces.blockFaces,
          layout: value.layout,
          schemaVersion: value.schemaVersion,
          tileCount: value.tileCount,
          variants: variants.variants,
        })),
      ),
    ),
  )

const validateManifestValue = (
  value: BlockTextureManifestWithCompleteFaces,
): Result.Result<BlockTextureManifest, BlockTextureManifestError> =>
  Result.flatMap(validateManifestEnvelope(value), validateManifestAllocations)

export const decodeBlockTextureManifest = (
  input: unknown,
): Result.Result<BlockTextureManifest, BlockTextureManifestError> => {
  const decoded = Schema.decodeUnknownResult(BlockTextureManifestSchema, { onExcessProperty: 'error' })(input)
  if (Result.isFailure(decoded)) {
    return manifestFailure('schema')
  }
  const { blockAlphaModes, blockFaces } = decoded.success
  if (!isCompleteBlockFaceMap(blockFaces)) {
    return manifestFailure('block-faces')
  }
  if (!isCompleteBlockAlphaModeMap(blockAlphaModes)) {
    return manifestFailure('block-alpha-modes')
  }
  return validateManifestValue({ ...decoded.success, blockAlphaModes, blockFaces })
}

export type BlockNameLookup = (blockId: BlockId) => unknown
export type TileIndexLookup = (
  blockId: BlockId,
  role: FaceRole,
  ...textureStage: [] | [unknown]
) => Result.Result<AtlasTileIndex, BlockTextureLookupError>
export type QuadTileLookup = (quad: GeometryQuad) => Result.Result<AtlasTileIndex, BlockTextureLookupError>

const lookupFailure = (
  blockName: unknown,
  role: FaceRole,
  reason: BlockTextureLookupError['reason'],
): BlockTextureLookupError => ({ _tag: 'BlockTextureLookupError', blockName, reason, role })

export const tileIndexForFaceAssignment = (
  blockName: unknown,
  role: FaceRole,
  assignment: unknown,
): Result.Result<AtlasTileIndex, BlockTextureLookupError> => {
  if (typeof blockName !== 'string' || !isBlockType(blockName)) {
    return Result.fail(lookupFailure(blockName, role, 'unknown-block'))
  }
  const decodedAssignment = Schema.decodeUnknownResult(TileAssignmentSchema)(assignment)
  if (Result.isFailure(decodedAssignment)) {
    return Result.fail(lookupFailure(blockName, role, 'invalid-tile-index'))
  }
  return Result.succeed(decodedAssignment.success[role])
}

const tileIndexForMissingStage = (
  blockName: BlockType,
  role: FaceRole,
): Result.Result<AtlasTileIndex, BlockTextureLookupError> => {
  if (BLOCKS_WITH_TEXTURE_STAGE.has(blockName)) {
    return Result.fail(lookupFailure(blockName, role, 'missing-texture-stage'))
  }
  return Result.succeed(TILE_BY_BLOCK_NAME[blockName][role])
}

const tileIndexForProvidedStage = (
  blockName: BlockType,
  role: FaceRole,
  textureStage: unknown,
): Result.Result<AtlasTileIndex, BlockTextureLookupError> => {
  const decodedTextureStage = Schema.decodeUnknownResult(PlantTextureStageSchema)(textureStage)
  if (Result.isFailure(decodedTextureStage)) {
    return Result.fail(lookupFailure(blockName, role, 'invalid-texture-stage'))
  }
  if (decodedTextureStage.success.blockType !== blockName) {
    return Result.fail(lookupFailure(blockName, role, 'texture-stage-block-mismatch'))
  }
  const variants = BLOCK_TEXTURE_VARIANTS[blockName]
  if (variants === undefined) {
    return Result.succeed(TILE_BY_BLOCK_NAME[blockName][role])
  }
  return tileIndexForVariantStage(
    variants,
    decodedTextureStage.success,
    { blockName, role },
  )
}

export const tileIndexForBlockName = (
  blockName: unknown,
  role: FaceRole,
  ...textureStage: [] | [unknown]
): Result.Result<AtlasTileIndex, BlockTextureLookupError> => {
  if (typeof blockName !== 'string' || !isBlockType(blockName)) {
    return Result.fail(lookupFailure(blockName, role, 'unknown-block'))
  }
  if (textureStage.length === EMPTY_ARRAY_LENGTH) {
    return tileIndexForMissingStage(blockName, role)
  }
  if (textureStage[FIRST_TEXTURE_STAGE_ARGUMENT] === MISSING_TEXTURE_STAGE) {
    return tileIndexForMissingStage(blockName, role)
  }
  return tileIndexForProvidedStage(blockName, role, textureStage[FIRST_TEXTURE_STAGE_ARGUMENT])
}

export const tileIndexResolver = (blockNameOf: BlockNameLookup): TileIndexLookup =>
  (blockId, role, ...textureStage) => tileIndexForBlockName(blockNameOf(blockId), role, ...textureStage)

export const quadTileFromResolver = (resolve: TileIndexLookup): QuadTileLookup =>
  (quad) => {
    if (Object.hasOwn(quad, 'textureStage') && 'textureStage' in quad) {
      return resolve(quad.blockId, quad.role, quad.textureStage)
    }
    return resolve(quad.blockId, quad.role, MISSING_TEXTURE_STAGE)
  }

export const quadTileForLookup = (blockNameOf: BlockNameLookup): QuadTileLookup =>
  quadTileFromResolver(tileIndexResolver(blockNameOf))

export const referencedTileIndices = (): ReadonlyArray<AtlasTileIndex> =>
  [
    ...new Set(
      Object.values(TILE_BY_BLOCK_NAME).flatMap((assignment) => [
        assignment.top,
        assignment.side,
        assignment.bottom,
      ]),
    ),
  ].sort((left, right) => left - right)
