# Security Policy

## Supported versions

Only the **latest release** receives security fixes. There are no long-lived
maintenance branches for older versions; if you are on an older build, upgrade
before reporting.

## Reporting a vulnerability

**Please do not open a public issue.**

Use GitHub's private vulnerability reporting:
<https://github.com/a23bc/ipatool-gui/security/advisories/new>

That channel is private between you and the maintainer and lets a fix be prepared
before the details are public.

A useful report contains:

- the app version (Settings → About) and the OS + version;
- what an attacker gains, and what they need to start with;
- reproduction steps, ideally a minimal one;
- any relevant lines from Activity → Export logs (credentials and tokens are
  redacted, but skim it first).

If you are unsure whether something counts as a vulnerability, report it privately
anyway — a false positive costs far less than a public disclosure of a real one.

## What this project assumes

Worth knowing before you spend time on a report, because these are deliberate
design decisions rather than bugs:

- **The app ships no `ipatool` binary.** It is downloaded on first launch and
  verified against the SHA-256 published by the upstream release. The checksum
  sidecar is always fetched from `github.com`, even when a download mirror is
  configured — a mirror that supplied both the binary and its checksum could vouch
  for a tampered artifact. A missing or unparseable checksum **fails closed**: the
  binary is not installed.
- **Builds are not code signed** (Windows: unsigned; macOS: ad-hoc, not notarized).
  Each release publishes `SHA256SUMS.txt`; that manifest is the provenance anchor.
  "The binary is unsigned" is therefore a known limitation, not a vulnerability.
  A way to make a *verified* download install something else **is** in scope.
- **Credentials are never written in plaintext.** They go to the OS keychain, or
  through Electron's `safeStorage`; when neither is available the app refuses
  rather than falling back to a plaintext file.
- **The renderer is treated as untrusted.** `sandbox` and `contextIsolation` are on,
  the preload exposes a fixed API, every IPC input that becomes a path or a URL is
  validated in the main process, and `fs:open-path` is restricted by an allow-list.

## Out of scope

- **Bugs in `ipatool` itself.** That is a separate project — report them at
  <https://github.com/majd/ipatool>. If this app passes a value to it in a way that
  makes a bug exploitable, that part *is* in scope here.
- **Apple ID consequences.** Account flags, rate limits or terms-of-service actions
  resulting from automated App Store access are not something a code change can fix.
- **Anything that requires existing code execution as your user**, administrator
  rights, or physical access — including patching the app's own files. At that point
  the attacker already has what they wanted.
- **Gatekeeper / SmartScreen warnings** about the unsigned build. These are expected
  and documented in the README; see [docs/troubleshooting.md](docs/troubleshooting.md).

## What to expect

This is a small project maintained in spare time. There is **no bug bounty**. Reports
are acknowledged as soon as possible, and you will be told whether the issue is
accepted, needs more information, or is out of scope. Accepted issues are fixed in a
normal release; credit is given in the release notes unless you ask otherwise.
