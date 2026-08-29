import { LABEL, pad, type Style } from './style'

export const LABEL_WIDTH = 15

export const row = (style: Style, label: string, value: string): string =>
  `${style.paint(pad(label, LABEL_WIDTH), LABEL)}${value}`

export const heading = (style: Style, text: string, width: number): string => {
  const prefix = `-- ${text} `
  return style.dim(prefix + '-'.repeat(Math.max(0, width - prefix.length)))
}

export const codes = (values: ReadonlyArray<string>): string =>
  values.length === 0 ? '(none)' : values.join(' ')
