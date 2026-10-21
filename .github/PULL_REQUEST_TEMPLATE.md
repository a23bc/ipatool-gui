## What changed

<!-- One or two sentences. If it needs more than that, it may be two PRs. -->

## Why

<!-- The problem this solves. Link the issue if there is one: Fixes #… -->

## How it was verified

<!-- Commands you ran, and what you observed. "npm test passes" is not enough on its
     own — say which behaviour the new test would catch if it regressed. -->

## Not verified

<!-- Anything you could not check locally: no macOS machine, no real Apple ID, no
     packaging toolchain, ... An honest gap is fine; a silent one is not. -->

## Checklist

- [ ] One concern only — unrelated changes are in another PR
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes (coverage gate included)
- [ ] `npm run lint` passes
- [ ] New logic in `src/shared/` has tests
- [ ] No credential, token or local-only file is included
- [ ] User-visible behaviour changes are described above
