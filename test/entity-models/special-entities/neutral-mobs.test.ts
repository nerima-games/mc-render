import { describe, expect, it } from "@effect/vitest"
import { NEUTRAL_MOB_ENTITY_MODELS } from "../../../src/domain/entity-models/special-entities/neutral-mobs"

const expectedKinds = [
  "cave_spider",
  "enderman",
  "iron_golem",
  "piglin",
  "snow_golem",
  "spider",
  "zombified_piglin",
] as const

const visualSignature = (descriptor: (typeof NEUTRAL_MOB_ENTITY_MODELS)[number]): string =>
  JSON.stringify(
    descriptor.parts
      .map(({ role, size, center, color }) => ({ role, size, center, color }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  )

describe("neutral mob entity models", () => {
  it("covers every assigned kind exactly once", () => {
    expect(NEUTRAL_MOB_ENTITY_MODELS).toHaveLength(expectedKinds.length)
    expect(NEUTRAL_MOB_ENTITY_MODELS.map(({ kind }) => kind).sort()).toStrictEqual([...expectedKinds].sort())
  })

  it("gives every kind non-empty visible cuboid geometry", () => {
    for (const descriptor of NEUTRAL_MOB_ENTITY_MODELS) {
      expect(descriptor.parts.length, descriptor.kind).toBeGreaterThan(0)
      for (const { role, size, center, color } of descriptor.parts) {
        expect(role.length, `${descriptor.kind} role`).toBeGreaterThan(0)
        expect(size.every((axis) => Number.isFinite(axis) && axis > 0), `${descriptor.kind} size`).toBe(true)
        expect(center.every(Number.isFinite), `${descriptor.kind} center`).toBe(true)
        expect(color.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255), `${descriptor.kind} color`).toBe(true)
        expect(color.some((channel) => channel > 0), `${descriptor.kind} visible color`).toBe(true)
      }
    }
  })

  it("gives every kind a distinct visible signature independent of part IDs", () => {
    const signatures = NEUTRAL_MOB_ENTITY_MODELS.map(visualSignature)
    expect(new Set(signatures).size).toBe(expectedKinds.length)
  })

  it("models eight distinct legs on each spider", () => {
    for (const kind of ["cave_spider", "spider"] as const) {
      const descriptor = NEUTRAL_MOB_ENTITY_MODELS.find((model) => model.kind === kind)
      expect(descriptor, kind).toBeDefined()
      expect(descriptor?.parts.filter(({ role }) => role === "leg")).toHaveLength(8)
    }
  })
})
