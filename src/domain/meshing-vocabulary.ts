/** A direction and normal for one axis-aligned cube face. */
export type FaceDirection = 'xPos' | 'xNeg' | 'yPos' | 'yNeg' | 'zPos' | 'zNeg'

/** The texture role shared by the top, bottom, and side faces of a block. */
export type FaceRole = 'top' | 'bottom' | 'side'

/** One of the chunk-local axes used by a quad's extents. */
export type QuadAxis = 'x' | 'y' | 'z'

/** The two axes a quad's width and height run along, in x/y/z order. */
export const tangentAxes = (direction: FaceDirection): readonly [QuadAxis, QuadAxis] => {
  switch (direction) {
    case 'xPos':
    case 'xNeg':
      return ['y', 'z']
    case 'yPos':
    case 'yNeg':
      return ['x', 'z']
    default:
      return ['x', 'y']
  }
}

/** Vertices and indices emitted for each quad. */
export const VERTICES_PER_QUAD = 4
export const INDICES_PER_QUAD = 6

/** One vertex in chunk-local or world coordinates. */
export type QuadVertex = readonly [number, number, number]

/** Four quad corners in winding order. */
export type QuadCorners = readonly [QuadVertex, QuadVertex, QuadVertex, QuadVertex]

/** The portable opaque or transparent-solid quad representation. */
export type MeshQuad = {
  readonly blockId: number
  readonly direction: FaceDirection
  readonly role: FaceRole
  readonly lx: number
  readonly y: number
  readonly lz: number
  readonly width: number
  readonly height: number
  readonly ao: number
}

export type PlantVertex = QuadVertex

export type CrossPlantQuad = {
  readonly blockId: number
  readonly role: FaceRole
  readonly vertices: readonly [PlantVertex, PlantVertex, PlantVertex, PlantVertex]
  readonly nx: number
  readonly ny: number
  readonly nz: number
  readonly ao: number
}

/** A non-cubic block shape emitted as explicit face vertices. */
export type BlockShapeKind = 'slab' | 'pressurePlate' | 'cactus' | 'rail' | 'lilyPad'

export type BlockShapeQuad = {
  readonly blockId: number
  readonly shape: BlockShapeKind
  readonly direction: FaceDirection
  readonly role: FaceRole
  readonly lx: number
  readonly y: number
  readonly lz: number
  readonly width: number
  readonly height: number
  readonly vertices: readonly [QuadVertex, QuadVertex, QuadVertex, QuadVertex]
  readonly ao: number
}

export type GeometryQuad = MeshQuad | CrossPlantQuad | BlockShapeQuad

export const isCrossPlantQuad = (quad: GeometryQuad): quad is CrossPlantQuad =>
  'nx' in quad

export const isBlockShapeQuad = (quad: GeometryQuad): quad is BlockShapeQuad =>
  'shape' in quad

/** A fluid vertex with a possibly fractional height. */
export type FluidVertex = readonly [number, number, number]

/** Horizontal flow metadata used by fluid rendering. */
export type FluidFlow = {
  readonly direction: readonly [x: number, z: number]
  readonly falling: boolean
}

/** A fluid surface or side skirt emitted by the mesher. */
export type FluidQuad = {
  readonly blockId: number
  readonly direction: FaceDirection
  readonly vertices: readonly [FluidVertex, FluidVertex, FluidVertex, FluidVertex]
  readonly flow?: FluidFlow
  readonly ao: number
}
