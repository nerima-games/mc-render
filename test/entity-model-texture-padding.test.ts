import { describe, expect, it } from '@effect/vitest'
import { vi } from 'vitest'

const atlasFixture = vi.hoisted(() => ({
  entries: [] as ReadonlyArray<never>,
  pixels: 'AQ==' as string,
}))

vi.mock('../src/domain/entity-models/generated/textures.json', () => ({ default: atlasFixture }))

import { entityTextureAtlasPixels } from '../src/domain/entity-model-textures.js'

describe('entity texture base64 padding', () => {
  it('decodes pixel bytes with two, one, and zero padding characters', () => {
    atlasFixture.pixels = 'AQ=='
    expect(Array.from(entityTextureAtlasPixels())).toStrictEqual([1])

    atlasFixture.pixels = 'AQI='
    expect(Array.from(entityTextureAtlasPixels())).toStrictEqual([1, 2])

    atlasFixture.pixels = 'AQID'
    expect(Array.from(entityTextureAtlasPixels())).toStrictEqual([1, 2, 3])
  })
})
