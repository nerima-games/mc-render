import type {
  ThreeBufferAttribute,
  ThreeBufferGeometry,
  ThreeEuler,
  ThreeObject3D,
  ThreeVector3,
} from './three-surface.js'
import { Brand } from 'effect'
import type { RenderPresentationTexture } from './render-presentation-assets.js'

export type PresentationVector3 = ThreeVector3
export type PresentationEuler = ThreeEuler
export type PresentationObject3D = ThreeObject3D
export type PresentationBufferAttribute = ThreeBufferAttribute
export type PresentationBufferGeometry = ThreeBufferGeometry

export type PresentationColor = Brand.Branded<number, 'PresentationColor'>
export type PresentationOpacity = Brand.Branded<number, 'PresentationOpacity'>
export type PresentationPointSize = Brand.Branded<number, 'PresentationPointSize'>
export type PresentationItemSize = Brand.Branded<number, 'PresentationItemSize'>

export const makePresentationColor: (value: number) => PresentationColor = Brand.nominal<PresentationColor>()
export const makePresentationOpacity: (value: number) => PresentationOpacity = Brand.nominal<PresentationOpacity>()
export const makePresentationPointSize: (value: number) => PresentationPointSize = Brand.nominal<PresentationPointSize>()
export const makePresentationItemSize: (value: number) => PresentationItemSize = Brand.nominal<PresentationItemSize>()

export type PresentationMaterial = {
  readonly color: { set(value: PresentationColor): unknown }
  transparent: boolean
  depthWrite: boolean
  depthTest: boolean
  dispose(): void
}

export const setPresentationOpacity = (material: PresentationMaterial, opacity: PresentationOpacity): void => {
  Object.assign(material, { opacity })
}

export type PresentationBasicMaterial<TTexture extends RenderPresentationTexture> = PresentationMaterial & {
  map: TTexture | null
}

export type PresentationBasicMaterialOptions<TTexture extends RenderPresentationTexture> = {
  readonly color?: PresentationColor
  readonly map?: TTexture | null
  readonly opacity?: PresentationOpacity
  readonly transparent?: boolean
  readonly depthWrite?: boolean
  readonly depthTest?: boolean
  readonly side?: typeof FRONT_SIDE | typeof DOUBLE_SIDE
}

export type PresentationLineMaterialOptions = {
  readonly color?: PresentationColor
  readonly opacity?: PresentationOpacity
  readonly transparent?: boolean
  readonly depthWrite?: boolean
  readonly depthTest?: boolean
}

export type PresentationPointsMaterialOptions = PresentationLineMaterialOptions & {
  readonly size?: PresentationPointSize
}

export type RenderPresentationSurface<
  TTexture extends RenderPresentationTexture = RenderPresentationTexture,
  TGeometry extends ThreeBufferGeometry = ThreeBufferGeometry,
  TBasicMaterial extends PresentationBasicMaterial<TTexture> = PresentationBasicMaterial<TTexture>,
  TLineMaterial extends PresentationMaterial = PresentationMaterial,
  TPointsMaterial extends PresentationMaterial = PresentationMaterial,
> = {
  readonly Group: new () => PresentationObject3D
  readonly BufferGeometry: new () => TGeometry
  readonly BufferAttribute: new (array: Float32Array, itemSize: PresentationItemSize) => PresentationBufferAttribute
  readonly MeshBasicMaterial: new (options: PresentationBasicMaterialOptions<TTexture>) => TBasicMaterial
  readonly LineBasicMaterial: new (options: PresentationLineMaterialOptions) => TLineMaterial
  readonly PointsMaterial: new (options: PresentationPointsMaterialOptions) => TPointsMaterial
  readonly Mesh: new (
    geometry: TGeometry,
    material: TBasicMaterial | TLineMaterial | TPointsMaterial,
  ) => PresentationObject3D
  readonly LineSegments: new (geometry: TGeometry, material: TLineMaterial) => PresentationObject3D
  readonly Points: new (geometry: TGeometry, material: TPointsMaterial) => PresentationObject3D
}

const DOUBLE_SIDE = 2
const FRONT_SIDE = 0

export const RENDER_PRESENTATION_SIDE: Readonly<{
  double: typeof DOUBLE_SIDE
  front: typeof FRONT_SIDE
}> = {
  double: DOUBLE_SIDE,
  front: FRONT_SIDE,
}
