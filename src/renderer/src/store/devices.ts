/**
 * Connected iOS devices and their installed apps (read-only in P0).
 *
 * Data comes from the Python bridge; this store only caches and filters. The
 * install-account DSID is display/match metadata - it never changes which
 * Apple ID a download would use.
 */

import { create } from 'zustand'
import type { DeviceApp, DeviceInfo, DevicesProbe } from '@shared/types'
import { filterDeviceApps, matchAccountByDsid } from '@shared/devices'
import { useAppStore } from './app'

export interface DevicesState {
  probe: DevicesProbe | null
  devices: DeviceInfo[]
  selectedUdid: string | null
  apps: DeviceApp[]
  appsLoading: boolean
  listLoading: boolean
  error: string | null
  filter: string
  onlyUser: boolean

  init: () => Promise<void>
  installRuntime: () => Promise<void>
  installing: boolean
  refreshDevices: (opts?: { fromInit?: boolean }) => Promise<void>
  select: (udid: string | null) => void
  refreshApps: () => Promise<void>
  setFilter: (value: string) => void
  visibleApps: () => DeviceApp[]
}

export const useDevicesStore = create<DevicesState>()((set, get) => ({
  probe: null,
  devices: [],
  selectedUdid: null,
  apps: [],
  appsLoading: false,
  listLoading: false,
  installing: false,
  error: null,
  filter: '',
  onlyUser: true,

  async init() {
    // StrictMode double-invokes effects; only probe/load once per mount cycle.
    if (get().listLoading || get().appsLoading) return
    if (get().probe?.ok && get().devices.length > 0) return
    set({ listLoading: true, error: null })
    const probe = await window.api.devicesProbe()
    set({ probe })
    if (!probe.ok) {
      set({ listLoading: false })
      return
    }
    await get().refreshDevices({ fromInit: true })
  },

  async installRuntime() {
    if (get().installing) return
    set({ installing: true, error: null })
    try {
      const probe = await window.api.devicesInstall()
      set({ probe, installing: false })
      if (probe.ok) await get().refreshDevices()
      else set({ error: probe.message || null })
    } catch (error) {
      set({ installing: false, error: String(error) })
    }
  },

  async refreshDevices(opts) {
    if (get().listLoading && !opts?.fromInit) return
    set({ listLoading: true, error: null })
    const result = await window.api.devicesList()
    if (!result.ok) {
      set({ listLoading: false, error: result.error })
      return
    }
    const devices = result.data
    const previous = get().selectedUdid
    const selected = devices.some((d) => d.udid === previous)
      ? previous
      : (devices[0]?.udid ?? null)
    set({ devices, selectedUdid: selected, listLoading: false, error: null })
    if (selected) await get().refreshApps()
    else set({ apps: [] })
  },

  select(udid) {
    if (get().selectedUdid === udid) return
    set({ selectedUdid: udid, apps: [], error: null })
    if (udid) void get().refreshApps()
  },

  async refreshApps() {
    const udid = get().selectedUdid
    if (!udid) return
    set({ appsLoading: true, error: null })
    const result = await window.api.devicesApps(udid)
    if (!result.ok) {
      set({ appsLoading: false, error: result.error })
      return
    }
    set({ apps: result.data, appsLoading: false, error: null })
  },

  setFilter(filter) {
    set({ filter })
  },

  visibleApps() {
    return filterDeviceApps(get().apps, get().filter)
  }
}))

/** Account email/label for a device app's install DSID, or null. */
export function accountLabelForApp(app: DeviceApp): string | null {
  const accounts = useAppStore.getState().accounts.accounts
  const match = matchAccountByDsid(app, accounts)
  return match ? match.name || match.email || match.id : null
}
