import { describe, expect, it } from 'vitest'
import {
  dsidKey,
  filterDeviceApps,
  formatDsid,
  formatInstallAccount,
  matchAccountByDsid
} from '@shared/devices'
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

describe('formatInstallAccount', () => {
  const local = {
    name: 'Jane',
    email: 'jane@example.com',
    remark: '工作号',
    id: 'a1bcdefg',
    dsid: '20825825307'
  }

  it('honours the chosen field and falls back when empty', () => {
    expect(formatInstallAccount(local, 'email', '—')).toBe('jane@example.com')
    expect(formatInstallAccount(local, 'name', '—')).toBe('Jane')
    expect(formatInstallAccount(local, 'remark', '—')).toBe('工作号')
    expect(formatInstallAccount({ ...local, remark: '' }, 'remark', '—')).toBe('jane@example.com')
    expect(formatInstallAccount(null, 'email', '20825825307')).toBe('20825825307')
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
