import { Result, Schema } from 'effect'
import {
  CHUNK_SHADER_UNIFORMS,
  chunkShaderSource,
} from '../domain/chunk-shader.js'
import {
  type MaterialPolicyVerdict,
  describeMaterialPolicy,
} from '../domain/material-policy.js'
import {
  type RenderEnvironmentPlan,
  type Viewport,
  planRenderEnvironment,
} from '../domain/render-environment.js'
import {
  THREE_DOUBLE_SIDE,
  type ThreeBufferGeometry,
  type ThreeMaterial,
  type ThreeShaderSurface,
  type ThreeUniform,
} from './three-surface.js'
import {
  WATER_MATERIAL_SPEC,
  WATER_WRITES_DEPTH,
} from '../domain/water-surface.js'
import { PARTICLE_MATERIAL_SPEC } from '../domain/particle-pool.js'
import { waterShaderSource } from '../domain/water-shader.js'

/** Full daylight used when no environment plan has been supplied. */
export const FULL_SUN_INTENSITY = 1

/** The material and stable uniform boxes shared by all chunk meshes. */
export type ChunkShaderMaterial<TShaderMaterial extends ThreeMaterial> = {
  readonly material: TShaderMaterial
  readonly uniforms: Record<string, ThreeUniform>
}

export type RendererMaterialPolicyFinding = {
  readonly materialName: string
  readonly verdict: MaterialPolicyVerdict
}

export type RendererMaterialPolicyError = {
  readonly _tag: 'RendererMaterialPolicyError'
  readonly violations: ReadonlyArray<RendererMaterialPolicyFinding>
}

type RendererMaterialPolicyResultShape<Success> =
  | {
      readonly _tag: 'Success'
      readonly _op: 'Success'
      readonly success: Success
    }
  | {
      readonly _tag: 'Failure'
      readonly _op: 'Failure'
      readonly failure: RendererMaterialPolicyError
    }

const MaterialPolicyVerdictSchema: Schema.Codec<MaterialPolicyVerdict> = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('ok'),
    reason: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal('must-force-single-pass'),
    reason: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal('review-sharing'),
    reason: Schema.String,
  }),
])

export const RendererMaterialPolicyFindingSchema: Schema.Codec<RendererMaterialPolicyFinding> = Schema.Struct({
  materialName: Schema.String,
  verdict: MaterialPolicyVerdictSchema,
})

export const RendererMaterialPolicyErrorSchema: Schema.Codec<RendererMaterialPolicyError> = Schema.Struct({
  _tag: Schema.Literal('RendererMaterialPolicyError'),
  violations: Schema.Array(RendererMaterialPolicyFindingSchema),
})

/** Decode Result schemas with `onExcessProperty: 'error'` to enforce exact shapes. */
export const RendererMaterialPolicyResultSchema: Schema.Codec<
  RendererMaterialPolicyResultShape<void>
> = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Success'),
    _op: Schema.Literal('Success'),
    success: Schema.Undefined,
  }),
  Schema.Struct({
    _tag: Schema.Literal('Failure'),
    _op: Schema.Literal('Failure'),
    failure: RendererMaterialPolicyErrorSchema,
  }),
])

type RendererMaterialPolicyBinding = RendererMaterialPolicyFinding & {
  readonly material: ThreeMaterial
}

const rendererMaterialPolicyBindings = (
  waterMaterial: ThreeMaterial,
  particleMaterial: ThreeMaterial,
): ReadonlyArray<RendererMaterialPolicyBinding> => [
  {
    material: waterMaterial,
    materialName: WATER_MATERIAL_SPEC.name,
    verdict: describeMaterialPolicy(WATER_MATERIAL_SPEC),
  },
  {
    material: particleMaterial,
    materialName: PARTICLE_MATERIAL_SPEC.name,
    verdict: describeMaterialPolicy(PARTICLE_MATERIAL_SPEC),
  },
]

export const findRendererMaterialPolicyViolations = (
  waterMaterial: ThreeMaterial,
  particleMaterial: ThreeMaterial,
): ReadonlyArray<RendererMaterialPolicyFinding> =>
  rendererMaterialPolicyBindings(waterMaterial, particleMaterial)
    .filter(({ material, verdict }) =>
      verdict.kind === 'must-force-single-pass' && material.forceSinglePass !== true,
    )
    .map(({ materialName, verdict }) => ({ materialName, verdict }))

/** Report a renderer-construction failure if a shared cutout/flat material lost its flag. */
export const assertRendererMaterialPolicies = (
  waterMaterial: ThreeMaterial,
  particleMaterial: ThreeMaterial,
): Result.Result<void, RendererMaterialPolicyError> => {
  const violations = findRendererMaterialPolicyViolations(waterMaterial, particleMaterial)
  if (violations.length === 0) {
    return Result.succeed(undefined)
  }

  return Result.fail({
    _tag: 'RendererMaterialPolicyError',
    violations,
  })
}

/** Update the shared shader's stable uniform boxes without rebuilding it. */
export const applyChunkShaderEnvironment = (
  uniforms: Record<string, ThreeUniform>,
  environment: RenderEnvironmentPlan,
): void => {
  const values: Readonly<Record<string, unknown>> = {
    [CHUNK_SHADER_UNIFORMS.sunIntensity]: environment.sunIntensity,
    [CHUNK_SHADER_UNIFORMS.fogColor]: [...environment.fogColor],
    [CHUNK_SHADER_UNIFORMS.fogNear]: environment.fogNear,
    [CHUNK_SHADER_UNIFORMS.fogFar]: environment.fogFar,
  }
  for (const [name, value] of Object.entries(values)) {
    const uniform = uniforms[name]
    if (uniform) {
      uniform.value = value
    }
  }
}

/** Build the textured, packed-light chunk material and its uniform boxes. */
export const makeChunkShaderMaterial = <
  TCanvas,
  TGeometry extends ThreeBufferGeometry,
  TMaterial extends ThreeMaterial,
  TShaderMaterial extends ThreeMaterial,
>(
  three: ThreeShaderSurface<TCanvas, TGeometry, TMaterial, TShaderMaterial>,
  atlasTexture: unknown,
  sunIntensity: number = FULL_SUN_INTENSITY,
): ChunkShaderMaterial<TShaderMaterial> => {
  const source = chunkShaderSource()
  const defaultEnvironment = planRenderEnvironment(FULL_SUN_INTENSITY)
  const uniforms: Record<string, ThreeUniform> = {
    [CHUNK_SHADER_UNIFORMS.atlas]: { value: atlasTexture },
    [CHUNK_SHADER_UNIFORMS.sunIntensity]: { value: sunIntensity },
    [CHUNK_SHADER_UNIFORMS.fogColor]: { value: [...defaultEnvironment.fogColor] },
    [CHUNK_SHADER_UNIFORMS.fogNear]: { value: defaultEnvironment.fogNear },
    [CHUNK_SHADER_UNIFORMS.fogFar]: { value: defaultEnvironment.fogFar },
  }
  return {
    material: new three.ShaderMaterial({
      fragmentShader: source.fragmentShader,
      uniforms,
      vertexColors: true,
      vertexShader: source.vertexShader,
    }),
    uniforms,
  }
}

/** The initial value for a refraction sample before a host fills its target. */
export const REFRACTION_UNAVAILABLE = 0

/** Initial camera position for the water shader's vec3 uniform. */
const ORIGIN_COMPONENT = 0
export const UNIFORM_ORIGIN: ReadonlyArray<number> = [ORIGIN_COMPONENT, ORIGIN_COMPONENT, ORIGIN_COMPONENT]

export type { Viewport } from '../domain/render-environment.js'

/** Build the water material and the uniform boxes a host updates per frame. */
export const makeWaterMaterial = <
  TCanvas,
  TGeometry extends ThreeBufferGeometry,
  TMaterial extends ThreeMaterial,
  TShaderMaterial extends ThreeMaterial,
>(
  three: ThreeShaderSurface<TCanvas, TGeometry, TMaterial, TShaderMaterial>,
  viewport: Viewport,
  sunIntensity: number = FULL_SUN_INTENSITY,
): ChunkShaderMaterial<TShaderMaterial> => {
  const source = waterShaderSource()
  const uniforms: Record<string, ThreeUniform> = {
    /* A vec3 uniform must start with an array; null would fail during three's
       driver upload even though construction is safe in a Node test. */
    uCameraPosition: { value: [...UNIFORM_ORIGIN] },
    uRefractionMap: { value: null },
    uRefractionValid: { value: REFRACTION_UNAVAILABLE },
    uResolution: { value: [viewport.width, viewport.height] },
    uSunIntensity: { value: sunIntensity },
    uTime: { value: ORIGIN_COMPONENT },
  }
  return {
    material: new three.ShaderMaterial({
      depthWrite: WATER_WRITES_DEPTH,
      forceSinglePass: true,
      fragmentShader: source.fragmentShader,
      side: THREE_DOUBLE_SIDE,
      transparent: WATER_MATERIAL_SPEC.transparent,
      uniforms,
      vertexColors: true,
      vertexShader: source.vertexShader,
    }),
    uniforms,
  }
}
