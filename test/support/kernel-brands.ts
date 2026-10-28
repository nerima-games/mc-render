import {
  AngleRadians,
  BlockAxis,
  BlockId,
  ChunkAxis,
  PositionAxis,
  blockPosition as kernelBlockPosition,
  chunkCoord as kernelChunkCoord,
  position as kernelPosition,
  type BlockPosition,
  type ChunkCoord,
  type Position,
} from '@nerima-games/mc-kernel'

export const blockId: typeof BlockId = BlockId
export const angleRadians: typeof AngleRadians = AngleRadians

export const chunkCoord: (cx: number, cz: number) => ChunkCoord = (cx, cz) =>
  kernelChunkCoord(ChunkAxis(cx), ChunkAxis(cz))

export const position: (x: number, y: number, z: number) => Position = (x, y, z) =>
  kernelPosition(PositionAxis(x), PositionAxis(y), PositionAxis(z))

export const blockPosition: (x: number, y: number, z: number) => BlockPosition = (x, y, z) =>
  kernelBlockPosition(BlockAxis(x), BlockAxis(y), BlockAxis(z))
