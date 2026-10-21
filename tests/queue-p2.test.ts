/**
 * Download-queue progress and settings propagation (audit P2-9, P2-10).
 *
 * Both defects were invisible to the existing suite because its fixtures
 * deliberately avoid `queued` items (so the pump never starts a download) and
 * nothing exercised the progress merge. These tests drive the real queue with a
 * controllable fake `download` so the publish() path actually runs.
 */
import { mkdtempSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type ProgressCb = (sample: {
  received: number | null
  total: number | null
  percent: number | null
  speed: number | null
}) => void

const state = vi.hoisted(() => ({
  root: '',
  calls: [] as Array<{
    options: Record<string, unknown>
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
    onProgress?: ProgressCb
  }>
}))

vi.mock('electron', () => ({
  app: { getPath: (name: string) => path.join(state.root, name), isReady: () => false, getLocale: () => 'en-US' },
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
      download: (options: Record<string, unknown>, onProgress?: ProgressCb) =>
        new Promise((resolve, reject) => {
          state.calls.push({ options, resolve, reject, onProgress })
        })
    }
  }
})

import { DownloadQueue } from '@main/queue'

async function freshQueue(): Promise<DownloadQueue> {
  state.root = mkdtempSync(path.join(os.tmpdir(), 'ipatool-queue-p2-'))
  await mkdir(path.join(state.root, 'userData'), { recursive: true })
  const queue = new DownloadQueue(() => path.join(state.root, 'userData', 'queue.json'))
  await queue.load()
  return queue
}

/** Lets start() reach its download call. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 40))
}

/** Waits for at least one publish() tick (PROGRESS_INTERVAL_MS is 100 ms). */
function progressTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 180))
}

beforeEach(() => {
  state.calls.length = 0
})

describe('progress total consistency (audit P2-9)', () => {
  it('ignores a derived total that is smaller than the bytes already on disk', async () => {
    const queue = await freshQueue()
    queue.enqueue([{ appId: 900, bundleID: 'com.example.big', name: 'Big' }])
    await settle()

    const call = state.calls[0]
    expect(call).toBeDefined()

    // 50 MB already received; the bar reports a 10 MB total (progressbar is
    // created before ChangeMax64, and the parser can derive a total from a lone
    // size + percentage). Accepting it used to pin the row at 100% with ETA 0.
    call!.onProgress?.({ received: 50_000_000, total: 10_000_000, percent: 50, speed: 1_000_000 })
    await progressTick()

    const item = queue.snapshot().items[0]
    expect(item?.progress.received).toBe(50_000_000)
    // The implausible total must not become the row's total.
    expect(item?.progress.total ?? 0).not.toBe(10_000_000)
    expect(item?.progress.percent ?? 0).toBeLessThan(100)
  })

  it('accepts a total that is larger than the received count', async () => {
    const queue = await freshQueue()
    queue.enqueue([{ appId: 901, bundleID: 'com.example.ok', name: 'Ok' }])
    await settle()

    state.calls[0]!.onProgress?.({
      received: 10_000_000,
      total: 50_000_000,
      percent: 20,
      speed: 1_000_000
    })
    await progressTick()

    const item = queue.snapshot().items[0]
    expect(item?.progress.total).toBe(50_000_000)
    expect(item?.progress.percent).toBeCloseTo(20, 0)
  })
})

describe('setConcurrency (audit P2-10)', () => {
  it('applies a new limit immediately and reports it in the snapshot', async () => {
    const queue = await freshQueue()
    expect(queue.snapshot().concurrency).toBe(2)

    queue.setConcurrency(5)
    expect(queue.snapshot().concurrency).toBe(5)

    // Out-of-range values are clamped, not stored verbatim.
    queue.setConcurrency(99)
    expect(queue.snapshot().concurrency).toBe(8)
    queue.setConcurrency(0)
    expect(queue.snapshot().concurrency).toBe(1)
  })
})