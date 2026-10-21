/**
 * Version history for a single app, resolved lazily.
 *
 * ipatool returns opaque external version identifiers; turning one into a human
 * version + release date costs a `get-version-metadata` call each. An app can
 * have hundreds of versions, so resolving them all up front (the old behaviour)
 * was slow, rate-limit bait, and kept hammering Apple after the drawer closed.
 *
 * New model:
 *  - only the rows currently visible are requested (the drawer reports its
 *    visible index range from the virtual list);
 *  - requests run through a small worker pool (concurrency 2);
 *  - closing the drawer bumps a generation token: queued work is dropped and
 *    in-flight results are discarded, so nothing continues in the background;
 *  - results are cached per id, so scrolling back is instant.
 */

import { create } from 'zustand'
import type { Platform, StoreApp, VersionMetadata } from '@shared/types'

const CONCURRENCY = 2

export interface VersionsError {
  message: string
  hint: string | null
  code: string | null
}

export interface VersionsState {
  app: StoreApp | null
  platform: Platform
  ids: string[]
  meta: Record<string, VersionMetadata>
  loading: boolean
  /** True while visible-row metadata requests are in flight. */
  working: boolean
  error: VersionsError | null

  load: (app: StoreApp, platform?: Platform) => Promise<void>
  enqueueVisible: (ids: string[]) => void
  stop: () => void
  close: () => void
}

/* Worker-pool state lives outside the store: it is control flow, not UI state. */
let generation = 0
let queue: string[] = []
const requested = new Set<string>()
const failed = new Set<string>()
/**
 * In-flight count for the *current* generation.
 *
 * A single module-level counter was reset to 0 by load() while workers from the
 * previous session were still outstanding. Their `finally` then decremented the
 * new counter (going negative) and the completion check could either leave
 * `working` stuck true or let the pool exceed CONCURRENCY. Each generation now
 * owns its own counter, so a stale worker can only release its own slot.
 */
const inFlightByGeneration = new Map<number, number>()

function inFlightFor(generationId: number): number {
  return inFlightByGeneration.get(generationId) ?? 0
}

function adjustInFlight(generationId: number, delta: number): number {
  const next = Math.max(0, inFlightFor(generationId) + delta)
  if (next === 0) inFlightByGeneration.delete(generationId)
  else inFlightByGeneration.set(generationId, next)
  return next
}

type Set = (partial: Partial<VersionsState>) => void
type Get = () => VersionsState

async function pump(set: Set, get: Get): Promise<void> {
  const myGeneration = generation
  set({ working: true })

  while (queue.length > 0 && inFlightFor(myGeneration) < CONCURRENCY) {
    const id = queue.shift()
    if (id === undefined) break
    adjustInFlight(myGeneration, 1)

    void (async () => {
      try {
        const state = get()
        const app = state.app
        if (!app) return
        const result = await window.api.getVersionMetadata(
          { appId: app.id || undefined, bundleID: app.bundleID || undefined },
          id,
          state.platform || undefined
        )
        // The drawer closed (or switched app) while we were away: discard.
        if (generation !== myGeneration) return
        if (result.ok) {
          set({ meta: { ...get().meta, [id]: result.data } })
        } else {
          failed.add(id)
        }
      } finally {
        const remaining = adjustInFlight(myGeneration, -1)
        // A worker from a superseded generation must not touch the new pool's
        // state: its counter is its own, so there is nothing to release.
        if (generation === myGeneration) {
          if (queue.length === 0 && remaining === 0) set({ working: false })
          else void pump(set, get)
        }
      }
    })()
  }

  if (queue.length === 0 && inFlightFor(myGeneration) === 0) set({ working: false })
}

export const useVersionsStore = create<VersionsState>()((set, get) => ({
  app: null,
  platform: '',
  ids: [],
  meta: {},
  loading: false,
  working: false,
  error: null,

  async load(app, platform) {
    // Invalidate any worker pool from a previous drawer session. The previous
    // generation keeps its own in-flight counter, so workers still running from
    // it cannot disturb the new pool's accounting.
    generation += 1
    queue = []
    requested.clear()
    failed.clear()

    set({
      app,
      platform: platform ?? '',
      ids: [],
      meta: {},
      loading: true,
      working: false,
      error: null
    })

    const result = await window.api.listVersions(
      { appId: app.id || undefined, bundleID: app.bundleID || undefined },
      platform || undefined
    )

    if (!result.ok) {
      set({
        loading: false,
        error: { message: result.error, hint: result.hint, code: result.code }
      })
      return
    }

    // Upstream returns oldest-first; the UI wants newest-first, and the first
    // entry after reversal is the latest version.
    set({ loading: false, ids: [...result.data.externalVersionIdentifiers].reverse() })
  },

  enqueueVisible(ids) {
    let added = false
    for (const id of ids) {
      if (requested.has(id) || failed.has(id)) continue
      requested.add(id)
      queue.push(id)
      added = true
    }
    if (added) void pump(set, get)
  },

  stop() {
    // Bumping the generation abandons the current pool: its counter is dropped
    // with it, so any worker still running cannot affect the next session.
    generation += 1
    inFlightByGeneration.clear()
    queue = []
    set({ working: false })
  },

  close() {
    get().stop()
    set({ app: null, ids: [], meta: {}, error: null, loading: false })
  }
}))
