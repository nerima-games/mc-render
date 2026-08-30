import { COLOR_COMPONENTS } from '../domain/chunk-geometry.js'

export type UnitCubeBuffers = Readonly<{
  readonly colors: Uint8Array
  readonly indices: Uint32Array
  readonly positions: Float32Array
}>

const CUBE_MIN = -0.5
const CUBE_MAX = 0.5
const UNIT_CUBE_VERTEX_COUNT = 8

const CUBE_VERTEX_0 = 0
const CUBE_VERTEX_1 = 1
const CUBE_VERTEX_2 = 2
const CUBE_VERTEX_3 = 3
const CUBE_VERTEX_4 = 4
const CUBE_VERTEX_5 = 5
const CUBE_VERTEX_6 = 6
const CUBE_VERTEX_7 = 7

export const makeUnitCubeBuffers = (color: readonly [number, number, number]): UnitCubeBuffers => {
  const positions = new Float32Array([
    CUBE_MIN,
    CUBE_MIN,
    CUBE_MIN,
    CUBE_MAX,
    CUBE_MIN,
    CUBE_MIN,
    CUBE_MAX,
    CUBE_MAX,
    CUBE_MIN,
    CUBE_MIN,
    CUBE_MAX,
    CUBE_MIN,
    CUBE_MIN,
    CUBE_MIN,
    CUBE_MAX,
    CUBE_MAX,
    CUBE_MIN,
    CUBE_MAX,
    CUBE_MAX,
    CUBE_MAX,
    CUBE_MAX,
    CUBE_MIN,
    CUBE_MAX,
    CUBE_MAX,
  ])
  const colors = new Uint8Array(UNIT_CUBE_VERTEX_COUNT * COLOR_COMPONENTS)
  for (let offset = 0; offset < colors.length; offset += COLOR_COMPONENTS) {
    colors.set(color, offset)
  }
  return {
    colors,
    indices: new Uint32Array([
      CUBE_VERTEX_0,
      CUBE_VERTEX_2,
      CUBE_VERTEX_1,
      CUBE_VERTEX_0,
      CUBE_VERTEX_3,
      CUBE_VERTEX_2,
      CUBE_VERTEX_4,
      CUBE_VERTEX_5,
      CUBE_VERTEX_6,
      CUBE_VERTEX_4,
      CUBE_VERTEX_6,
      CUBE_VERTEX_7,
      CUBE_VERTEX_0,
      CUBE_VERTEX_4,
      CUBE_VERTEX_7,
      CUBE_VERTEX_0,
      CUBE_VERTEX_7,
      CUBE_VERTEX_3,
      CUBE_VERTEX_1,
      CUBE_VERTEX_2,
      CUBE_VERTEX_6,
      CUBE_VERTEX_1,
      CUBE_VERTEX_6,
      CUBE_VERTEX_5,
      CUBE_VERTEX_0,
      CUBE_VERTEX_1,
      CUBE_VERTEX_5,
      CUBE_VERTEX_0,
      CUBE_VERTEX_5,
      CUBE_VERTEX_4,
      CUBE_VERTEX_3,
      CUBE_VERTEX_7,
      CUBE_VERTEX_6,
      CUBE_VERTEX_3,
      CUBE_VERTEX_6,
      CUBE_VERTEX_2,
    ]),
    positions,
  }
}
