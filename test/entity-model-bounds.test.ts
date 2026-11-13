import { describe, expect, it } from '@effect/vitest'
import { Euler, Vector3 } from 'three'
import { ENTITY_MODEL_CATALOG } from '../src/domain/entity-model-catalog.js'
import collisionDimensions from '../scripts/entity-models/collision-dimensions.json' with { type: 'json' }

const HALF_UNIT_CUBE_EXTENT = 0.5
const CUBE_CORNER_SIGNS = [-1, 1] as const
const ENTITY_MODEL_COUNT = 128
const BOUNDS_EPSILON = 1e-9
const COLLISION_DIMENSION_RELATIVE_TOLERANCE = 0.1
const NON_NUMERIC_REFERENCE_STATUSES = new Set(['configurable', 'none', 'unavailable', 'variable'])

type ModelBounds = Readonly<{
  readonly minimumY: number
  readonly maximumY: number
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
    maximumY: maximum.y,
    widthX: maximum.x - minimum.x,
    depthZ: maximum.z - minimum.z,
    height: maximum.y - minimum.y,
  }
}

const relativeError = (actual: number, expected: number): number => Math.abs(actual - expected) / expected

describe('entity model bounds', () => {
  it('places the lowest static model point at feetPosition for all kernel kinds', () => {
    expect(ENTITY_MODEL_CATALOG).toHaveLength(ENTITY_MODEL_COUNT)
    expect(new Set(ENTITY_MODEL_CATALOG.map(({ kind }) => kind))).toHaveLength(ENTITY_MODEL_COUNT)

    for (const model of ENTITY_MODEL_CATALOG) {
      const bounds = boundsFor(model.parts)
      expect(Math.abs(bounds.minimumY), `${model.kind} minimumY`).toBeLessThanOrEqual(BOUNDS_EPSILON)
    }
  })

  it('keeps each model close to its Java Edition collision reference', () => {
    const modelKinds = ENTITY_MODEL_CATALOG.map(({ kind }) => String(kind)).toSorted()
    const referenceKinds = collisionDimensions.entities.map(({ kind }) => kind).toSorted()
    expect(modelKinds).toHaveLength(ENTITY_MODEL_COUNT)
    expect(new Set(modelKinds)).toHaveLength(ENTITY_MODEL_COUNT)
    expect(referenceKinds).toStrictEqual(modelKinds)

    for (const model of ENTITY_MODEL_CATALOG) {
      const kind = String(model.kind)
      const reference = collisionDimensions.entities.find((entry) => entry.kind === kind)
      expect(reference, `${kind} collision reference`).toBeDefined()
      if (reference === undefined) {
        continue
      }
      const bounds = boundsFor(model.parts)
      const modelWidth = Math.max(bounds.widthX, bounds.depthZ)
      if (typeof reference.width === 'number') {
        expect(
          relativeError(modelWidth, reference.width),
          `${kind} model width ${modelWidth} vs reference ${reference.width}`,
        ).toBeLessThanOrEqual(COLLISION_DIMENSION_RELATIVE_TOLERANCE)
      }
      if (typeof reference.height === 'number') {
        expect(
          relativeError(bounds.height, reference.height),
          `${kind} model height ${bounds.height} vs reference ${reference.height}`,
        ).toBeLessThanOrEqual(COLLISION_DIMENSION_RELATIVE_TOLERANCE)
      }
      if (reference.width === null || reference.height === null) {
        expect(NON_NUMERIC_REFERENCE_STATUSES.has(reference.status)).toBe(true)
      }
    }
  })
})
