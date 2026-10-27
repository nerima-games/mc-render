import { defineConfig } from 'vitest/config'

const vitestConfig: Parameters<typeof defineConfig>[0] = {
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
        // BROWSER_RUNTIME: Vitest's V8 provider observes the Node process, while
        // the published browser entry executes in Chromium. Its WebGL behavior
        // is exercised by the Playwright browser regression job; excluding it
        // here avoids treating browser-process code as unexecuted Node code.
        'src/browser.ts',
      ],
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // TEST_STANDARD.md §3: every executable source metric must remain at 100%.
      // Type-only adapters use compile-time fixtures; executable source in the
      // Node coverage scope remains subject to this threshold.
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
  esbuild: {
    target: 'node24',
    format: 'esm',
    platform: 'node',
  },
}

const config: ReturnType<typeof defineConfig> = defineConfig(vitestConfig)

export default config
