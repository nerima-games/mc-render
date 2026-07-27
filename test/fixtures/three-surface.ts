/**
 * NOT A TEST — a fixture that is COMPILED by one.
 *
 * `test/three-surface.test.ts` builds a TypeScript program over this file with
 * `lib: ["ES2022", "DOM"]` and the real `three` package resolvable, and asserts
 * it produces zero diagnostics. That is what proves the claim
 * `application/three-surface.ts` makes: the REAL `three` namespace satisfies
 * `ThreeSurface<HTMLCanvasElement>` WITHOUT A CAST.
 *
 * The claim is not obvious and it is not stable under a careless edit. Two
 * edges in particular fail silently in the ordinary `pnpm typecheck`, because
 * that project has no `three` and no DOM to be assignable FROM:
 *
 *   - CONSTRUCT SIGNATURES ARE CONTRAVARIANT in their parameters under
 *     `strictFunctionTypes`. Making `ThreeRendererParameters.antialias`
 *     optional, or widening `powerPreference` to `string`, breaks
 *     `WebGLRenderer` here and nowhere else.
 *   - `ThreeScene.add` and `ThreeEuler.set` are METHODS on purpose. Rewriting
 *     either as a function-typed property — which looks like a tidy-up — makes
 *     a real `Scene`/`Euler` unassignable, because their parameters are our
 *     narrow types and only the bivariant direction holds.
 *
 * The first person to notice either would be a browser consumer, and the fix
 * they would reach for is `as unknown as`, which is where the type safety would
 * actually be lost.
 *
 * Excluded from `tsconfig.json` and `tsconfig.test.json` (`test/fixtures/**`),
 * because it names DOM types and imports `three`, and those projects
 * deliberately can see neither. It is still linted and still scanned by
 * `pnpm check:deps`.
 */
import * as THREE from 'three'
import { makeWorldRenderer } from '../../application/world-renderer'
import type {
  ThreeBufferAttribute,
  ThreeBufferGeometry,
  ThreeMaterial,
  ThreeMesh,
  ThreePerspectiveCamera,
  ThreeScene,
  ThreeSurface,
  ThreeWebGLRenderer,
} from '../../application/three-surface'

/**
 * THE WHOLE CLAIM, IN ONE LINE.
 *
 * `THREE` is the real namespace object. If every constructor in the surface is
 * satisfied by the real one, a host can pass `THREE` straight to
 * `makeWorldRenderer` and no other line in this file would be needed.
 *
 * The rest of the file exists because a single namespace-level assignment
 * reports only the FIRST mismatch, and a surface with seven constructors wants
 * each one to fail on its own line.
 */
export const namespaceIsASurface: ThreeSurface<
  HTMLCanvasElement,
  THREE.BufferGeometry,
  THREE.MeshBasicMaterial
> = THREE

declare const browserCanvas: HTMLCanvasElement

/** The contravariant edge: our parameters object must satisfy three's. */
export const renderer: ThreeWebGLRenderer = new THREE.WebGLRenderer({
  canvas: browserCanvas,
  antialias: false,
  stencil: false,
  powerPreference: 'high-performance',
  failIfMajorPerformanceCaveat: false,
})

export const scene: ThreeScene = new THREE.Scene()

export const camera: ThreePerspectiveCamera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 300)

export const geometry: ThreeBufferGeometry = new THREE.BufferGeometry()

/**
 * Every typed array the geometry builder emits, against the one construct
 * signature the surface declares.
 *
 * `Float32Array | Uint8Array | Uint32Array` is a union in the surface and
 * `TypedArray` in three's declaration; a union is assignable to a wider union,
 * so all three land on the same slot. Listing them separately is what would
 * catch a fourth being added to `ChunkGeometryBuffers` without the surface
 * hearing about it.
 */
export const positionAttribute: ThreeBufferAttribute = new THREE.BufferAttribute(
  new Float32Array(12),
  3,
  false,
)
export const colorAttribute: ThreeBufferAttribute = new THREE.BufferAttribute(
  new Uint8Array(12),
  3,
  true,
)
export const indexAttribute: ThreeBufferAttribute = new THREE.BufferAttribute(
  new Uint32Array(6),
  1,
  false,
)

export const material: ThreeMaterial = new THREE.MeshBasicMaterial({
  vertexColors: true,
  wireframe: false,
})

/**
 * The mesh is built from REAL three values, not from the narrow ones above.
 *
 * `new THREE.Mesh(...)` is the real constructor and wants a real
 * `BufferGeometry`; handing it `geometry` — which is typed as the SUPERTYPE
 * `ThreeBufferGeometry` — is rejected, correctly, and would be rejected in a
 * host too. What the surface claims is that `typeof THREE.Mesh` satisfies
 * `ThreeSurface['Mesh']`, and `namespaceIsASurface` above is what checks that.
 * This line checks the other half: the RESULT is a `ThreeMesh`.
 */
export const mesh: ThreeMesh = new THREE.Mesh(
  new THREE.BufferGeometry(),
  new THREE.MeshBasicMaterial({ vertexColors: true, wireframe: false }),
)

/**
 * The bivariant edges, exercised in the direction that actually bites.
 *
 * `scene.add(mesh)` is the one that fails first if `ThreeScene.add` is rewritten
 * as a property: `ThreeMesh` names four of `Object3D`'s members, so only
 * `Object3D -> ThreeMesh` holds and the contravariant check wants the reverse.
 */
export const drivesTheSeam = (): void => {
  scene.add(mesh)
  camera.position.set(0, 64, 0)
  camera.rotation.set(0, 0, 0, 'YXZ')
  camera.aspect = 16 / 9
  camera.updateProjectionMatrix()
  geometry.setAttribute('position', positionAttribute)
  geometry.setAttribute('color', colorAttribute)
  geometry.setIndex(indexAttribute)
  geometry.computeBoundingSphere()
  renderer.setSize(1280, 720, false)
  renderer.setClearColor(0x87ceeb, 1)
  renderer.render(scene, camera)
  scene.remove(mesh)
  geometry.dispose()
  material.dispose()
  renderer.dispose()
}

/**
 * THE HOST'S CALL, spelled the way a host has to spell it.
 *
 * `makeWorldRenderer<HTMLCanvasElement, THREE.BufferGeometry,
 * THREE.MeshBasicMaterial>` — THREE EXPLICIT TYPE ARGUMENTS, and they are not
 * optional. Inference does not reach the right answer, and the reason is worth
 * having written down because the error it produces is four levels deep:
 *
 *   `typeof THREE.BufferGeometry` is itself generic, and its own default is
 *   `BufferGeometry<NormalOrGLBufferAttributes>`. Inferring `TGeometry` from
 *   the `BufferGeometry` slot therefore lands on that, while `typeof THREE.Mesh`
 *   wants `BufferGeometry<NormalBufferAttributes>` — a narrower `Attributes`
 *   that excludes `GLBufferAttribute`. The two slots infer incompatible answers
 *   from the same namespace, and the failure surfaces as "GLBufferAttribute is
 *   missing the following properties from type BufferAttribute".
 *
 * mc-render cannot fix that from its side: naming either instantiation means
 * naming a `three` type, which is the thing `application/three-surface.ts`
 * exists not to do. So the host pins them, once, at the one call site that has
 * `three` in scope anyway.
 *
 * This line is in the fixture rather than only in mc-compose because mc-compose
 * is not in `pnpm verify` — `pnpm typecheck:app` needs sibling checkouts on
 * disk and CI has none. Without it, the ergonomics of this seam would be
 * checked only by a command CI never runs.
 */
export const hostBuildsARenderer = makeWorldRenderer<
  HTMLCanvasElement,
  THREE.BufferGeometry,
  THREE.MeshBasicMaterial
>(THREE, browserCanvas, { width: 1280, height: 720 })
