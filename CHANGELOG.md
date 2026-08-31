# @nerima-games/mc-render

## 0.5.0

### Minor Changes

- [`253baa0`](https://github.com/nerima-games/mc-render/commit/253baa0a07f8092334fd678788a6d0a271051d3a) Thanks [@takeokunn](https://github.com/takeokunn)! - Move mc-compose's `apps/render-preview` and `apps/shader-probe` fixture/probe pages into this repository's own `apps/`, now importing this package's source directly and built with a new `vite` dev/build setup (`pnpm dev:web` / `pnpm build:web` / `pnpm preview:web`). Also lowers the game-rule logic mc-compose carried alongside them (Wave 1, W1-L5): a multi-finger touch-look controller and touch-control roster builder in `browser-input-adapter.ts`, a native mouse-click queue in `input-service.ts`, a chunk-light resolution tracker in `domain/voxel-lighting.ts`, a software-rasterizer quality helper in `domain/post-processing.ts`, and a frame-budgeted `DirtySource` decorator (`makeBudgetedDirtySource`) in `application/world-sync.ts`.

## 0.4.0

### Minor Changes

- [#18](https://github.com/nerima-games/mc-render/pull/18) [`8da0ca0`](https://github.com/nerima-games/mc-render/commit/8da0ca01aac7062033fdce1d7ab10fc5fe363815) Thanks [@takeokunn](https://github.com/takeokunn)! - Repoint the LOD vocabulary (`CHUNK_SIZE`, `LOD_LEVELS`, `LodLevel`, `LodLevelSchema`, `STEP_FOR_LOD`) from the local `domain/lod-vocabulary.ts` mirror to `@nerima-games/mc-meshing`, now that mc-meshing has published it. The barrel no longer re-exports these names; consumers import them from `@nerima-games/mc-meshing` directly.

### Patch Changes

- [#17](https://github.com/nerima-games/mc-render/pull/17) [`d0e146e`](https://github.com/nerima-games/mc-render/commit/d0e146e3c5d9c0b615de2b41b5bf333f5b2dbf0d) Thanks [@takeokunn](https://github.com/takeokunn)! - Complete the org toolchain devDependency pin set: knip 6.33.0 (its verify gate arrives in Wave 3; the pin belongs to the Wave 0 table) plus @effect/vitest 0.30.0 where it was missing.

## 0.3.0

### Minor Changes

- [#10](https://github.com/nerima-games/mc-render/pull/10) [`8bc3635`](https://github.com/nerima-games/mc-render/commit/8bc363520789c1a054d9c1b0f75f2f0db1b54b2e) Thanks [@takeokunn](https://github.com/takeokunn)! - Clear every `oxlint --deny-warnings` violation across `src/`, `apps/`, `scripts/`, and `test/`, and close the coverage gate (all four metrics now above the 99% threshold, up from below it since the 2026-08-01 org rollout).
  
  `.oxlintrc.json` gained a small number of narrow, evidence-based base-rule refinements rather than per-file suppressions: an `id-length` exception for the graphics-domain vector/color vocabulary (`x`/`y`/`z`/`u`/`v`/`r`/`g`/`b`/`a`, matching Three.js's own field names), a `no-underscore-dangle` allowance for Effect's `_tag` discriminated-union field, and file-scoped `max-params` exemptions for published entry points confirmed (by inspecting the sibling `mc-compose` checkout) to be called positionally by real external code — `makeWorldRenderer`, `makeProductionWorldRenderer`, `syncWorld`, `buildChunkGeometry` — plus `src/domain/particle-pool.ts`, whose already-documented zero-allocation frame-path design predates this change.
  
  Two previously-unused exported functions had their signatures reshaped from long positional argument lists into an options object, with zero known external callers (verified against this repo and the sibling `mc-compose`/`mc-playground-kit` checkouts):
  
  - `attachChunkStoreRenderer(renderer, store, options?, config?)` → `attachChunkStoreRenderer(renderer, store, options?)`, where `options.config` now carries the mesh config.
  - `preparePerspectiveFrustum(camera, verticalFovDegrees, aspect, nearPlane, farPlane)` → `preparePerspectiveFrustum(frustum: PerspectiveFrustum)`, reusing the file's own existing `PerspectiveFrustum` type.
  
  No other exported function's signature or runtime behavior changed. The coverage work added real behavioral tests for previously-untested branches across `src/application/**` and `src/domain/**`; a handful of branches that proved genuinely unreachable through any public call path (documented in each case, e.g. `worker-pool.ts`'s post-`shift()` guard on a provably non-empty queue) remain uncovered rather than forced with `v8 ignore`.

- [#14](https://github.com/nerima-games/mc-render/pull/14) [`89eaff2`](https://github.com/nerima-games/mc-render/commit/89eaff22c579d2876d8581566bf1828a6a19d876) Thanks [@takeokunn](https://github.com/takeokunn)! - Land the local main: renderer implementation, browser runtime boundary, and the uninitialized mirrored-camera state and ThreeMaterialSide exports.

### Patch Changes

- [#15](https://github.com/nerima-games/mc-render/pull/15) [`0e443ec`](https://github.com/nerima-games/mc-render/commit/0e443ecd69f92e56572aa3f39e88af3fab3ba462) Thanks [@takeokunn](https://github.com/takeokunn)! - Toolchain frozen to org pin set (TypeScript 7.0.2, vitest 4.1.11, effect 3.22.1, node 24, pnpm 11.24.0); build switched to tsc emit; release workflow added

## 0.2.0

### Minor Changes

- Add deterministic daylight environment planning and synchronize the sky clear
  colour, chunk sunlight, and distance fog through `WorldRenderer`.

### Patch Changes

- [`86996da`](https://github.com/nerima-games/mc-render/commit/86996da57dea437e2dc3d5a1558717a9c54f78e6) Thanks [@takeokunn](https://github.com/takeokunn)! - Integrate worldgen sky and block light into chunk vertex colours, including dirty re-sync and boundary-safe sampling.

- [#1](https://github.com/nerima-games/mc-render/pull/1) [`5ab0fde`](https://github.com/nerima-games/mc-render/commit/5ab0fdebd4a950dc642e7f79270c35852f1c6c23) Thanks [@takeokunn](https://github.com/takeokunn)! - Migrate to the org's `src/` package layout (PACKAGE_STANDARD.md) and add the
  previously-undeclared `@nerima-games/mc-sim` runtime dependency, aligning
  `package.json#dependencies` with the Tier2 dependency graph declared in
  DEPENDENCY_POLICY.md and `docs/architecture.md` §3.1. No shipped import from
  `mc-sim` exists yet (the `CameraPoseSnapshot` type it conceptually owns is
  still provisionally mirrored in `src/domain/kernel-vocabulary.ts`); this only
  corrects the declared dependency to match the documented graph ahead of that
  mirror being retired.
