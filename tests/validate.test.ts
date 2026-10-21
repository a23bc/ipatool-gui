/**
 * Runtime validation helpers (audit P2-1, P2-2, P2-3, P2-6).
 *
 * Everything here is pure, so the tests double as documentation of exactly what
 * a value crossing the IPC boundary is allowed to look like. Each case is taken
 * from the audit: the artwork country and the engine version were both proven to
 * escape their intended path with a traversal segment.
 */

import { describe, expect, it } from 'vitest'
import { isInsideRoot, isSafeVersionString, safeCountryCode, safeVersionString } from '@shared/validate'

describe('safeCountryCode', () => {
  it('accepts a two-letter code in any case, trimming whitespace', () => {
    expect(safeCountryCode('us')).toBe('us')
    expect(safeCountryCode('US')).toBe('us')
    expect(safeCountryCode(' uk ')).toBe('uk')
    expect(safeCountryCode('DE')).toBe('de')
  })

  it('rejects anything that could act as a path segment', () => {
    // The audit's exact payload: country '..\\..\\..\\..\\Users\\Public\\x'
    // used to escape userData/artwork through path.join.
    for (const hostile of [
      '..',
      '../../etc',
      '..\\..\\evil',
      '/etc/passwd',
      'C:\\Windows',
      'u',
      'usa',
      '1a',
      '',
      'u s'
    ]) {
      expect(safeCountryCode(hostile)).toBe('us')
    }
  })

  it('falls back for non-strings', () => {
    for (const value of [null, undefined, 42, {}, []]) {
      expect(safeCountryCode(value)).toBe('us')
    }
  })

  it('honours a custom fallback and still refuses an unsafe one', () => {
    expect(safeCountryCode(undefined, 'cn')).toBe('cn')
    expect(safeCountryCode(undefined, '../evil')).toBe('us')
  })
})

describe('isSafeVersionString', () => {
  it('accepts real ipatool version shapes', () => {
    expect(isSafeVersionString('2.6.0')).toBe(true)
    expect(isSafeVersionString('2.6.0-rc1')).toBe(true)
    expect(isSafeVersionString('2.6.0.1')).toBe(true)
    expect(isSafeVersionString('10.0.0-alpha.2')).toBe(true)
  })

  it('rejects traversal, query delimiters and separators', () => {
    // The audit proved '..' + '?' could redirect BOTH the asset and the
    // canonical checksum URL onto another repository.
    for (const hostile of [
      '../../../../eviluser/evilrepo/releases/download/v1',
      '2.6.0?x=',
      '2.6.0/../../evil',
      '..\\..\\evil',
      'v2.6.0',
      '1.2',
      '',
      'a'.repeat(200)
    ]) {
      expect(isSafeVersionString(hostile)).toBe(false)
    }
  })

  it('rejects non-strings', () => {
    for (const value of [null, undefined, 2.6, {}]) {
      expect(isSafeVersionString(value)).toBe(false)
    }
  })

  it('safeVersionString returns the trimmed value or empty string', () => {
    expect(safeVersionString('  2.6.0  ')).toBe('2.6.0')
    expect(safeVersionString('../../evil')).toBe('')
    expect(safeVersionString(undefined)).toBe('')
  })
})

describe('isInsideRoot', () => {
  const BS = String.fromCharCode(92)
  const win = (value: string): string => value.split('/').join(BS)

  it('accepts the root itself and its children (POSIX)', () => {
    expect(isInsideRoot('/a/b', '/a/b', false)).toBe(true)
    expect(isInsideRoot('/a/b/c.ipa', '/a/b', false)).toBe(true)
    expect(isInsideRoot('/a/b/deep/er/file', '/a/b', false)).toBe(true)
  })

  it('rejects siblings, traversal and the empty root (POSIX)', () => {
    expect(isInsideRoot('/a/bc/x', '/a/b', false)).toBe(false)
    expect(isInsideRoot('/a/x', '/a/b', false)).toBe(false)
    expect(isInsideRoot('/a/b', '', false)).toBe(false)
  })

  it('is case-insensitive when asked (the Windows regression)', () => {
    // The audit found the old raw startsWith check rejecting a legitimate
    // c:\... target under a C:\... root.
    const target = win('c:/Users/X/Downloads/a.ipa')
    const root = win('C:/Users/X/Downloads')
    expect(isInsideRoot(target, root, true)).toBe(true)
    expect(isInsideRoot(target, root, false)).toBe(false)
  })

  it('still rejects a prefix escape on Windows', () => {
    const root = win('C:/Users/X/Downloads')
    expect(isInsideRoot(win('C:/Users/X/Downloads-evil/a.ipa'), root, true)).toBe(false)
    expect(isInsideRoot(win('C:/Users/X/Other/a.ipa'), root, true)).toBe(false)
  })

  it('handles a root that already ends with a separator', () => {
    expect(isInsideRoot('/a/b/c', '/a/b/', false)).toBe(true)
    expect(isInsideRoot('/a/b/', '/a/b/', false)).toBe(true)
    expect(isInsideRoot(win('C:/x/y'), win('C:/x/'), true)).toBe(true)
  })
})
