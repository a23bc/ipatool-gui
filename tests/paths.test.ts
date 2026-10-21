/**
 * paths.ts unit tests: the gate that decides what the engine is allowed to run.
 *
 * Regression coverage for the P0 finding in the repository audit: `ipatoolPath`
 * is renderer-writable via `settings:update`, and whatever `resolveEngine`
 * returns is spawned. These tests pin the two properties that make that safe -
 * the basename must be ipatool, and on Windows only a real .exe can run - so a
 * future refactor cannot quietly reopen the hole.
 */
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ root: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => path.join(mocks.root, name),
    isReady: () => false
  }
}))

import { binaryName, isExecutable, isIpatoolBinaryPath, resolveEngine } from '@main/paths'

const isWindowsHost = process.platform === 'win32'

/** Creates an executable-looking file at `filePath`. */
function makeExecutable(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, 'stub', 'utf8')
  if (!isWindowsHost) chmodSync(filePath, 0o755)
}

beforeEach(() => {
  mocks.root = mkdtempSync(path.join(os.tmpdir(), 'ipatool-paths-'))
})

describe('isIpatoolBinaryPath', () => {
  it('accepts the exact binary name the app installs', () => {
    expect(isIpatoolBinaryPath(path.join('/opt/homebrew/bin', binaryName()))).toBe(true)
    expect(isIpatoolBinaryPath(binaryName())).toBe(true)
  })

  it('rejects any other program name, regardless of directory', () => {
    // The audit's repro used whoami.exe; calc.exe and a shell are the same class.
    for (const name of ['whoami.exe', 'calc.exe', 'cmd.exe', 'sh', 'bash', 'ipatool.sh', 'ipatool.exe.bak']) {
      expect(isIpatoolBinaryPath(path.join('/usr/bin', name))).toBe(false)
    }
  })

  it('is not fooled by a directory that merely contains the name', () => {
    expect(isIpatoolBinaryPath(path.join('/tmp', 'ipatool', 'evil.exe'))).toBe(false)
  })
})

describe('isExecutable', () => {
  it('returns false for a path that does not exist', async () => {
    expect(await isExecutable(path.join(mocks.root, 'missing', binaryName()))).toBe(false)
  })

  it('accepts a readable real binary and rejects a non-exe on Windows', async () => {
    const exe = path.join(mocks.root, 'bin', binaryName())
    makeExecutable(exe)
    expect(await isExecutable(exe)).toBe(true)

    if (isWindowsHost) {
      // Windows has no executable bit; the extension is the only signal, and the
      // runner spawns without a shell so .bat/.cmd could never work anyway.
      const script = path.join(mocks.root, 'bin', 'ipatool.bat')
      makeExecutable(script)
      expect(await isExecutable(script)).toBe(false)
      const text = path.join(mocks.root, 'bin', 'ipatool.txt')
      makeExecutable(text)
      expect(await isExecutable(text)).toBe(false)
    }
  })
})

describe('resolveEngine', () => {
  it('honours an explicit override that points at a real ipatool binary', async () => {
    const bin = path.join(mocks.root, 'custom', binaryName())
    makeExecutable(bin)
    const resolved = await resolveEngine(bin)
    expect(resolved).toEqual({ path: bin, source: 'settings' })
  })

  it('accepts an override that is a directory containing ipatool', async () => {
    const dir = path.join(mocks.root, 'custom-dir')
    makeExecutable(path.join(dir, binaryName()))
    const resolved = await resolveEngine(dir)
    expect(resolved).toEqual({ path: path.join(dir, binaryName()), source: 'settings' })
  })

  it('REFUSES an override whose basename is not ipatool (the P0 regression)', async () => {
    // Exactly what a compromised renderer could write via settings:update.
    const evil = path.join(mocks.root, 'custom', isWindowsHost ? 'whoami.exe' : 'sh')
    makeExecutable(evil)

    const resolved = await resolveEngine(evil)
    // It must not be returned as a settings override. Any other source is fine
    // (e.g. a real ipatool later on PATH) - what matters is that the attacker
    // path never wins.
    expect(resolved?.path).not.toBe(evil)
    expect(resolved?.source).not.toBe('settings')
  })

  it('does not fall back to a sibling binary when the override is a foreign file', async () => {
    const dir = path.join(mocks.root, 'mixed')
    makeExecutable(path.join(dir, 'calc.exe'))
    // No ipatool next to it, so the override contributes nothing. Whatever comes
    // back (a real ipatool elsewhere on this machine, or null) must never be the
    // file the caller asked for.
    const resolved = await resolveEngine(path.join(dir, 'calc.exe'))
    expect(resolved?.path ?? '').not.toContain('calc.exe')
  })
})
