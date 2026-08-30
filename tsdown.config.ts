import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    browser: 'src/browser.ts',
  },
  format: ['esm'],
  outDir: 'dist',
  clean: true,
  dts: true,
  sourcemap: true,
  target: 'es2024',
  platform: 'neutral',
  tsconfig: 'tsconfig.package.json',
  deps: {
    alwaysBundle: ['@nerima-games/mc-kernel', '@nerima-games/mc-meshing'],
    onlyBundle: ['@nerima-games/mc-kernel', '@nerima-games/mc-meshing'],
    dts: {
      neverBundle: ['@nerima-games/mc-kernel', '@nerima-games/mc-meshing', 'three'],
    },
  },
})
