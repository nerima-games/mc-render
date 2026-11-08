import { describe, expect, it } from 'vitest'
import { translucentChunkShaderSource } from '../src/domain/translucent-chunk-shader'

describe('translucent chunk shader', () => {
  it('selects water shading per vertex inside the same chunk draw', () => {
    const source = translucentChunkShaderSource()

    expect(source.vertexShader).toContain('attribute float tileIndex;')
    expect(source.vertexShader).toContain('attribute vec2 fluidDirection;')
    expect(source.vertexShader).toContain('attribute float fluidFalling;')
    expect(source.vertexShader).toContain('attribute float waterSurface;')
    expect(source.vertexShader).toContain('varying float vWaterSurface;')
    expect(source.vertexShader).toContain('vWaterSurface = waterSurface;')
    expect(source.fragmentShader).toContain('if (vWaterSurface > 0.5)')
    expect(source.fragmentShader).toContain('gl_FragColor = shadeWaterSurface();')
    expect(source.fragmentShader).toContain('gl_FragColor = shadeChunkSurface();')
    expect(source.fragmentShader.match(/uniform float uSunIntensity;/g)).toHaveLength(1)
  })
})
