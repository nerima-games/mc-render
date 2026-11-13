import { describe, expect, it } from '@effect/vitest'
import { DRAGON_ENTITY_MODELS } from '../../src/domain/entity-models/dragon.js'

describe('ender dragon entity model', () => {
  it('defines exactly the ender_dragon kind', () => {
    expect(DRAGON_ENTITY_MODELS.map(({ kind }) => kind)).toStrictEqual(['ender_dragon'])
  })

  it('has substantial visible cuboid geometry for a large dragon silhouette', () => {
    for (const descriptor of DRAGON_ENTITY_MODELS) {
      expect(descriptor.parts.length, descriptor.kind).toBeGreaterThanOrEqual(30)
      expect(new Set(descriptor.parts.map(({ id }) => id)).size).toBe(descriptor.parts.length)

      for (const { role, size, center, color, rotation } of descriptor.parts) {
        expect(role.length, `${descriptor.kind} role`).toBeGreaterThan(0)
        expect(size).toHaveLength(3)
        expect(size.every((axis) => Number.isFinite(axis) && axis > 0), `${descriptor.kind} size`).toBe(true)
        expect(center).toHaveLength(3)
        expect(center.every(Number.isFinite), `${descriptor.kind} center`).toBe(true)
        expect(color).toHaveLength(3)
        expect(color.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255), `${descriptor.kind} color`).toBe(true)
        expect(color.some((channel) => channel > 0), `${descriptor.kind} visible color`).toBe(true)
        if (rotation !== undefined) {
          expect(rotation).toHaveLength(3)
          expect(rotation.every(Number.isFinite), `${descriptor.kind} rotation`).toBe(true)
        }
      }

      const roles = new Set(descriptor.parts.map(({ role }) => role))
      for (const role of ['head', 'horn', 'neck', 'body', 'wing', 'tail', 'leg']) {
        expect(roles, `${descriptor.kind} ${role} geometry`).toContain(role)
      }

      const wings = descriptor.parts.filter(({ role }) => role === 'wing')
      const leftWingSpan = Math.max(...wings.filter(({ center }) => center[0] < 0).map(({ center, size }) => -center[0] + size[0] / 2))
      const rightWingSpan = Math.max(...wings.filter(({ center }) => center[0] > 0).map(({ center, size }) => center[0] + size[0] / 2))
      expect(leftWingSpan).toBeGreaterThan(3.8)
      expect(rightWingSpan).toBeGreaterThan(3.8)
      expect(new Set(descriptor.parts.map(({ color }) => color.join(','))).size).toBeGreaterThan(4)
    }
  })
})
