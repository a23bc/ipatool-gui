/**
 * Purchases (apps owned by the signed-in Apple ID).
 *
 * ipatool pages this list, so the store accumulates pages and lets the user keep
 * loading. Selection is keyed on `id|bundleID` rather than the array index, so it
 * survives filtering and paging.
 *
 * Everything here belongs to *one* Apple ID: the list is that account's licences.
 * Switching accounts therefore resets the store outright (see
 * {@link initPurchasesSession}), and a page still in flight when the switch
 * happens is discarded instead of being appended to the new account's list.
 */

import { create } from 'zustand'
import type { Platform, StoreApp } from '@shared/types'
import { useAppStore } from './app'
import { useUiStore } from './ui'

export interface PurchasesState {
  apps: StoreApp[]
  /** Pages already loaded, in order. */
  loadedPages: number[]
  page: number
  totalCount: number
  platform: Platform
  filter: string
  selection: string[]
  loading: boolean
  loaded: boolean
  error: { message: string; hint: string | null; code: string | null } | null
  /** Account the loaded pages belong to. */
  accountId: string
  /** Bumped on every account change, so a stale page is never merged in. */
  epoch: number

  setPlatform: (platform: Platform) => void
  setFilter: (filter: string) => void
  load: (page?: number, append?: boolean) => Promise<void>
  loadMore: () => Promise<void>
  hydrateFromCache: () => void
  toggle: (key: string) => void
  selectKeys: (keys: string[]) => void
  clearSelection: () => void
  reset: () => void
}

export function appKey(app: StoreApp): string {
  return `${app.id}|${app.bundleID}`
}

function cacheKey(accountId: string): string {
  return `ipatool-purchases:${accountId}`
}

/** Last successful page set, so the tab can paint instantly on revisit. */
function readCache(accountId: string): StoreApp[] {
  if (!accountId) return []
  try {
    const raw = localStorage.getItem(cacheKey(accountId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as StoreApp[]) : []
  } catch {
    return []
  }
}

function writeCache(accountId: string, apps: StoreApp[]): void {
  if (!accountId) return
  try {
    // Cap so a huge library cannot blow the localStorage quota.
    localStorage.setItem(cacheKey(accountId), JSON.stringify(apps.slice(0, 1000)))
  } catch {
    /* quota / private mode - cache is optional */
  }
}

export function visibleApps(apps: StoreApp[], filter: string): StoreApp[] {
  const needle = filter.trim().toLowerCase()
  if (!needle) return apps
  return apps.filter(
    (app) =>
      app.name.toLowerCase().includes(needle) ||
      app.bundleID.toLowerCase().includes(needle) ||
      String(app.id).includes(needle)
  )
}

export const usePurchasesStore = create<PurchasesState>()((set, get) => ({
  apps: [],
  loadedPages: [],
  page: 1,
  totalCount: 0,
  platform: '',
  filter: '',
  selection: [],
  loading: false,
  loaded: false,
  error: null,
  accountId: currentAccountId(),
  epoch: 0,

  setPlatform: (platform) => {
    set({ platform })
    if (get().loaded) void get().load(1, false)
  },

  setFilter: (filter) => set({ filter }),

  async load(page = 1, append = false) {
    const settings = useAppStore.getState().settings
    const accountId = currentAccountId()
    const epoch = get().epoch
    set({ loading: true, error: null })

    let result
    try {
      result = await window.api.listPurchases({
        page,
        maxResults: settings.purchasesPageSize,
        platform: get().platform || undefined
      })
    } catch (error) {
      // Same contract as search.run: an IPC rejection must roll the loading
      // state back instead of leaving the view spinning forever.
      if (get().epoch !== epoch) return
      set({ loading: false, error: { message: String(error), hint: null, code: null } })
      return
    }

    // A page fetched as the previous account is not this account's licence list.
    if (get().epoch !== epoch || currentAccountId() !== accountId) return

    if (!result.ok) {
      set({
        loading: false,
        error: { message: result.error, hint: result.hint, code: result.code }
      })
      if (result.code === 'not-signed-in') useUiStore.getState().setAuthOpen(true)
      return
    }

    const incoming = result.data.apps
    const prev = get().apps
    // `append` only merges when the pages so far belong to the same account; a
    // switch (which resets `apps`) must never inherit them. A non-append page 1
    // with an already-populated list is an incremental refresh: merge instead of
    // wiping pages the user scrolled through.
    const mergeIntoExisting =
      get().accountId === accountId &&
      (append || (page === 1 && !append && prev.length > 0))
    const byKey = new Map<string, StoreApp>()
    if (mergeIntoExisting) {
      for (const app of prev) byKey.set(appKey(app), app)
    }
    for (const app of incoming) byKey.set(appKey(app), app)
    const merged = mergeIntoExisting ? Array.from(byKey.values()) : incoming

    set({
      apps: merged,
      page,
      totalCount: result.data.totalCount,
      loadedPages: append ? Array.from(new Set([...get().loadedPages, page])) : [page],
      loading: false,
      loaded: true,
      error: null,
      accountId
    })
    writeCache(accountId, merged)
  },

  async loadMore() {
    const { page, totalCount, apps, loading } = get()
    if (loading) return
    if (totalCount > 0 && apps.length >= totalCount) return
    await get().load(page + 1, true)
  },

  toggle(key) {
    const selection = get().selection
    set({
      selection: selection.includes(key) ? selection.filter((k) => k !== key) : selection.concat(key)
    })
  },

  selectKeys(keys) {
    set({ selection: Array.from(new Set(keys)) })
  },

  clearSelection() {
    set({ selection: [] })
  },

  reset() {
    set((state) => ({
      apps: [],
      loadedPages: [],
      page: 1,
      totalCount: 0,
      // The previous account's storefront/platform choice must not leak into the
      // next one: querying the new session with the old platform can legitimately
      // return zero results.
      platform: useAppStore.getState().settings.defaultPlatform,
      filter: '',
      selection: [],
      loading: false,
      loaded: false,
      error: null,
      accountId: currentAccountId(),
      epoch: state.epoch + 1
    }))
  },

  /** Paint last-known rows immediately, then let the view refresh page 1. */
  hydrateFromCache() {
    const accountId = currentAccountId()
    if (!accountId) return
    const cached = readCache(accountId)
    if (cached.length === 0) return
    set((state) => {
      if (state.loading || state.apps.length > 0) return state
      return {
        apps: cached,
        loaded: true,
        accountId,
        epoch: state.epoch
      }
    })
  }
}))

/** The account every request will actually run as, straight from the live store. */
function currentAccountId(): string {
  return useAppStore.getState().accounts.activeId
}

/**
 * Wipes the licence list whenever the active account changes.
 *
 * Owned apps are per Apple ID, so keeping them across a switch would show one
 * account's purchases - and let the user queue downloads against them - under
 * another. `reset()` also bumps the epoch, which is what discards a page that was
 * still being fetched as the previous account.
 */
export function initPurchasesSession(): () => void {
  const off = window.api.on('accounts:changed', (snapshot) => {
    if (usePurchasesStore.getState().accountId === snapshot.activeId) return
    usePurchasesStore.getState().reset()
  })

  // The first snapshot may already have arrived before this ran.
  const active = currentAccountId()
  if (active !== '' && usePurchasesStore.getState().accountId !== active) {
    usePurchasesStore.setState({ accountId: active })
  }

  return off
}
