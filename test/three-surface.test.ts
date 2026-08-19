/**
 * The property `application/three-surface.ts` rests on, checked rather than
 * asserted: THE REAL `three` SATISFIES THE STRUCTURAL SURFACE WITHOUT A CAST.
 *
 * The same mechanism as the DOM proof at the foot of
 * `test/browser-input-adapter.test.ts` — a TypeScript program is built over a
 * fixture that the ordinary projects deliberately cannot compile, and its
 * diagnostics are the assertion. The two halves are:
 *
 *   (a) `test/fixtures/three-surface.ts` compiles against the REAL `three`
 *       declarations and the real `lib.dom.d.ts`, with zero errors;
 *   (b) `tsconfig.build.json` still has no `"DOM"` or `types`, and the core
 *       entry remains free of a runtime `three` import. The separate
 *       `./browser` entry is the intentional DOM/Three boundary.
 *
 * (b) is the load-bearing one. Without it, (a) could be made to pass at any
 * time by importing `three` in `application/world-renderer.ts` and deleting the
 * surface, and every pure module in `domain/` would silently gain
 * `HTMLCanvasElement`, `document` and `WebGL2RenderingContext` on the way past.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { DoubleSide } from 'three'
import ts from 'typescript-compiler-api'
import { THREE_DOUBLE_SIDE } from '../src/application/three-surface'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('REGRESSION: the THREE surface is a real subset of the real three', () => {
  it.effect('keeps the transparent flat-surface side value aligned with Three', () =>
    Effect.sync(() => {
      expect(THREE_DOUBLE_SIDE).toBe(2)
      expect(THREE_DOUBLE_SIDE).toBe(DoubleSide)
    }),
  )

  it.effect(
    'the real `three` namespace satisfies ThreeSurface without a cast',
    () =>
      Effect.sync(() => {
        // NOT a hand-written stub of three's types — the package's own
        // `.d.ts`, resolved the way a consumer would resolve it. Every one of
        // the variance rules in `application/three-surface.ts`'s header was
        // discovered by this test rejecting the obvious spelling first:
        //
        //   ThreeMesh with `geometry`      -> "Object3D is missing geometry"
        //   ThreeMaterial with `dispose`   -> "Material[] has no dispose"
        //   ThreeCamera with `aspect`      -> "Camera is missing aspect"
        //   Mesh: new (g: ThreeBufferGeometry) -> the contravariant direction,
        //       which is the one construct signatures get and methods do not.
        const fixture = path.join(repositoryRoot, 'test', 'fixtures', 'three-surface.ts')
        const program = ts.createProgram({
          rootNames: [fixture],
          options: {
            noEmit: true,
            strict: true,
            exactOptionalPropertyTypes: true,
            noUncheckedIndexedAccess: true,
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            moduleDetection: ts.ModuleDetectionKind.Force,
            skipLibCheck: true,
            types: [],
            // THE POINT OF THE TEST: the real DOM and, through the import in
            // the fixture, the real `three`.
            lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
            baseUrl: repositoryRoot,
          },
        })

        const diagnostics = [
          ...program.getSemanticDiagnostics(),
          ...program.getSyntacticDiagnostics(),
        ].filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)

        expect(
          diagnostics.map((diagnostic) =>
            ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
          ),
        ).toStrictEqual([])
      }),
    60_000,
  )

  it.effect('the fixture really did resolve `three`, rather than silently failing to', () =>
    Effect.sync(() => {
      // Without this, the test above passes if `three` is absent AND the
      // fixture's import silently resolves to `any` — which is exactly the
      // failure mode `application/three-surface.ts` rejects `skipLibCheck` for.
      // Resolving the specifier the same way the program does is what makes
      // "zero diagnostics" mean "checked" rather than "not checked".
      const resolved = ts.resolveModuleName(
        'three',
        path.join(repositoryRoot, 'test', 'fixtures', 'three-surface.ts'),
        { moduleResolution: ts.ModuleResolutionKind.Bundler, baseUrl: repositoryRoot },
        ts.sys,
      )

      expect(resolved.resolvedModule?.resolvedFileName).toMatch(/three/u)
      expect(resolved.resolvedModule?.extension).toBe(ts.Extension.Dts)
    }),
  )

  it.effect('the core project still compiles with no DOM and no runtime three import', () =>
    Effect.sync(() => {
      // The other half of the proof, and the one that stops the first half from
      // being satisfiable by giving up. `pnpm typecheck` runs
      // `tsconfig.build.json`; if a later change adds "DOM" there, every pure
      // module can reach `document` and nothing notices for months.
      const config = ts.readConfigFile(
        path.join(repositoryRoot, 'tsconfig.build.json'),
        ts.sys.readFile,
      )
      const parsed = ts.parseJsonConfigFileContent(config.config as unknown, ts.sys, repositoryRoot)

      expect(parsed.options.lib).toStrictEqual(['lib.es2024.d.ts'])
      expect(parsed.options.types).toStrictEqual([])
      expect(
        parsed.fileNames.some((file) => file.endsWith('application/world-renderer.ts')),
      ).toBe(true)
      expect(parsed.fileNames.some((file) => file.endsWith('application/three-surface.ts'))).toBe(
        true,
      )
      expect(parsed.fileNames.some((file) => file.includes('/test/'))).toBe(false)
    }),
  )

  it.effect('the core entry keeps three at the browser boundary', () =>
    Effect.sync(() => {
      // Stated as a source inspection rather than trusted to the compiler,
      // because the browser entry is intentionally the only runtime Three
      // boundary and the compiler does not enforce that architectural split.
      const config = ts.readConfigFile(
        path.join(repositoryRoot, 'tsconfig.build.json'),
        ts.sys.readFile,
      )
      const parsed = ts.parseJsonConfigFileContent(config.config as unknown, ts.sys, repositoryRoot)

      const offenders = parsed.fileNames.filter((file) =>
        /(?:^|\n)\s*import[^\n]*from\s*['"]three(?:\/[^'"]*)?['"]/u.test(readFileSync(file, 'utf8')),
      )
      expect(offenders).toStrictEqual([])

      const manifest = JSON.parse(
        readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
      ) as {
        readonly dependencies?: Record<string, string>
        readonly devDependencies?: Record<string, string>
      }

      expect(manifest.dependencies?.['three']).toBeDefined()
      expect(manifest.devDependencies?.['three']).toBeUndefined()
      // Pinned to the same major/minor as the types, and that is not
      // bookkeeping: docs/versioning.md §5 records that THREE ships breaking
      // changes in MINOR releases, so a `@types/three` a minor ahead of `three`
      // describes a library that is not installed.
      const majorMinor = (range: string | undefined) => range?.match(/^\^?(?<majorMinor>\d+\.\d+)/)?.groups?.['majorMinor']
      expect(majorMinor(manifest.devDependencies?.['@types/three'])).toBe(
        majorMinor(manifest.dependencies?.['three']),
      )
    }),
  )
})
