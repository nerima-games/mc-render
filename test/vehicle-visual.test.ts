import { describe, expect, it } from '@effect/vitest'
import type { OccupantId, Vehicle, VehicleId } from '@nerima-games/mc-sim'
import {
  interpolateVehicle,
  planVehicleVisual,
  vehicleVisualDescriptor,
  type VehicleRenderPlan,
} from '../src/index'

const vehicle = (overrides: Partial<Vehicle> = {}): Vehicle => ({
  id: 'v:7' as VehicleId,
  type: 'boat',
  dimension: 'overworld',
  position: { x: 2, y: 4, z: 6 },
  velocity: { x: 0, y: 0, z: 0 },
  yawRadians: 0,
  ...overrides,
})

describe('vehicle visual descriptors', () => {
  it('publishes stable distinct boat and minecart silhouettes', () => {
    const boat = vehicleVisualDescriptor('boat')
    const minecart = vehicleVisualDescriptor('minecart')

    expect(vehicleVisualDescriptor('boat')).toBe(boat)
    expect(vehicleVisualDescriptor('minecart')).toBe(minecart)
    expect(boat.type).toBe('boat')
    expect(minecart.type).toBe('minecart')
    expect(boat.parts).not.toStrictEqual(minecart.parts)
    for (const descriptor of [boat, minecart]) {
      expect(new Set(descriptor.parts.map(({ id }) => id)).size).toBe(descriptor.parts.length)
      expect(descriptor.parts.every(({ size }) => size.every((component) => component > 0))).toBe(true)
    }
  })
})

describe('vehicle interpolation', () => {
  it('interpolates transforms and takes the shortest path across the yaw seam', () => {
    const previous = vehicle({
      position: { x: 0, y: 2, z: 4 },
      velocity: { x: 0, y: 0, z: 2 },
      yawRadians: (170 * Math.PI) / 180,
    })
    const current = vehicle({
      position: { x: 10, y: 4, z: 8 },
      velocity: { x: 4, y: 2, z: 0 },
      yawRadians: (-170 * Math.PI) / 180,
    })
    const sample = interpolateVehicle(previous, current, 0.5)

    expect(sample.position).toStrictEqual({ x: 5, y: 3, z: 6 })
    expect(sample.velocity).toStrictEqual({ x: 2, y: 1, z: 1 })
    expect(Math.abs(sample.yawRadians)).toBeCloseTo(Math.PI, 12)
  })

  it('clamps invalid amounts and does not blend unrelated vehicles', () => {
    const current = vehicle({ position: { x: 10, y: 4, z: 8 }, yawRadians: 2 })
    expect(interpolateVehicle(vehicle(), current, Number.NaN).position).toStrictEqual(vehicle().position)
    expect(interpolateVehicle(vehicle(), current, 99).position).toStrictEqual(current.position)
    const unrelated = vehicle({
      id: 'v:8' as VehicleId,
      position: { x: 20, y: 30, z: 40 },
    })
    expect(interpolateVehicle(vehicle(), unrelated, 0).position).toStrictEqual(unrelated.position)
  })
})

describe('vehicle render planning', () => {
  it('exposes a world-space occupant anchor and camera visibility decision', () => {
    const occupant = 'player:local' as OccupantId
    const occupied = vehicle({ occupant, yawRadians: Math.PI / 2 })
    const firstPerson: VehicleRenderPlan = planVehicleVisual(occupied, {
      camera: { localOccupantId: occupant },
    })
    const thirdPerson = planVehicleVisual(occupied, {
      camera: { localOccupantId: occupant, perspective: 'third-person' },
    })

    expect(firstPerson.occupant).toStrictEqual({
      id: occupant,
      position: { x: 2, y: 4.48, z: 6 },
      facingRadians: Math.PI / 2,
      visible: false,
    })
    expect(thirdPerson.occupant?.visible).toBe(true)
    expect(planVehicleVisual(vehicle()).occupant).toBeUndefined()
  })

  it('uses the interpolated vehicle pose for the occupant in the same frame', () => {
    const occupant = 'player:remote' as OccupantId
    const plan = planVehicleVisual(vehicle({ position: { x: 10, y: 4, z: 6 }, occupant }), {
      previous: vehicle({ position: { x: 0, y: 2, z: 6 }, occupant }),
      interpolation: 0.25,
    })

    expect(plan.position).toStrictEqual({ x: 2.5, y: 2.5, z: 6 })
    expect(plan.occupant?.position).toStrictEqual({ x: 2.5, y: 2.98, z: 6 })
    expect(plan.occupant?.visible).toBe(true)
  })
})
