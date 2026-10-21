# Troubleshooting

Start here for the four problems that come up most. If none of these match, open an
issue with the bug report form — it asks for the details this page keeps asking for.

**Where the logs are:** Activity → **Export logs**. Credentials and tokens are
redacted automatically, but skim the file before sharing it.

---

## The app cannot find or install the `ipatool` engine

Settings → Engine shows what was detected and why it was rejected.

| What you see | What it means |
| --- | --- |
| `ipatool was not found` | Not on `PATH`, not in the managed folder, and no path configured. Use **Install** in Settings → Engine, or point *ipatool path* at a real `ipatool` binary. |
| `not-executable` | A path is configured but it is not an `ipatool` binary. The basename must be exactly `ipatool` (`ipatool.exe` on Windows). A directory is also accepted — the app looks for `<dir>/ipatool` inside it. |
| `checksum-mismatch` | **This is the app protecting you.** The downloaded archive did not match the SHA-256 published by the upstream release, or the checksum sidecar was missing, unparseable, or described a different file. Nothing was installed. Retry; if it persists, download the release manually from <https://github.com/majd/ipatool/releases> and point *ipatool path* at it. |
| Download stalls behind a mirror | A GitHub mirror only accelerates the **asset** download. The checksum is still fetched from `github.com`, so a network that blocks `github.com` entirely will fail verification even with a mirror configured. |

---

## macOS: "Keychain Not Found" while signing in

You see a system alert titled **Keychain Not Found**:

> A keychain cannot be found to store "account".

The sign-in sheet behind it is the app's, but **the alert is macOS's own**, raised on
behalf of the `ipatool` command-line tool (the keychain icon in the alert carries a
small `exec` badge). `ipatool` stores the Apple ID credential in your login keychain;
if macOS cannot find a default keychain, the credential cannot be saved and sign-in
never completes.

Check what the system thinks it has:

```bash
security list-keychains
security default-keychain
```

- **If no default is set**, point it back at the login keychain:

  ```bash
  security default-keychain -s ~/Library/Keychains/login.keychain-db
  ```

- **If the "login" keychain is missing or damaged**, create one in Keychain Access
  (File → New Keychain, name it `login`), unlock it, and set it as default with the
  command above.

- **Do not press "Reset To Defaults"** in that alert unless you mean it: on some macOS
  versions it creates a new, empty keychain, which can make existing saved passwords
  harder to reach. "Cancel" changes nothing.

Migrating from a backup, or resetting the keychain recently, is a common cause.

---

## macOS: "IPATool GUI is damaged and can't be opened"

The download is fine — it is not notarized, and Gatekeeper reports the quarantine flag
as damage. After moving the app to `/Applications`, run once:

```bash
xattr -dr com.apple.quarantine "/Applications/IPATool GUI.app"
```

Notes that catch people out:

- `-r` is required: files inside the bundle are quarantined too.
- On macOS 15+, right-click → Open no longer bypasses Gatekeeper. The command above is
  the simplest path; otherwise use System Settings → Privacy & Security → "Open Anyway".
- Extract with **Finder** or `tar -xzf`. Some third-party extractors drop symlinks or
  the executable bit, which breaks the bundle for real.

---

## Windows: SmartScreen blocks the installer

The build is unsigned, so SmartScreen warns about an unknown publisher. Choose
**More info → Run anyway**. If your organisation blocks unsigned binaries by policy,
there is no per-user workaround — use the portable build or build from source.

---

## Linux: AppImage will not start

```bash
chmod +x IPATool-GUI-*.AppImage
./IPATool-GUI-*.AppImage
```

If it exits with a FUSE error, install `libfuse2` (Ubuntu 22.04+:
`sudo apt install libfuse2`). Alternatively use the `.deb`, which needs no FUSE.

---

## Sign-in or download fails against Apple's endpoints

Some networks cannot reach Apple's purchase/download hosts
(e.g. `p47-buy.itunes.apple.com`). The app classifies the failure for you:

| Error | Meaning | What to do |
| --- | --- | --- |
| `dns` / `tls` / `network` | Could not reach Apple | Configure a system proxy or VPN, then retry. |
| `timeout` | Apple did not answer in time | Retry; first sign-in is often slow. |
| `rate-limited` | Too many requests | Wait; lowering Settings → Downloads → concurrency helps. |
| `app-not-found` | The App Store has no such app **for your storefront** | Check the country in Settings, and that the app exists in that storefront. |
| `version-not-found` | That version is not available for your account | Pick another version, or download the current one. |
| `resume-failed` | The partial file no longer matches the remote file | Retry — the app restarts the download from scratch. |
| `platform-mismatch` | The app does not support the selected platform | Switch the platform filter (iPhone / iPad / Mac). |
| `proxy` | The proxy refused the request or could not open a CONNECT tunnel | Check the proxy rules and credentials, or try without the proxy. |
| `disk` | No space left on the destination volume | Free space, or change the download directory in Settings. |

---

## Reporting something not covered here

Open an issue with the **bug report** form. It asks for the app version, OS, engine
version, reproducibility and logs — those five fields are what makes it possible to
act on a report instead of guessing.
