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
  refreshDevices: () => Promise<void>
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
  error: null,
  filter: '',
  onlyUser: true,

  async init() {
    const probe = await window.api.devicesProbe()
    set({ probe })
    if (!probe.ok) return
    await get().refreshDevices()
  },

  async refreshDevices() {
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
