/**
 * Ubuntu 24.04+ restricts unprivileged user namespaces through AppArmor. Inside
 * an AppImage Chromium's SUID fallback cannot work (the payload is a user-owned
 * FUSE mount), so the process aborts before the first window. Wrap the Linux
 * executable and add --no-sandbox only in that situation; a .deb install keeps
 * its root-owned chrome-sandbox and the normal sandbox.
 *
 * electron-builder runs this hook before the targets are assembled, so the
 * wrapper is what AppRun and the .deb desktop entry both execute.
 */
const fs = require('node:fs/promises')
const path = require('node:path')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return
  if (!context.targets.some((target) => target.name === 'appImage')) return

  const executable = path.join(context.appOutDir, context.packager.executableName)
  const real = `${executable}.bin`
  const name = path.basename(executable)

  const wrapper = `#!/usr/bin/env bash
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ -n "\${APPIMAGE:-}" ]; then
  restricted="$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || true)"
  userns="$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || true)"
  if [ "$restricted" = "1" ] || [ "$userns" = "0" ]; then
    exec "$HERE/${name}.bin" --no-sandbox "$@"
  fi
fi

exec "$HERE/${name}.bin" "$@"
`

  await fs.rename(executable, real)
  await fs.writeFile(executable, wrapper)
  await fs.chmod(executable, 0o755)
}
