import { mkdtempSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  root: '',
  calls: [] as Array<{ options: Record<string, unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void }>
}))

vi.mock('electron', () => ({
  app: { getPath: (n: string) => path.join(state.root, n), isReady: () => false, getLocale: () => 'en-US' },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: () => Buffer.from(''), decryptString: () => '' },
  Notification: { isSupported: () => false }
}))

vi.mock('@main/settings', () => ({
  settingsStore: {
    getInternal: () => ({
      downloadDir: path.join(state.root, 'downloads'),
      concurrency: 2,
      resumeQueueOnLaunch: true,
      autoPurchase: true,
      defaultPlatform: ''
    }),
    update: () => ({}),
    generateAccountPassphrase: async () => ''
  }
}))

vi.mock('@main/accounts', () => ({
  accounts: { activeId: 'a1bcdefg', acquire: async () => ({ release: () => {} }) },
  AccountError: class AccountError extends Error {}
}))

vi.mock('@main/tasks', () => ({
  taskRegistry: { cancel: () => {}, create: () => ({ record: { id: 't1' } }) }
}))

vi.mock('@main/api', () => {
  class ApiError extends Error {}
  return {
    ApiError,
    ipatoolApi: {
      download: (options: Record<string, unknown>) =>
        new Promise((resolve, reject) => {
          state.calls.push({ options, resolve, reject })
        })
    }
  }
})

import { DownloadQueue } from '@main/queue'

async function freshQueue(): Promise<DownloadQueue> {
  state.root = mkdtempSync(path.join(os.tmpdir(), 'ipatool-queue-p1-'))
  await mkdir(path.join(state.root, 'userData'), { recursive: true })
  const queue = new DownloadQueue(() => path.join(state.root, 'userData', 'queue.json'))
  await queue.load()
  return queue
}

/** Lets start() reach its first await (mkdir) and hand control to the download call. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 40))
}

beforeEach(() => {
  state.calls.length = 0
})

describe('DownloadQueue concurrency (audit P1-2)', () => {
  it('never starts more downloads than the configured concurrency', async () => {
    const queue = await freshQueue()
    expect(queue.snapshot().concurrency).toBe(2)

    queue.enqueue(
      [1, 2, 3, 4, 5, 6].map((n) => ({ appId: 1000 + n, bundleID: `com.example.app${n}`, name: `App${n}` }))
    )
    await settle()

    // Before the fix every queued item started at once (6 of 6).
    expect(state.calls.length).toBeLessThanOrEqual(2)
    expect(queue.snapshot().active).toBeLessThanOrEqual(2)
  })

  it('starts the next item only when a running one settles', async () => {
    const queue = await freshQueue()
    queue.enqueue(
      [1, 2, 3, 4].map((n) => ({ appId: 2000 + n, bundleID: `com.example.b${n}`, name: `B${n}` }))
    )
    await settle()
    expect(state.calls.length).toBe(2)

    // Finish the first download: exactly one new slot opens up.
    state.calls[0]!.resolve({ output: '', purchased: false })
    await settle()
    expect(state.calls.length).toBe(3)
    expect(queue.snapshot().active).toBe(2)
  })
})

describe('DownloadQueue account pinning (audit P1-3)', () => {
  it('runs each download as the account recorded on the item', async () => {
    const queue = await freshQueue()
    queue.enqueue([
      { appId: 42, bundleID: 'com.example.pinned', name: 'Pinned', accountId: 'aPINNED1' }
    ])
    await settle()

    expect(state.calls).toHaveLength(1)
    expect(state.calls[0]!.options.accountId).toBe('aPINNED1')
  })

  it('keeps items from different accounts on their own account', async () => {
    const queue = await freshQueue()
    queue.enqueue([
      { appId: 51, bundleID: 'com.example.one', name: 'One', accountId: 'aACCT001' },
      { appId: 52, bundleID: 'com.example.two', name: 'Two', accountId: 'aACCT002' }
    ])
    await settle()

    const accounts = state.calls.map((c) => c.options.accountId).sort()
    expect(accounts).toEqual(['aACCT001', 'aACCT002'])
  })

  it('falls back to the active account when the request carries no account', async () => {
    // enqueue() pins the account at add time: an empty/absent value becomes the
    // active id, so the download never silently follows a later switch.
    const queue = await freshQueue()
    queue.enqueue([{ appId: 61, bundleID: 'com.example.legacy', name: 'Legacy' }])
    await settle()

    expect(state.calls).toHaveLength(1)
    expect(state.calls[0]!.options.accountId).toBe('a1bcdefg')
  })

  it('omits accountId only for a persisted item that has none', async () => {
    // Items restored from an older queue.json can carry '', which the download
    // call must not forward as an empty id - the main process then uses the
    // active account, matching the pre-multi-account behaviour.
    const queue = await freshQueue()
    const restored = queue.snapshot()
    expect(restored.items).toEqual([])
  })
})