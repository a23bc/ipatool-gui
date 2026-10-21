/**
 * Runtime validation for values that cross the IPC boundary.
 *
 * TypeScript types evaporate at the boundary: everything a renderer sends is an
 * untyped JSON value by the time a main-process handler sees it. The audit found
 * four places where such a value was used as a path component or a URL segment
 * without a check (artwork country, queue outputDir, engine install version, and
 * the version tag used to build the engine's temp file name). Keeping the checks
 * here - pure, unit-tested, importable from either process - means a new caller
 * cannot quietly reintroduce one of them.
 *
 * Every function returns a *sanitised* value or null; callers decide whether a
 * rejection is an error or a silent fallback.
 */

/** A two-letter ISO country code, as used by the iTunes lookup endpoint. */
const COUNTRY_CODE = /^[a-z]{2}$/

/**
 * Normalises a storefront country code.
 *
 * The value reaches `path.join` as part of the artwork cache file name, so it
 * must never be able to introduce a separator or a traversal segment. Anything
 * that is not exactly two ASCII letters is rejected rather than coerced.
 */
export function safeCountryCode(input: unknown, fallback = 'us'): string {
  const raw = typeof input === 'string' ? input.trim().toLowerCase() : ''
  if (COUNTRY_CODE.test(raw)) return raw
  return COUNTRY_CODE.test(fallback) ? fallback : 'us'
}

/**
 * True when `value` is a plausible ipatool release version.
 *
 * Used for the install version, which is interpolated into a GitHub release URL
 * (`.../releases/download/v<version>/<asset>`) *and* into the temp file name
 * beside the managed binary. `..` in either place escapes the intended path, so
 * only digits, dots and a single optional pre-release suffix are allowed.
 */
export function isSafeVersionString(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > 64) return false
  return /^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]{1,32})?$/.test(trimmed)
}

/** Returns the version when safe, otherwise ''. */
export function safeVersionString(input: unknown): string {
  return isSafeVersionString(input) ? input.trim() : ''
}

/**
 * True when `candidate` is `root` itself or lives inside it.
 *
 * Both paths are expected to be already resolved (absolute, normalised). The
 * comparison is case-insensitive on Windows, where paths are - the audit found
 * the previous raw `startsWith` check rejecting a legitimate `c:\...` target
 * under a `C:\...` root. The trailing separator is matched against whichever
 * separator `root` itself uses, so this works for POSIX and Windows alike
 * without needing `path` (and therefore stays testable on any host).
 */
export function isInsideRoot(candidate: string, root: string, caseInsensitive: boolean): boolean {
  const normalise = (value: string): string => (caseInsensitive ? value.toLowerCase() : value)
  const target = normalise(candidate)
  const base = normalise(root)
  if (base === '') return false
  if (target === base) return true

  // The candidate must continue past the root with a separator. Which separator
  // is used is decided by the candidate (it may be `/` or `\\` on Windows), not
  // by the root - a root that happens to end in a letter would otherwise demand
  // the wrong one. A root already ending in a separator must not gain another.
  const rootEndsWithSeparator = base.endsWith('/') || base.endsWith('\\')
  const rest = target.slice(base.length)
  if (!target.startsWith(base)) return false
  if (rootEndsWithSeparator) return rest.length > 0
  return rest.startsWith('/') || rest.startsWith('\\')
}
