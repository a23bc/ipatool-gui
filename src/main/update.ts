/**
 * Self-update check.
 *
 * Deliberately *not* electron-updater: automatic binary replacement needs code
 * signing on macOS and an update server contract, and a half-working updater is
 * worse than none. Instead we ask GitHub for the newest release tag and let the
 * user decide, linking straight to the release page.
 *
 * The repository slug is injected at build time (`APP_REPO` in CI), so a fork
 * gets update checks against its own repo with no source edits.
 */

import type { UpdateCheckResult } from '../shared/types'
import { isNewer } from '../shared/semver'
import { applyMirror, fetchJson, fetchTextWithFinalUrl } from './http'
import { settingsStore } from './settings'

declare const __APP_VERSION__: string
declare const __APP_REPO__: string

const rawAppVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'
// CI injects the git tag (`v0.2.1`), while package.json carries a bare version.
// Normalising here keeps the UI from rendering "vv0.2.1" and the comparison
// independent of which source the value came from.
export const APP_VERSION: string = rawAppVersion.trim().replace(/^v/i, '') || '0.0.0'
export const APP_REPO: string = typeof __APP_REPO__ === 'string' ? __APP_REPO__ : ''
declare const __APP_PRODUCT__: string
export const APP_PRODUCT: string = typeof __APP_PRODUCT__ === 'string' ? __APP_PRODUCT__ : 'IPATool GUI'

const UPDATE_CHECK_TIMEOUT_MS = 12_000

interface GhRelease {
  tag_name: string
  html_url: string
  published_at: string | null
  prerelease: boolean
}

export function updateCheckAvailable(): boolean {
  return APP_REPO.includes('/')
}

function repoWeb(): string {
  return `https://github.com/${APP_REPO}`
}

/**
 * Newest published tag via the `releases/latest` redirect.
 *
 * The API is tried first because it also reports `published_at`, but
 * api.github.com 403s aggressively on shared/NAT addresses - the same reason
 * engine version discovery avoids it. The web redirect (and a configured
 * mirror) is the fallback that makes the check usable from those networks.
 */
async function latestFromWeb(signal: AbortSignal): Promise<{ latest: string; url: string } | null> {
  const page = `${repoWeb()}/releases/latest`
  const mirror = settingsStore.getInternal().githubMirror.trim()
  const candidates = [mirror !== '' ? applyMirror(page, mirror) : null, page]

  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const { text, url } = await fetchTextWithFinalUrl(candidate, { signal })
      // Stop the capture at URL/HTML delimiters: the tag also appears in
      // links (`.../tag/v0.5.0"`) and a permissive class would keep the quote.
      const tag =
        url.match(/\/releases\/tag\/([^/?#"'<>\s]+)/)?.[1] ??
        text.match(/\/releases\/tag\/([^/?#"'<>\s]+)/)?.[1]
      if (!tag) continue
      const latest = decodeURIComponent(tag).replace(/^v/i, '')
      if (latest === '') continue
      return { latest, url: `${repoWeb()}/releases/tag/${tag}` }
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

export async function checkAppUpdate(): Promise<UpdateCheckResult> {
  const base: UpdateCheckResult = {
    current: APP_VERSION,
    latest: null,
    hasUpdate: false,
    url: null,
    publishedAt: null,
    error: null
  }

  if (!updateCheckAvailable()) {
    return { ...base, error: 'update-check-not-configured' }
  }

  // api.github.com can hang on bad networks; without a deadline the Settings
  // button would spin forever.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS)
  timer.unref?.()

  try {
    try {
      const release = await fetchJson<GhRelease>(
        `https://api.github.com/repos/${APP_REPO}/releases/latest`,
        { signal: controller.signal }
      )
      const latest = release?.tag_name?.replace(/^v/i, '') ?? ''
      if (latest !== '') {
        return {
          current: APP_VERSION,
          latest,
          hasUpdate: isNewer(latest, APP_VERSION),
          url: release.html_url || `${repoWeb()}/releases/latest`,
          publishedAt: release.published_at ?? null,
          error: null
        }
      }
    } catch {
      /* rate-limited or unreachable; the web redirect below is the fallback */
    }

    const web = await latestFromWeb(controller.signal)
    if (!web) return { ...base, error: 'no-release' }
    return {
      current: APP_VERSION,
      latest: web.latest,
      hasUpdate: isNewer(web.latest, APP_VERSION),
      url: web.url,
      publishedAt: null,
      error: null
    }
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}
