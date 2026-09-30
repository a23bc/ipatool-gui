# IPATool GUI

<p align="center">
  <img src="build/icon.png" width="128" height="128" alt="IPATool GUI" />
</p>

<p align="center">
  <b>A desktop GUI for <a href="https://github.com/majd/ipatool">ipatool</a></b><br/>
  Search the App Store · Browse versions · Download .ipa / .pkg with any Apple ID
</p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README_CN.md">中文</a>
</p>

<p align="center">
  <a href="https://github.com/a23bc/ipatool-gui/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/a23bc/ipatool-gui"></a>
  <a href="https://github.com/a23bc/ipatool-gui/actions"><img alt="CI" src="https://github.com/a23bc/ipatool-gui/actions/workflows/ci.yml/badge.svg"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

---

## Overview

**IPATool GUI** is a cross-platform desktop app (Windows / macOS / Linux) for the
command-line tool [ipatool](https://github.com/majd/ipatool). It does not reimplement
Apple protocols — it wraps the CLI into a proper GUI: search apps, browse version
history, queue downloads, and manage multiple Apple IDs.

**This repository ships no ipatool binary.** On first launch the app fetches it from
the official GitHub releases and verifies the published SHA-256.

### Features

| | |
| --- | --- |
| **Search** | Keyword / Bundle ID, platform filter, app icons, search history |
| **Version history** | Full version list; download any specific version |
| **Purchases** | Paginated apps owned by your Apple ID; multi-select batch download |
| **Download queue** | Parallel downloads, true pause/resume (HTTP Range), retry, reorder, speed & ETA, persists across restarts |
| **Multi-account** | Several Apple IDs side by side with one-click switching and isolated sessions |
| **Sign-in** | Two-factor authentication (2FA) completed inside the app |
| **Batch import** | Import text / JSON / App Store links into the download queue |
| **Activity log** | Full output of every ipatool call, secrets redacted, filter & export |
| **UI** | Dark / light theme, English & Chinese, command palette (Ctrl/⌘ + K) |

### Screenshots

> Screenshots coming soon. Dark-first modern UI with fully virtualized lists.

---

## Install

Download the build for your platform from
[Releases](https://github.com/a23bc/ipatool-gui/releases/latest).

### macOS

Builds are **ad-hoc signed and not notarized**. On first open, Gatekeeper may say
**“IPATool GUI” is damaged and can’t be opened** — the file is **not** corrupt;
it simply has not been notarized. After extracting, run this once:

```bash
xattr -dr com.apple.quarantine "/Applications/IPATool GUI.app"
```

Notes:

- `-r` is required (files inside the app bundle are also quarantined).
- On macOS 15+, right-click → Open no longer bypasses Gatekeeper; this command is the simplest path.
- Extract with **Finder** or `tar -xzf` so symlinks and the executable bit survive.

### Windows

SmartScreen may warn about an unknown publisher — choose **Run anyway**.

### Linux

AppImage and deb packages for x64 / arm64.

---

## Quick start

1. **Install and launch** the app; follow the wizard to detect or install the ipatool engine (can be automatic).
2. **Sign in with your Apple ID** (e-mail or phone number). Enter the 2FA code in-app if prompted.
3. **Search** for an app → open details / versions → **Download**. Items enter the queue where you can pause, resume, and retry.

### Network tip

On some networks, Apple purchase/download endpoints (e.g. `p47-buy.itunes.apple.com`)
are not directly reachable. If credential fetch fails before download, configure a
system proxy or VPN and try again.

---

## Development

```bash
npm install          # Node 20.19+
npm run dev          # Electron + Vite HMR
npm run typecheck && npm test && npm run lint
```

Package:

```bash
npm run dist:win     # Windows NSIS + portable
npm run dist:mac     # macOS (unsigned)
npm run dist:linux   # AppImage + deb
```

More build, test, and release detail: [docs/architecture.md](docs/architecture.md).

---

## Learn more

| Doc | Contents |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | Multi-account model, pause/resume, progress parsing, security model, packaging & CI, code map |
| [Security](docs/architecture.md#安全披露) | Report vulnerabilities via Private vulnerability reporting — do not open a public issue |

Worth knowing (details in the docs):

- **True multi-account isolation** — each account has its own ipatool session directory and sandboxed HOME.
- **Pause is real pause** — uses ipatool’s HTTP Range resume, not cancel-and-restart.
- **Credentials are never stored in plaintext** — OS keychain / `safeStorage`; refused rather than written when unavailable.
- **No auto-update** — an unsigned auto-update channel is a security risk; updates are prompt-only.

---

## Please use it responsibly

Only download apps you are entitled to. Automated App Store access may trigger Apple
rate limits or account flags.

This project is a third-party frontend for
[majd/ipatool](https://github.com/majd/ipatool) (MIT) and does not redistribute ipatool.

**License:** [MIT](LICENSE)
