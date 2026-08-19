import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const destination = mkdtempSync(join(tmpdir(), 'mc-render-pack-'))

try {
  execFileSync('pnpm', ['pack', '--pack-destination', destination], { stdio: 'inherit' })
  const archiveName = readdirSync(destination).find((name) => name.endsWith('.tgz'))
  if (archiveName === undefined) {
    throw new Error('pnpm pack produced no tarball')
  }

  const archive = join(destination, archiveName)
  const entries = new Set(
    execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter((entry) => entry.length > 0),
  )
  for (const required of [
    'package/dist/index.js',
    'package/dist/index.d.ts',
    'package/dist/browser.js',
    'package/dist/browser.d.ts',
    'package/README.md',
    'package/LICENSE',
    'package/CHANGELOG.md',
    'package/package.json',
  ]) {
    if (!entries.has(required)) {
      throw new Error(`package is missing ${required}`)
    }
  }
  for (const entry of entries) {
    if (entry.startsWith('package/src/')) {
      throw new Error(`package contains source files: ${entry}`)
    }
  }

  const manifest = JSON.parse(
    execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }),
  )
  if (manifest.name !== '@nerima-games/mc-render') {
    throw new Error(`package name is ${String(manifest.name)}`)
  }
  if (manifest.type !== 'module') {
    throw new Error('package must remain ESM')
  }
  if (manifest.main !== './dist/index.js' || manifest.types !== './dist/index.d.ts') {
    throw new Error('package main/types do not point at the core build')
  }
  const coreExport = manifest.exports?.['.']
  const browserExport = manifest.exports?.['./browser']
  if (
    coreExport?.import !== './dist/index.js' ||
    coreExport?.types !== './dist/index.d.ts' ||
    browserExport?.import !== './dist/browser.js' ||
    browserExport?.types !== './dist/browser.d.ts'
  ) {
    throw new Error('package exports do not point at both public builds')
  }

  const distProbe = [
    `const core = await import(${JSON.stringify(pathToFileURL(join(process.cwd(), 'dist/index.js')).href)})`,
    `const browser = await import(${JSON.stringify(pathToFileURL(join(process.cwd(), 'dist/browser.js')).href)})`,
    "if (Object.keys(core).length === 0) throw new Error('core build exports nothing')",
    "if (typeof browser.makeBrowserWorldRuntime !== 'function') throw new Error('browser build has no runtime entry')",
  ].join(';')
  execFileSync(process.execPath, ['--input-type=module', '-e', distProbe], { stdio: 'inherit' })
  process.stdout.write(`validated ${String(entries.size)} package entries\n`)
} finally {
  rmSync(destination, { force: true, recursive: true })
}
