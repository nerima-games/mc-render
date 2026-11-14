import { describe, expect, it } from '@effect/vitest'
import { Euler, Vector3 } from 'three'
import { ENTITY_MODEL_CATALOG } from '../src/domain/entity-model-catalog.js'
import modelDesignDimensions from '../scripts/entity-models/model-design-dimensions.json' with { type: 'json' }

const HALF_UNIT_CUBE_EXTENT = 0.5
const CUBE_CORNER_SIGNS = [-1, 1] as const
const ENTITY_MODEL_COUNT = 128
const BOUNDS_EPSILON = 1e-9
const MINIMUM_DESIGN_DIMENSION_FILL = 0.99

type ModelBounds = Readonly<{
  readonly minimumY: number
  readonly widthX: number
  readonly depthZ: number
  readonly height: number
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
    widthX: maximum.x - minimum.x,
    depthZ: maximum.z - minimum.z,
    height: maximum.y - minimum.y,
  }
}

describe('entity model bounds', () => {
  it('grounds every kernel model at feetPosition and covers all design dimensions', () => {
    const modelKinds = ENTITY_MODEL_CATALOG.map(({ kind }) => String(kind)).toSorted()
    const designKinds = Object.keys(modelDesignDimensions.dimensions).toSorted()
    const dimensionsByKind = new Map(Object.entries(modelDesignDimensions.dimensions))
    expect(modelKinds).toHaveLength(ENTITY_MODEL_COUNT)
    expect(new Set(modelKinds)).toHaveLength(ENTITY_MODEL_COUNT)
    expect(designKinds).toStrictEqual(modelKinds)

    for (const model of ENTITY_MODEL_CATALOG) {
      const kind = String(model.kind)
      const design = dimensionsByKind.get(kind)
      expect(design, `${kind} design dimensions`).toBeDefined()
      if (design !== undefined) {
        const bounds = boundsFor(model.parts)
        expect(Math.abs(bounds.minimumY), `${kind} minimumY`).toBeLessThanOrEqual(BOUNDS_EPSILON)
        const modelWidth = Math.max(bounds.widthX, bounds.depthZ)
        expect(modelWidth, `${kind} model width exceeds art design`).toBeLessThanOrEqual(design.width + BOUNDS_EPSILON)
        expect(modelWidth, `${kind} model width is undersized`).toBeGreaterThanOrEqual(
          design.width * MINIMUM_DESIGN_DIMENSION_FILL,
        )
        expect(bounds.height, `${kind} model height exceeds art design`).toBeLessThanOrEqual(
          design.height + BOUNDS_EPSILON,
        )
        expect(bounds.height, `${kind} model height is undersized`).toBeGreaterThanOrEqual(
          design.height * MINIMUM_DESIGN_DIMENSION_FILL,
        )
      }
    }
  })
})
