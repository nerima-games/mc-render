import { describe, expect, it } from '@effect/vitest'
import { Euler, Vector3 } from 'three'
import { ENTITY_MODEL_CATALOG } from '../src/domain/entity-model-catalog.js'

const HALF_UNIT_CUBE_EXTENT = 0.5
const CUBE_CORNER_SIGNS = [-1, 1] as const
const ENTITY_MODEL_COUNT = 128
const BOUNDS_EPSILON = 1e-9

type ModelBounds = Readonly<{
  readonly minimumY: number
  readonly maximumY: number
  readonly widthX: number
  readonly depthZ: number
}>

const boundsFor = (parts: (typeof ENTITY_MODEL_CATALOG)[number]['parts']): ModelBounds => {
  const minimum = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
  const maximum = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)

  for (const part of parts) {
    const [sizeX, sizeY, sizeZ] = part.size
    const [centerX, centerY, centerZ] = part.center
    const [rotationX, rotationY, rotationZ] = part.rotation ?? [0, 0, 0]
    const rotation = new Euler(rotationX, rotationY, rotationZ, 'YXZ')

    for (const signX of CUBE_CORNER_SIGNS) {
      for (const signY of CUBE_CORNER_SIGNS) {
        for (const signZ of CUBE_CORNER_SIGNS) {
          const corner = new Vector3(
            signX * sizeX * HALF_UNIT_CUBE_EXTENT,
            signY * sizeY * HALF_UNIT_CUBE_EXTENT,
            signZ * sizeZ * HALF_UNIT_CUBE_EXTENT,
          )
            .applyEuler(rotation)
            .add(new Vector3(centerX, centerY, centerZ))
          minimum.min(corner)
          maximum.max(corner)
        }
      }
    }
  }

  return {
    minimumY: minimum.y,
    maximumY: maximum.y,
    widthX: maximum.x - minimum.x,
    depthZ: maximum.z - minimum.z,
  }
}

describe('entity model bounds', () => {
  it('places the lowest static model point at feetPosition for all kernel kinds', () => {
    expect(ENTITY_MODEL_CATALOG).toHaveLength(ENTITY_MODEL_COUNT)
    expect(new Set(ENTITY_MODEL_CATALOG.map(({ kind }) => kind))).toHaveLength(ENTITY_MODEL_COUNT)

    for (const model of ENTITY_MODEL_CATALOG) {
      const bounds = boundsFor(model.parts)
      expect(Math.abs(bounds.minimumY), `${model.kind} minimumY`).toBeLessThanOrEqual(BOUNDS_EPSILON)
    }
  })
})
