/**
 * CSS layering guard (audit P2-12).
 *
 * The custom component classes used to be unlayered. Unlayered CSS beats every
 * @layer, so `class="btn h-[26px]"` silently got .btn's height and the Tailwind
 * utility was dropped - roughly 50 call sites relied on the opposite. They now
 * live in @layer components, which utilities (a later layer) can override.
 *
 * This test reads the stylesheet so the regression cannot come back quietly.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const cssPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  'renderer',
  'src',
  'index.css'
)
const css = readFileSync(cssPath, 'utf8')

/** Returns [open, close] indices of a top-level @layer block. */
function layerRange(source: string, name: string): [number, number] | null {
  const open = source.indexOf('@layer ' + name)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return [open, i]
    }
  }
  return null
}

describe('index.css layering (audit P2-12)', () => {
  it('defines the component classes inside @layer components', () => {
    const range = layerRange(css, 'components')
    expect(range).not.toBeNull()

    const [open, close] = range!
    for (const selector of ['.btn {', '.input {', '.badge {', '.row {', '.panel {']) {
      const at = css.indexOf(selector)
      expect(at, selector).toBeGreaterThan(open)
      expect(at, selector).toBeLessThan(close)
    }
  })

  it('does not leave an unlayered .btn or .input rule behind', () => {
    // A duplicate outside the layer would win again, silently.
    const range = layerRange(css, 'components')!
    const outside = css.slice(0, range[0]) + css.slice(range[1])
    expect(outside).not.toMatch(/^\.btn\s*\{/m)
    expect(outside).not.toMatch(/^\.input\s*\{/m)
  })

  it('keeps the design tokens outside any layer', () => {
    // Theme variables must stay unlayered: they are custom properties, not
    // competing declarations, and moving them would change their resolution.
    const range = layerRange(css, 'components')!
    const before = css.slice(0, range[0])
    expect(before).toContain(':root {')
    expect(before).toContain("html[data-theme='dark']")
  })
})
