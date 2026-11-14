import type { AtlasTileIndex } from './texture-atlas.js'
import type { BlockTextureLookupError } from './block-texture-map.js'
import { Result } from 'effect'

type VariantLookupContext = Pick<BlockTextureLookupError, 'blockName' | 'role'>

export const tileIndexForVariantStage = (
  variants: ReadonlyArray<AtlasTileIndex>,
  stage: number,
  context: VariantLookupContext,
): Result.Result<AtlasTileIndex, BlockTextureLookupError> => {
  const variant = variants[stage]
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
