# Changelog

This repository uses Changesets for package releases. Generated package changelog entries are
created during `pnpm version-packages`.

## Unreleased

- Hardened release gates with deterministic package smoke logging/timeouts.
- Added a Vite 5 / 6 / 7 / 8 peer matrix smoke test for the packed tarball.
- Added E2E port preflight checks and environment-variable port overrides for local runs.
- Clarified GA support scope, SSR VM loader limits, and signed-manifest security boundaries in docs.
