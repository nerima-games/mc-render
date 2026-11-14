// SPDX-License-Identifier: CC0-1.0
import { Buffer } from 'node:buffer'
import { deflateSync } from 'node:zlib'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const PNG_HEADER_BYTES = 13
const COLOR_TYPE_RGBA = 6
const BIT_DEPTH_8 = 8
const NO_INTERLACE = 0
const FILTER_NONE = 0
const PNG_BYTES_PER_PIXEL = 4
const SCANLINE_FILTER_BYTES = 1
const CRC_POLYNOMIAL = 0xedb88320
const CRC_INITIAL = 0xffffffff
const CRC_FINAL_XOR = 0xffffffff
const CRC_TABLE_SIZE = 256
const CRC_BYTE_MASK = 0xff
const CRC_SHIFT = 8

const CRC_TABLE = Uint32Array.from({ length: CRC_TABLE_SIZE }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < CRC_SHIFT; bit += 1) {
    crc = (crc & 1) === 1 ? CRC_POLYNOMIAL ^ (crc >>> 1) : crc >>> 1
  }
  return crc >>> 0
})

const crc32 = (data: Uint8Array): number => {
  let crc = CRC_INITIAL
  for (const byte of data) {
    const index = (crc ^ byte) & CRC_BYTE_MASK
    crc = (CRC_TABLE[index] ?? 0) ^ (crc >>> CRC_SHIFT)
  }
  return (crc ^ CRC_FINAL_XOR) >>> 0
}

const pngChunk = (type: string, data: Uint8Array): Buffer => {
  const typeBytes = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.byteLength)
  chunk.writeUInt32BE(data.byteLength, 0)
  typeBytes.copy(chunk, 4)
  Buffer.from(data).copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.byteLength)), 8 + data.byteLength)
  return chunk
}

export const encodeRgbaPng = (width: number, height: number, pixels: Uint8Array): Uint8Array => {
  const rowBytes = width * PNG_BYTES_PER_PIXEL
  const scanlines = Buffer.alloc(height * (rowBytes + SCANLINE_FILTER_BYTES))
  for (let row = 0; row < height; row += 1) {
    const scanlineOffset = row * (rowBytes + SCANLINE_FILTER_BYTES)
    scanlines[scanlineOffset] = FILTER_NONE
    scanlines.set(pixels.subarray(row * rowBytes, (row + 1) * rowBytes), scanlineOffset + SCANLINE_FILTER_BYTES)
  }
  const header = Buffer.alloc(PNG_HEADER_BYTES)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = BIT_DEPTH_8
  header[9] = COLOR_TYPE_RGBA
  header[10] = 0
  header[11] = 0
  header[12] = NO_INTERLACE
  const imageData = deflateSync(scanlines, { level: 9 })
  return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', header), pngChunk('IDAT', imageData), pngChunk('IEND', Buffer.alloc(0))])
}
