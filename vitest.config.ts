import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: '50%',
        minForks: 1,
        isolate: true,
        singleFork: false,
      },
    },
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
      include: ['src/index.ts', 'src/domain/**/*.ts', 'src/application/**/*.ts', 'src/stages/**/*.ts'],
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
      ],
      all: true,
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // TEST_STANDARD.md §3: four-metric 100% gate.
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
  esbuild: {
    target: 'node24',
    format: 'esm',
    platform: 'node',
  },
})
