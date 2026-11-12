import { Brand, Result, Schema } from 'effect'
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

export type ColorVisionCoefficient = Brand.Branded<number, 'ColorVisionCoefficient'>
export type UnderwaterColorStrength = Brand.Branded<number, 'UnderwaterColorStrength'>
export type ColorCorrectionShaderSource = Brand.Branded<string, 'ColorCorrectionShaderSource'>

const MIN_UNDERWATER_STRENGTH = 0
const MAX_UNDERWATER_STRENGTH = 1
const EMPTY_SHADER_SOURCE_LENGTH = 0

export const ColorVisionCoefficientSchema: Schema.Codec<ColorVisionCoefficient, number> = Schema.Finite
  .pipe(Schema.brand('ColorVisionCoefficient'))

export const UnderwaterColorStrengthSchema: Schema.Codec<UnderwaterColorStrength, number> = Schema.Finite
  .check(Schema.isBetween({ maximum: MAX_UNDERWATER_STRENGTH, minimum: MIN_UNDERWATER_STRENGTH }))
  .pipe(Schema.brand('UnderwaterColorStrength'))

export const ColorCorrectionShaderSourceSchema: Schema.Codec<ColorCorrectionShaderSource, string> = Schema.String
  .check(Schema.makeFilter<string>((value) =>
    value.length > EMPTY_SHADER_SOURCE_LENGTH || 'Shader source must not be empty'
  ))
  .pipe(Schema.brand('ColorCorrectionShaderSource'))

export type ColorVisionMatrix = readonly [
  ColorVisionCoefficient, ColorVisionCoefficient, ColorVisionCoefficient,
  ColorVisionCoefficient, ColorVisionCoefficient, ColorVisionCoefficient,
  ColorVisionCoefficient, ColorVisionCoefficient, ColorVisionCoefficient,
]

type ColorVisionRow = Readonly<{ readonly blue: number; readonly green: number; readonly red: number }>
type ColorVisionRows = Readonly<{ readonly row0: ColorVisionRow; readonly row1: ColorVisionRow; readonly row2: ColorVisionRow }>
type ColorVisionCoefficientRow = readonly [ColorVisionCoefficient, ColorVisionCoefficient, ColorVisionCoefficient]
type ColorVisionCoefficientRows = Readonly<{
  readonly row0: ColorVisionCoefficientRow
  readonly row1: ColorVisionCoefficientRow
  readonly row2: ColorVisionCoefficientRow
}>

const decodeColorVisionCoefficient = Schema.decodeUnknownSync(ColorVisionCoefficientSchema)
const colorVisionRow = ({ blue, green, red }: ColorVisionRow): ColorVisionCoefficientRow => [
  decodeColorVisionCoefficient(red),
  decodeColorVisionCoefficient(green),
  decodeColorVisionCoefficient(blue),
]

const colorVisionRows = ({ row0, row1, row2 }: ColorVisionRows): ColorVisionCoefficientRows => ({
  row0: colorVisionRow(row0),
  row1: colorVisionRow(row1),
  row2: colorVisionRow(row2),
})

const IDENTITY_MATRIX: ColorVisionCoefficientRows = colorVisionRows({
  row0: { blue: 0, green: 0, red: 1 },
  row1: { blue: 0, green: 1, red: 0 },
  row2: { blue: 1, green: 0, red: 0 },
})

/** Dichromacy transforms from Machado, Oliveira, and Fernandes, IEEE TVCG 15(6), 2009. */
const COLOR_VISION_MATRICES: Readonly<Record<ColorVisionCorrection, ColorVisionCoefficientRows>> = {
  deuteranopia: colorVisionRows({
    row0: { blue: -0.227968, green: 0.860646, red: 0.367322 },
    row1: { blue: 0.047413, green: 0.672501, red: 0.280085 },
    row2: { blue: 0.968881, green: 0.04294, red: -0.01182 },
  }),
  off: IDENTITY_MATRIX,
  protanopia: colorVisionRows({
    row0: { blue: -0.204868, green: 1.052583, red: 0.152286 },
    row1: { blue: 0.099216, green: 0.786281, red: 0.114503 },
    row2: { blue: 1.051998, green: -0.048116, red: -0.003882 },
  }),
  tritanopia: colorVisionRows({
    row0: { blue: -0.178779, green: -0.076749, red: 1.255528 },
    row1: { blue: 0.147602, green: 0.930809, red: -0.078411 },
    row2: { blue: 0.3039, green: 0.691367, red: 0.004733 },
  }),
}

export type ColorCorrectionPlan = Readonly<{
  readonly matrix: ColorVisionMatrix
  readonly underwaterStrength: UnderwaterColorStrength
}>

export type ColorCorrectionUniform<Value> = { value: Value }

export type ColorCorrectionUniforms = {
  readonly tDiffuse: ColorCorrectionUniform<unknown>
  readonly uColorVisionRow0: ColorCorrectionUniform<ColorVisionCoefficientRow>
  readonly uColorVisionRow1: ColorCorrectionUniform<ColorVisionCoefficientRow>
  readonly uColorVisionRow2: ColorCorrectionUniform<ColorVisionCoefficientRow>
  readonly uUnderwaterStrength: ColorCorrectionUniform<UnderwaterColorStrength>
}

export type ColorCorrectionShader = Readonly<{
  readonly fragmentShader: ColorCorrectionShaderSource
  readonly uniforms: ColorCorrectionUniforms
  readonly vertexShader: ColorCorrectionShaderSource
}>

const decodeUnderwaterColorStrength = Schema.decodeUnknownSync(UnderwaterColorStrengthSchema)
const NO_UNDERWATER_STRENGTH = decodeUnderwaterColorStrength(MIN_UNDERWATER_STRENGTH)
const FULL_UNDERWATER_STRENGTH = decodeUnderwaterColorStrength(MAX_UNDERWATER_STRENGTH)

const COLOR_CORRECTION_VERTEX_SHADER: ColorCorrectionShaderSource = Schema.decodeUnknownSync(
  ColorCorrectionShaderSourceSchema,
)(`
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`)

const COLOR_CORRECTION_FRAGMENT_SHADER: ColorCorrectionShaderSource = Schema.decodeUnknownSync(
  ColorCorrectionShaderSourceSchema,
)(`
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
`)

const matrixTuple = ({ row0, row1, row2 }: ColorVisionCoefficientRows): ColorVisionMatrix => [
  ...row0,
  ...row1,
  ...row2,
]

const underwaterStrengthFor = (underwater: boolean): UnderwaterColorStrength => {
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
