/**
 * Boot-failure handling for the app store (audit P1-5).
 *
 * `init()` used to set its "already initialised" latch *before* awaiting the
 * first IPC round-trip and had no error path, so any boot failure left the UI on
 * a spinner forever: the latch made a retry a no-op and the caller dropped the
 * rejection. These tests pin the two properties that make the failure
 * recoverable - the latch is released and the reason is exposed - and that a
 * successful retry clears the error.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountsSnapshot, AppInfoPayload, EngineStatus, Settings } from '@shared/types'

type Listener = (payload: unknown) => void

const state = vi.hoisted(() => ({
  listeners: new Set<Listener>(),
  failBoot: true
}))

const APP_INFO: AppInfoPayload = {
  appVersion: '0.1.1',
  electronVersion: '39.0.0',
  chromeVersion: '140.0.0',
  nodeVersion: '22.0.0',
  platform: 'win32',
  arch: 'x64',
  locale: 'en-US',
  isDev: false,
  paths: { userData: '/tmp/ud', downloads: '/tmp/dl', documents: '/tmp/doc' }
}

const SETTINGS = {
  ipatoolPath: '', autoInstallEngine: true, engineVersion: '', githubMirror: '',
  downloadDir: '/tmp/dl', concurrency: 2, autoPurchase: true, defaultPlatform: '',
  searchLimit: 25, purchasesPageSize: 50, passphraseMode: 'auto', keychainPassphrase: '',
  isolateSessionHome: true, accounts: [], activeAccountId: '', accountCounter: 1,
  verbose: false, theme: 'system', locale: 'system', artworkEnabled: true,
  artworkCountry: 'us', maxLogLines: 2000, resumeQueueOnLaunch: true,
  notifyOnComplete: true, confirmCloseWhileDownloading: false, lastEmail: ''
} as unknown as Settings

const ENGINE: EngineStatus = {
  state: 'idle', path: null, version: null, source: null,
  message: null, code: null, download: null
}

const ACCOUNTS: AccountsSnapshot = {
  accounts: [], activeId: '', credentialSlot: 'file',
  slotBridge: 'not-needed', slotDetail: '', legacy: null
}

const api = {
  getAppInfo: async (): Promise<AppInfoPayload> => {
    if (state.failBoot) throw new Error('ipc not ready')
    return APP_INFO
  },
  getSettings: async (): Promise<Settings> => SETTINGS,
  getEngineStatus: async (): Promise<EngineStatus> => ENGINE,
  getAccounts: async (): Promise<AccountsSnapshot> => ACCOUNTS,
  detectEngine: async (): Promise<EngineStatus> => ENGINE,
  on: (_channel: string, listener: Listener): (() => void) => {
    state.listeners.add(listener)
    return () => state.listeners.delete(listener)
  }
}

// The store touches `window` for the bridge and for matchMedia/theme writes.
const fakeWindow = {
  api,
  matchMedia: () => ({ matches: false }),
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
}
;(globalThis as unknown as { window: unknown }).window = fakeWindow
;(globalThis as unknown as { document: unknown }).document = {
  documentElement: { dataset: {} },
  querySelector: () => null
}

import { disposeAppStore, useAppStore } from '@renderer/store/app'

beforeEach(() => {
  disposeAppStore()
  state.failBoot = true
  state.listeners.clear()
  useAppStore.setState({ ready: false, bootError: null })
})

describe('app store boot failure (audit P1-5)', () => {
  it('records the failure instead of leaving ready=false with no explanation', async () => {
    await useAppStore.getState().init()

    const after = useAppStore.getState()
    expect(after.ready).toBe(false)
    expect(after.bootError).toContain('ipc not ready')
  })

  it('allows a retry to succeed (the latch is released on failure)', async () => {
    await useAppStore.getState().init()
    expect(useAppStore.getState().bootError).not.toBeNull()

    // Second call must actually run again rather than returning early.
    state.failBoot = false
    await useAppStore.getState().init()

    const after = useAppStore.getState()
    expect(after.ready).toBe(true)
    expect(after.bootError).toBeNull()
  })

  it('does not register IPC listeners when boot fails', async () => {
    await useAppStore.getState().init()
    // Subscriptions are only installed on the success path, so a retry cannot
    // double-subscribe.
    expect(state.listeners.size).toBe(0)
  })

  it('registers listeners exactly once after a successful boot', async () => {
    state.failBoot = false
    await useAppStore.getState().init()
    const first = state.listeners.size
    expect(first).toBeGreaterThan(0)

    // init() is idempotent once it succeeded.
    await useAppStore.getState().init()
    expect(state.listeners.size).toBe(first)
  })
})
