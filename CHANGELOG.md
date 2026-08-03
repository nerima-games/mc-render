# @nerima-games/mc-render

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
