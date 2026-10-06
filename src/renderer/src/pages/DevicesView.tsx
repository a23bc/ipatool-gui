/**
 * Devices — read-only view of connected iPhones and their user apps (P0).
 *
 * "Install account" is the DSID that originally installed the app on the phone.
 * It is only matched against local ipatool accounts for display; downloads
 * always use the account selected in the header.
 */

import { useCallback, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { DeviceApp } from '@shared/types'
import { filterDeviceApps, formatDsid } from '@shared/devices'
import { useAppStore } from '@renderer/store/app'
import { useDevicesStore } from '@renderer/store/devices'
import { useQueueStore } from '@renderer/store/queue'
import { useSearchStore } from '@renderer/store/search'
import { useUiStore } from '@renderer/store/ui'
import { EmptyState } from '@renderer/components/EmptyState'
import { Icon, Spinner } from '@renderer/components/Icon'
import { VirtualList } from '@renderer/components/VirtualList'
import { accountLabelForApp } from '@renderer/store/devices'

const ROW_HEIGHT = 52

function AppRow({ app }: { app: DeviceApp }): ReactNode {
  const t = useAppStore((state) => state.t)
  const enqueue = useQueueStore((state) => state.enqueue)
  const setTerm = useSearchStore((state) => state.setTerm)
  const runSearch = useSearchStore((state) => state.run)
  const setView = useUiStore((state) => state.setView)
  const toast = useUiStore((state) => state.toast)

  const accountLabel = accountLabelForApp(app)

  const download = (): void => {
    void enqueue([
      {
        bundleID: app.bundleId,
        name: app.name,
        version: app.version
      }
    ])
  }

  const search = (): void => {
    setTerm(app.bundleId)
    setView('search')
    void runSearch()
    toast({ kind: 'info', message: t('devices.searchStarted', { name: app.name }), duration: 2000 })
  }

  return (
    <div className="flex h-full items-center gap-3 px-4" style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <span className="truncate text-[13px] font-medium leading-tight">{app.name}</span>
        <span className="mono mt-0.5 truncate faint">{app.bundleId}</span>
      </div>

      <span className="mono w-[64px] shrink-0 truncate text-right dim" title={app.version}>
        {app.version || '—'}
      </span>

      <span
        className="w-[150px] shrink-0 truncate text-right text-[11px]"
        title={
          accountLabel
            ? `${t('devices.installAccount')}: ${formatDsid(app.applicationDsid)} → ${t('devices.accountMatched')}`
            : `${t('devices.installAccount')}: ${formatDsid(app.applicationDsid)} · ${t('devices.accountUnmatched')}`
        }
        style={{ color: accountLabel ? 'var(--success)' : 'var(--text-faint)' }}
      >
        {accountLabel || formatDsid(app.applicationDsid)}
      </span>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className="btn btn-ghost btn-icon h-[26px] w-[26px]"
          title={t('devices.search')}
          onClick={search}
        >
          <Icon name="search" size={13} />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon h-[26px] w-[26px]"
          title={t('devices.download')}
          onClick={download}
        >
          <Icon name="download" size={13} />
        </button>
      </div>
    </div>
  )
}

export function DevicesView(): ReactNode {
  const t = useAppStore((state) => state.t)
  const probe = useDevicesStore((state) => state.probe)
  const devices = useDevicesStore((state) => state.devices)
  const selectedUdid = useDevicesStore((state) => state.selectedUdid)
  const apps = useDevicesStore((state) => state.apps)
  const appsLoading = useDevicesStore((state) => state.appsLoading)
  const listLoading = useDevicesStore((state) => state.listLoading)
  const error = useDevicesStore((state) => state.error)
  const filter = useDevicesStore((state) => state.filter)
  const init = useDevicesStore((state) => state.init)
  const installRuntime = useDevicesStore((state) => state.installRuntime)
  const installing = useDevicesStore((state) => state.installing)
  const refreshDevices = useDevicesStore((state) => state.refreshDevices)
  const refreshApps = useDevicesStore((state) => state.refreshApps)
  const select = useDevicesStore((state) => state.select)
  const setFilter = useDevicesStore((state) => state.setFilter)

  useEffect(() => {
    void init()
  }, [init])

  const rows = useMemo(() => filterDeviceApps(apps, filter), [apps, filter])
  const device = devices.find((d) => d.udid === selectedUdid) ?? null
  const keyOf = useCallback((app: DeviceApp) => app.bundleId, [])
  const renderItem = useCallback((app: DeviceApp) => <AppRow app={app} />, [])

  if (probe && !probe.ok) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <EmptyState
          icon="phone"
          title={t('devices.pythonMissing')}
          body={probe.message || t('devices.pythonMissingHelp')}
        >
          {probe.canInstall !== false ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={installing}
              onClick={() => void installRuntime()}
            >
              {installing ? <Spinner size={13} /> : <Icon name="download" size={13} />}
              {installing ? t('devices.installing') : t('devices.install')}
            </button>
          ) : null}
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2.5"
        style={{ borderColor: 'var(--border)' }}
      >
        <span className="text-[12.5px] font-semibold">{t('nav.devices')}</span>
        {probe?.ok ? (
          <span className="faint text-[11px]">
            {probe.source === 'managed' ? t('devices.source.managed') : t('devices.source.system')}
            {probe.version ? ` · ${probe.version}` : ''}
          </span>
        ) : null}
        {device ? (
          <span className="faint text-[11.5px]">
            {device.name || device.productType || t('devices.untitled')} · iOS {device.productVersion || '?'} ·{' '}
            <span className="mono">{device.udid.slice(0, 8)}…</span>
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          {devices.length > 1 ? (
            <select
              className="input input-w-md"
              value={selectedUdid ?? ''}
              onChange={(event) => select(event.target.value || null)}
            >
              {devices.map((d) => (
                <option key={d.udid} value={d.udid}>
                  {d.name || d.productType || d.udid.slice(0, 8)}
                </option>
              ))}
            </select>
          ) : null}

          <input
            className="input input-w-lg"
            placeholder={t('devices.filter')}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            spellCheck={false}
          />

          <button
            type="button"
            className="btn btn-ghost h-[26px]"
            title={t('common.refresh')}
            disabled={listLoading || appsLoading}
            onClick={() => void refreshDevices()}
          >
            {listLoading || appsLoading ? <Spinner size={13} /> : <Icon name="refresh" size={13} />}
          </button>
        </div>
      </div>

      {error ? (
        <div className="border-b px-4 py-2 text-[11.5px]" style={{ color: 'var(--danger)', borderColor: 'var(--border)' }}>
          {error}
          <button type="button" className="btn btn-ghost ml-2 h-[22px]" onClick={() => void refreshApps()}>
            {t('common.refresh')}
          </button>
        </div>
      ) : null}

      {!listLoading && devices.length === 0 && !error ? (
        <EmptyState
          icon="phone"
          title={t('devices.empty.title')}
          body={t('devices.empty.body')}
        />
      ) : null}

      {(listLoading || appsLoading) && rows.length === 0 && !error ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
          <Icon name="phone" size={36} className="faint" />
          <Spinner size={18} />
          <p className="faint text-[12px]">{appsLoading ? t('devices.loadingApps') : t('devices.loadingDevices')}</p>
        </div>
      ) : null}

      {device && apps.length === 0 && !appsLoading && !listLoading && !error ? (
        <EmptyState icon="phone" title={t('devices.noApps.title')} body={t('devices.noApps.body')} />
      ) : null}

      {rows.length > 0 ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className="flex shrink-0 items-center gap-3 px-4 py-1.5 text-[11px] faint"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <span className="flex-1">{t('devices.column.app')}</span>
            <span className="w-[64px] text-right">{t('devices.column.version')}</span>
            <span className="w-[150px] text-right" title={t('devices.installAccountHelp')}>
              {t('devices.installAccount')}
            </span>
            <span className="w-[56px]" />
          </div>
          <VirtualList
            items={rows}
            rowHeight={ROW_HEIGHT}
            keyOf={keyOf}
            renderItem={renderItem}
            className="flex-1"
          />
          <div
            className="faint flex shrink-0 items-center gap-3 border-t px-4 py-1.5 text-[11px]"
            style={{ borderColor: 'var(--border)' }}
          >
            <span>{t('devices.count', { n: rows.length })}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
