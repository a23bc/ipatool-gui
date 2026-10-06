import { describe, expect, it } from 'vitest'
import { dsidKey, filterDeviceApps, formatDsid, matchAccountByDsid } from '@shared/devices'
import type { DeviceApp } from '@shared/types'

const app = (dsid: number | string | null): Pick<DeviceApp, 'applicationDsid'> => ({ applicationDsid: dsid })

function account(id: string, dsid: string) {
  return { id, name: `Account ${id}`, email: '', dsid }
}

describe('dsidKey / formatDsid', () => {
  it('normalises numbers and strings', () => {
    expect(dsidKey(20825825307)).toBe('20825825307')
    expect(dsidKey(' 18378161841 ')).toBe('18378161841')
    expect(dsidKey(null)).toBe('')
    expect(formatDsid(undefined)).toBe('—')
  })
})

describe('matchAccountByDsid', () => {
  it('matches a local account by DirectoryServicesID', () => {
    const accounts = [account('a1bcdefg', '20825825307'), account('a2hijklm', '18378161841')]
    expect(matchAccountByDsid(app(20825825307), accounts)?.id).toBe('a1bcdefg')
    expect(matchAccountByDsid(app('18378161841'), accounts)?.id).toBe('a2hijklm')
  })

  it('returns null when unknown or missing', () => {
    expect(matchAccountByDsid(app(999), [account('a1bcdefg', '1')])).toBeNull()
    expect(matchAccountByDsid(app(null), [])).toBeNull()
  })
})

describe('filterDeviceApps', () => {
  const apps: DeviceApp[] = [
    {
      bundleId: 'com.alipay.iphoneclient',
      name: '支付宝',
      version: '10',
      build: '1',
      applicationType: 'User',
      applicationDsid: 1,
      signerIdentity: null,
      isAppClip: false
    },
    {
      bundleId: 'com.google.chrome.ios',
      name: 'Chrome',
      version: '125',
      build: '1',
      applicationType: 'User',
      applicationDsid: 2,
      signerIdentity: null,
      isAppClip: false
    }
  ]

  it('filters by name, bundle id and dsid', () => {
    expect(filterDeviceApps(apps, 'chrome')).toHaveLength(1)
    expect(filterDeviceApps(apps, '支付宝')).toHaveLength(1)
    expect(filterDeviceApps(apps, 'alipay')).toHaveLength(1)
    expect(filterDeviceApps(apps, '2')).toHaveLength(1)
    expect(filterDeviceApps(apps, '')).toHaveLength(2)
  })
})
