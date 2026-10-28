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
