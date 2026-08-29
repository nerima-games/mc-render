import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { API, DiagnosticCategory } from 'typescript/unstable/sync'

type FixtureInspection = {
  readonly errors: readonly string[]
  readonly sourceFileNames: readonly string[]
}

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
      files: [fixture],
      compilerOptions: {
        noEmit: true,
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        moduleDetection: 'Force',
        skipLibCheck: true,
        types: [],
        lib,
      },
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
