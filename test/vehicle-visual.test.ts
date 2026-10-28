import { describe, expect, it } from '@effect/vitest'
import { AngleRadians, PositionAxis, VehicleVelocityComponent, position } from '@nerima-games/mc-kernel'
import type { OccupantId, Vehicle, VehicleId } from '@nerima-games/mc-sim'
import {
  interpolateVehicle,
  planVehicleVisual,
  vehicleVisualDescriptor,
  type VehicleRenderPlan,
} from '../src/index'

const positionOf = (x: number, y: number, z: number) => position(PositionAxis(x), PositionAxis(y), PositionAxis(z))

const velocityOf = (x: number, y: number, z: number) => ({
  x: VehicleVelocityComponent(x),
  y: VehicleVelocityComponent(y),
  z: VehicleVelocityComponent(z),
})

const vehicle = (overrides: Partial<Vehicle> = {}): Vehicle => ({
  id: 'v:7' as VehicleId,
  type: 'boat',
  dimension: 'overworld',
  position: positionOf(2, 4, 6),
  velocity: velocityOf(0, 0, 0),
  yawRadians: AngleRadians(0),
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
      position: positionOf(0, 2, 4),
      velocity: velocityOf(0, 0, 2),
      yawRadians: AngleRadians((170 * Math.PI) / 180),
    })
    const current = vehicle({
      position: positionOf(10, 4, 8),
      velocity: velocityOf(4, 2, 0),
      yawRadians: AngleRadians((-170 * Math.PI) / 180),
    })
    const sample = interpolateVehicle(previous, current, 0.5)

    expect(sample.position).toStrictEqual({ x: 5, y: 3, z: 6 })
    expect(sample.velocity).toStrictEqual({ x: 2, y: 1, z: 1 })
    expect(Math.abs(sample.yawRadians)).toBeCloseTo(Math.PI, 12)
  })

  it('clamps invalid amounts and does not blend unrelated vehicles', () => {
    const current = vehicle({ position: positionOf(10, 4, 8), yawRadians: AngleRadians(2) })
    expect(interpolateVehicle(vehicle(), current, Number.NaN).position).toStrictEqual(vehicle().position)
    expect(interpolateVehicle(vehicle(), current, 99).position).toStrictEqual(current.position)
    const unrelated = vehicle({
      id: 'v:8' as VehicleId,
      position: positionOf(20, 30, 40),
    })
    expect(interpolateVehicle(vehicle(), unrelated, 0).position).toStrictEqual(unrelated.position)
  })
})

describe('vehicle render planning', () => {
  it('exposes a world-space occupant anchor and camera visibility decision', () => {
    const occupant = 'player:local' as OccupantId
    const occupied = vehicle({ occupant, yawRadians: AngleRadians(Math.PI / 2) })
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
    const plan = planVehicleVisual(vehicle({ position: positionOf(10, 4, 6), occupant }), {
      previous: vehicle({ position: positionOf(0, 2, 6), occupant }),
      interpolation: 0.25,
    })

    expect(plan.position).toStrictEqual({ x: 2.5, y: 2.5, z: 6 })
    expect(plan.occupant?.position).toStrictEqual({ x: 2.5, y: 2.98, z: 6 })
    expect(plan.occupant?.visible).toBe(true)
  })

  it('defaults to a full blend when previous is given without an explicit interpolation amount', () => {
    // No `interpolation` field at all (not even `undefined`), so resolveSample must fall
    // back to DEFAULT_INTERPOLATION_AMOUNT (1) rather than leaving it `undefined`.
    const previous = vehicle({ position: positionOf(0, 2, 4), velocity: velocityOf(0, 0, 0), yawRadians: AngleRadians(0) })
    const current = vehicle({ position: positionOf(10, 4, 8), velocity: velocityOf(1, 1, 1), yawRadians: AngleRadians(1) })

    const plan = planVehicleVisual(current, { previous })

    // amount=1 fully blends to `current`: lerp(from, to, 1) === to for every field.
    expect(plan.position).toStrictEqual(current.position)
    expect(plan.velocity).toStrictEqual(current.velocity)
    expect(plan.yawRadians).toBeCloseTo(current.yawRadians, 12)
  })
})
