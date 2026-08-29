import { CHUNK_SIZE_XZ } from '@nerima-games/mc-kernel'
import { Schema } from 'effect'

/** Horizontal extent of a chunk, shared with the kernel's coordinate system. */
export const CHUNK_SIZE = CHUNK_SIZE_XZ

const LOD_LEVEL_ORIGINAL = 0
const LOD_LEVEL_HALF = 1
const LOD_LEVEL_QUARTER = 2

/** The levels, from the original mesh to the coarsest simplified mesh. */
export const LOD_LEVELS = [LOD_LEVEL_ORIGINAL, LOD_LEVEL_HALF, LOD_LEVEL_QUARTER] as const

export type LodLevel = (typeof LOD_LEVELS)[number]

/** Runtime validation for a LOD level received from an untyped boundary. */
export const LodLevelSchema = Schema.Literal(...LOD_LEVELS)

/** Number of blocks represented by one grid cell at each LOD level. */
const STEP_ORIGINAL = 1
const STEP_HALF = 2
const STEP_QUARTER = 4
export const STEP_FOR_LOD: Readonly<Record<LodLevel, number>> = {
  [LOD_LEVEL_ORIGINAL]: STEP_ORIGINAL,
  [LOD_LEVEL_HALF]: STEP_HALF,
  [LOD_LEVEL_QUARTER]: STEP_QUARTER,
}
