import type { Brand } from 'effect'

export type EntityModelVector = readonly [xAxis: number, yAxis: number, zAxis: number]

export type EntityModelColor = readonly [red: number, green: number, blue: number]

export type EntityModelKind = Brand.Branded<string, 'EntityModelKind'>
export type EntityModelPartIdentifier = Brand.Branded<string, 'EntityModelPartIdentifier'>
export type EntityModelPartRole = Brand.Branded<string, 'EntityModelPartRole'>

export type EntityModelPartDescriptor = Readonly<{
  id: EntityModelPartIdentifier
  role: EntityModelPartRole
  size: EntityModelVector
  center: EntityModelVector
  color: EntityModelColor
  rotation?: EntityModelVector
}>

export type EntityModelDescriptor = Readonly<{
  kind: EntityModelKind
  parts: ReadonlyArray<EntityModelPartDescriptor>
}>
