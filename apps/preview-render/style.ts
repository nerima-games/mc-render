/**
 * Colour and small pure formatters.
 *
 * A dev application, not shipped API.
 *
 * `--ascii` exists so a frame can be pasted into an issue, and a panel full of
 * `ESC[38;2;…m` underneath it would defeat that entirely. Threading a `Style`
 * rather than reading a module-level flag keeps every view a pure function of
 * its arguments — which is also why `views.ts` can be read as a specification
 * of what the preview claims, instead of as terminal plumbing.
 */
import { ESC } from './terminal'

export type Rgb = readonly [number, number, number]

export const LABEL: Rgb = [150, 160, 175]
export const VALUE: Rgb = [235, 240, 246]
export const GOOD: Rgb = [120, 205, 130]
export const WARN: Rgb = [255, 175, 70]
export const BAD: Rgb = [255, 105, 105]
export const NOTE: Rgb = [130, 175, 235]
export const DAY: Rgb = [250, 220, 120]
export const NIGHT: Rgb = [125, 140, 210]

const RESET = `${ESC}[0m`

export const paint = (text: string, color: Rgb): string =>
  `${ESC}[38;2;${String(color[0])};${String(color[1])};${String(color[2])}m${text}${RESET}`

export const bold = (text: string): string => `${ESC}[1m${text}${RESET}`

export const dim = (text: string): string => `${ESC}[2m${text}${RESET}`

export type Style = {
  readonly paint: (text: string, color: Rgb) => string
  readonly bold: (text: string) => string
  readonly dim: (text: string) => string
}

export const ANSI_STYLE: Style = { paint, bold, dim }

export const PLAIN_STYLE: Style = {
  paint: (text) => text,
  bold: (text) => text,
  dim: (text) => text,
}

// --- pure formatters ---------------------------------------------------------

/** Right-pad to `width`. Never truncates: a clipped number is a wrong number. */
export const pad = (text: string, width: number): string =>
  text.length >= width ? text : text + ' '.repeat(width - text.length)

/** Left-pad to `width`, for columns of numbers. */
export const padStart = (text: string, width: number): string =>
  text.length >= width ? text : ' '.repeat(width - text.length) + text

/**
 * Fixed-point, and NaN-honest.
 *
 * `Number.prototype.toFixed` renders NaN as the string `NaN`, which is exactly
 * what this preview wants: `domain/time-of-day.ts` can be driven into a state
 * where every reader returns NaN (see `probes.ts`, TIME-RESTORE), and a
 * formatter that hid it behind `0.00` would hide the defect the panel exists to
 * show.
 */
export const fixed = (value: number, digits: number): string => value.toFixed(digits)

export const degrees = (radians: number): string => `${(radians * (180 / Math.PI)).toFixed(1)}°`

/** A proportion bar. `total <= 0` renders empty rather than dividing by zero. */
export const bar = (value: number, total: number, width: number): string => {
  const ratio = total > 0 && Number.isFinite(value) ? Math.max(0, Math.min(1, value / total)) : 0
  const filled = Math.round(ratio * width)
  return '#'.repeat(filled) + '.'.repeat(Math.max(0, width - filled))
}

/** A signed bar centred on zero, for the pointer delta and the wheel accumulator. */
export const signedBar = (value: number, span: number, halfWidth: number): string => {
  if (!Number.isFinite(value) || span <= 0) {
    return ' '.repeat(halfWidth) + '|' + ' '.repeat(halfWidth)
  }
  const clamped = Math.max(-1, Math.min(1, value / span))
  const cells = Math.round(Math.abs(clamped) * halfWidth)
  const left = clamped < 0 ? '.'.repeat(halfWidth - cells) + '<'.repeat(cells) : ' '.repeat(halfWidth)
  const right = clamped > 0 ? '>'.repeat(cells) + '.'.repeat(halfWidth - cells) : ' '.repeat(halfWidth)
  return left + '|' + right
}

/** `yes` / `no`, so a boolean column reads without a legend. */
export const yesNo = (value: boolean): string => (value ? 'yes' : 'no')
