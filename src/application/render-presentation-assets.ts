export type RenderPresentationTexture = Readonly<{
  readonly isTexture: true
}>

const ARM_TEXTURE_WIDTH = 16
const ARM_TEXTURE_HEIGHT = 32
export const FIRST_PERSON_ARM_TEXTURE_WIDTH: typeof ARM_TEXTURE_WIDTH = ARM_TEXTURE_WIDTH
export const FIRST_PERSON_ARM_TEXTURE_HEIGHT: typeof ARM_TEXTURE_HEIGHT = ARM_TEXTURE_HEIGHT

const ARM_SLEEVE_HEIGHT = 24
const ARM_CUFF_ROW = 23
const ARM_SEAM_PERIOD = 8
const ARM_EDGE_INSET = 1
const ARM_EDGE_LEFT = ARM_EDGE_INSET
const ARM_EDGE_RIGHT = ARM_TEXTURE_WIDTH - ARM_EDGE_INSET - ARM_EDGE_INSET
const ARM_HIGHLIGHT_PERIOD = 11
const ARM_OPAQUE_ALPHA = 255
const ARM_RGBA_CHANNEL_COUNT = 4
const ARM_PIXEL_INDEX_START = 0
const ARM_PIXEL_INDEX_STEP = 1
const ARM_GREEN_CHANNEL_INDEX = 1
const ARM_BLUE_CHANNEL_INDEX = 2
const ARM_ALPHA_CHANNEL_INDEX = 3
const ARM_RED_SHIFT = 16
const ARM_GREEN_SHIFT = 8
const ARM_COLOR_BYTE_MASK = 0xff
const ARM_ZERO_REMAINDER = 0

const ARM_PALETTE = {
  cuff: 0x5e4336,
  cuffHighlight: 0x785542,
  fabric: 0x976f51,
  fabricHighlight: 0xb28965,
  fabricShadow: 0x775641,
  skin: 0xcd916c,
  skinHighlight: 0xe0a780,
  skinShadow: 0xab6e52,
} as const

const armSkinPixel = (x: number, y: number): number => {
  if (x === ARM_EDGE_LEFT || x === ARM_EDGE_RIGHT) {
    return ARM_PALETTE.skinShadow
  }
  if ((x + y) % ARM_HIGHLIGHT_PERIOD === ARM_ZERO_REMAINDER) {
    return ARM_PALETTE.skinHighlight
  }
  return ARM_PALETTE.skin
}

const armSleevePixel = (x: number, y: number): number => {
  if (x === ARM_EDGE_LEFT || x === ARM_EDGE_RIGHT || y % ARM_SEAM_PERIOD === ARM_ZERO_REMAINDER) {
    return ARM_PALETTE.fabricShadow
  }
  if ((x + y) % ARM_HIGHLIGHT_PERIOD === ARM_ZERO_REMAINDER) {
    return ARM_PALETTE.fabricHighlight
  }
  return ARM_PALETTE.fabric
}

const armPixel = (x: number, y: number): number => {
  if (y >= ARM_SLEEVE_HEIGHT) {
    if (y === ARM_SLEEVE_HEIGHT) {
      return ARM_PALETTE.cuff
    }
    return armSkinPixel(x, y)
  }
  if (y === ARM_CUFF_ROW) {
    return ARM_PALETTE.cuffHighlight
  }
  return armSleevePixel(x, y)
}

type ArmPixelWriteInput = Readonly<{ color: number; data: Uint8Array; offset: number }>

const writeArmPixel = ({ color, data, offset }: ArmPixelWriteInput): void => {
  data[offset] = (color >> ARM_RED_SHIFT) & ARM_COLOR_BYTE_MASK
  data[offset + ARM_GREEN_CHANNEL_INDEX] = (color >> ARM_GREEN_SHIFT) & ARM_COLOR_BYTE_MASK
  data[offset + ARM_BLUE_CHANNEL_INDEX] = color & ARM_COLOR_BYTE_MASK
  data[offset + ARM_ALPHA_CHANNEL_INDEX] = ARM_OPAQUE_ALPHA
}

/** Row-major, top-to-bottom RGBA bytes for a host-created DataTexture. */
export const makeFirstPersonArmTextureData: () => Uint8Array = (): Uint8Array => {
  const data = new Uint8Array(ARM_TEXTURE_WIDTH * ARM_TEXTURE_HEIGHT * ARM_RGBA_CHANNEL_COUNT)
  for (let y = ARM_PIXEL_INDEX_START; y < ARM_TEXTURE_HEIGHT; y += ARM_PIXEL_INDEX_STEP) {
    for (let x = ARM_PIXEL_INDEX_START; x < ARM_TEXTURE_WIDTH; x += ARM_PIXEL_INDEX_STEP) {
      const offset = (y * ARM_TEXTURE_WIDTH + x) * ARM_RGBA_CHANNEL_COUNT
      writeArmPixel({ color: armPixel(x, y), data, offset })
    }
  }
  return data
}

/** Texture slots for the replaceable, non-game assets used by presentation effects. */
export type RenderPresentationTextures<TTexture extends RenderPresentationTexture = RenderPresentationTexture> = Readonly<{
  readonly arm?: TTexture
  readonly cracks?: TTexture
  /** The RN5 terrain atlas; block item descriptors select a tile UV region from it. */
  readonly heldItem?: TTexture
  readonly moon?: TTexture
  readonly sun?: TTexture
}>
