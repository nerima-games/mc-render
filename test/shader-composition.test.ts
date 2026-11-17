import { describe, expect, it } from 'vitest'
import { Result } from 'effect'
import {
  createBrowserCompositeShader,
  createBrowserCopyShader,
  createBrowserGodRaysShader,
} from '../src/domain/browser-render-policy'
import { QUALITY_PRESETS } from '../src/domain/post-processing'
import { chunkShaderSource } from '../src/domain/chunk-shader'
import { DEFAULT_COLOR_FILTER_INPUT, makeColorCorrectionShader } from '../src/domain/color-correction'
import { particleShaderSource } from '../src/domain/particle-shader'
import { translucentChunkShaderSource } from '../src/domain/translucent-chunk-shader'
import { waterShaderSource } from '../src/domain/water-shader'

const makeVector2 = (x: number, y: number): { readonly x: number; readonly y: number } => ({ x, y })
const effectVariants = [
  [],
  ['bloom'],
  ['godRays'],
  ['bokeh'],
  ['bloom', 'godRays'],
  ['bloom', 'bokeh'],
  ['godRays', 'bokeh'],
  ['bloom', 'godRays', 'bokeh'],
]
const browserPrograms = Object.entries(QUALITY_PRESETS).flatMap(([preset, quality]) => [
  {
    name: `god rays ${preset}`,
    ...Result.getOrThrow(createBrowserGodRaysShader(quality.godRaysSamples, makeVector2)),
  },
  ...effectVariants.map((effects) => ({
    name: `composite ${preset} ${effects.join('+') || 'disabled'}`,
    ...Result.getOrThrow(createBrowserCompositeShader({
      camera: { near: 0.1, far: 1000 },
      effects,
      makeVector2,
      quality,
      viewport: { width: 320, height: 180 },
    })),
  })),
])

const programs = [
  ...browserPrograms,
  { name: 'reference copy', ...createBrowserCopyShader() },
  { name: 'chunk', ...chunkShaderSource() },
  { name: 'translucent chunk', ...translucentChunkShaderSource() },
  { name: 'water', ...waterShaderSource() },
  { name: 'particle', ...particleShaderSource() },
  { name: 'color correction', ...makeColorCorrectionShader(DEFAULT_COLOR_FILTER_INPUT) },
]

const stages = programs.flatMap(({ name, vertexShader, fragmentShader }) => [
  { name: `${name} vertex`, source: vertexShader },
  { name: `${name} fragment`, source: fragmentShader },
])

const varyingDeclarations = (source: string): Array<string> =>
  Array.from(source.matchAll(/^\s*varying\s+(?<type>\w+)\s+(?<name>\w+)\s*;/gmu), ([, type, name]) => `${type} ${name}`)

describe('assembled shader programs', () => {
  it.each(stages)('$name has one owner per declaration', ({ source }) => {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, '')
    const variables = Array.from(
      withoutComments.matchAll(/^\s*(?:uniform|varying)\s+\w+\s+(?<name>\w+)\s*(?:\[[^\]]*\])?\s*;/gmu),
      ([, name]) => name,
    )
    const functions = Array.from(
      withoutComments.matchAll(/^\s*\w+\s+(?<name>\w+)\s*\((?<parameters>[^;{}]*)\)\s*\{/gmu),
      ([, name, parameters]) => {
        const types = parameters!.split(',').map((parameter) =>
          parameter.trim().split(/\s+/u).slice(0, -1).join(' '),
        )
        return `${name}(${types.join(',')})`
      },
    )
    expect(variables.length).toBeGreaterThan(0)
    expect(functions).toContain('main()')
    expect(variables).toHaveLength(new Set(variables).size)
    expect(functions).toHaveLength(new Set(functions).size)
  })

  it.each(programs)('$name supplies every fragment varying from its vertex stage', ({ vertexShader, fragmentShader }) => {
    const vertexVaryings = varyingDeclarations(vertexShader)
    const fragmentVaryings = varyingDeclarations(fragmentShader)
    expect(fragmentVaryings.length).toBeGreaterThan(0)
    expect(vertexVaryings).toEqual(expect.arrayContaining(fragmentVaryings))
  })
})
