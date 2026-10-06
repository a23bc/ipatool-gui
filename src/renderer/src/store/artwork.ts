/**
 * Artwork store.
 *
 * Icons are fetched lazily by whichever row is actually on screen, deduplicated
 * in flight, and cached in the main process (memory + disk). Keeping this in its
 * own store means an icon arriving does not invalidate the search-results store
 * and re-render the whole list.
 */

import { create } from 'zustand'
import { useAppStore } from './app'

export interface ArtworkState {
  byId: Record<string, string | null>
  request: (appId: number) => void
  requestByBundle: (bundleId: string) => void
  invalidate: (appId: number) => void
  /** Drops every cached icon; mirrors `window.api.clearArtworkCache()`. */
  invalidateAll: () => void
}

const inflight = new Set<string>()

export const useArtworkStore = create<ArtworkState>()((set, get) => ({
  byId: {},

  request(appId) {
    if (!Number.isFinite(appId) || appId <= 0) return
    if (!useAppStore.getState().settings.artworkEnabled) return
    const key = `id:${appId}`
    if (key in get().byId) return
    if (inflight.has(key)) return

    inflight.add(key)
    window.api
      .getArtwork(appId)
      .then((dataUrl) => {
        set((state) => ({ byId: { ...state.byId, [key]: dataUrl } }))
      })
      .catch(() => {
        set((state) => ({ byId: { ...state.byId, [key]: null } }))
      })
      .finally(() => {
        inflight.delete(key)
      })
  },

  requestByBundle(bundleId) {
    const bid = bundleId.trim()
    if (bid === '') return
    if (!useAppStore.getState().settings.artworkEnabled) return
    const key = `bundle:${bid}`
    if (key in get().byId) return
    if (inflight.has(key)) return

    inflight.add(key)
    window.api
      .getArtworkByBundle(bid)
      .then((dataUrl) => {
        set((state) => ({ byId: { ...state.byId, [key]: dataUrl } }))
      })
      .catch(() => {
        set((state) => ({ byId: { ...state.byId, [key]: null } }))
      })
      .finally(() => {
        inflight.delete(key)
      })
  },

  invalidate(appId) {
    const key = `id:${appId}`
    inflight.delete(key)
    set((state) => {
      const next = { ...state.byId }
      delete next[key]
      return { byId: next }
    })
  },

  invalidateAll() {
    inflight.clear()
    set({ byId: {} })
  }
}))

/** Convenience selector for a single icon. */
export function selectArtwork(appId: number): string | null | undefined {
  return useArtworkStore.getState().byId[`id:${appId}`]
}
