/**
 * Tests for the boundary gate itself.
 *
 * plan.md §5.1-4 requires the dependency whitelist CI from the first commit.
 * A gate nobody tests is a gate that quietly stops gating — the reference's
 * `check-package-dag.ts` printed warnings and always exited 0, which is
 * documentation wearing a gate's clothes. These tests assert that the gate
 * still says no.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  allowedDirectDependencies,
  checkDeclaredDependencies,
  checkPolicyConfiguration,
  classifyImport,
  extractOrgPackageName,
  findBannedTimeSources,
  findCycles,
  findTransitivePath,
  isToolingOrTestPath,
  parseImports,
  REPOSITORY_POLICY,
  TIME_SOURCE_ESCAPE_HATCH,
  type DeclaredDependencies,
} from '../scripts/check-dependency-whitelist'

const NOTHING_DECLARED: DeclaredDependencies = {
  dependencies: new Set<string>(),
  devDependencies: new Set<string>(),
}

const declaring = (dependencies: ReadonlyArray<string>, dev: ReadonlyArray<string> = []): DeclaredDependencies => ({
  dependencies: new Set(dependencies),
  devDependencies: new Set(dev),
})

const shippedImport = (importedPackage: string) => ({
  importedPackage,
  filePath: 'application/world-renderer.ts',
  line: 1,
  isToolingOrTest: false,
})

const testImport = (importedPackage: string) => ({
  importedPackage,
  filePath: 'test/post-processing.test.ts',
  line: 1,
  isToolingOrTest: true,
})

const graph = (entries: ReadonlyArray<readonly [string, ReadonlyArray<string>]>): Map<string, ReadonlySet<string>> =>
  new Map(entries.map(([node, targets]) => [node, new Set(targets)]))

describe('mc-render dependency policy', () => {
  it.effect('is this repository, and its allowed set is exactly plan.md §2.1', () =>
    Effect.sync(() => {
      expect(REPOSITORY_POLICY.thisPackage).toBe('@nerima-games/mc-render')
      expect([...allowedDirectDependencies()].sort()).toStrictEqual([
        '@nerima-games/mc-meshing',
        '@nerima-games/mc-sim',
        '@nerima-games/mc-worldgen',
      ])
    }),
  )

  it.effect('carries the FULL 16-repository roster, so cycle detection can see a cycle', () =>
    Effect.sync(() => {
      expect([...REPOSITORY_POLICY.dependencyGraph.keys()].sort()).toStrictEqual([
        '@nerima-games/mc-audio',
        '@nerima-games/mc-compose',
        '@nerima-games/mc-dev-meta',
        '@nerima-games/mc-kernel',
        '@nerima-games/mc-meshing',
        '@nerima-games/mc-noise',
        '@nerima-games/mc-physics',
        '@nerima-games/mc-playground-kit',
        '@nerima-games/mc-render',
        '@nerima-games/mc-save',
        '@nerima-games/mc-sim',
        '@nerima-games/mc-worldgen',
        '@nerima-games/mx-gameplay',
        '@nerima-games/mx-multiplayer',
        '@nerima-games/mx-redstone',
        '@nerima-games/mx-ui',
      ])
      expect(REPOSITORY_POLICY.dependencyGraph.size).toBe(16)
    }),
  )

  it.effect('has an internally consistent configuration: no cycles, no dangling rows', () =>
    Effect.sync(() => {
      expect(checkPolicyConfiguration()).toStrictEqual([])
    }),
  )

  it.effect('the declared architecture is acyclic end to end', () =>
    Effect.sync(() => {
      expect(findCycles(REPOSITORY_POLICY.dependencyGraph)).toStrictEqual([])
    }),
  )

  it.effect('never lists mc-kernel as an edge — it is universal, not a dependency', () =>
    Effect.sync(() => {
      for (const [, targets] of REPOSITORY_POLICY.dependencyGraph) {
        expect(targets.has('@nerima-games/mc-kernel')).toBe(false)
      }
    }),
  )

  it.effect('depends on mc-sim, which is what makes the camera write-back edge a cycle', () =>
    Effect.sync(() => {
      // The camera-ownership fix expressed structurally: mc-sim cannot import
      // mc-render, so it can never ask this repository where the camera is.
      expect(allowedDirectDependencies().has('@nerima-games/mc-sim')).toBe(true)
      const simRow = REPOSITORY_POLICY.dependencyGraph.get('@nerima-games/mc-sim')
      expect(simRow?.has('@nerima-games/mc-render')).toBe(false)
    }),
  )

  it.effect('REGRESSION: mc-playground-kit is not, and must never be, a dependency', () =>
    Effect.sync(() => {
      // plan.md §2.3-2: this repository owns the runtime input service. Taking
      // input from the dev-only harness instead would leave the shipped game
      // with no input at all.
      expect(allowedDirectDependencies().has('@nerima-games/mc-playground-kit')).toBe(false)
    }),
  )
})

describe('import classification for mc-render', () => {
  it.effect('allows a declared direct dependency from shipped source', () =>
    Effect.sync(() => {
      const declared = declaring(['@nerima-games/mc-sim'])
      expect(classifyImport(shippedImport('@nerima-games/mc-sim'), declared)).toBeUndefined()
    }),
  )

  it.effect('allows mc-kernel without it appearing in any allowlist — but it must be declared', () =>
    Effect.sync(() => {
      expect(
        classifyImport(shippedImport('@nerima-games/mc-kernel'), declaring(['@nerima-games/mc-kernel'])),
      ).toBeUndefined()
      expect(classifyImport(shippedImport('@nerima-games/mc-kernel'), NOTHING_DECLARED)?.rule).toBe(
        'undeclared-dependency',
      )
    }),
  )

  it.effect('REGRESSION: mc-physics is reachable through mc-sim and is therefore FORBIDDEN', () =>
    Effect.sync(() => {
      // The renderer draws what the simulation says is true. Re-running a
      // collision query here would make the drawn world and the simulated one
      // two independent answers to the same question.
      const violation = classifyImport(
        shippedImport('@nerima-games/mc-physics'),
        declaring(['@nerima-games/mc-physics']),
      )

      expect(violation?.rule).toBe('transitive-import')
      expect(violation?.message).toContain('@nerima-games/mc-render -> @nerima-games/mc-sim -> @nerima-games/mc-physics')
    }),
  )

  it.effect('REGRESSION: mc-save is likewise transitive — the renderer never reads a save file', () =>
    Effect.sync(() => {
      expect(
        classifyImport(shippedImport('@nerima-games/mc-save'), declaring(['@nerima-games/mc-save']))?.rule,
      ).toBe('transitive-import')
    }),
  )

  it.effect('rejects mx-ui outright: experience modules are downstream, not upstream', () =>
    Effect.sync(() => {
      const violation = classifyImport(shippedImport('@nerima-games/mx-ui'), NOTHING_DECLARED)
      expect(violation?.rule).toBe('not-whitelisted')
    }),
  )

  it.effect('rejects importing mc-render from mc-render', () =>
    Effect.sync(() => {
      expect(classifyImport(shippedImport('@nerima-games/mc-render'), NOTHING_DECLARED)?.rule).toBe(
        'self-import',
      )
    }),
  )

  it.effect('REGRESSION: mc-playground-kit may never be imported from shipped source', () =>
    Effect.sync(() => {
      const violation = classifyImport(
        shippedImport('@nerima-games/mc-playground-kit'),
        declaring([], ['@nerima-games/mc-playground-kit']),
      )

      expect(violation?.rule).toBe('dev-only-package-in-shipped-source')
    }),
  )

  it.effect('mc-playground-kit IS allowed from a test, if it is a devDependency', () =>
    Effect.sync(() => {
      expect(
        classifyImport(
          testImport('@nerima-games/mc-playground-kit'),
          declaring([], ['@nerima-games/mc-playground-kit']),
        ),
      ).toBeUndefined()
    }),
  )

  it.effect('REGRESSION: mc-playground-kit in "dependencies" is a package.json-level failure', () =>
    Effect.sync(() => {
      const violations = checkDeclaredDependencies(declaring(['@nerima-games/mc-playground-kit']))

      expect(violations).toHaveLength(1)
      expect(violations[0]?.rule).toBe('dev-only-package-in-dependencies')
    }),
  )

  it.effect('flags a typo as unknown-package rather than guessing', () =>
    Effect.sync(() => {
      expect(classifyImport(shippedImport('@nerima-games/mc-wordlgen'), NOTHING_DECLARED)?.rule).toBe(
        'unknown-package',
      )
    }),
  )

  it.effect('a dependency in package.json that the policy forbids is caught even if unimported', () =>
    Effect.sync(() => {
      const violations = checkDeclaredDependencies(declaring(['@nerima-games/mc-audio', 'effect']))

      expect(violations).toHaveLength(1)
      expect(violations[0]?.rule).toBe('undeclared-in-policy')
    }),
  )
})

describe('shipped vs tooling classification', () => {
  it.effect('index.ts, domain/ and application/ are shipped; everything else is not', () =>
    Effect.sync(() => {
      expect(isToolingOrTestPath('index.ts')).toBe(false)
      expect(isToolingOrTestPath('domain/post-processing.ts')).toBe(false)
      expect(isToolingOrTestPath('application/input-service.ts')).toBe(false)
      expect(isToolingOrTestPath('test/post-processing.test.ts')).toBe(true)
      expect(isToolingOrTestPath('scripts/check-dependency-whitelist.ts')).toBe(true)
    }),
  )
})

describe('graph utilities', () => {
  it.effect('findTransitivePath explains WHY an import is unlicensed', () =>
    Effect.sync(() => {
      expect(
        findTransitivePath(REPOSITORY_POLICY.dependencyGraph, '@nerima-games/mc-compose', '@nerima-games/mc-sim'),
      ).toStrictEqual(['@nerima-games/mc-compose', '@nerima-games/mx-gameplay', '@nerima-games/mc-sim'])
      expect(
        findTransitivePath(REPOSITORY_POLICY.dependencyGraph, '@nerima-games/mc-render', '@nerima-games/mx-ui'),
      ).toBeUndefined()
    }),
  )

  it.effect('findCycles rejects a two-node cycle — there is no co-evolution allowlist here', () =>
    Effect.sync(() => {
      const violations = findCycles(graph([['a', ['b']], ['b', ['a']]]))
      expect(violations[0]?.rule).toBe('cycle')
    }),
  )

  it.effect('a diamond is not a cycle', () =>
    Effect.sync(() => {
      expect(findCycles(graph([['a', ['b', 'c']], ['b', ['d']], ['c', ['d']], ['d', []]]))).toStrictEqual([])
    }),
  )

  it.effect('extractOrgPackageName strips subpaths and ignores non-org specifiers', () =>
    Effect.sync(() => {
      expect(extractOrgPackageName('@nerima-games/mc-worldgen/domain/chunk')).toBe('@nerima-games/mc-worldgen')
      expect(extractOrgPackageName('effect')).toBeUndefined()
      expect(extractOrgPackageName('../domain/time-of-day')).toBeUndefined()
    }),
  )
})

describe('import extraction', () => {
  it.effect('sees real imports, including multi-line and dynamic ones', () =>
    Effect.sync(() => {
      const source = [
        "import { Effect } from 'effect'",
        'import {',
        '  ChunkManager,',
        "} from '@nerima-games/mc-worldgen'",
        "const later = await import('@nerima-games/mc-meshing')",
        "export type { Chunk } from '@nerima-games/mc-worldgen'",
      ].join('\n')

      expect(parseImports(source).map((record) => record.specifier)).toStrictEqual([
        'effect',
        '@nerima-games/mc-worldgen',
        '@nerima-games/mc-meshing',
        '@nerima-games/mc-worldgen',
      ])
    }),
  )

  it.effect('does NOT see an import mentioned inside a comment or a string', () =>
    Effect.sync(() => {
      const source = [
        "// import { X } from '@nerima-games/mx-ui'",
        "/* import { Y } from '@nerima-games/mx-ui' */",
        'const documentation = "import { Z } from \'@nerima-games/mx-ui\'"',
      ].join('\n')

      expect(parseImports(source).filter((record) => record.specifier.startsWith('@nerima-games'))).toStrictEqual(
        [],
      )
    }),
  )
})

describe('banned time sources', () => {
  it.effect('catches all three raw clock reads, with line numbers', () =>
    Effect.sync(() => {
      const source = ['const a = Date.now()', 'const b = new Date()', 'const c = performance.now()'].join('\n')
      const violations = findBannedTimeSources(source, 'application/x.ts')

      expect(violations.map((violation) => violation.line).sort()).toStrictEqual([1, 2, 3])
      expect(violations.every((violation) => violation.rule === 'banned-time-source')).toBe(true)
    }),
  )

  it.effect('ignores the same text inside a comment or a string', () =>
    Effect.sync(() => {
      const source = ['// Date.now() is banned', 'const message = "call Date.now() and lose"'].join('\n')

      expect(findBannedTimeSources(source, 'application/x.ts')).toStrictEqual([])
    }),
  )

  it.effect('the escape hatch exempts exactly the line that carries it', () =>
    Effect.sync(() => {
      // The only legitimate raw clock read is the adapter that IMPLEMENTS the
      // clock Port. mc-render owns the browser platform, so that adapter will
      // very likely live HERE — which is exactly why the escape hatch is
      // per-line rather than per-file.
      const source = [
        `const now = Date.now() // ${TIME_SOURCE_ESCAPE_HATCH}`,
        'const sneaky = Date.now()',
      ].join('\n')
      const violations = findBannedTimeSources(source, 'application/clock-adapter.ts')

      expect(violations).toHaveLength(1)
      expect(violations[0]?.line).toBe(2)
    }),
  )
})
