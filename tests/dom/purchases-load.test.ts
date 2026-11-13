/**
 * Tab remounts used to fire overlapping page-1 requests. The store must drop a
 * second `load` while the first one is still in flight.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '@shared/types'

let resolveLoad: ((value: unknown) => void) | null = null
const listPurchases = vi.fn(
  () =>
    new Promise((resolve) => {
      resolveLoad = resolve
    })
)

;(globalThis as unknown as { window: unknown }).window = {
  api: { listPurchases }
}
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
}

import { useAppStore } from '@renderer/store/app'
import { usePurchasesStore } from '@renderer/store/purchases'

const ACCOUNTS = {
  accounts: [],
  activeId: 'a1234567890',
  credentialSlot: 'file',
  slotBridge: 'not-needed',
  slotDetail: '',
  legacy: null
}

const SETTINGS = {
  purchasesPageSize: 50,
  defaultPlatform: ''
} as unknown as Settings

beforeEach(() => {
  listPurchases.mockClear()
  resolveLoad = null
  useAppStore.setState({ accounts: ACCOUNTS as never, settings: SETTINGS })
  usePurchasesStore.setState({
    apps: [],
    loaded: false,
    loading: false,
    page: 1,
    totalCount: 0,
    error: null,
    accountId: ACCOUNTS.activeId
  })
})

describe('purchases load dedupe', () => {
  it('sends only one request while the first page is in flight', async () => {
    const first = usePurchasesStore.getState().load(1, false)
    const second = usePurchasesStore.getState().load(1, false)
    expect(listPurchases).toHaveBeenCalledTimes(1)

    resolveLoad?.({ ok: true, data: { apps: [], totalCount: 0 } })
    await Promise.all([first, second])

    expect(usePurchasesStore.getState().loading).toBe(false)
    expect(usePurchasesStore.getState().loaded).toBe(true)
  })
})
