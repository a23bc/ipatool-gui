---
feature: devices-install-account-match
status: in-progress
updated: 2026-09-30
branch: feat/devices-p0
commits:
---

# Devices install-account match (DSID)

## Report

## [S1] Problem
Devices list always shows the raw `ApplicationDSID` instead of the signed-in account's e-mail / name / remark. Local `AccountProfile.dsid` stayed empty on Windows. The keyring decrypt path must also be safe: the file keyring holds the Apple ID password.

## [S2] Design
**Identity sources (priority order):**
1. `ipatool auth info` / login zerolog success event — read `directoryServicesIdentifier` when present (no extra decrypt).
2. File keyring JWE decrypt (PBES2) **only** to extract e-mail / dsid / name via `parseKeyringIdentity`. Full plaintext (incl. password) must never be logged, IPC'd, or stored.

**Security contract (hard):**
- Decrypt stays in `main/` only; no IPC returns raw keyring or passphrase.
- `learnIdentityFromKeyring` never throws (catch-all); failures are silent for the user but do not leave partial identity writes.
- After parsing identity, drop the plaintext reference immediately (no shared mutable copy).
- Passphrase is never written to command lines we log; `taskRegistry` secrets list already redacts `--keychain-passphrase`.
- Tests cover JWE round-trip **and** that `parseKeyringIdentity` never returns a `password` field.

**UI:** matched rows keep using `deviceAccountLabel` (e-mail / name / remark). Search button uses app display name (already done).

## [S3] Out of Scope
- Auto-switching the download account to the install account.
- Changing ipatool keyring format.
- macOS shared-slot behaviour beyond existing snapshot path.

## Tasks
- [ ] T1: Read `directoryServicesIdentifier` from auth info / login events into `AccountInfo.dsid` and `markIdentity` — acceptance: account row has non-empty dsid after `auth info` succeeds (covers: S2)
- [ ] T2: Harden `learnIdentityFromKeyring` (no throw, no secret leak, JWE as fallback) — acceptance: unit tests for parse without password; learn fails closed (covers: S2)
- [ ] T3: Regression tests + typecheck/lint/test green — acceptance: suite passes (covers: S2)
