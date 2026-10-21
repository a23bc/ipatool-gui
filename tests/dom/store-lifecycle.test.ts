/**
 * Renderer store lifecycle (audit P2-11, P2-13, P2-14).
 *
 * Three defects that only show up over time: listeners registered after a
 * round-trip that can fail (leaving the view permanently unsubscribed), a worker
 * pool whose shared counter is reset while workers are still running, and
 * dispose functions that existed but were never called.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueueSnapshot, TaskRecord } from '@shared/types'

type Listener = (payload: unknown) => void

const state = vi.hoisted(() => ({
  listeners: new Map<string, Set<Listener>>(),
  failQueue: false,
  failTasks: false,
  metadata: [] as string[]
}))

const QUEUE: QueueSnapshot = { items: [], concurrency: 2, active: 0 }

const api = {
  getQueue: async (): Promise<QueueSnapshot> => {
    if (state.failQueue) throw new Error('queue ipc down')
    return QUEUE
  },
  listTasks: async (): Promise<TaskRecord[]> => {
    if (state.failTasks) throw new Error('tasks ipc down')
    return []
  },
  on: (channel: string, listener: Listener): (() => void) => {
    let set = state.listeners.get(channel)
    if (!set) {
      set = new Set()
      state.listeners.set(channel, set)
    }
    set.add(listener)
    return () => set!.delete(listener)
  },
  exists: async (): Promise<boolean> => true,
  reveal: async (): Promise<void> => {},
  getVersionMetadata: async (_selector: unknown, id: string) => {
    state.metadata.push(id)
    return { ok: true as const, data: { externalVersionID: id, displayVersion: '1.0', releaseDate: null }, taskId: 't' }
  }
}

;(globalThis as unknown as { window: unknown }).window = {
  api,
  matchMedia: () => ({ matches: false }),
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
}
;(globalThis as unknown as { document: unknown }).document = {
  documentElement: { dataset: {} },
  querySelector: () => null
}

import { disposeQueueStore, useQueueStore } from '@renderer/store/queue'
import { disposeTasksStore, useTasksStore } from '@renderer/store/tasks'

function listenerCount(channel: string): number {
  return state.listeners.get(channel)?.size ?? 0
}

beforeEach(() => {
  disposeQueueStore()
  disposeTasksStore()
  state.listeners.clear()
  state.failQueue = false
  state.failTasks = false
  state.metadata = []
  useQueueStore.setState({ items: [], initialised: false, concurrency: 2, active: 0 })
  useTasksStore.setState({ tasks: [], lines: {}, initialised: false, selectedId: null })
})

describe('queue store subscription ordering (audit P2-11)', () => {
  it('registers listeners even when the first round-trip fails', async () => {
    state.failQueue = true
    await expect(useQueueStore.getState().init()).rejects.toThrow('queue ipc down')

    // The whole point: a failure here must not leave the view deaf to updates.
    expect(listenerCount('queue:snapshot')).toBe(1)
    expect(listenerCount('queue:progress')).toBe(1)
    expect(listenerCount('queue:item-finished')).toBe(1)
  })

  it('does not double-subscribe when init is retried', async () => {
    state.failQueue = true
    await expect(useQueueStore.getState().init()).rejects.toThrow()

    state.failQueue = false
    await useQueueStore.getState().init()
    await useQueueStore.getState().init()

    expect(listenerCount('queue:snapshot')).toBe(1)
    expect(useQueueStore.getState().initialised).toBe(true)
  })
})

describe('tasks store subscription ordering (audit P2-11)', () => {
  it('registers listeners even when the first round-trip fails', async () => {
    state.failTasks = true
    await expect(useTasksStore.getState().init()).rejects.toThrow('tasks ipc down')

    expect(listenerCount('task:log')).toBe(1)
    expect(listenerCount('task:finished')).toBe(1)
  })

  it('does not double-subscribe when init is retried', async () => {
    state.failTasks = true
    await expect(useTasksStore.getState().init()).rejects.toThrow()

    state.failTasks = false
    await useTasksStore.getState().init()
    await useTasksStore.getState().init()

    expect(listenerCount('task:log')).toBe(1)
  })
})

describe('dispose functions (audit P2-14)', () => {
  it('detach the listeners and allow a clean re-init', async () => {
    await useQueueStore.getState().init()
    await useTasksStore.getState().init()
    expect(listenerCount('queue:snapshot')).toBe(1)

    disposeQueueStore()
    disposeTasksStore()
    expect(listenerCount('queue:snapshot')).toBe(0)
    expect(listenerCount('task:log')).toBe(0)

    // A fresh init after dispose subscribes again rather than thinking it is done.
    await useQueueStore.getState().init()
    expect(listenerCount('queue:snapshot')).toBe(1)
  })
})
