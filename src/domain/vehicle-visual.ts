/** Renderer-independent vehicle silhouettes, interpolation and occupant placement. */

import type { OccupantId, Vehicle, VehicleId, VehicleType } from '@nerima-games/mc-sim'

export type VehicleVisualVector = readonly [x: number, y: number, z: number]
export type VehicleVisualColor = readonly [red: number, green: number, blue: number]
export type VehicleVisualPartRole = 'body' | 'rim' | 'seat' | 'wheel'

export type VehicleVisualPartDescriptor = Readonly<{
  id: string
  role: VehicleVisualPartRole
  size: VehicleVisualVector
  center: VehicleVisualVector
  rotation: VehicleVisualVector
  color: VehicleVisualColor
}>

export type VehicleVisualDescriptor = Readonly<{
  type: VehicleType
  parts: ReadonlyArray<VehicleVisualPartDescriptor>
  /** Local-space point at which compose should place the occupant's feet. */
  occupantAnchor: VehicleVisualVector
}>

export type VehicleInterpolationSample = Readonly<{
  position: Readonly<{ x: number; y: number; z: number }>
  velocity: Readonly<{ x: number; y: number; z: number }>
  yawRadians: number
}>

export type VehicleCameraContext = Readonly<{
  localOccupantId?: OccupantId
  perspective?: 'first-person' | 'third-person'
}>

export type VehicleOccupantRenderPlan = Readonly<{
  id: OccupantId
  position: Readonly<{ x: number; y: number; z: number }>
  facingRadians: number
  visible: boolean
}>

export type VehicleRenderPlan = Readonly<{
  id: VehicleId
  type: VehicleType
  dimension: Vehicle['dimension']
  position: VehicleInterpolationSample['position']
  velocity: VehicleInterpolationSample['velocity']
  yawRadians: number
  parts: ReadonlyArray<VehicleVisualPartDescriptor>
  occupant?: VehicleOccupantRenderPlan
}>

const part = (
  id: string,
  role: VehicleVisualPartRole,
  size: VehicleVisualVector,
  center: VehicleVisualVector,
  color: VehicleVisualColor,
  rotation: VehicleVisualVector = [0, 0, 0],
): VehicleVisualPartDescriptor => ({ center, color, id, role, rotation, size })

const BOAT_VISUAL: VehicleVisualDescriptor = {
  occupantAnchor: [0, 0.48, 0],
  parts: [
    part('hull', 'body', [1.4, 0.3, 2.2], [0, 0.2, 0], [130, 82, 43]),
    part('left-rim', 'rim', [0.18, 0.45, 2.1], [-0.7, 0.48, 0], [155, 101, 54]),
    part('right-rim', 'rim', [0.18, 0.45, 2.1], [0.7, 0.48, 0], [155, 101, 54]),
    part('bow-rim', 'rim', [1.22, 0.45, 0.18], [0, 0.48, -1.02], [155, 101, 54]),
    part('stern-rim', 'rim', [1.22, 0.45, 0.18], [0, 0.48, 1.02], [155, 101, 54]),
    part('seat', 'seat', [1.05, 0.12, 0.35], [0, 0.48, 0], [109, 67, 35]),
  ],
  type: 'boat',
}

const MINECART_VISUAL: VehicleVisualDescriptor = {
  occupantAnchor: [0, 0.62, 0],
  parts: [
    part('floor', 'body', [1, 0.18, 1.25], [0, 0.18, 0], [112, 117, 119]),
    part('left-wall', 'rim', [0.16, 0.62, 1.25], [-0.5, 0.48, 0], [145, 150, 152]),
    part('right-wall', 'rim', [0.16, 0.62, 1.25], [0.5, 0.48, 0], [145, 150, 152]),
    part('front-wall', 'rim', [0.84, 0.62, 0.16], [0, 0.48, -0.55], [145, 150, 152]),
    part('back-wall', 'rim', [0.84, 0.62, 0.16], [0, 0.48, 0.55], [145, 150, 152]),
    part('left-wheel', 'wheel', [0.16, 0.28, 0.34], [-0.57, 0.12, 0], [68, 71, 72]),
    part('right-wheel', 'wheel', [0.16, 0.28, 0.34], [0.57, 0.12, 0], [68, 71, 72]),
  ],
  type: 'minecart',
}

const DESCRIPTORS: Readonly<Record<VehicleType, VehicleVisualDescriptor>> = {
  boat: BOAT_VISUAL,
  minecart: MINECART_VISUAL,
}

export const vehicleVisualDescriptor = (type: VehicleType): VehicleVisualDescriptor =>
  DESCRIPTORS[type]

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0

const lerp = (from: number, to: number, amount: number): number =>
  from + (to - from) * amount

const shortestAngleDelta = (from: number, to: number): number =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from))

/** Interpolate matching simulation snapshots without mutating either snapshot. */
export const interpolateVehicle = (
  previous: Vehicle,
  current: Vehicle,
  amount: number,
): VehicleInterpolationSample => {
  const safeAmount = clamp01(amount)
  if (
    previous.id !== current.id ||
    previous.type !== current.type ||
    previous.dimension !== current.dimension
  ) {
    return {
      position: { ...current.position },
      velocity: { ...current.velocity },
      yawRadians: current.yawRadians,
    }
  }

  return {
    position: {
      x: lerp(previous.position.x, current.position.x, safeAmount),
      y: lerp(previous.position.y, current.position.y, safeAmount),
      z: lerp(previous.position.z, current.position.z, safeAmount),
    },
    velocity: {
      x: lerp(previous.velocity.x, current.velocity.x, safeAmount),
      y: lerp(previous.velocity.y, current.velocity.y, safeAmount),
      z: lerp(previous.velocity.z, current.velocity.z, safeAmount),
    },
    yawRadians: previous.yawRadians + shortestAngleDelta(previous.yawRadians, current.yawRadians) * safeAmount,
  }
}

/** Build backend-neutral vehicle and occupant transforms for one render frame. */
export const planVehicleVisual = (
  vehicle: Vehicle,
  options: Readonly<{
    previous?: Vehicle
    interpolation?: number
    camera?: VehicleCameraContext
  }> = {},
): VehicleRenderPlan => {
  const sample = options.previous === undefined
    ? { position: { ...vehicle.position }, velocity: { ...vehicle.velocity }, yawRadians: vehicle.yawRadians }
    : interpolateVehicle(options.previous, vehicle, options.interpolation ?? 1)
  const descriptor = vehicleVisualDescriptor(vehicle.type)
  const cosYaw = Math.cos(sample.yawRadians)
  const sinYaw = Math.sin(sample.yawRadians)
  const [anchorX, anchorY, anchorZ] = descriptor.occupantAnchor
  const occupant = vehicle.occupant === undefined ? undefined : {
    facingRadians: sample.yawRadians,
    id: vehicle.occupant,
    position: {
      x: sample.position.x + anchorX * cosYaw - anchorZ * sinYaw,
      y: sample.position.y + anchorY,
      z: sample.position.z + anchorX * sinYaw + anchorZ * cosYaw,
    },
    visible: !(
      options.camera?.localOccupantId === vehicle.occupant &&
      (options.camera.perspective ?? 'first-person') === 'first-person'
    ),
  }

  return {
    dimension: vehicle.dimension,
    id: vehicle.id,
    parts: descriptor.parts,
    position: sample.position,
    type: vehicle.type,
    velocity: sample.velocity,
    yawRadians: sample.yawRadians,
    ...(occupant === undefined ? {} : { occupant }),
  }
}
