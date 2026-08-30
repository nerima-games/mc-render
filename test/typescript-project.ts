import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { API, DiagnosticCategory } from 'typescript/unstable/sync'

type FixtureInspection = {
  readonly errors: readonly string[]
  readonly sourceFileNames: readonly string[]
}

/**
 * Type-check one fixture file in an isolated, throwaway project.
 *
 * TypeScript 7's main entry point has no synchronous `createProgram`: the
 * classic Program API this repository's tests used to call was removed, and
 * `typescript/unstable/sync`'s `API`/`Snapshot`/`Project` is its replacement.
 * A real `tsconfig.json` is written to a temp directory (rather than passed
 * as an in-memory `CompilerOptions` object) because `openProjects` takes a
 * config file path, not parsed options.
 */
export const inspectTypeScriptFixture = (
  repositoryRoot: string,
  fixture: string,
  lib: readonly string[],
): FixtureInspection => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'mc-render-typescript-'))
  const configPath = path.join(temporaryRoot, 'tsconfig.json')

  writeFileSync(
    configPath,
    JSON.stringify({
      compilerOptions: {
        exactOptionalPropertyTypes: true,
        lib,
        module: 'ESNext',
        moduleDetection: 'Force',
        moduleResolution: 'Bundler',
        noEmit: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: true,
        strict: true,
        target: 'ES2022',
        types: [],
      },
      files: [fixture],
    }),
  )

  const api = new API({ cwd: repositoryRoot })
  try {
    const snapshot = api.updateSnapshot({ openProjects: [configPath] })
    try {
      const project = snapshot.getProject(configPath)
      if (project === undefined) {
        throw new Error(`TypeScript did not open ${configPath}`)
      }

      const diagnostics = [
        ...project.program.getSyntacticDiagnostics(fixture),
        ...project.program.getSemanticDiagnostics(fixture),
      ]

      return {
        errors: diagnostics
          .filter((diagnostic) => diagnostic.category === DiagnosticCategory.Error)
          .map((diagnostic) => diagnostic.text),
        sourceFileNames: project.program.getSourceFileNames(),
      }
    } finally {
      snapshot.dispose()
    }
  } finally {
    api.close()
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

export const parseTypeScriptConfig = (repositoryRoot: string, configPath: string) => {
  const api = new API({ cwd: repositoryRoot })
  try {
    return api.parseConfigFile(configPath)
  } finally {
    api.close()
  }
}
