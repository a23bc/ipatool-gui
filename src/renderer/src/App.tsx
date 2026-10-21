import { useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useAppStore } from '@renderer/store/app'
import { useQueueStore } from '@renderer/store/queue'
import { initPurchasesSession } from '@renderer/store/purchases'
import { initSearchSession } from '@renderer/store/search'
import { useTasksStore } from '@renderer/store/tasks'
import { useUiStore, VIEWS, type View } from '@renderer/store/ui'
import { CommandPalette } from '@renderer/components/CommandPalette'
import { AccountManager } from '@renderer/components/AccountManager'
import { ConfirmDialog } from '@renderer/components/ConfirmDialog'
import { EngineSetup } from '@renderer/components/EngineSetup'
import { Header, StatusBar } from '@renderer/components/Header'
import { Sidebar } from '@renderer/components/Sidebar'
import { Spinner } from '@renderer/components/Icon'
import { Toasts } from '@renderer/components/Toasts'
import { VersionsDrawer } from '@renderer/components/VersionsDrawer'
import { ActivityView } from '@renderer/pages/ActivityView'
import { AuthModal } from '@renderer/pages/AuthModal'
import { ConsoleView } from '@renderer/pages/ConsoleView'
import { DownloadsView } from '@renderer/pages/DownloadsView'
import { PurchasesView } from '@renderer/pages/PurchasesView'
import { SearchView } from '@renderer/pages/SearchView'
import { SettingsView } from '@renderer/pages/SettingsView'

/** First-paint placeholder while the stores are booting. */
function BootLoading(): ReactNode {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <Spinner size={20} />
      <p className="faint text-[12px]">{useAppStore.getState().t('common.loading')}</p>
    </div>
  )
}

/**
 * Shown when the initial IPC round-trip failed.
 *
 * The old behaviour was an endless spinner: `init()` set its latch before the
 * await, so the failure could never be retried and the window looked hung. A
 * failed boot is almost always transient (main process still starting, a handler
 * not registered yet), so the primary action is a retry.
 */
function BootError({ message, onRetry }: { message: string; onRetry: () => void }): ReactNode {
  const t = useAppStore((state) => state.t)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-[13px] font-medium">{t('boot.failed.title')}</p>
      <p className="faint max-w-[520px] text-[12px] leading-relaxed">{t('boot.failed.body')}</p>
      <pre
        className="mono max-h-[140px] max-w-[520px] overflow-auto whitespace-pre-wrap break-words rounded-md border px-3 py-2 text-[11.5px]"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)', color: 'var(--danger)' }}
      >
        {message}
      </pre>
      <button type="button" className="btn btn-primary" onClick={onRetry}>
        {t('common.retry')}
      </button>
    </div>
  )
}

/** Digit shortcuts map onto sidebar order, so 1..6 jumps between views. */
const VIEW_SHORTCUTS: Record<string, View> = {
  '1': 'search',
  '2': 'purchases',
  '3': 'downloads',
  '4': 'activity',
  '5': 'console'
}

function CurrentView({ view }: { view: View }): ReactNode {
  switch (view) {
    case 'search':
      return <SearchView />
    case 'purchases':
      return <PurchasesView />
    case 'downloads':
      return <DownloadsView />
    case 'activity':
      return <ActivityView />
    case 'console':
      return <ConsoleView />
    case 'settings':
      return <SettingsView />
    default:
      return <SearchView />
  }
}

export function App(): ReactNode {
  const ready = useAppStore((state) => state.ready)
  const bootError = useAppStore((state) => state.bootError)
  const initApp = useAppStore((state) => state.init)
  const retryBoot = useCallback(() => {
    // init() clears its own latch on failure, so a second call is a real retry.
    void initApp().catch((error: unknown) => {
      console.error('[renderer] retry failed', error)
    })
  }, [initApp])
  const initQueue = useQueueStore((state) => state.init)
  const initTasks = useTasksStore((state) => state.init)
  const view = useUiStore((state) => state.view)
  const setView = useUiStore((state) => state.setView)
  const versionsFor = useUiStore((state) => state.versionsFor)

  // Boot the stores. Each store guards against double-initialisation, so this is
  // safe under StrictMode's double effect invocation.
  useEffect(() => {
    void (async () => {
      await initApp()
      // Only boot the per-view stores once the app store actually came up: if it
      // failed, `bootError` is set and the retry button re-runs this effect, so
      // queue/task listeners are registered exactly once on the successful path.
      if (!useAppStore.getState().ready) return
      await Promise.all([initQueue(), initTasks()])
    })().catch((error: unknown) => {
      // The store handles its own boot failure; this is the last line of defence
      // against an unhandled rejection from the queue/task initialisers.
      console.error('[renderer] store initialisation failed', error)
    })
  }, [initApp, initQueue, initTasks])

  // Bind the stores that hold per-account data to the active account. Search
  // results and the owned-apps list both belong to exactly one Apple ID, so a
  // switch has to drop them; subscribing here (rather than in each view) means the
  // reset also happens while another view is on screen.
  useEffect(() => {
    const disposers = [initSearchSession(), initPurchasesSession()]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, [])

  // Global shortcuts: Ctrl/Cmd+1..5 switch views, Ctrl/Cmd+, opens settings.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return
      const target = event.target as HTMLElement | null
      const typing =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      if (event.key === ',') {
        event.preventDefault()
        setView('settings')
        return
      }
      // Allow digit shortcuts while typing so they stay discoverable, but never
      // swallow them inside the palette's own input.
      if (typing && useUiStore.getState().paletteOpen) return
      const mapped = VIEW_SHORTCUTS[event.key]
      if (mapped) {
        event.preventDefault()
        setView(mapped)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView])

  // (No global Escape handler here on purpose: it used to call
  // setPaletteOpen(false) only when the palette was already closed - a no-op.
  // The overlays that need Escape each own a handler: Modal captures it at the
  // document level, CommandPalette and VersionsDrawer listen on window.)

  if (!ready) {
    return bootError ? <BootError message={bootError} onRetry={retryBoot} /> : <BootLoading />
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Header />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col" style={{ background: 'var(--bg)' }}>
          <CurrentView view={view} />
        </main>
      </div>
      <StatusBar />

      {/* Overlays. Order matters for stacking: drawer under palette. */}
      {versionsFor ? <VersionsDrawer /> : null}
      <EngineSetup />
      <AccountManager />
      <AuthModal />
      <CommandPalette />
      <ConfirmDialog />
      <Toasts />
    </div>
  )
}

export { VIEWS }
