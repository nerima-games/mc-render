import {
  CHUNK_SHADER_ATTRIBUTES,
  CHUNK_SHADER_UNIFORMS,
  chunkFragmentDeclarations,
  chunkFragmentShadeFunction,
  glslFloat,
} from './chunk-shader.js'
import {
  waterFragmentDeclarations,
  waterFragmentShadeFunction,
} from './water-shader.js'
import { FACE_BRIGHTNESS } from './voxel-lighting.js'
import { WATER_UNIFORM_NAMES } from './water-surface.js'

const ALPHA_TEST_UNIFORM = 'uAlphaTest'
const WATER_SURFACE_ATTRIBUTE = 'waterSurface'
const FLUID_DIRECTION_ATTRIBUTE = 'fluidDirection'
const FLUID_FALLING_ATTRIBUTE = 'fluidFalling'

export type TranslucentChunkShaderSource = {
  readonly attributeNames: ReadonlyArray<string>
  readonly fragmentShader: string
  readonly uniformNames: ReadonlyArray<string>
  readonly vertexShader: string
}

/** Build both transparent surface paths into one draw-call shader. */
export const translucentChunkShaderSource = (): TranslucentChunkShaderSource => {
  const vertexShader = `
attribute float ${CHUNK_SHADER_ATTRIBUTES.tileIndex};
attribute vec2 ${FLUID_DIRECTION_ATTRIBUTE};
attribute float ${FLUID_FALLING_ATTRIBUTE};
attribute float ${WATER_SURFACE_ATTRIBUTE};

varying vec2 vUv;
varying vec3 vColor;
varying float vTileIndex;
varying float vFaceBrightness;
varying float vFogDepth;
varying float vWaterSurface;
varying vec3 vWorldPosition;
varying vec4 vClipPosition;
varying vec3 vNormal;
varying vec2 vFluidDirection;
varying float vFluidFalling;

void main() {
  vUv = uv;
  vColor = color;
  vTileIndex = ${CHUNK_SHADER_ATTRIBUTES.tileIndex};
  vWaterSurface = ${WATER_SURFACE_ATTRIBUTE};
  vFluidDirection = ${FLUID_DIRECTION_ATTRIBUTE};
  vFluidFalling = ${FLUID_FALLING_ATTRIBUTE};

  vFaceBrightness = normal.y > 0.5
    ? ${glslFloat(FACE_BRIGHTNESS.yPos)}
    : (normal.y < -0.5
        ? ${glslFloat(FACE_BRIGHTNESS.yNeg)}
        : (abs(normal.x) > 0.5
            ? ${glslFloat(FACE_BRIGHTNESS.xPos)}
            : ${glslFloat(FACE_BRIGHTNESS.zPos)}));

  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vFogDepth = max(-viewPosition.z, 0.0);
  vWorldPosition = worldPosition.xyz;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * viewPosition;
  vClipPosition = gl_Position;
}
`

  const fragmentShader = `
${chunkFragmentDeclarations(false)}
${waterFragmentDeclarations(false)}
uniform float ${CHUNK_SHADER_UNIFORMS.sunIntensity};
varying float vWaterSurface;

${chunkFragmentShadeFunction()}
${waterFragmentShadeFunction()}
void main() {
  if (vWaterSurface > 0.5) {
    gl_FragColor = shadeWaterSurface();
    return;
  }
  gl_FragColor = shadeChunkSurface();
}
`

  const attributeNames = [
    CHUNK_SHADER_ATTRIBUTES.tileIndex,
    FLUID_DIRECTION_ATTRIBUTE,
    FLUID_FALLING_ATTRIBUTE,
    WATER_SURFACE_ATTRIBUTE,
  ]
  const uniformNames = [...new Set([
    ...Object.values(CHUNK_SHADER_UNIFORMS),
    ALPHA_TEST_UNIFORM,
    ...WATER_UNIFORM_NAMES,
  ])]

  return { attributeNames, fragmentShader, uniformNames, vertexShader }
}
