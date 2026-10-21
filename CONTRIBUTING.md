# Contributing

Thanks for helping. This is a small project, so the fastest way to get a change
merged is to keep it small and to show how you verified it.

## Before you start

- **Bugs vs. security.** Bugs go in the issue tracker (use the bug report form — it
  asks for the app version, OS, engine version and logs). Anything that looks like a
  vulnerability goes through the **Security** tab, not a public issue.
- **Open an issue first for anything larger than a typo.** A new feature, a new
  dependency, or a change to the IPC surface is worth a sentence of agreement before
  you write the code.
- **This repository ships no `ipatool` binary.** The app downloads it at runtime and
  verifies the published SHA-256. Please do not add a bundled copy.

## Development

Requirements: Node 20.19+ and npm.

```bash
npm install
npm run dev          # Electron + Vite with HMR
```

Before opening a pull request, run the same checks CI runs:

```bash
npm run typecheck
npm test             # vitest, coverage gate enabled
npm run lint
npm run build
```

Packaging (rarely needed for a normal change):

```bash
npm run dist:win     # NSIS installer + portable exe
npm run dist:mac     # .app (ad-hoc signed)
npm run dist:linux   # AppImage + deb
```

## Where code goes

The layering matters more than the file count — put logic in the lowest layer that
can hold it:

| Path | What belongs there |
| --- | --- |
| `src/shared/` | Pure logic with no Electron or Node I/O: parsing, formatting, error classification, validation. **Fully unit-testable, and expected to be tested.** |
| `src/main/` | Electron main process: IPC handlers, queue, engine, settings, subprocess runner. |
| `src/preload/` | The frozen `window.api` bridge. Keep it a thin, explicit allow-list. |
| `src/renderer/` | React UI and zustand stores. Renderer state lives in stores, not components. |

Two rules that come up in review:

- **Everything crossing the IPC boundary is untrusted.** A renderer-supplied string
  that becomes a path component or a URL segment must be validated in `src/main`
  (see `src/shared/validate.ts`). Types do not survive the boundary.
- **User-visible behaviour changes need a sentence in the PR.** A different default,
  a different error message, a new prompt — say so explicitly.

## Tests

- New logic in `src/shared/` needs tests. There is a per-area coverage gate, so an
  untested module in the security-relevant paths will fail CI.
- `tests/` runs in the Node environment; `tests/dom/` covers renderer stores with a
  stubbed `window.api`.
- A test that only proves "the code runs" is not worth much. Prefer one that fails
  against the old behaviour — say in the PR what it catches.
- Signal/timing tests that cannot work on Windows should be scoped with
  `describe.skipIf(process.platform === 'win32')` rather than deleted.

## Style

- Match the surrounding code. No reformatting of untouched lines, no "while I'm
  here" refactors — they make a review impossible to follow.
- Comments explain **why**, not what. If a line looks odd, the reason it must be that
  way belongs next to it.
- Commits: English, imperative mood, one logical change each (`fix(queue): ...`).
- No new runtime dependencies without discussing it first.
- Never commit credentials, tokens, or local-only files (editor config, scratch
  scripts, exported logs). Keep those in `.git/info/exclude`, which is per-clone and
  never pushed.

## Pull requests

- One concern per PR. If a change needs two independent explanations, it is two PRs.
- Describe: what was wrong, what you changed, how you verified it, and what you did
  **not** verify. An honest "untested on macOS" is fine; a silent gap is not.
- CI must be green. `typecheck`, `test` and `build` all run on every PR.

## Licence

By contributing you agree that your work is licensed under the MIT licence, the same
as this project.
