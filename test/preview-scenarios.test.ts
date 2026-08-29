import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SCENARIO_NAMES } from '../apps/preview-render/script'
import { postFxView, scenarioCatalogue } from '../apps/preview-render/views'
import { PLAIN_STYLE } from '../apps/preview-render/style'
import { POST_PROCESSING_PASS_ORDER } from '../src/domain/post-processing'

describe('preview scenario catalogue', () => {
  it.effect('renders every scripted scenario, including the HUD click case', () =>
    Effect.sync(() => {
      const lines = scenarioCatalogue(PLAIN_STYLE, 120)
      for (const name of SCENARIO_NAMES) {
        expect(lines.some((line) => line.includes(name))).toBe(true)
      }
    }),
  )

  it.effect('renders the post-processing contract as an inspectable table', () =>
    Effect.sync(() => {
      const lines = postFxView(PLAIN_STYLE, 120)
      const presetSectionStart = lines.findIndex((line) => line.includes('the four presets'))
      const orderRows = lines.slice(1, presetSectionStart)
      const passPositions = POST_PROCESSING_PASS_ORDER.map((pass) =>
        orderRows.findIndex((line) => line.includes(`  ${pass}`)),
      )

      expect(passPositions.every((position) => position >= 0)).toBe(true)
      expect(passPositions).toEqual([...passPositions].sort((left, right) => left - right))
      expect(lines.some((line) => line.includes('low'))).toBe(true)
      expect(lines.some((line) => line.includes('ultra'))).toBe(true)
      expect(lines.some((line) => line.includes('(empty)') && line.includes('violation(s)'))).toBe(true)
    }),
  )
})
