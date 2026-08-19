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
 * deliberately can see neither. It is still linted, while its Three
 * compatibility is checked by `test/three-surface.test.ts`.
 */
import * as THREE from 'three'
import {
  makeChunkShaderMaterial,
  makeWaterMaterial,
  makeWorldRenderer,
} from '../../src/application/world-renderer'
import { makeProductionWorldRenderer } from '../../src/application/world-renderer-production'
import { chunkShaderSource } from '../../src/domain/chunk-shader'
import type {
  ThreeBufferAttribute,
  ThreeBufferGeometry,
  ThreeMaterial,
  ThreeMesh,
  ThreePerspectiveCamera,
  ThreeScene,
  ThreeInstancedSurface,
  ThreeShaderSurface,
  ThreeSurface,
  ThreeWebGLRenderer,
} from '../../src/application/three-surface'

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

/**
 * THE SAME PROOF FOR THE SHADER SURFACE.
 *
 * `application/three-surface.ts` claims the real `three` namespace satisfies
 * `ThreeShaderSurface` without a cast, exactly as it claims for the smaller
 * surface above, and this is the line that makes the claim checkable rather
 * than merely stated.
 *
 * FOUR TYPE ARGUMENTS, and the third and fourth differ. The first cut of
 * `ThreeShaderSurface` reused one material slot for both constructors, and this
 * line is what rejected it: at `TMaterial = ShaderMaterial` the intersection
 * obliges `MeshBasicMaterial` to return a `ShaderMaterial`. `TMaterial` is the
 * material `makeWorldRenderer` BUILDS; `TShaderMaterial` is the one a textured
 * host builds for itself. A host with both paths has both.
 *
 * The construct-signature contravariance the header describes applies here too:
 * `ThreeShaderMaterialParameters` requires `vertexColors: true` where three
 * accepts `boolean | undefined`, and the assignment holds because required-true
 * is assignable INTO the wider optional — the direction that works. Widening
 * ours to `boolean` would also compile and would give up the compile-time
 * guarantee that `vColor` is defined; narrowing three's is not something this
 * file can do.
 */
export const namespaceIsAShaderSurface: ThreeShaderSurface<
  HTMLCanvasElement,
  THREE.BufferGeometry,
  THREE.MeshBasicMaterial,
  THREE.ShaderMaterial
> = THREE

/**
 * The generated source, constructed the way a host constructs it.
 *
 * This is the ONLY place in `pnpm verify` where `domain/chunk-shader.ts`'s
 * output meets a real `three` declaration. It does not compile the GLSL — that
 * needs a GL context and happens in mc-compose's Playwright run — but it does
 * check that the shape `chunkShaderSource()` returns is the shape the
 * constructor takes, which is the half that can go wrong silently in Node.
 */
export const hostBuildsTheChunkMaterial: THREE.ShaderMaterial = new THREE.ShaderMaterial({
  vertexShader: chunkShaderSource().vertexShader,
  fragmentShader: chunkShaderSource().fragmentShader,
  uniforms: { uSunIntensity: { value: 1 }, uAtlas: { value: null } },
  vertexColors: true,
})

/**
 * `makeChunkShaderMaterial` against the real namespace, rather than by hand.
 *
 * The line above spells the constructor out; this one goes through the function
 * a host would actually call. Both are here because they check different
 * things — that one checks the SHAPE `chunkShaderSource()` returns, this one
 * checks that `makeChunkShaderMaterial`'s four type parameters are inferable
 * from a real namespace, which is the property that decides whether a host has
 * to write them out.
 */
export const hostBuildsTheChunkMaterialViaTheSeam = makeChunkShaderMaterial<
  HTMLCanvasElement,
  THREE.BufferGeometry,
  THREE.MeshBasicMaterial,
  THREE.ShaderMaterial
>(THREE, new THREE.Texture())

/**
 * THE TEXTURED PATH, END TO END, AS A HOST SPELLS IT.
 *
 * FOUR TYPE ARGUMENTS where `hostBuildsARenderer` above needs three, and the
 * fourth is the whole point of the material factory: `TUsedMaterial` is
 * `ShaderMaterial` here and `MeshBasicMaterial` there, from the same namespace
 * and the same function.
 *
 * This line is what makes "a host can select the packed-light path" a checked
 * claim rather than a documented intention. Before the factory existed,
 * `makeWorldRenderer` constructed a `MeshBasicMaterial` unconditionally and
 * this call could not be written at all — `application/three-surface.ts`'s
 * header said so in a NOTE, and this is that note discharged.
 */
export const hostBuildsATexturedRenderer = makeWorldRenderer<
  HTMLCanvasElement,
  THREE.BufferGeometry,
  THREE.MeshBasicMaterial,
  THREE.ShaderMaterial
>(THREE, browserCanvas, { width: 1280, height: 720 }, {
  material: () => hostBuildsTheChunkMaterialViaTheSeam.material,
})

/**
 * The water material, against the real namespace.
 *
 * The second shader in the repository, and the check it adds over the chunk
 * one is that `domain/water-shader.ts`'s uniform record — which holds a `null`,
 * an array and four numbers — satisfies three's `{ [uniform: string]: IUniform }`.
 * `ThreeUniform.value` is `unknown` on our side precisely so this seam never
 * enumerates three's accepted types, and this line is what confirms the
 * looseness is assignable rather than merely convenient.
 */
export const hostBuildsTheWaterMaterial = makeWaterMaterial<
  HTMLCanvasElement,
  THREE.BufferGeometry,
  THREE.MeshBasicMaterial,
  THREE.ShaderMaterial
>(THREE, { width: 1280, height: 720 })

export const hostBuildsAProductionRenderer = makeProductionWorldRenderer<
  HTMLCanvasElement,
  THREE.BufferGeometry,
  THREE.MeshBasicMaterial,
  THREE.InstancedBufferGeometry,
  THREE.ShaderMaterial
>(THREE, browserCanvas, { width: 1280, height: 720 }, new THREE.Texture())

/**
 * THE INSTANCED PARTICLE PATH, against the real namespace.
 *
 * The third seam, and the one whose members are least like the others: three's
 * `InstancedBufferAttribute` constructor takes `(array, itemSize, normalized?,
 * meshPerAttribute?)` and ours names the first two, which holds because the
 * remaining parameters are optional. Narrowing OUR signature is the direction
 * that works; a third required parameter here would not.
 *
 * `instanceCount` is the member that would fail if `ThreeInstancedBufferGeometry`
 * declared it `readonly` — `application/particle-system.ts` assigns it every
 * frame, and three declares it mutable.
 */
export const namespaceIsAnInstancedSurface: ThreeInstancedSurface<
  HTMLCanvasElement,
  THREE.BufferGeometry,
  THREE.MeshBasicMaterial,
  THREE.InstancedBufferGeometry
> = THREE
