/**
 * iOS device bridge (pymobiledevice3).
 *
 * The Electron process never talks to lockdown itself: it runs
 * `python/devices/main.py`, which wraps pymobiledevice3 and prints one JSON
 * object per call. That keeps Python version churn out of the Electron ABI and
 * leaves room for richer account probing later without touching the UI.
 *
 * P0 is read-only: list devices, list apps, probe the tool.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { app } from 'electron'
import type { DeviceApp, DeviceInfo, DevicesProbe, Operation } from '../shared/types'

const BRIDGE_TIMEOUT_MS = 120_000

/** Repo layout in dev is `python/devices/main.py` next to package.json. */
function bridgeScript(): string {
  return path.join(app.getAppPath(), 'python', 'devices', 'main.py')
}

function resolvePython(): string | null {
  const override = process.env.IPATOOL_GUI_PYTHON?.trim()
  if (override) return override
  // Windows: `py -3` launcher is more reliable than a bare `python` alias.
  return process.platform === 'win32' ? 'py' : 'python3'
}

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

function runBridge<T>(
  args: string[],
  timeoutMs = BRIDGE_TIMEOUT_MS
): Promise<BridgePayload<T>> {
  return new Promise((resolve) => {
    const python = resolvePython()
    if (!python) {
      resolve({ ok: false, code: 'python-missing', message: 'No Python interpreter configured' })
      return
    }
    // On Windows the `py` launcher wants `-3` before the script path.
    const argv = process.platform === 'win32' && python.endsWith('py')
      ? ['-3', bridgeScript(), ...args]
      : [bridgeScript(), ...args]

    const child = spawn(python, argv, {
      windowsHide: true,
      env: { ...process.env },
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
      resolve({
        ok: false,
        code: 'python-missing',
        message: error.message
      })
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
    hint: payload.code === 'python-missing' ? 'python-missing' : payload.code,
    code: payload.code,
    taskId: '',
    exitCode: null
  }
}

export const devices = {
  async probe(): Promise<DevicesProbe> {
    const payload = await runBridge<{ executable: string | null; version: string | null }>(['probe'], 15_000)
    if (payload.ok) {
      return {
        ok: true,
        executable: payload.data.executable,
        version: payload.data.version
      }
    }
    return {
      ok: false,
      executable: null,
      version: null,
      message: payload.message
    }
  },

  async list(): Promise<Operation<DeviceInfo[]>> {
    return toOperation(await runBridge<DeviceInfo[]>(['list-devices']), 'Could not list iOS devices')
  },

  async apps(udid: string): Promise<Operation<DeviceApp[]>> {
    return toOperation(
      await runBridge<DeviceApp[]>(['list-apps', '--udid', udid, '--type', 'User']),
      'Could not list apps on this device'
    )
  }
}
