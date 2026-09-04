/**
 * @nerima-games/mc-render — rendering, and the runtime input service.
 *
 * Two responsibilities that look unrelated and are not:
 *
 *   RENDERING (plan.md §3.9) — THREE.js materials, camera, post-FX, particles,
 *   water, the worker pool, and the textures.
 *
 *   RUNTIME INPUT (plan.md §2.3-2, §7) — keyboard, mouse, pointer lock, touch,
 *   key remapping. It lives here and NOT in mc-playground-kit, because kit is
 *   dev-only: input placed there would be absent from every shipped build. Both
 *   are browser-platform concerns, and this is the repository that owns the
 *   browser platform.
 *
 * What this repository is NOT allowed to be: the authority on the camera.
 * mc-sim owns `CameraPoseSnapshot`; `domain/camera-mirror.ts` consumes one and
 * produces renderer state, in that direction only. The package dependency
 * policy and TypeScript boundaries keep the reverse edge out of the shipped
 * surface.
 *
 * The domain is PURE — no THREE.js, no DOM, no WebGL. The post-FX chain, the
 * material policy, the input bindings and the scratch buffers are all data and
 * pure functions, which is what lets them be tested in Node under
 * `environment: 'node'`.
 *
 * The `window` input adapter is here now, and it did NOT turn `"DOM"` on in
 * `tsconfig.base.json`: it describes the handful of DOM members it uses as
 * structural types in `application/dom-surface.ts`, which is one file, is
 * auditable in one read, and is proved against the real `lib.dom.d.ts` by a
 * test. `pnpm typecheck` therefore still compiles this entire shipped surface
 * with `lib: ["ES2024"]` and `types: []` — which is the property that keeps the
 * pointer-lock state machine testable at all (plan.md §3.10: Playwright runs on
 * SwiftShader and cannot do pointer lock).
 *
 * THE THREE.js ADAPTER IS HERE NOW, AND IT DID NOT TURN `"DOM"` ON EITHER.
 * `application/three-surface.ts` describes the seven constructors the renderer
 * uses and the ~20 members off them, and `test/three-surface.test.ts` compiles a
 * fixture against the REAL `three` and `lib.dom.d.ts` to prove the namespace
 * satisfies them. `three` is a devDependency: it exists so that proof has an
 * oracle, and no shipped file imports it. `"WebWorker"` is still ahead, with the
 * mesher pool.
 */

// --- Domain: pure values, policies and orderings ---------------------------
// Which atlas tile each block shows. Keyed by NAME and not by id: the
// Reference's table is indexed by ITS block ids, and mc-kernel's ordering
// Disagrees from index 1 onward, so an index-wise copy would have been wrong in
// Texture coverage: 117 of 120 rows have a real texture on every face.
export * from './domain/block-texture-map.js'
export * from './domain/block-shapes.js'
export * from './domain/camera-mirror.js'
export * from './domain/chunk-geometry.js'
export * from './domain/frame-scratch.js'
export * from './domain/frustum-culling.js'
export * from './domain/input-bindings.js'
// Arrow-key navigation WITHIN a keyboard focus group (DN-16 §5(a)) — the codes,
// The direction they map to, and the index step that direction takes.
export * from './domain/focus-navigation.js'
export * from './domain/gamepad-input.js'
export * from './domain/player-control.js'
// Level-of-detail.ts decides which LOD tier a chunk is drawn at.
// The same module measures the cost to the picture.
// The tier vocabulary itself (LodLevel, STEP_FOR_LOD, CHUNK_SIZE) is
// @nerima-games/mc-meshing's; consumers import it from there directly.
export * from './domain/level-of-detail.js'
export * from './domain/material-policy.js'
export * from './domain/meshing-vocabulary.js'
export * from './domain/mob-visual.js'
export * from './domain/particle-pool.js'
export * from './domain/particle-shader.js'
export * from './domain/post-processing.js'
export {
  DAY_SKY_COLOR,
  DEFAULT_DIMENSION,
  DEFAULT_ENVIRONMENT_FAR_PLANE,
  END_VOID_COLOR,
  NETHER_FOG_COLOR,
  NIGHT_SKY_COLOR,
  type RenderEnvironmentPlan,
  planRenderEnvironment,
} from './domain/render-environment.js'
export * from './domain/weather-rendering.js'
export * from './domain/texture-atlas.js'
export * from './domain/vehicle-visual.js'
export * from './domain/wither-visual.js'
// The shading curve. `chunk-geometry.ts` builds buffers and does not decide how
// Bright a surface is; this holds the rule, and a host injects the light
// Readings. Its header names the noun still missing before the reference's
// R = AO / G = sky / B = block packing can be used: a `ShaderMaterial` in
// `application/three-surface.ts` to decode it.
export * from './domain/chunk-shader.js'
export * from './domain/voxel-lighting.js'
export * from './domain/water-refraction.js'
export * from './domain/water-shader.js'
export * from './domain/water-surface.js'

// --- Application: Effect services ------------------------------------------
export * from './application/input-service.js'

// --- Application: the browser adapter for the input service ------------------
// The ONLY files in this repository that know what an `addEventListener` is.
// `dom-surface.ts` is the whole DOM dependency, structurally; see its header for
// Why that is a narrow interface rather than `"lib": ["DOM"]`.
export * from './application/dom-surface.js'
export * from './application/browser-input-adapter.js'
export * from './application/gamepad-input-adapter.js'

// --- Application: the THREE.js adapter --------------------------------------
// `three-surface.ts` is the whole THREE dependency, structurally — the same
// Move `dom-surface.ts` makes for `window`, and for the same reason: no shipped
// File imports `three`, so `tsconfig.build.json` still compiles this package
// With `lib: ["ES2024"]` and `types: []`. The HOST passes the real namespace in.
//
// `world-renderer.ts` is the only file in the repository that touches a GPU. It
// Is what closes docs/e2e-triage.md #1 in mc-compose: nothing in the roster
// Created a WebGL context, so the composed page drew nothing and the smoke test
// That says so was `fixme`.
export * from './application/three-surface.js'
export * from './application/world-renderer.js'
export * from './application/particle-system.js'
export * from './application/weather-renderer.js'
export * from './application/world-sync.js'
export * from './application/chunk-store-mesher.js'
export * from './application/worker-pool.js'

// --- Stages: this repository's contribution to the frame --------------------
// `renderModule` is a full `GameModule` (plan.md §4.1): a Layer plus an
// Effect-valued `frameStages`. It is what closes the hole recorded in
// Mc-compose/docs/architecture.md §5 — nothing in the roster could reach the
// Renderer, so the shipped build had no input stage at all.
export * from './stages/registration.js'
export * from './stages/stage-ids.js'

// --- Provisional -------------------------------------------------------------
// Kernel and meshing vocabulary are not re-exported from this package:
// Consumers import them from `@nerima-games/mc-kernel` and
// `@nerima-games/mc-meshing` directly, keeping one source of truth.
