/**
 * THE ENTIRE THREE.js SURFACE THIS REPOSITORY DEPENDS ON, IN ONE FILE.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists instead of `import * as THREE from 'three'`
 * ---------------------------------------------------------------------------
 *
 * `tsconfig.base.json` ships `lib: ["ES2024"]` and `types: []`, and its own
 * comment names this adapter as the thing that would finally argue for `"DOM"`:
 * "a class hierarchy the size of THREE's is not a handful of members". It turns
 * out not to need the argument, because the renderer does not need the class
 * hierarchy — it needs seven constructors and about twenty members off them.
 *
 * `@types/three` cannot be imported here without `"DOM"`. Its declarations name
 * `HTMLCanvasElement`, `WebGL2RenderingContext`, `ImageBitmap` and several
 * dozen more, and `skipLibCheck: true` does not save the consumer: it silences
 * the errors INSIDE the `.d.ts` and leaves the unresolved names as `any` at
 * every use site. So `renderer.render(scene, camera)` would typecheck against a
 * renderer that is `any` — the appearance of a checked seam with none of the
 * checking. That is strictly worse than the structural types below, which are
 * small enough to read and are PROVED against the real `three` by a test.
 *
 * The three prior instances of this move in the organisation are
 * `application/dom-surface.ts` (this repository, `window`/`document`),
 * `mx-ui/application/dom-surface.ts` (`Document`/`HTMLElement`) and
 * `mc-save/domain/indexeddb-surface.ts` (`IDBFactory`). Read `dom-surface.ts`'s
 * header first; everything it says about why a second tsconfig project was
 * rejected applies here unchanged, and is not repeated.
 *
 * ---------------------------------------------------------------------------
 * `three` IS a real dependency of this repository — as a devDependency
 * ---------------------------------------------------------------------------
 *
 * `package.json` declares `three` and `@types/three` in `devDependencies`, and
 * that placement is the whole design rather than a technicality:
 *
 *   - NO SHIPPED FILE IMPORTS `three`. `pnpm typecheck` over
 *     `tsconfig.build.json` still compiles the published surface with
 *     `lib: ["ES2024"]`, `types: []` and no `three` in sight, which is the
 *     property every pure module in `domain/` depends on.
 *   - the dependency exists so that `test/fixtures/three-surface.ts` can be
 *     compiled AGAINST THE REAL `three/index.d.ts` and asserted to produce zero
 *     diagnostics. Without the package there is no oracle, and the types below
 *     would be a claim nobody checks.
 *   - the HOST supplies the namespace at runtime, exactly as it supplies
 *     `window`, `document` and the canvas to `browserInputLayer`. A host is
 *     already the thing that owns the platform; `three` is platform.
 *
 * `pnpm check:deps` has NO OPINION on any of this, and that is worth stating
 * because it is easy to assume otherwise. Its rules 3-6 are written over
 * `@nerima-games/*` specifiers only — `checkDeclaredDependencies` skips every
 * name that does not start with the org scope, and so does the import check.
 * Adding `three` therefore required no edit to `REPOSITORY_POLICY` and no
 * widening of any whitelist. The gate that DOES have an opinion is
 * `pnpm typecheck`, and it keeps it by seeing no `three` import at all.
 *
 * ---------------------------------------------------------------------------
 * Why the surface has THREE type parameters, which looks like over-engineering
 * ---------------------------------------------------------------------------
 *
 * `ThreeSurface<TCanvas, TGeometry, TMaterial>`. Each one is there because a
 * CONSTRUCTOR PARAMETER of the real `three` cannot be written down here, and
 * construct-signature parameters are the one place in this file where
 * bivariance does NOT rescue a narrow type.
 *
 * That asymmetry is the single most surprising thing here, and it is measured
 * rather than assumed. A method parameter IS compared bivariantly, which is why
 * `ThreeScene.add(object: ThreeMesh)` is satisfied by
 * `Object3D.add(...object: Object3D[])`. A construct signature is NOT: the same
 * shape written as `Mesh: new (geometry: ThreeBufferGeometry, ...)` was
 * rejected with "Type 'ThreeBufferGeometry' is missing the following properties
 * from type 'BufferGeometry': id, uuid, name, type, and 42 more" — the
 * contravariant direction, and the only one offered.
 *
 * So for each such parameter there were three ways out:
 *
 *   1. Widen ours to `unknown`. REJECTED: contravariance wants OUR type
 *      assignable TO three's, and `unknown` is assignable to nothing.
 *   2. Narrow ours to `never`, as `mc-save/domain/indexeddb-surface.ts` had to
 *      for its event handlers. REJECTED: a parameter that cannot be produced is
 *      a constructor that cannot be called.
 *   3. Make it a TYPE PARAMETER, so the HOST — which does have `lib.DOM` and
 *      does have `three` — supplies `HTMLCanvasElement`, `THREE.BufferGeometry`
 *      and `THREE.MeshBasicMaterial`, and the assignability check happens
 *      there, in the fixture, against the real declarations.
 *
 * (3) is chosen three times. `TGeometry` and `TMaterial` carry constraints
 * (`ThreeBufferGeometry`, `ThreeMaterial`) so that the renderer can still call
 * `dispose()` on what it built; `TCanvas` carries none, because nothing here
 * ever does anything to a canvas except hand it back to `three`.
 *
 * THE COST IS PAID BY THE HOST, IN ONE LINE, AND IT IS NOT OPTIONAL. A host
 * must write the three arguments out:
 *
 *   makeWorldRenderer<HTMLCanvasElement, THREE.BufferGeometry, THREE.MeshBasicMaterial>(
 *     THREE, canvas, { width, height })
 *
 * because inference does not reach the right answer. `typeof
 * THREE.BufferGeometry` is itself generic and defaults to
 * `BufferGeometry<NormalOrGLBufferAttributes>`, while `typeof THREE.Mesh` wants
 * the narrower `BufferGeometry<NormalBufferAttributes>` — so the two slots
 * infer incompatible answers from the same namespace, and the error names
 * `GLBufferAttribute` four levels down. `test/fixtures/three-surface.ts` writes
 * that call out so the ergonomics are checked by `pnpm verify` rather than only
 * by mc-compose, which CI cannot run.
 *
 * ---------------------------------------------------------------------------
 * Why `add` and `set` are written in METHOD syntax and the rest are not
 * ---------------------------------------------------------------------------
 *
 * The members whose parameters are OUR types — `ThreeScene.add` taking a
 * `ThreeMesh`, `ThreeWebGLRenderer.render` taking a `ThreeScene`,
 * `ThreeEuler.set` taking the literal `'YXZ'` — are declared with method syntax
 * on purpose. TypeScript exempts method declarations from
 * `strictFunctionTypes`, so their parameters are compared bivariantly, and
 * bivariance is exactly what is needed: `THREE.Object3D.add` takes an
 * `Object3D`, `ThreeMesh` names ONE of that type's seventy-odd members, and
 * only the `Object3D -> ThreeMesh` direction holds.
 *
 * Written as a function-typed property instead, `add: (object: ThreeMesh) =>
 * unknown`, a real `Scene` stops satisfying `ThreeScene` — and the fix somebody
 * would reach for is `as unknown as`, which is where the checking would
 * actually be lost. Everything else here is a plain property, because
 * everything else takes only primitives, which are assignable in both
 * directions and do not care.
 *
 * BIVARIANCE IS NOT A LICENCE TO ADD MEMBERS, and this is the trap. It says one
 * of the two directions must hold, and for every one of these narrow types the
 * direction that holds is `real -> ours`. So each of them may name only members
 * the REAL supertype already has: `ThreeMesh` may not gain `geometry` or
 * `material`, because `Object3D` has neither; `ThreeCamera` may not gain
 * `aspect` or `updateProjectionMatrix`, because `Camera` — which is what
 * `WebGLRenderer.render` declares — has neither. Both were written the obvious
 * way first and rejected by `test/three-surface.test.ts`, which is the entire
 * reason that test exists.
 */

/**
 * One `BufferAttribute`, as this repository uses it: OPAQUE.
 *
 * Deliberately empty of members, and that emptiness is FORCED rather than
 * chosen. `BufferGeometry.setIndex` is declared
 * `setIndex(index: BufferAttribute | number[] | null): this`, and a method
 * parameter is compared bivariantly — so this type has to be one that
 * `BufferAttribute`, `number[]` AND `null` can reach. Any member at all would
 * exclude the array and the null; see `ThreeBufferGeometry.setIndex` below,
 * where the `| null` is spelled out rather than folded in here.
 *
 * An empty object type accepts anything non-nullish, which is acceptable HERE
 * and only here: every value that reaches these slots was produced by
 * `ThreeSurface.BufferAttribute`, so the type is a label on a PROVENANCE rather
 * than a check on a shape. It is not a place to add members. `copyArray` and
 * `needsUpdate`, which the reference's `tryReuseGeometry` uses
 * (ts-minecraft `packages/rendering/infrastructure/meshing/chunk-mesh-geometry.ts:68-71`),
 * belong to the in-place GPU buffer reuse path this repository has not written
 * and has no benchmark to justify.
 */
export type ThreeBufferAttribute = Record<never, never>

/**
 * A material: opaque, and disposable.
 *
 * This is a CONSTRAINT on `ThreeSurface`'s `TMaterial`, not the type a mesh is
 * built from — see the surface's own header paragraph on why the geometry and
 * the material are type parameters. Nothing here reads a material; the renderer
 * creates one, hands it to every mesh, and disposes it at teardown.
 */
export type ThreeMaterial = {
  readonly dispose: () => void
}

/**
 * The geometry members the chunk mesh path calls.
 *
 * `computeBoundingSphere` is here and is NOT optional. Without it `three`
 * computes a bounding sphere lazily on first render and warns
 * ("THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN") for
 * any geometry with an empty position attribute — and an empty chunk is the
 * normal case at the edge of the loaded world, not an error.
 *
 * `setIndex` takes `| null` because the real one does and the comparison is
 * bivariant; the renderer never passes it. See `ThreeBufferAttribute`.
 */
export type ThreeBufferGeometry = {
  setAttribute(name: string, attribute: ThreeBufferAttribute): unknown
  setIndex(index: ThreeBufferAttribute | null): unknown
  readonly computeBoundingSphere: () => void
  readonly dispose: () => void
}

/** `Vector3.set`, which is the only thing done to a position here. */
export type ThreeVector3 = {
  set(x: number, y: number, z: number): unknown
}

/**
 * `Euler.set`, pinned to `'YXZ'`.
 *
 * The order is load-bearing and `domain/camera-mirror.ts` already carries the
 * citation: ts-minecraft
 * `packages/app/application/frame/stages/camera-stage.ts:67` sets
 * `(pitch, yaw, 0, 'YXZ')`, and with the default `'XYZ'` yawing while pitched
 * tilts the horizon. Naming the literal here rather than `string` means a
 * renderer that passes a different order does not compile.
 */
export type ThreeEuler = {
  set(x: number, y: number, z: number, order: 'YXZ'): unknown
}

/**
 * A mesh, as a SCENE takes one: one member, and it is on `Object3D`.
 *
 * The same forcing as `ThreeMaterial`. `Scene.add` takes `Object3D`, so for
 * `add(object: ThreeMesh)` to be satisfiable this type may name only members
 * `Object3D` itself has — the bivariant direction that holds is
 * `Object3D -> ThreeMesh`, and `geometry` and `material` are not on `Object3D`.
 * The renderer keeps its own handles on those anyway, which is why losing them
 * here costs nothing.
 *
 * `frustumCulled` is writable because the reference turns it OFF for chunk
 * meshes and culls by AABB itself
 * (ts-minecraft `packages/rendering/infrastructure/meshing/chunk-mesh-geometry.ts:40-41`:
 * "frustumCulled=false + manual AABB frustum culling in WorldRendererService
 * (cheaper than Three.js per-object bounding-sphere checks)"). This repository
 * has no frustum culler yet and leaves the flag at three's default; the member
 * is here so that adding one is a renderer change and not a surface change.
 */
export type ThreeMesh = {
  frustumCulled: boolean
}

/**
 * A scene: something meshes are added to and removed from.
 *
 * Both members are METHODS, not function-typed properties, and that is the
 * header's point made concrete — `add`'s parameter is our narrow `ThreeMesh`,
 * only the bivariant direction holds, and method syntax is what selects it.
 */
export type ThreeScene = {
  add(object: ThreeMesh): unknown
  remove(object: ThreeMesh): unknown
}

/**
 * A camera AS THE RENDERER TAKES ONE.
 *
 * `WebGLRenderer.render`'s second parameter is `Camera`, and `aspect` and
 * `updateProjectionMatrix` live on `PerspectiveCamera` rather than on `Camera`
 * — so naming them here would make the real `render` unsatisfiable in both
 * directions. This is the supertype `render` speaks in;
 * `ThreePerspectiveCamera` below is what the mirror writes to.
 */
export type ThreeCamera = {
  readonly position: ThreeVector3
  readonly rotation: ThreeEuler
}

/** The camera members the mirror writes, plus the projection it invalidates. */
export type ThreePerspectiveCamera = ThreeCamera & {
  aspect: number
  readonly updateProjectionMatrix: () => void
}

/**
 * The renderer.
 *
 * `render` is a method taking the supertypes above, for the reason the header
 * gives; the other three take only primitives and are plain properties.
 */
export type ThreeWebGLRenderer = {
  render(scene: ThreeScene, camera: ThreeCamera): unknown
  readonly setSize: (width: number, height: number, updateStyle: boolean) => unknown
  readonly setClearColor: (color: number, alpha: number) => unknown
  readonly dispose: () => void
}

/**
 * What a `new WebGLRenderer(...)` is given.
 *
 * Every field except `canvas` is optional in `WebGLRendererParameters` and
 * REQUIRED here, which is the correct direction: this type has to be assignable
 * TO three's, and demanding more fields than the target declares is what makes
 * an object type a subtype. It also means the renderer cannot silently stop
 * passing one.
 */
export type ThreeRendererParameters<TCanvas> = {
  readonly canvas: TCanvas
  readonly antialias: boolean
  readonly stencil: boolean
  readonly powerPreference: 'high-performance'
  readonly failIfMajorPerformanceCaveat: boolean
}

/**
 * THE SURFACE. Seven constructors, and nothing else from `three` is reachable.
 *
 * `TCanvas` is the host's canvas type — `HTMLCanvasElement` in a browser. See
 * the header for why it is a parameter and not `unknown`.
 *
 * `MeshBasicMaterial` is here and `Material` is not constructible, which is a
 * deliberate narrowing of the seven names this seam was asked for.
 * `THREE.Material` is abstract in every sense that matters — a `Mesh` needs an
 * INSTANCE, and the unlit basic material is the only one this repository can
 * construct today because it is the only one that needs no light in the scene.
 * `ThreeMaterial` above is the CONSTRAINT on what one may be; this is the one
 * factory that produces one. When a lit material and a light arrive, they
 * arrive together, as two more members here.
 */
export type ThreeSurface<
  TCanvas,
  TGeometry extends ThreeBufferGeometry,
  TMaterial extends ThreeMaterial,
> = {
  readonly WebGLRenderer: new (parameters: ThreeRendererParameters<TCanvas>) => ThreeWebGLRenderer
  readonly Scene: new () => ThreeScene
  readonly PerspectiveCamera: new (
    fov: number,
    aspect: number,
    near: number,
    far: number,
  ) => ThreePerspectiveCamera
  readonly BufferGeometry: new () => TGeometry
  readonly BufferAttribute: new (
    array: Float32Array | Uint8Array | Uint32Array,
    itemSize: number,
    normalized: boolean,
  ) => ThreeBufferAttribute
  readonly Mesh: new (geometry: TGeometry, material: TMaterial) => ThreeMesh
  readonly MeshBasicMaterial: new (parameters: {
    readonly vertexColors: boolean
    readonly wireframe: boolean
  }) => TMaterial
}

/**
 * A uniform, as three wants it: a box with a mutable `value`.
 *
 * The BOX is the point and is not three being verbose. A host sets
 * `uniforms.uSunIntensity.value = 0.3` and every material sharing that object
 * sees it on the next frame, with no material rebuild and no shader
 * recompilation. Passing a bare number would mean replacing the uniform record
 * to change the sun, which sets `needsUpdate` and re-resolves the program for
 * every sharer — the exact cost `domain/material-policy.ts`'s `forceSinglePass`
 * rule exists to avoid, arrived at from the other direction.
 *
 * `unknown` rather than a union of the types three accepts: this surface never
 * READS a uniform value, it only hands one over, and enumerating three's
 * accepted types would be a list to maintain for no check.
 */
export type ThreeUniform = {
  value: unknown
}

/**
 * The parameters `ShaderMaterial` is constructed with.
 *
 * `vertexColors: true` is REQUIRED and not optional, which is a deliberate
 * narrowing of three's own signature. `domain/chunk-shader.ts`'s fragment source
 * reads `vColor` for all three of ambient occlusion, sky light and block light;
 * without the flag three does not define the `color` attribute and the shader
 * fails to link — in the browser, with a blank canvas and a console message,
 * which is the failure this repository has the least ability to see. Making it
 * a required `true` moves that to compile time.
 */
export type ThreeShaderMaterialParameters = {
  readonly vertexShader: string
  readonly fragmentShader: string
  readonly uniforms: Record<string, ThreeUniform>
  readonly vertexColors: true
}

/**
 * The surface, plus a `ShaderMaterial`.
 *
 * SEPARATE FROM `ThreeSurface` RATHER THAN A NINTH MEMBER OF IT, and the reason
 * is the property that file's header is built around: `makeWorldRenderer` must
 * remain constructible by a host that has no atlas image and no textured
 * pipeline. `apps/preview-render`, `test/stage-registration.test.ts` and every
 * consumer that composes the module to inspect frame order are in that
 * position, and adding a required member to `ThreeSurface` would oblige all of
 * them to supply a constructor they never call.
 *
 * A host that wants the textured, packed-light path passes one of these; a host
 * that wants a grey unlit world passes the smaller surface. Same discipline as
 * `DrawPort` — what a richer host adds is a port, not a branch.
 *
 * ---------------------------------------------------------------------------
 * FOUR TYPE PARAMETERS, BECAUSE THE TWO MATERIALS ARE NOT THE SAME MATERIAL
 * ---------------------------------------------------------------------------
 *
 * The first cut of this type reused `TMaterial` for both constructors and was
 * wrong in a way worth recording, because it reads as correct:
 *
 *     ThreeSurface<TCanvas, TGeometry, TMaterial> & {
 *       ShaderMaterial: new (...) => TMaterial   // <- wrong
 *     }
 *
 * Instantiated at `TMaterial = THREE.ShaderMaterial`, that obliges
 * `MeshBasicMaterial` to RETURN a `ShaderMaterial`, which no version of three
 * does. `test/three-surface.test.ts` caught it — it compiles the fixture and
 * asserts zero diagnostics — and the message named `MeshBasicMaterial` as the
 * incompatible member, three levels down, which is the opposite end of the type
 * from the one being added.
 *
 * `TMaterial` was never "the material type"; it is THE MATERIAL
 * `makeWorldRenderer` BUILDS. A host that has both paths available has two
 * material types and needs two slots. That distinction is invisible while only
 * one constructor exists, which is exactly why adding the second one is when it
 * had to be made.
 *
 * NOTE what this does NOT yet do: `makeWorldRenderer` still constructs a
 * `MeshBasicMaterial` unconditionally. Handing it a `ShaderMaterial` means the
 * renderer taking a material FACTORY rather than building one, and it means an
 * atlas texture — which needs `TextureLoader`, which needs the DOM, which is a
 * separate seam from this one. This type is the half that can land without
 * either.
 */
export type ThreeShaderSurface<
  TCanvas,
  TGeometry extends ThreeBufferGeometry,
  TMaterial extends ThreeMaterial,
  TShaderMaterial extends ThreeMaterial,
> = ThreeSurface<TCanvas, TGeometry, TMaterial> & {
  readonly ShaderMaterial: new (parameters: ThreeShaderMaterialParameters) => TShaderMaterial
}
