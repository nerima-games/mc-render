import type { AtlasTileIndex } from './texture-atlas.js'
import { Result } from 'effect'
import type { FaceRole } from './meshing-vocabulary.js'
import type { BlockTextureLookupError } from './block-texture-map.js'

export const tileIndexForVariantStage = (
  variants: ReadonlyArray<AtlasTileIndex>,
  stage: number,
  blockName: unknown,
  role: FaceRole,
): Result.Result<AtlasTileIndex, BlockTextureLookupError> => {
  const variant = variants[stage]
  if (variant === undefined) {
    return Result.fail({
      _tag: 'BlockTextureLookupError',
      blockName,
      reason: 'missing-texture-variant',
      role,
    })
  }
  return Result.succeed(variant)
}
