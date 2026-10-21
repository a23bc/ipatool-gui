/**
 * Version-metadata worker pool (audit P2-13).
 *
 * load() used to reset a single module-level inFlight counter while workers from
 * the previous drawer session were still outstanding. Their finally then
 * decremented the *new* counter, which could leave `working` stuck true (a
 * spinner that never stops) or let the pool exceed CONCURRENCY (double the
 * request rate against Apple).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Operation, VersionMetadata } from '@shared/types'

type Resolver = (value: Operation<VersionMetadata>) => void

const state = vi.hoisted(() => ({
  pending: [] as Array<{ id: string; resolve: Resolver }>,
  maxConcurrent: 0,
  active: 0
}))

const okResult = (id: string): Operation<VersionMetadata> => ({
  ok: true,
  data: { externalVersionID: id, displayVersion: '1.0' },
  taskId: 't'
})

const api = {
  getVersionMetadata: (_selector: unknown, id: string): Promise<Operation<VersionMetadata>> => {
    state.active += 1
    state.maxConcurrent = Math.max(state.maxConcurrent, state.active)
    return new Promise<Operation<VersionMetadata>>((resolve) => {
      state.pending.push({ id, resolve })
    }).finally(() => {
      state.active -= 1
    })
  }
}

;(globalThis as unknown as { window: unknown }).window = { api }

import { useVersionsStore } from '@renderer/store/versions'

/** Resolves every pending request with a success. */
async function drain(): Promise<void> {
  // Resolve in waves: each resolution may schedule another worker.
  for (let round = 0; round < 10; round += 1) {
    const batch = state.pending.splice(0)
    if (batch.length === 0) break
    for (const entry of batch) entry.resolve(okResult(entry.id))
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

beforeEach(() => {
  useVersionsStore.getState().stop()
  state.pending.length = 0
  state.maxConcurrent = 0
  state.active = 0
})

describe('versions worker pool (audit P2-13)', () => {
  it('never exceeds the concurrency cap while resolving a batch', async () => {
    useVersionsStore.setState({
      app: { id: 1, bundleID: 'com.example.app', name: 'App', version: '1.0', price: 0 },
      platform: '',
      ids: ['a', 'b', 'c', 'd', 'e', 'f'],
      meta: {},
      loading: false,
      working: false,
      error: null
    })
    useVersionsStore.getState().enqueueVisible(['a', 'b', 'c', 'd', 'e', 'f'])

    await new Promise((resolve) => setTimeout(resolve, 10))
    // CONCURRENCY is 2; the audit reproduced 4 concurrent requests after a
    // reopen because the shared counter had been reset.
    expect(state.maxConcurrent).toBeLessThanOrEqual(2)

    await drain()
    expect(useVersionsStore.getState().working).toBe(false)
    expect(Object.keys(useVersionsStore.getState().meta).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('does not leave working stuck after a reopen while requests are in flight', async () => {
    const app = { id: 1, bundleID: 'com.example.app', name: 'App', version: '1.0', price: 0 }
    useVersionsStore.setState({ app, platform: '', ids: ['x', 'y'], meta: {}, loading: false, working: false })
    useVersionsStore.getState().enqueueVisible(['x', 'y'])
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(state.pending.length).toBeGreaterThan(0)

    // Reopen the drawer for the same app: this is what used to reset the
    // counter while the old requests were still outstanding.
    useVersionsStore.setState({ app, ids: ['x', 'y'], meta: {} })
    useVersionsStore.getState().enqueueVisible(['x', 'y'])
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Resolve the stale workers too, then the new ones.
    await drain()
    await drain()

    expect(useVersionsStore.getState().working).toBe(false)
  })
})
