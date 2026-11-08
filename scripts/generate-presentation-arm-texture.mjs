import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import {
  FIRST_PERSON_ARM_TEXTURE_HEIGHT,
  FIRST_PERSON_ARM_TEXTURE_WIDTH,
  makeFirstPersonArmTextureData,
} from '../src/application/render-presentation-assets.ts'

const OUTPUT_PATH = fileURLToPath(new URL('../assets/presentation/first-person-arm.png', import.meta.url))
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')
const PNG_COLOR_TYPE_RGBA = 6
const PNG_BIT_DEPTH = 8
const BYTES_PER_PIXEL = 4
const FILTER_NONE = 0
const CRC_POLYNOMIAL = 0xedb88320
const PNG_CHUNK_LENGTH_FIELD_BYTES = 4
const PNG_CHUNK_PREFIX_BYTES = 8
const PNG_HEADER_BYTES = 13
const PNG_WIDTH_OFFSET = 0
const PNG_HEIGHT_OFFSET = 4
const PNG_BIT_DEPTH_OFFSET = 8
const PNG_COLOR_TYPE_OFFSET = 9
const PNG_COMPRESSION_OFFSET = 10
const PNG_FILTER_METHOD_OFFSET = 11
const PNG_INTERLACE_OFFSET = 12
const PNG_FILTER_BYTE_COUNT = 1
const CRC_BITS_PER_BYTE = 8
const CRC_INITIAL_VALUE = 0xffffffff
const CRC_FINAL_XOR = 0xffffffff

const crc32 = (data) => {
  let crc = CRC_INITIAL_VALUE
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < CRC_BITS_PER_BYTE; bit += 1) {
      const mask = -(crc & 1)
      crc = (crc >>> 1) ^ (CRC_POLYNOMIAL & mask)
    }
  }
  return (crc ^ CRC_FINAL_XOR) >>> 0
}

const pngChunk = (name, data) => {
  const type = Buffer.from(name, 'ascii')
  const content = Buffer.concat([type, data])
  const chunk = Buffer.alloc(PNG_CHUNK_PREFIX_BYTES + content.length)
  chunk.writeUInt32BE(data.length, 0)
  content.copy(chunk, PNG_CHUNK_LENGTH_FIELD_BYTES)
  chunk.writeUInt32BE(crc32(content), PNG_CHUNK_LENGTH_FIELD_BYTES + content.length)
  return chunk
}

const pngRows = (data, width, height) => {
  const rowLength = width * BYTES_PER_PIXEL
  const rows = Buffer.alloc(height * (rowLength + PNG_FILTER_BYTE_COUNT))
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * rowLength
    const targetOffset = row * (rowLength + PNG_FILTER_BYTE_COUNT)
    rows[targetOffset] = FILTER_NONE
    Buffer.from(data.buffer, data.byteOffset + sourceOffset, rowLength).copy(rows, targetOffset + PNG_FILTER_BYTE_COUNT)
  }
  return rows
}

const pngHeader = (width, height) => {
  const header = Buffer.alloc(PNG_HEADER_BYTES)
  header.writeUInt32BE(width, PNG_WIDTH_OFFSET)
  header.writeUInt32BE(height, PNG_HEIGHT_OFFSET)
  header[PNG_BIT_DEPTH_OFFSET] = PNG_BIT_DEPTH
  header[PNG_COLOR_TYPE_OFFSET] = PNG_COLOR_TYPE_RGBA
  header[PNG_COMPRESSION_OFFSET] = FILTER_NONE
  header[PNG_FILTER_METHOD_OFFSET] = FILTER_NONE
  header[PNG_INTERLACE_OFFSET] = FILTER_NONE
  return header
}

const textureData = makeFirstPersonArmTextureData()
const output = Buffer.concat([
  PNG_SIGNATURE,
  pngChunk('IHDR', pngHeader(FIRST_PERSON_ARM_TEXTURE_WIDTH, FIRST_PERSON_ARM_TEXTURE_HEIGHT)),
  pngChunk('IDAT', deflateSync(pngRows(textureData, FIRST_PERSON_ARM_TEXTURE_WIDTH, FIRST_PERSON_ARM_TEXTURE_HEIGHT), { level: 9 })),
  pngChunk('IEND', Buffer.alloc(0)),
])

await mkdir(dirname(OUTPUT_PATH), { recursive: true })
await writeFile(OUTPUT_PATH, output)
