import { describe, expect, it, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  checksum: '' as string | Error,
  archive: new Uint8Array([1, 2, 3])
  , extractCalls: 0
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ipatool-engine-test', isReady: () => false }
}))

vi.mock('@main/settings', () => ({
  settingsStore: {
    getInternal: () => ({
      ipatoolPath: '',
      engineVersion: '',
      githubMirror: '',
      autoInstallEngine: true
    })
  }
}))

vi.mock('@main/http', () => ({
  HttpError: class HttpError extends Error {
    constructor(message: string, readonly status: number, readonly url: string) {
      super(message)
    }
  },
  applyMirror: (url: string) => url,
  describeHttpError: (e: Error) => e.message,
  fetchBuffer: async () => state.archive,
  fetchJson: async () => {
    throw new Error('api unavailable')
  },
  fetchText: async (url: string) => {
    if (url.endsWith('.sha256sum')) {
      if (state.checksum instanceof Error) throw state.checksum
      return state.checksum
    }
    return ''
  },
  fetchTextWithFinalUrl: async () => {
    throw new Error('offline')
  }
}))

vi.mock('@main/paths', () => ({
  isExecutable: async () => true,
  isIpatoolBinaryPath: () => true,
  isWindows: () => process.platform === 'win32',
  lookupOnPath: async () => null,
  managedBinaryPath: () => '/tmp/ipatool-engine-test/bin/ipatool',
  managedDir: () => '/tmp/ipatool-engine-test/bin',
  resolveEngine: async () => null,
  expandUserPath: (p: string) => p
}))

vi.mock('@main/runner', () => ({
  run: async () => ({ code: 0, signal: null, killed: false, timedOut: false, stdout: '2.6.0', stderr: '' })
}))

import { EngineManager } from '@main/engine'

const ASSET = 'ipatool-2.6.0-windows-amd64.tar.gz'
const GOOD_HASH = 'a'.repeat(64)

beforeEach(() => {
  state.checksum = `${GOOD_HASH}  ${ASSET}`
  state.extractCalls = 0
})

describe('EngineManager.install checksum policy (audit P1-1)', () => {
  it('refuses to install when the checksum file cannot be fetched', async () => {
    state.checksum = new Error('404 not found')
    const engine = new EngineManager()
    const status = await engine.install('2.6.0', true)

    expect(status.state).toBe('error')
    expect(status.code).toBe('checksum-mismatch')
    expect(status.message).toMatch(/checksum/i)
  })

  it('refuses to install when the checksum body is unparseable', async () => {
    state.checksum = '<html>blocked by proxy</html>'
    const engine = new EngineManager()
    const status = await engine.install('2.6.0', true)

    expect(status.state).toBe('error')
    expect(status.code).toBe('checksum-mismatch')
  })

  it('refuses a sidecar that describes a different asset', async () => {
    state.checksum = `${GOOD_HASH}  ipatool-2.6.0-macos-arm64.tar.gz`
    const engine = new EngineManager()
    const status = await engine.install('2.6.0', true)

    expect(status.state).toBe('error')
    expect(status.message).toMatch(/describes/i)
  })

  it('rejects a downloaded archive whose hash does not match', async () => {
    // Sidecar is well-formed but the bytes differ.
    const engine = new EngineManager()
    const status = await engine.install('2.6.0', true)

    expect(status.state).toBe('error')
    expect(status.code).toBe('checksum-mismatch')
  })
})
