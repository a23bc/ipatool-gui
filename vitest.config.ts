import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import path from 'node:path'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.join(root, 'src/shared'),
      '@main': path.join(root, 'src/main'),
      '@renderer': path.join(root, 'src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    reporters: ['default'],
    // M12: coverage is a regression gate for a security-sensitive codebase.
    // `npm run test:watch` opts out (via CLI flag) to stay fast; CI runs with
    // it on, so new code that drops a directory below its floor fails the build.
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/shared/**/*.ts', 'src/main/**/*.ts'],
      // Process entry points are glue (app lifecycle, window chrome) that
      // cannot be meaningfully unit-tested without booting Electron.
      exclude: ['src/main/index.ts', 'src/main/window.ts'],
      // Floors are per-area, not one global average. A single number let the
      // security boundary rot: the audit found src/main/ipc.ts at 0% while the
      // aggregate sat comfortably above the gate. Each entry below is calibrated
      // a little under the measured baseline, so ordinary refactoring passes and
      // a real regression fails.
      thresholds: {
        statements: 60,
        branches: 70,
        functions: 68,
        lines: 60,
        // The pure shared layer is fully testable - hold it to a high bar.
        'src/shared/**': {
          statements: 90,
          branches: 85,
          functions: 90,
          lines: 90
        },
        // The IPC surface is the documented trust boundary: path allow-list,
        // raw-command allow-list, action validation.
        'src/main/ipc.ts': {
          statements: 38,
          branches: 65,
          functions: 30,
          lines: 38
        },
        // Subprocess lifecycle: kill, timeout, spawn failure, line buffering.
        'src/main/runner.ts': {
          statements: 55,
          branches: 60,
          functions: 60,
          lines: 55
        }
      }
    }
  }
})
