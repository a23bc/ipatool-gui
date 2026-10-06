"""
ipatool-gui devices bridge.

Thin CLI around pymobiledevice3 so the Electron main process never talks to the
iOS lockdown stack directly. One JSON object on stdout, errors included.

  python devices/main.py probe
  python devices/main.py list-devices
  python devices/main.py list-apps --udid <udid> [--type User|System|Any]

Exit codes: 0 = ok, 2 = usage, 3 = tool/device error (payload still JSON).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from typing import Any

# ---------------------------------------------------------------------------
# tool discovery
# ---------------------------------------------------------------------------


def find_pmd3() -> str | None:
    """Resolve the pymobiledevice3 executable. Override with PYMOBILEDEVICE3_PATH."""
    override = os.environ.get("PYMOBILEDEVICE3_PATH", "").strip()
    if override:
        return override if os.path.isfile(override) else None
    return shutil.which("pymobiledevice3")


def run_pmd3(args: list[str], timeout: int = 60) -> tuple[int, str, str]:
    exe = find_pmd3()
    if not exe:
        return 127, "", "pymobiledevice3 not found on PATH"
    try:
        proc = subprocess.run(
            [exe, *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired:
        return 124, "", f"pymobiledevice3 timed out after {timeout}s"
    except OSError as exc:
        return 126, "", str(exc)


def emit(payload: dict[str, Any]) -> None:
    json.dump(payload, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


def fail(code: str, message: str, **extra: Any) -> None:
    emit({"ok": False, "code": code, "message": message, **extra})
    sys.exit(3)


def ok(command: str, data: Any) -> None:
    emit({"ok": True, "command": command, "data": data})


# ---------------------------------------------------------------------------
# normalize
# ---------------------------------------------------------------------------


def normalize_device(raw: dict[str, Any]) -> dict[str, Any]:
    udid = raw.get("UniqueDeviceID") or raw.get("Identifier") or ""
    return {
        "udid": udid,
        "name": raw.get("DeviceName") or None,
        "productType": raw.get("ProductType") or None,
        "productVersion": raw.get("ProductVersion") or None,
        "buildVersion": raw.get("BuildVersion") or None,
        "connection": (raw.get("ConnectionType") or "unknown").lower(),
        "deviceClass": raw.get("DeviceClass") or None,
    }


def normalize_app(bundle_id: str, raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "bundleId": bundle_id or raw.get("CFBundleIdentifier") or "",
        "name": raw.get("CFBundleDisplayName")
        or raw.get("CFBundleName")
        or bundle_id,
        "version": raw.get("CFBundleShortVersionString")
        or raw.get("CFBundleVersion")
        or "",
        "build": raw.get("CFBundleVersion") or "",
        "applicationType": raw.get("ApplicationType") or "User",
        "applicationDsid": raw.get("ApplicationDSID"),
        "signerIdentity": raw.get("SignerIdentity"),
        "isAppClip": bool(raw.get("IsAppClip", False)),
    }


# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------


def cmd_probe() -> None:
    exe = find_pmd3()
    if not exe:
        fail("python-missing", "pymobiledevice3 executable not found on PATH")
    code, out, err = run_pmd3(["version"])
    version = (out or err).strip().splitlines()[0] if (out or err) else None
    if code != 0:
        # `version` is informational; still report the binary path.
        ok("probe", {"executable": exe, "version": None, "raw": (out + err).strip()[:200]})
        return
    ok("probe", {"executable": exe, "version": version})


def cmd_list_devices() -> None:
    code, out, err = run_pmd3(["usbmux", "list"])
    if code != 0:
        fail("device-bus", (err or out or "usbmux list failed").strip()[:500])
    try:
        raw = json.loads(out or "[]")
    except json.JSONDecodeError:
        fail("device-bus", "pymobiledevice3 usbmux list returned non-JSON")
    if not isinstance(raw, list):
        fail("device-bus", "unexpected usbmux payload")
    devices = [normalize_device(d) for d in raw if isinstance(d, dict)]
    ok("list-devices", devices)


def cmd_list_apps(udid: str, app_type: str) -> None:
    if not udid:
        fail("device-missing", "--udid is required")
    args = ["apps", "list", "--udid", udid, "--type", app_type]
    code, out, err = run_pmd3(args, timeout=120)
    if code != 0:
        text = (err or out or "apps list failed").strip()
        lowered = text.lower()
        if "lockdown" in lowered and ("passcode" in lowered or "locked" in lowered):
            fail("device-locked", text[:500], udid=udid)
        if "tunnel" in lowered or "rsd" in lowered:
            fail("tunnel-required", text[:500], udid=udid)
        fail("device-apps", text[:500], udid=udid)
    try:
        raw = json.loads(out or "{}")
    except json.JSONDecodeError:
        fail("device-apps", "pymobiledevice3 apps list returned non-JSON", udid=udid)
    if not isinstance(raw, dict):
        fail("device-apps", "unexpected apps payload", udid=udid)
    apps = [normalize_app(bid, a) for bid, a in raw.items() if isinstance(a, dict)]
    apps.sort(key=lambda a: (a["name"] or "").lower())
    ok("list-apps", apps)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="ipatool-gui-devices", description="iOS device bridge")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("probe", help="check pymobiledevice3 availability")
    sub.add_parser("list-devices", help="list connected devices")

    p_apps = sub.add_parser("list-apps", help="list apps on a device")
    p_apps.add_argument("--udid", required=True)
    p_apps.add_argument("--type", dest="app_type", default="Any", choices=["User", "System", "Hidden", "Any"])

    args = parser.parse_args(argv)
    if args.command == "probe":
        cmd_probe()
    elif args.command == "list-devices":
        cmd_list_devices()
    elif args.command == "list-apps":
        cmd_list_apps(args.udid, args.app_type)
    else:  # pragma: no cover - argparse
        parser.error(f"unknown command {args.command}")


if __name__ == "__main__":
    main()
