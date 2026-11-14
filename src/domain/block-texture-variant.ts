import type { AtlasTileIndex } from './texture-atlas.js'
import type { PlantTextureStage } from '@nerima-games/mc-meshing'
import type { BlockTextureLookupError } from './block-texture-map.js'
import { Result } from 'effect'

type VariantLookupContext = Pick<BlockTextureLookupError, 'blockName' | 'role'>

export const tileIndexForVariantStage = (
  variants: ReadonlyArray<AtlasTileIndex>,
  textureStage: PlantTextureStage,
  context: VariantLookupContext,
): Result.Result<AtlasTileIndex, BlockTextureLookupError> => {
  if (textureStage.blockType !== context.blockName) {
    return Result.fail({
      _tag: 'BlockTextureLookupError',
      blockName: context.blockName,
      reason: 'texture-stage-block-mismatch',
      role: context.role,
    })
  }
  const variant = variants[textureStage.stage]
  if (variant === undefined) {
    return Result.fail({
      _tag: 'BlockTextureLookupError',
      blockName: context.blockName,
      reason: 'missing-texture-variant',
      role: context.role,
    })
  }
  return Result.succeed(variant)
}
