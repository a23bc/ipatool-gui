/**
 * iOS device bridge (pymobiledevice3).
 *
 * Runtime policy:
 *  1. If `pymobiledevice3` is already on PATH (pipx, scoop, user install), use it.
 *  2. Otherwise use a managed venv under userData (`devices-venv`) and install
 *     pymobiledevice3 there on demand.
 *
 * The Electron process never talks to lockdown itself: it runs
 * `python/devices/main.py`, which wraps pymobiledevice3 and prints one JSON
 * object per call. The script ships in `extraResources` (not asar) because
 * CPython opens it by filesystem path.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { DeviceApp, DeviceInfo, DevicesProbe, Operation } from '../shared/types'

const BRIDGE_TIMEOUT_MS = 120_000
const INSTALL_TIMEOUT_MS = 300_000
const PIN = 'pymobiledevice3>=11,<12'

interface BridgeOk<T> {
  ok: true
  command: string
  data: T
}
interface BridgeFail {
  ok: false
  code: string
  message: string
  [key: string]: unknown
}
type BridgePayload<T> = BridgeOk<T> | BridgeFail

export interface ToolRuntime {
  /** Interpreter used to run the bridge. */
  python: string
  /** Extra args before the script (e.g. ['-3'] for the Windows py launcher). */
  pythonArgs: string[]
  /** Where pymobiledevice3 itself comes from. */
  source: 'system' | 'managed'
  /** PATH additions so the bridge can `which pymobiledevice3`. */
  pathPrefix: string[]
}

/** Devices bridge script: unpacked resources first, then dev tree. */
function bridgeScript(): string {
  const resources = path.join(process.resourcesPath, 'python', 'devices', 'main.py')
  const dev = path.join(app.getAppPath(), 'python', 'devices', 'main.py')
  if (existsSync(resources)) return resources
  if (existsSync(dev)) return dev
  return resources
}

export function managedVenvDir(): string {
  return path.join(app.getPath('userData'), 'devices-venv')
}

function venvPython(): string {
  return process.platform === 'win32'
    ? path.join(managedVenvDir(), 'Scripts', 'python.exe')
    : path.join(managedVenvDir(), 'bin', 'python3')
}

function venvScriptsDir(): string {
  return process.platform === 'win32'
    ? path.join(managedVenvDir(), 'Scripts')
    : path.join(managedVenvDir(), 'bin')
}

function basePython(): { cmd: string; args: string[] } {
  const override = process.env.IPATOOL_GUI_PYTHON?.trim()
  if (override) return { cmd: override, args: [] }
  return process.platform === 'win32' ? { cmd: 'py', args: ['-3'] } : { cmd: 'python3', args: [] }
}

function runProcess(
  cmd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}
): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({ code: 124, out, err: err + '\ntimeout' })
    }, opts.timeoutMs ?? 30_000)
    timer.unref?.()
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (c: string) => {
      out += c
    })
    child.stderr.on('data', (c: string) => {
      err += c
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: 127, out, err: e.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, out, err })
    })
  })
}

async function probePmd3(pathPrefix: string[]): Promise<boolean> {
  const env = { ...process.env }
  if (pathPrefix.length > 0) {
    env.PATH = [...pathPrefix, env.PATH ?? ''].join(path.delimiter)
  }
  const { code, out, err } = await runProcess('pymobiledevice3', ['version'], { env, timeoutMs: 15_000 })
  return code === 0 && (out + err).trim().length > 0
}

/**
 * Resolve a working toolchain without installing anything.
 * Prefers a system/pipx pymobiledevice3, then the managed venv.
 */
export async function resolveToolRuntime(): Promise<ToolRuntime | null> {
  // 1) System / pipx / scoop: just ask PATH.
  if (await probePmd3([])) {
    return { python: basePython().cmd, pythonArgs: basePython().args, source: 'system', pathPrefix: [] }
  }

  // 2) Managed venv created by us.
  const py = venvPython()
  if (existsSync(py)) {
    const scripts = venvScriptsDir()
    if (await probePmd3([scripts])) {
      return {
        python: py,
        pythonArgs: [],
        source: 'managed',
        pathPrefix: [scripts]
      }
    }
  }

  return null
}

/**
 * Create userData/devices-venv and pip-install pymobiledevice3.
 * Used when the machine has Python but no pymobiledevice3 anywhere.
 */
export async function installManagedRuntime(
  onStatus?: (message: string) => void
): Promise<ToolRuntime | null> {
  const base = basePython()
  const venvDir = managedVenvDir()
  onStatus?.(`Creating venv at ${venvDir}`)
  await mkdir(path.dirname(venvDir), { recursive: true })
  // Clean rebuild keeps a half-failed install from poisoning later runs.
  await rm(venvDir, { recursive: true, force: true })

  const create = await runProcess(base.cmd, [...base.args, '-m', 'venv', venvDir], {
    timeoutMs: INSTALL_TIMEOUT_MS
  })
  if (create.code !== 0) {
    throw new Error(`Could not create venv: ${(create.err || create.out).trim().slice(0, 400)}`)
  }

  const py = venvPython()
  onStatus?.(`Installing ${PIN}`)
  const pip = await runProcess(py, ['-m', 'pip', 'install', '--upgrade', 'pip'], {
    timeoutMs: INSTALL_TIMEOUT_MS
  })
  if (pip.code !== 0) {
    throw new Error(`pip upgrade failed: ${(pip.err || pip.out).trim().slice(0, 400)}`)
  }
  const install = await runProcess(py, ['-m', 'pip', 'install', PIN], {
    timeoutMs: INSTALL_TIMEOUT_MS
  })
  if (install.code !== 0) {
    throw new Error(`pip install failed: ${(install.err || install.out).trim().slice(0, 400)}`)
  }

  return resolveToolRuntime()
}

function runBridge<T>(runtime: ToolRuntime, args: string[], timeoutMs = BRIDGE_TIMEOUT_MS): Promise<BridgePayload<T>> {
  return new Promise((resolve) => {
    const script = bridgeScript()
    if (!existsSync(script)) {
      resolve({
        ok: false,
        code: 'python-missing',
        message: `Device bridge script not found at ${script}`
      })
      return
    }

    const env = { ...process.env }
    if (runtime.pathPrefix.length > 0) {
      env.PATH = [...runtime.pathPrefix, env.PATH ?? ''].join(path.delimiter)
    }

    const child = spawn(runtime.python, [...runtime.pythonArgs, script, ...args], {
      windowsHide: true,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({ ok: false, code: 'timeout', message: `Device bridge timed out after ${timeoutMs}ms` })
    }, timeoutMs)
    timer.unref?.()

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      out += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      err += chunk
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, code: 'python-missing', message: error.message })
    })
    child.on('close', () => {
      clearTimeout(timer)
      const line = out.trim().split('\n').filter(Boolean).pop() ?? ''
      try {
        resolve(JSON.parse(line) as BridgePayload<T>)
      } catch {
        resolve({
          ok: false,
          code: 'device-bus',
          message: (err || out || 'Device bridge returned non-JSON').slice(0, 500)
        })
      }
    })
  })
}

function toOperation<T>(payload: BridgePayload<T>, context: string): Operation<T> {
  if (payload.ok) {
    return { ok: true, data: payload.data, taskId: '' }
  }
  return {
    ok: false,
    error: payload.message || context,
    hint: payload.code,
    code: payload.code,
    taskId: '',
    exitCode: null
  }
}

export const devices = {
  async probe(): Promise<DevicesProbe> {
    const runtime = await resolveToolRuntime()
    if (!runtime) {
      return {
        ok: false,
        source: 'missing',
        executable: null,
        version: null,
        message: 'pymobiledevice3 is not installed (system or managed venv)',
        canInstall: true
      }
    }
    const payload = await runBridge<{ executable: string | null; version: string | null }>(
      runtime,
      ['probe'],
      15_000
    )
    if (payload.ok) {
      return {
        ok: true,
        source: runtime.source,
        executable: payload.data.executable,
        version: payload.data.version
      }
    }
    return {
      ok: false,
      source: runtime.source,
      executable: null,
      version: null,
      message: payload.message,
      canInstall: runtime.source === 'managed'
    }
  },

  async install(): Promise<DevicesProbe> {
    try {
      await installManagedRuntime()
    } catch (error) {
      return {
        ok: false,
        source: 'missing',
        executable: null,
        version: null,
        message: error instanceof Error ? error.message : String(error),
        canInstall: true
      }
    }
    return devices.probe()
  },

  async list(): Promise<Operation<DeviceInfo[]>> {
    const runtime = await resolveToolRuntime()
    if (!runtime) {
      return {
        ok: false,
        error: 'pymobiledevice3 is not installed',
        hint: 'python-missing',
        code: 'python-missing',
        taskId: '',
        exitCode: null
      }
    }
    return toOperation(await runBridge<DeviceInfo[]>(runtime, ['list-devices']), 'Could not list iOS devices')
  },

  async apps(udid: string): Promise<Operation<DeviceApp[]>> {
    const runtime = await resolveToolRuntime()
    if (!runtime) {
      return {
        ok: false,
        error: 'pymobiledevice3 is not installed',
        hint: 'python-missing',
        code: 'python-missing',
        taskId: '',
        exitCode: null
      }
    }
    return toOperation(
      await runBridge<DeviceApp[]>(runtime, ['list-apps', '--udid', udid, '--type', 'User']),
      'Could not list apps on this device'
    )
  }
}
