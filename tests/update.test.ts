/**
 * Self-update check tests.
 *
 * update.ts reads its build-time constants as bare identifiers, so each case
 * stubs `__APP_REPO__` / `__APP_VERSION__` on globalThis and loads a fresh
 * module instance to pick them up. Network helpers and the settings store are
 * mocked; nothing here touches the network.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mirror: '',
  fetchJson: vi.fn(),
  fetchText: vi.fn()
}))

vi.mock('electron', () => ({
  app: { isReady: () => false },
  net: {}
}))

vi.mock('@main/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/http')>()
  return {
    ...actual,
    fetchJson: mocks.fetchJson,
    fetchTextWithFinalUrl: mocks.fetchText
  }
})

vi.mock('@main/settings', () => ({
  settingsStore: { getInternal: () => ({ githubMirror: mocks.mirror }) }
}))

async function load(repo: string, version = 'v0.2.0') {
  vi.stubGlobal('__APP_REPO__', repo)
  vi.stubGlobal('__APP_VERSION__', version)
  vi.resetModules()
  return import('@main/update')
}

beforeEach(() => {
  mocks.mirror = ''
  mocks.fetchJson.mockReset()
  mocks.fetchText.mockReset()
})

describe('checkAppUpdate', () => {
  it('reports not configured when the build has no repo slug', async () => {
    const update = await load('')
    expect(update.updateCheckAvailable()).toBe(false)

    const result = await update.checkAppUpdate()
    expect(result.error).toBe('update-check-not-configured')
    expect(mocks.fetchJson).not.toHaveBeenCalled()
    expect(mocks.fetchText).not.toHaveBeenCalled()
  })

  it('normalises the injected tag and reports a newer release', async () => {
    const update = await load('a23bc/ipatool-gui', 'v0.2.0')
    expect(update.APP_VERSION).toBe('0.2.0')

    mocks.fetchJson.mockResolvedValue({
      tag_name: 'v0.3.0',
      html_url: 'https://github.com/a23bc/ipatool-gui/releases/tag/v0.3.0',
      published_at: '2026-10-01T00:00:00Z',
      prerelease: false
    })

    const result = await update.checkAppUpdate()
    expect(result).toEqual({
      current: '0.2.0',
      latest: '0.3.0',
      hasUpdate: true,
      url: 'https://github.com/a23bc/ipatool-gui/releases/tag/v0.3.0',
      publishedAt: '2026-10-01T00:00:00Z',
      error: null
    })
    expect(mocks.fetchText).not.toHaveBeenCalled()
  })

  it('is not fooled by the same tag with and without the v prefix', async () => {
    const update = await load('a23bc/ipatool-gui', 'v0.2.0')
    mocks.fetchJson.mockResolvedValue({
      tag_name: '0.2.0',
      html_url: 'https://github.com/a23bc/ipatool-gui/releases/tag/v0.2.0',
      published_at: null,
      prerelease: false
    })

    const result = await update.checkAppUpdate()
    expect(result.hasUpdate).toBe(false)
  })

  it('falls back to the releases/latest redirect when the API is rate-limited', async () => {
    const update = await load('a23bc/ipatool-gui')
    mocks.fetchJson.mockRejectedValue(new Error('HTTP 403 Rate limited'))
    mocks.fetchText.mockResolvedValue({
      text: '',
      url: 'https://github.com/a23bc/ipatool-gui/releases/tag/v0.4.0'
    })

    const result = await update.checkAppUpdate()
    expect(result.latest).toBe('0.4.0')
    expect(result.hasUpdate).toBe(true)
    expect(result.url).toBe('https://github.com/a23bc/ipatool-gui/releases/tag/v0.4.0')
    expect(mocks.fetchText).toHaveBeenCalledWith(
      'https://github.com/a23bc/ipatool-gui/releases/latest',
      expect.anything()
    )
  })

  it('tries the configured GitHub mirror first and can parse the tag from the page body', async () => {
    mocks.mirror = 'https://ghproxy.example'
    const update = await load('a23bc/ipatool-gui')
    mocks.fetchJson.mockRejectedValue(new Error('HTTP 403 Rate limited'))
    mocks.fetchText.mockResolvedValue({
      text: '<a href="/a23bc/ipatool-gui/releases/tag/v0.5.0">release</a>',
      url: 'https://ghproxy.example/https://github.com/a23bc/ipatool-gui/releases/latest'
    })

    const result = await update.checkAppUpdate()
    expect(mocks.fetchText).toHaveBeenCalledTimes(1)
    expect(mocks.fetchText).toHaveBeenCalledWith(
      'https://ghproxy.example/https://github.com/a23bc/ipatool-gui/releases/latest',
      expect.anything()
    )
    expect(result.latest).toBe('0.5.0')
    expect(result.url).toBe('https://github.com/a23bc/ipatool-gui/releases/tag/v0.5.0')
  })

  it('reports no-release when neither the API nor the release page works', async () => {
    const update = await load('a23bc/ipatool-gui')
    mocks.fetchJson.mockRejectedValue(new Error('offline'))
    mocks.fetchText.mockRejectedValue(new Error('offline'))

    const result = await update.checkAppUpdate()
    expect(result.error).toBe('no-release')
    expect(result.latest).toBeNull()
    expect(result.hasUpdate).toBe(false)
  })
})
