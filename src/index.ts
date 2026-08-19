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
 * direction makes the reverse a cycle; the typecheck keeps the reachable
 * public source consistent.
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
 * The core entry keeps the THREE surface structural: `application/three-surface.ts`
 * describes the constructors the renderer needs, and the fixture proves that
 * real `three` satisfies the contract. The explicit `./browser` entry is the
 * platform boundary: it owns the runtime `three` namespace, WebGL renderer,
 * texture loading, refraction target and EffectComposer. Keeping that entry
 * separate leaves the root entry and its Node tests DOM-free.
 */

// --- Domain: pure values, policies and orderings ---------------------------
// Which atlas tile each block shows. Keyed by NAME and not by id: the
// Reference's table is indexed by ITS block ids, and mc-kernel's ordering
// Disagrees from index 1 onward, so an index-wise copy would have been wrong in
// 117 of 120 rows with a real texture on every face.
export * from './domain/block-texture-map'
export * from './domain/camera-mirror'
export * from './domain/chunk-geometry'
export * from './domain/frame-scratch'
export * from './domain/frustum-culling'
export * from './domain/focus-navigation'
export * from './domain/input-bindings'
export * from './domain/gamepad-input'
export * from './domain/player-control'
// `level-of-detail.ts` owns distance-based LOD policy. The shared level and
// Chunk vocabulary remains in `@nerima-games/mc-meshing` and is intentionally
// Consumed directly rather than re-exported from this package.
export * from './domain/level-of-detail'
export * from './domain/material-policy'
export * from './domain/mob-visual'
export * from './domain/particle-pool'
export * from './domain/particle-shader'
export * from './domain/post-processing'
export * from './domain/render-environment'
export * from './domain/weather-rendering'
export * from './domain/texture-atlas'
export * from './domain/vehicle-visual'
export * from './domain/wither-visual'
// The shading curve. `chunk-geometry.ts` builds buffers and does not decide how
// Bright a surface is; this holds the rule, and a host injects the light
// Readings. Its header names the noun still missing before the reference's
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
// WHY that is a narrow interface rather than `"lib": ["DOM"]`.
export * from './application/dom-surface'
export * from './application/browser-input-adapter'
export * from './application/browser-worker-port'
export * from './application/gamepad-input-adapter'

// --- Application: the core THREE surface ------------------------------------
// The root entry exposes the structural contract and renderer. The browser
// Entry is intentionally separate so consumers that only need plans, input or
// The Node surface does not acquire DOM/WebGL types through this module.
export * from './application/three-surface'
export * from './application/world-renderer'
export * from './application/world-renderer-production'
export * from './application/particle-system'
export * from './application/weather-renderer'
export * from './application/world-sync'
export * from './application/chunk-store-mesher'
export * from './application/worker-pool'

// --- Stages: this repository's contribution to the frame --------------------
// `renderModule` is a full `GameModule` (plan.md §4.1): a Layer plus an
// Effect-valued `frameStages`. It is what closes the hole recorded in
// Mc-compose/docs/architecture.md §5 — nothing in the roster could reach the
// Renderer, so the shipped build had no input stage at all.
export * from './stages/registration'
export * from './stages/stage-ids'

// --- Provisional -------------------------------------------------------------
// Kernel vocabulary is not re-exported from this package: consumers import it
// From `@nerima-games/mc-kernel`, keeping one source of truth.
