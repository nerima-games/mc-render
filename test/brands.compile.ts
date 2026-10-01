import {
  BlockId,
  ChunkKey,
  DeltaTimeSecs,
  FixedDurationSecs,
  SimulationTick,
  chunkCoord,
} from '@nerima-games/mc-kernel'
import { type ChunkView } from '@nerima-games/mc-meshing'
import { DEFAULT_TICK_DURATION } from '@nerima-games/mc-sim'
import { chunkKeyOf as worldgenChunkKeyOf } from '@nerima-games/mc-worldgen'

export const fixtureBlockId: BlockId = BlockId(1)
export const fixtureChunkKey: ChunkKey = ChunkKey('0,0')
export const fixtureTick: SimulationTick = SimulationTick(1)
export const fixtureFixedDuration: FixedDurationSecs = FixedDurationSecs(0.05)
export const fixtureDeltaTime: DeltaTimeSecs = DeltaTimeSecs(0.016)
export const fixtureSimDuration: FixedDurationSecs = DEFAULT_TICK_DURATION
export const fixtureWorldgenChunkKey: ChunkKey = worldgenChunkKeyOf(chunkCoord(0, 0))
export const fixtureMeshingBlocks: ChunkView['blocks'] = new Uint16Array(0)

// These assignments must remain rejected even though every value is numeric or textual.
// @ts-expect-error BlockId and ChunkKey are distinct brands.
export const rejectedBlockFromChunk: BlockId = fixtureChunkKey
// @ts-expect-error SimulationTick and FixedDurationSecs are distinct brands.
export const rejectedTickFromDuration: SimulationTick = fixtureFixedDuration
// @ts-expect-error FixedDurationSecs and DeltaTimeSecs are distinct brands.
export const rejectedFixedFromDelta: FixedDurationSecs = fixtureDeltaTime
// @ts-expect-error ChunkKey and SimulationTick are distinct brands.
export const rejectedChunkFromTick: ChunkKey = fixtureTick
