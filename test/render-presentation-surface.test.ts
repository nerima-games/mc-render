import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectTypeScriptFixture } from './typescript-project'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('render presentation Three.js surface', () => {
  it.effect('accepts the real Three.js namespace without a cast', () =>
    Effect.sync(() => {
      const fixture = path.join(repositoryRoot, 'test', 'fixtures', 'render-presentation-surface.ts')
      const inspection = inspectTypeScriptFixture(repositoryRoot, fixture, ['ES2022', 'DOM'])

      expect(inspection.errors).toStrictEqual([])
      expect(
        inspection.sourceFileNames.some((file) =>
          /node_modules[\\/](?:three|@types[\\/]three)[\\/].+\.d\.ts$/u.test(file),
        ),
      ).toBe(true)
      expect(readFileSync(fixture, 'utf8')).toContain('= THREE')
    }),
    60_000,
  )
})
