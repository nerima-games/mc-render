import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    maxWorkers: '50%',
    isolate: true,
    include: ['test/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.git/**'],
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 5000,
    slowTestThreshold: 300,
    fileParallelism: true,
    sequence: {
      seed: 0,
      hooks: 'stack',
    },
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      enabled: false,
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        '**/*.config.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        // PURE_TYPE (TEST_STANDARD.md §3.2, same treatment as mc-kernel's
        // domain/frame.ts): every export in this file is `export type` — zero
        // executable statements. v8 reports files like this as 0% rather than
        // 100%, which only makes the headline number meaningless without
        // saying anything about real coverage. The contract this file makes
        // (that the structural types below are a real subset of `three`'s
        // actual API) is verified by `pnpm typecheck` and by
        // test/three-surface.test.ts / test/fixtures/three-surface.ts, which
        // compile it against the real `three/index.d.ts` — not by vitest
        // coverage.
        'src/application/three-surface.ts',
        // NOT_SHIPPED (Wave 0 toolchain freeze, chore/wave0-toolchain): this
        // is the package's optional browser entry point. It was previously
        // built by tsdown (dist/browser.js) but never actually reachable
        // through package.json#exports (no "./browser" subpath was ever
        // declared, and docs/public-api.md §8 names src/index.ts as the sole
        // source of truth for the public surface). The org-standard build
        // (`tsc -p tsconfig.release.json`) only emits src/index.ts plus
        // domain/application/stages, so this file is no longer part of the
        // shipped dist/ output either — nothing in this repository imports
        // it (verified: no src/, test/, or apps/ file references
        // './browser' or 'src/browser'). Excluded here rather than silently
        // dropped from the coverage.include glob, so the gap stays visible.
        // See the Wave 0 PR report for the open question this leaves: either
        // restore a "./browser" export + release-build target in a later
        // wave, or formally reclassify this file as non-shipped.
        'src/browser.ts',
      ],
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // TEST_STANDARD.md §3: every executable source metric must remain at 100%.
      // Type-only adapters use compile-time fixture tests instead of V8 coverage;
      // all executable source remains subject to this threshold.
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
  esbuild: {
    target: 'node24',
    format: 'esm',
    platform: 'node',
  },
})
