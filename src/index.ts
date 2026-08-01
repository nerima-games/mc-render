/**
 * @nerima-games/mc-render — rendering, and the runtime input service.
 *
 * PRE-AUDIT FIRST CUT (叩き台). See README.md 現状.
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
 * produces renderer state, in that direction only. The dependency graph makes
 * the reverse a cycle, which `pnpm check:deps` rejects outright.
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
// reference's table is indexed by ITS block ids, and mc-kernel's ordering
// disagrees from index 1 onward, so an index-wise copy would have been wrong in
// 117 of 120 rows with a real texture on every face.
export * from './domain/block-texture-map'
export * from './domain/camera-mirror'
export * from './domain/chunk-geometry'
export * from './domain/frame-scratch'
export * from './domain/frustum-culling'
export * from './domain/input-bindings'
// `level-of-detail.ts` decides which LOD tier a chunk is drawn at, and measures
// what that costs the picture. mc-meshing docs/responsibility.md §3.4 assigned
// it here because it takes a DISTANCE and mc-meshing holds no coordinates; the
// level vocabulary stayed there and `domain/lod-vocabulary.ts` mirrors it back.
//
// THAT MIRROR IS NOT EXPORTED FROM THIS BARREL, and neither is
// `domain/kernel-vocabulary.ts`. Both exclusions are deliberate and both are
// pinned by tests; this one was added because `check:repoint` FAILED WITHOUT IT,
// which is worth recording because the failure is invisible from inside this
// repository.
//
// `export * from './domain/lod-vocabulary'` becomes
// `export * from '@nerima-games/mc-meshing'` on the day the mirror is deleted —
// a re-export of that package's ENTIRE surface, which collides with the nine
// names `domain/chunk-geometry.ts` declares as its own structural mirrors
// (`FaceDirection`, `FaceRole`, `QuadAxis`, `tangentAxes`, `totalQuadArea`,
// `AO_LEVELS`, `AO_MAX`, `VERTICES_PER_QUAD`, `INDICES_PER_QUAD`). Nine TS2308s
// in three tsconfig projects, and `pnpm verify` here is green throughout,
// because the collision does not exist until the import is repointed.
//
// A mirror is a private stand-in for somebody else's package. Putting one in a
// barrel re-publishes it under this package's name, which is the thing the
// mirror headers all promise not to do.
export * from './domain/level-of-detail'
export * from './domain/material-policy'
export * from './domain/particle-pool'
export * from './domain/particle-shader'
export * from './domain/post-processing'
export * from './domain/render-environment'
export * from './domain/weather-rendering'
export * from './domain/texture-atlas'
// The shading curve. `chunk-geometry.ts` builds buffers and does not decide how
// bright a surface is; this holds the rule, and a host injects the light
// readings. Its header names the noun still missing before the reference's
// R = AO / G = sky / B = block packing can be used: a `ShaderMaterial` in
// `application/three-surface.ts` to decode it.
export * from './domain/chunk-shader'
export * from './domain/voxel-lighting'
export * from './domain/water-refraction'
export * from './domain/water-shader'
export * from './domain/water-surface'

// --- Application: Effect services ------------------------------------------
export * from './application/input-service'

// --- Application: the browser adapter for the input service ------------------
// The ONLY files in this repository that know what an `addEventListener` is.
// `dom-surface.ts` is the whole DOM dependency, structurally; see its header for
// why that is a narrow interface rather than `"lib": ["DOM"]`.
export * from './application/dom-surface'
export * from './application/browser-input-adapter'

// --- Application: the THREE.js adapter --------------------------------------
// `three-surface.ts` is the whole THREE dependency, structurally — the same
// move `dom-surface.ts` makes for `window`, and for the same reason: no shipped
// file imports `three`, so `tsconfig.build.json` still compiles this package
// with `lib: ["ES2024"]` and `types: []`. The HOST passes the real namespace in.
//
// `world-renderer.ts` is the only file in the repository that touches a GPU. It
// is what closes docs/e2e-triage.md #1 in mc-compose: nothing in the roster
// created a WebGL context, so the composed page drew nothing and the smoke test
// that says so was `fixme`.
export * from './application/three-surface'
export * from './application/world-renderer'
export * from './application/particle-system'
export * from './application/weather-renderer'
export * from './application/world-sync'
export * from './application/chunk-store-mesher'
export * from './application/worker-pool'

// --- Stages: this repository's contribution to the frame --------------------
// `renderModule` is a full `GameModule` (plan.md §4.1): a Layer plus an
// Effect-valued `frameStages`. It is what closes the hole recorded in
// mc-compose/docs/architecture.md §5 — nothing in the roster could reach the
// renderer, so the shipped build had no input stage at all.
export * from './stages/registration'
export * from './stages/stage-ids'

// --- Provisional -------------------------------------------------------------
// `domain/kernel-vocabulary.ts` is a temporary local mirror of
// @nerima-games/mc-kernel and is NOT re-exported: consumers must take that
// vocabulary from kernel, not from mc-render, or the mirror would become a
// second source of truth and its scheduled deletion would break them.
