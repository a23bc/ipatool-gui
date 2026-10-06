/**
 * Pure helpers for the Devices view.
 *
 * Device ApplicationDSID is who *installed* the app on the phone; the account
 * list is who we can *download* as in this app. Matching is a hint only - never
 * auto-switch the ipatool session because of it.
 */

import type { DeviceApp } from './types'

/** Minimal account identity used for install-account matching. */
export interface DsidHolder {
  dsid: string
  name: string
  email: string
  id: string
}

/** Normalises DSID values from JSON (number | string) to a compare key. */
export function dsidKey(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

/**
 * Best local account for a device app's install DSID, if any.
 *
 * Device `ApplicationDSID` is the Directory Services ID of the Apple ID that
 * originally installed the app on the phone. ipatool stores the same DSID on
 * each account record (`DirectoryServicesID`). Equal DSIDs mean "this app was
 * installed with that Apple ID" — still only a hint for which account to
 * *download* as; never switch sessions automatically.
 */
export function matchAccountByDsid(
  apps: Pick<DeviceApp, 'applicationDsid'>,
  accounts: DsidHolder[]
): DsidHolder | null {
  const key = dsidKey(apps.applicationDsid)
  if (key === '') return null
  return accounts.find((account) => dsidKey(account.dsid) === key) ?? null
}

/** True when the install DSID matches a local account. */
export function installAccountKnown(
  app: Pick<DeviceApp, 'applicationDsid'>,
  accounts: DsidHolder[]
): boolean {
  return matchAccountByDsid(app, accounts) !== null
}

/** Short label for an install DSID in table cells. */
export function formatDsid(value: number | string | null | undefined): string {
  const key = dsidKey(value)
  if (key === '') return '—'
  return key
}

/** Client-side name/bundle filter for the device app list. */
export function filterDeviceApps(apps: DeviceApp[], query: string): DeviceApp[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return apps
  return apps.filter(
    (app) =>
      app.name.toLowerCase().includes(needle) ||
      app.bundleId.toLowerCase().includes(needle) ||
      String(app.applicationDsid ?? '').includes(needle)
  )
}
