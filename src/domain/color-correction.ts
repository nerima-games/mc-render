import { Result, Schema } from 'effect'
import type { Settings } from '@nerima-games/mc-sim'

/** The setting's type is owned by the pinned mc-sim package. */
export type ColorVisionCorrection = Settings['colorVisionCorrection']

/** Mc-sim 0.9.0 exports the Settings type but not its runtime literal list. */
export const COLOR_VISION_CORRECTIONS: readonly [
  ColorVisionCorrection,
  ColorVisionCorrection,
  ColorVisionCorrection,
  ColorVisionCorrection,
] = ['off', 'protanopia', 'deuteranopia', 'tritanopia']

export const ColorVisionCorrectionSchema: Schema.Codec<ColorVisionCorrection> =
  Schema.Literals(COLOR_VISION_CORRECTIONS)

export type ColorFilterInput = Readonly<{
  readonly colorVisionCorrection: ColorVisionCorrection
  readonly underwater: boolean
}>

export const ColorFilterInputSchema: Schema.Codec<ColorFilterInput> = Schema.Struct({
  colorVisionCorrection: ColorVisionCorrectionSchema,
  underwater: Schema.Boolean,
})

export const decodeColorFilterInput: (input: unknown) => Result.Result<ColorFilterInput, Schema.SchemaError> = (input) =>
  Schema.decodeUnknownResult(ColorFilterInputSchema, { onExcessProperty: 'error' })(input)

export type ColorVisionMatrix = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
]

type ColorVisionRow = Readonly<{ readonly blue: number; readonly green: number; readonly red: number }>
type ColorVisionRows = Readonly<{ readonly row0: ColorVisionRow; readonly row1: ColorVisionRow; readonly row2: ColorVisionRow }>

const IDENTITY_ROW_0: ColorVisionRow = { blue: 0, green: 0, red: 1 }
const IDENTITY_ROW_1: ColorVisionRow = { blue: 0, green: 1, red: 0 }
const IDENTITY_ROW_2: ColorVisionRow = { blue: 1, green: 0, red: 0 }
const IDENTITY_MATRIX: ColorVisionRows = { row0: IDENTITY_ROW_0, row1: IDENTITY_ROW_1, row2: IDENTITY_ROW_2 }

/** Dichromacy transforms from Machado, Oliveira, and Fernandes, IEEE TVCG 15(6), 2009. */
const COLOR_VISION_MATRICES: Readonly<Record<ColorVisionCorrection, ColorVisionRows>> = {
  deuteranopia: {
    row0: { blue: -0.227968, green: 0.860646, red: 0.367322 },
    row1: { blue: 0.047413, green: 0.672501, red: 0.280085 },
    row2: { blue: 0.968881, green: 0.04294, red: -0.01182 },
  },
  off: IDENTITY_MATRIX,
  protanopia: {
    row0: { blue: -0.204868, green: 1.052583, red: 0.152286 },
    row1: { blue: 0.099216, green: 0.786281, red: 0.114503 },
    row2: { blue: 1.051998, green: -0.048116, red: -0.003882 },
  },
  tritanopia: {
    row0: { blue: -0.178779, green: -0.076749, red: 1.255528 },
    row1: { blue: 0.147602, green: 0.930809, red: -0.078411 },
    row2: { blue: 0.3039, green: 0.691367, red: 0.004733 },
  },
}

export type ColorCorrectionPlan = Readonly<{
  readonly matrix: ColorVisionMatrix
  readonly underwaterStrength: number
}>

export type ColorCorrectionUniform<Value> = { value: Value }

export type ColorCorrectionUniforms = {
  readonly tDiffuse: ColorCorrectionUniform<unknown>
  readonly uColorVisionRow0: ColorCorrectionUniform<readonly [number, number, number]>
  readonly uColorVisionRow1: ColorCorrectionUniform<readonly [number, number, number]>
  readonly uColorVisionRow2: ColorCorrectionUniform<readonly [number, number, number]>
  readonly uUnderwaterStrength: ColorCorrectionUniform<number>
}

export type ColorCorrectionShader = Readonly<{
  readonly fragmentShader: string
  readonly uniforms: ColorCorrectionUniforms
  readonly vertexShader: string
}>

const NO_UNDERWATER_STRENGTH = 0
const FULL_UNDERWATER_STRENGTH = 1
const COLOR_CORRECTION_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const COLOR_CORRECTION_FRAGMENT_SHADER = `
uniform sampler2D tDiffuse;
uniform vec3 uColorVisionRow0;
uniform vec3 uColorVisionRow1;
uniform vec3 uColorVisionRow2;
uniform float uUnderwaterStrength;
varying vec2 vUv;

void main() {
  vec4 source = texture2D(tDiffuse, vUv);
  vec3 corrected = vec3(
    dot(uColorVisionRow0, source.rgb),
    dot(uColorVisionRow1, source.rgb),
    dot(uColorVisionRow2, source.rgb)
  );
  vec3 underwater = corrected * vec3(0.28, 0.58, 0.92) + vec3(0.015, 0.035, 0.06);
  vec3 result = mix(corrected, underwater, uUnderwaterStrength);
  gl_FragColor = vec4(clamp(result, 0.0, 1.0), source.a);
}
`

const matrixTuple = ({ row0, row1, row2 }: ColorVisionRows): ColorVisionMatrix => [
  row0.red, row0.green, row0.blue,
  row1.red, row1.green, row1.blue,
  row2.red, row2.green, row2.blue,
]

const underwaterStrengthFor = (underwater: boolean): number => {
  if (underwater) {
    return FULL_UNDERWATER_STRENGTH
  }
  return NO_UNDERWATER_STRENGTH
}

export const planColorCorrection = (input: ColorFilterInput): ColorCorrectionPlan => ({
  matrix: matrixTuple(COLOR_VISION_MATRICES[input.colorVisionCorrection]),
  underwaterStrength: underwaterStrengthFor(input.underwater),
})

export const isColorFilterActive = (input: ColorFilterInput): boolean =>
  input.underwater || input.colorVisionCorrection !== 'off'

/** A ShaderPass-compatible constructor; this keeps the domain module independent of Three.js. */
export type ColorCorrectionPassConstructor<Pass> = new (shader: ColorCorrectionShader) => Pass

/** Build the shader descriptor accepted by Three's `ShaderPass` constructor. */
export const makeColorCorrectionShader = (input: ColorFilterInput): ColorCorrectionShader => {
  const plan = planColorCorrection(input)
  const [row0Red, row0Green, row0Blue, row1Red, row1Green, row1Blue, row2Red, row2Green, row2Blue] = plan.matrix
  return {
    fragmentShader: COLOR_CORRECTION_FRAGMENT_SHADER,
    uniforms: {
      tDiffuse: { value: null },
      uColorVisionRow0: { value: [row0Red, row0Green, row0Blue] },
      uColorVisionRow1: { value: [row1Red, row1Green, row1Blue] },
      uColorVisionRow2: { value: [row2Red, row2Green, row2Blue] },
      uUnderwaterStrength: { value: plan.underwaterStrength },
    },
    vertexShader: COLOR_CORRECTION_VERTEX_SHADER,
  }
}

/** Construct a real ShaderPass-compatible pass from the current settings input. */
export const makeColorCorrectionPass = <Pass>(
  ShaderPass: ColorCorrectionPassConstructor<Pass>,
  input: ColorFilterInput,
): Pass => new ShaderPass(makeColorCorrectionShader(input))

/** Refresh an installed pass after settings or underwater state changes. */
export const updateColorCorrectionPass = (
  pass: Readonly<{ readonly uniforms: ColorCorrectionUniforms }>,
  input: ColorFilterInput,
): void => {
  const shader = makeColorCorrectionShader(input)
  pass.uniforms.uColorVisionRow0.value = shader.uniforms.uColorVisionRow0.value
  pass.uniforms.uColorVisionRow1.value = shader.uniforms.uColorVisionRow1.value
  pass.uniforms.uColorVisionRow2.value = shader.uniforms.uColorVisionRow2.value
  pass.uniforms.uUnderwaterStrength.value = shader.uniforms.uUnderwaterStrength.value
}

export const DEFAULT_COLOR_FILTER_INPUT: ColorFilterInput = {
  colorVisionCorrection: 'off',
  underwater: false,
}

export { COLOR_CORRECTION_FRAGMENT_SHADER, COLOR_CORRECTION_VERTEX_SHADER }
