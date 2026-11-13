export type EntityModelVector = readonly [xAxis: number, yAxis: number, zAxis: number]

export type EntityModelColor = readonly [red: number, green: number, blue: number]

export type EntityModelPartDescriptor = Readonly<{
  id: string
  role: string
  size: EntityModelVector
  center: EntityModelVector
  color: EntityModelColor
  rotation?: EntityModelVector
}>

export type EntityModelDescriptor = Readonly<{
  kind: string
  parts: ReadonlyArray<EntityModelPartDescriptor>
}>
