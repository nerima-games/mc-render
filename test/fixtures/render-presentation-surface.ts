import * as THREE from 'three'
import type { RenderPresentationSurface } from '../../src/application/render-presentation-surface'

export const namespaceIsPresentationSurface: RenderPresentationSurface<
  THREE.Texture,
  THREE.BufferGeometry,
  THREE.MeshBasicMaterial,
  THREE.LineBasicMaterial,
  THREE.PointsMaterial
> = THREE
