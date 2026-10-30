/**
 * Caption-button dimming is reference-counted: stacked dialogs must not
 * un-dim the OS chrome when only the inner one closes.
 */
import { describe, expect, it } from 'vitest'

const calls: boolean[] = []
;(globalThis as unknown as { window: unknown }).window = {
  api: { setChromeDimmed: (value: boolean) => calls.push(value) }
}

import { holdModalChrome } from '@renderer/store/ui'

describe('holdModalChrome', () => {
  it('stays dimmed until the last holder releases', () => {
    const releaseOuter = holdModalChrome()
    const releaseInner = holdModalChrome()
    expect(calls.at(-1)).toBe(true)

    releaseInner()
    expect(calls.at(-1)).toBe(true)

    releaseOuter()
    expect(calls.at(-1)).toBe(false)
  })

  it('ignores a release called twice', () => {
    const release = holdModalChrome()
    release()
    release()
    expect(calls.at(-1)).toBe(false)
  })
})
