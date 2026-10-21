/**
 * IPC trust-boundary handlers (audit P2-16).
 *
 * src/main/ipc.ts was at 0% coverage while implementing the documented security
 * model: the fs:open-path allow-list, the run:raw subcommand allow-list and the
 * queue-action validation. These tests register the real handlers against a
 * stubbed ipcMain and call them, so a regression in an allow-list fails the
 * build instead of shipping.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const state = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  opened: [] as string[],
  userData: '/tmp/ipatool-ipc-userdata',
  downloadDir: '/tmp/ipatool-ipc-downloads',
  rawCalls: [] as string[][],
  queueControl: [] as Array<[string, string]>,
  installCalls: [] as Array<[string, boolean]>
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  clipboard: { writeText: () => {} },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true })
  },
  ipcMain: {
    handle: (channel: string, handler: Handler) => state.handlers.set(channel, handler),
    on: (channel: string, handler: Handler) => state.handlers.set(channel, handler)
  },
  shell: {
    openPath: async (target: string) => {
      state.opened.push(target)
      return ''
    },
    showItemInFolder: (target: string) => state.opened.push(target),
    openExternal: async (url: string) => {
      state.opened.push(url)
    }
  },
  nativeTheme: { themeSource: 'system', shouldUseDarkColors: false, on: () => {} },
  app: {
    getPath: (name: string) => (name === 'userData' ? state.userData : '/tmp/ipatool-ipc-other'),
    getLocale: () => 'en-US',
    getAppPath: () => '/tmp/ipatool-ipc-app',
    isPackaged: false
  },
  Notification: { isSupported: () => false }
}))

vi.mock('@main/settings', () => ({
  settingsStore: {
    get: () => ({ downloadDir: state.downloadDir }),
    getInternal: () => ({
      downloadDir: state.downloadDir,
      concurrency: 2,
      maxLogLines: 2000,
      notifyOnComplete: false,
      locale: 'en-US',
      theme: 'system',
      artworkEnabled: true,
      artworkCountry: 'us',
      ipatoolPath: '',
      engineVersion: '',
      githubMirror: '',
      autoInstallEngine: true
    }),
    update: (patch: unknown) => patch,
    reset: () => ({}),
    on: () => {}
  }
}))

vi.mock('@main/accounts', () => ({
  accounts: {
    snapshot: async () => ({
      accounts: [],
      activeId: '',
      credentialSlot: 'file',
      slotBridge: 'not-needed',
      slotDetail: '',
      legacy: null
    }),
    add: () => {},
    get: () => null,
    activeId: 'a1bcdefg',
    setRemark: () => {},
    remove: async () => ({ removedDir: false, path: null }),
    clearSnapshot: async () => {},
    markIdentity: () => {}
  },
  AccountError: class AccountError extends Error {
    constructor(message: string, readonly code: string) {
      super(message)
    }
  },
  assertAccountId: (value: unknown) => {
    const id = typeof value === 'string' ? value.trim() : ''
    if (!/^a[0-9a-z]{6,40}$/.test(id)) throw new Error('bad account id')
    return id
  }
}))

vi.mock('@main/api', () => {
  class ApiError extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly taskId = '',
      readonly exitCode: number | null = null
    ) {
      super(message)
    }
  }
  return {
    ApiError,
    ipatoolApi: {
      runRaw: async (args: string[]) => {
        state.rawCalls.push(args)
        return 'ok'
      },
      search: async () => ({ count: 0, apps: [] }),
      listVersions: async () => ({ bundleID: '', externalVersionIdentifiers: [] }),
      getVersionMetadata: async () => ({ externalVersionID: '', displayVersion: '' }),
      listPurchases: async () => ({ count: 0, totalCount: 0, page: 1, apps: [] }),
      purchase: async () => ({ alreadyOwned: false }),
      login: async () => ({ status: 'ok', account: null, message: '', taskId: 't' }),
      accountInfoOrNull: async () => null,
      revoke: async () => ({ revoked: true })
    }
  }
})

vi.mock('@main/artwork', () => ({ artworkCache: { get: async () => null, clear: async () => 0 } }))

vi.mock('@main/queue', () => ({
  downloadQueue: {
    snapshot: () => ({ items: [], concurrency: 2, active: 0 }),
    enqueue: () => [],
    control: (id: string, action: string) => {
      state.queueControl.push([id, action])
    },
    clearFinished: () => {},
    setConcurrency: () => {},
    deletePartial: async () => ({ deleted: false, path: null })
  }
}))

vi.mock('@main/engine', () => {
  class EngineError extends Error {
    constructor(message: string, readonly code: string) {
      super(message)
    }
  }
  return {
    EngineError,
    engineManager: {
      state: {
        state: 'idle',
        path: null,
        version: null,
        source: null,
        message: null,
        code: null,
        download: null
      },
      detect: async () => ({ state: 'idle' }),
      install: (version: string, force: boolean) => {
        state.installCalls.push([version, force])
        return { state: 'idle' }
      },
      uninstall: async () => ({ state: 'idle' }),
      releases: async () => [],
      checkUpdate: async () => ({ current: '', latest: null, hasUpdate: false, error: null }),
      on: () => {}
    }
  }
})

vi.mock('@main/session', () => ({
  afterLogin: async () => {},
  refreshAll: async () => {},
  switchTo: async () => ({ snapshot: {}, check: {} }),
  verifySession: async () => ({ status: 'ok', account: null, expected: '', message: '' })
}))

vi.mock('@main/tasks', () => ({
  taskRegistry: { list: () => [], get: () => null, clear: () => {}, cancel: () => {}, on: () => {}, setLineCap: () => {} }
}))
vi.mock('@main/update', () => ({
  APP_PRODUCT: 'IPATool GUI',
  APP_VERSION: '0.1.1',
  checkAppUpdate: async () => ({})
}))
vi.mock('@main/window', () => ({ syncTitleBarOverlay: () => {} }))
vi.mock('@main/paths', () => ({ expandUserPath: (value: string) => value }))

import { registerIpc } from '@main/ipc'

function call(channel: string, ...args: unknown[]): unknown {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error('no handler for ' + channel)
  return handler({}, ...args)
}

beforeEach(() => {
  state.handlers.clear()
  state.opened.length = 0
  state.rawCalls.length = 0
  state.queueControl.length = 0
  state.installCalls.length = 0
  registerIpc()
})

describe('fs:open-path allow-list (audit P2-16)', () => {
  it('opens a package inside the download directory', async () => {
    // path.resolve() runs on the host, so compare on the resolved tail rather
    // than on the raw string: Windows turns /tmp/... into C:\tmp\...
    const target = state.downloadDir + '/App.ipa'
    await expect(call('fs:open-path', target)).resolves.toBe('')
    expect(state.opened).toHaveLength(1)
    expect(state.opened[0]).toMatch(/App\.ipa$/)
  })

  it('refuses a path outside the allowed roots', async () => {
    await expect(call('fs:open-path', '/etc/passwd')).rejects.toThrow(/Refused/)
    expect(state.opened).toHaveLength(0)
  })

  it('refuses an executable extension even inside the download directory', async () => {
    await expect(call('fs:open-path', state.downloadDir + '/evil.exe')).rejects.toThrow(/extension/)
    expect(state.opened).toHaveLength(0)
  })

  it('refuses an empty path', async () => {
    await expect(call('fs:open-path', '   ')).rejects.toThrow(/No path given/)
  })
})

describe('run:raw subcommand allow-list (audit P2-16)', () => {
  it('allows the read-only subcommands', async () => {
    for (const sub of ['search', 'list-versions', 'list-purchases', 'get-version-metadata']) {
      state.rawCalls.length = 0
      const result = (await call('run:raw', { args: [sub, 'x'] })) as { ok: boolean }
      expect(result.ok, sub).toBe(true)
      expect(state.rawCalls).toHaveLength(1)
    }
  })

  it('allows auth info but not auth login/revoke', async () => {
    const info = (await call('run:raw', { args: ['auth', 'info'] })) as { ok: boolean }
    expect(info.ok).toBe(true)

    for (const sub of ['login', 'revoke']) {
      const refused = (await call('run:raw', { args: ['auth', sub] })) as { ok: boolean; error: string }
      expect(refused.ok, sub).toBe(false)
      expect(refused.error).toMatch(/dedicated sign-in/)
    }
  })

  it('refuses write-side subcommands', async () => {
    for (const sub of ['download', 'purchase', 'install', 'rm']) {
      const refused = (await call('run:raw', { args: [sub] })) as { ok: boolean; error: string }
      expect(refused.ok, sub).toBe(false)
      expect(refused.error).toMatch(/read-only/)
    }
  })
})

describe('queue:control action validation (audit P2-16)', () => {
  it('forwards a known action', async () => {
    await call('queue:control', 'd1', 'pause')
    expect(state.queueControl).toEqual([['d1', 'pause']])
  })

  it('drops an unknown action instead of forwarding it', async () => {
    await call('queue:control', 'd1', 'rm -rf /')
    expect(state.queueControl).toHaveLength(0)
  })
})

describe('engine:install version validation (audit P2-16)', () => {
  it('forwards a real version', async () => {
    await call('engine:install', '2.6.0', true)
    expect(state.installCalls).toEqual([['2.6.0', true]])
  })

  it('refuses a traversal-shaped version', async () => {
    const result = (await call('engine:install', '../../evil', true)) as { state: string }
    expect(result.state).toBe('error')
    expect(state.installCalls).toHaveLength(0)
  })
})