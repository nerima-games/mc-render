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
 *   (b) `tsconfig.build.json` still has no `"DOM"`, no `types`, and no file
 *       that imports `three` — so the shipped package remains compilable
 *       without either.
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
import { inspectTypeScriptFixture, parseTypeScriptConfig } from './typescript-project'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('REGRESSION: the THREE surface is a real subset of the real three', () => {
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
        const inspection = inspectTypeScriptFixture(repositoryRoot, fixture, ['ES2022', 'DOM'])

        expect(inspection.errors).toStrictEqual([])
      }),
    60_000,
  )

  it.effect('the fixture really did resolve `three`, rather than silently failing to', () =>
    Effect.sync(() => {
      // Without this, the test above passes if `three` is absent AND the
      // fixture's import silently resolves to `any` — which is exactly the
      // failure mode `application/three-surface.ts` rejects `skipLibCheck` for.
      // Inspecting the program's loaded source files is what makes "zero
      // diagnostics" mean "checked" rather than "not checked".
      const inspection = inspectTypeScriptFixture(
        repositoryRoot,
        path.join(repositoryRoot, 'test', 'fixtures', 'three-surface.ts'),
        ['ES2022', 'DOM'],
      )

      expect(
        inspection.sourceFileNames.some((file) =>
          /node_modules[\\/](?:three|@types[\\/]three)[\\/].+\.d\.ts$/u.test(file),
        ),
      ).toBe(true)
    }),
  )

  it.effect('the shipped project still compiles with no DOM and no three', () =>
    Effect.sync(() => {
      // The other half of the proof, and the one that stops the first half from
      // being satisfiable by giving up. `pnpm typecheck` runs
      // `tsconfig.build.json`; if a later change adds "DOM" there, every pure
      // module can reach `document` and nothing notices for months.
      const parsed = parseTypeScriptConfig(
        repositoryRoot,
        path.join(repositoryRoot, 'tsconfig.build.json'),
      )

      expect(parsed.options['lib']).toStrictEqual(['lib.es2024.d.ts'])
      expect(parsed.options['types']).toStrictEqual([])
      expect(
        parsed.fileNames.some((file) => file.endsWith('application/world-renderer.ts')),
      ).toBe(true)
      expect(parsed.fileNames.some((file) => file.endsWith('application/three-surface.ts'))).toBe(
        true,
      )
      expect(parsed.fileNames.some((file) => file.includes('/test/'))).toBe(false)
    }),
  )

  it.effect('NO shipped file imports three, and package.json keeps it a devDependency', () =>
    Effect.sync(() => {
      // Stated as a grep rather than trusted to the compiler, because the
      // compiler would be perfectly happy with a `three` import in
      // `application/` — `skipLibCheck` would swallow the DOM references inside
      // the declarations and hand every use site `any`. That is the exact
      // failure this surface exists to prevent, and it is INVISIBLE to
      // `pnpm typecheck`.
      const parsed = parseTypeScriptConfig(
        repositoryRoot,
        path.join(repositoryRoot, 'tsconfig.build.json'),
      )

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

      expect(manifest.dependencies?.['three']).toBeUndefined()
      expect(manifest.devDependencies?.['three']).toBeDefined()
      // Keep the type package on the same major/minor as THREE because THREE
      // ships breaking changes in MINOR releases; patch releases may differ.
      const minorVersion = (version: string | undefined): string | undefined =>
        version?.match(/(?<minor>\d+\.\d+)/u)?.groups?.['minor']
      expect(minorVersion(manifest.devDependencies?.['@types/three'])).toBe(
        minorVersion(manifest.devDependencies?.['three']),
      )
    }),
  )
})
