import { describe, expect, it } from "vitest"
import { ANIMAL_ENTITY_MODELS } from "../../src/domain/entity-models/animals.js"

const EXPECTED_KINDS = [
  "allay",
  "armadillo",
  "axolotl",
  "bat",
  "camel",
  "cat",
  "chicken",
  "cod",
  "cow",
  "dolphin",
  "donkey",
  "fox",
  "frog",
  "glow_squid",
  "horse",
  "mooshroom",
  "mule",
  "ocelot",
  "parrot",
  "pig",
  "pufferfish",
  "rabbit",
  "salmon",
  "sheep",
  "skeleton_horse",
  "sniffer",
  "squid",
  "strider",
  "tadpole",
  "tropical_fish",
  "turtle",
  "zombie_horse",
  "bee",
  "goat",
  "llama",
  "trader_llama",
  "panda",
  "polar_bear",
  "wolf",
] as const

const visualSignature = (descriptor: (typeof ANIMAL_ENTITY_MODELS)[number]): string =>
  JSON.stringify(
    descriptor.parts
      .map(({ role, size, center, color }) => ({ role, size, center, color }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  )

describe("animal entity model descriptors", () => {
  it("defines a cuboid model for each assigned animal kind", () => {
    expect(ANIMAL_ENTITY_MODELS.map(({ kind }) => kind)).toHaveLength(EXPECTED_KINDS.length)
    expect(new Set(ANIMAL_ENTITY_MODELS.map(({ kind }) => kind))).toEqual(new Set(EXPECTED_KINDS))

    for (const descriptor of ANIMAL_ENTITY_MODELS) {
      expect(descriptor.parts.length, descriptor.kind).toBeGreaterThan(0)
      for (const { size, center, color } of descriptor.parts) {
        expect(size, `${descriptor.kind} has positive cuboid dimensions`).toHaveLength(3)
        expect(size.every((component) => Number.isFinite(component) && component > 0)).toBe(true)
        expect(center, `${descriptor.kind} has a finite cuboid center`).toHaveLength(3)
        expect(center.every(Number.isFinite)).toBe(true)
        expect(color, `${descriptor.kind} has a visible RGB color`).toHaveLength(3)
        expect(color.every((component) => Number.isFinite(component) && component >= 0 && component <= 255)).toBe(true)
      }
    }
  })

  it("gives every animal a distinct rendered visual signature", () => {
    const signatures = ANIMAL_ENTITY_MODELS.map(visualSignature)
    expect(new Set(signatures).size).toBe(EXPECTED_KINDS.length)
  })
})
