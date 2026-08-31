/**
 * Dev server and build for `apps/render-preview` and `apps/shader-probe`.
 *
 * Lowered from mc-compose's `vite.config.ts` (Wave 1, W1-L5): both apps moved
 * here import `@nerima-games/mc-render`'s own source directly now (see each
 * app's `preview.ts` / `probe.ts`), so the build that proves they run belongs
 * beside the source it draws, not in the composed game's config.
 *
 * `outDir: 'build'`, not `dist/`: `dist/` is `tsc -p tsconfig.release.json`'s
 * output — the published package — and `scripts/clean-dist.mjs` /
 * `scripts/verify-package.mjs` both assume it holds exactly that. A second
 * writer into the same directory would make `pnpm build` and `pnpm build:web`
 * order-dependent on which one last cleaned the other's output.
 */
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const DEV_SERVER_PORT = 5182

const config: ReturnType<typeof defineConfig> = defineConfig({
  server: {
    port: DEV_SERVER_PORT,
    strictPort: true,
    host: '127.0.0.1',
  },
  resolve: {
    // Context.Tag identity requires one shared Effect installation, the same
    // reason mc-compose's config dedupes it.
    dedupe: ['effect'],
  },
  build: {
    target: 'es2024',
    outDir: 'build',
    sourcemap: true,
    // `rolldownOptions`, not `rollupOptions`: this pin of `vite` (8.2.2) builds
    // on Rolldown, and mc-compose's config — this file's source — found
    // `rollupOptions` silently ignored (its own header, on the codeSplitting
    // group below: a generic vendor group broke ESM interop; that was
    // diagnosed against `rolldownOptions`, not re-verified against the other
    // key).
    rolldownOptions: {
      input: {
        renderPreview: resolve(import.meta.dirname, 'apps/render-preview/index.html'),
        shaderProbe: resolve(import.meta.dirname, 'apps/shader-probe/index.html'),
      },
      output: {
        // Keep the verified Three.js boundary only; a generic vendor group
        // caused an ESM interop failure in mc-compose's browser startup bundle.
        codeSplitting: {
          groups: [
            {
              name: 'three',
              test: /node_modules[\\/]three[\\/]/,
              priority: 3,
              minSize: 128 * 1024,
            },
          ],
        },
      },
    },
  },
  clearScreen: false,
})

export default config
