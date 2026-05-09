# vite-plugin-federation

## 0.2.0

### Minor Changes

- fix

## 0.1.1

### Patch Changes

- fix

## 0.1.0

This is the first beta release of `vite-plugin-federation`. The beta scope covers
manifest-first Vite browser federation, Node SSR hosts, DTS generation and consumption, dev remote
HMR, and the curated runtime APIs. Webpack/SystemJS/`var` remotes are supported as compatibility and
migration paths; signed manifests are documented as a custom-fetch verification recipe rather than a
built-in signature verifier.

### Added

- Added manifest-first federation for Vite remotes and hosts with `mf-manifest.json`,
  `mf-stats.json`, and `mf-debug.json` outputs.
- Added runtime helpers for manifest registration, remote loading, fallback URLs, retry/timeouts,
  request collapsing, cache TTL, stale-while-revalidate, circuit breaking, preload collection, and
  runtime debug snapshots.
- Added isolated runtime scopes for multi-tenant hosts through `createFederationRuntimeScope()`.
- Added Node SSR support with dedicated `ssrRemoteEntry` output, `createServerFederationInstance()`,
  SSR-aware manifest registration, remote-entry fallback, and preload link collection for streaming
  HTML.
- Added DTS generation and consumption workflows backed by `@module-federation/dts-plugin`,
  including manifest-derived type URLs, build-time type fetching, failure handling, and dev hot sync.
- Added dev remote HMR routing for remote exposes, styles, and type updates, plus devtools overlay
  diagnostics.
- Added shared dependency diagnostics and controls for singleton conflicts, strict singleton mode,
  provider source annotations, subpath and pnpm workspace matching, local fallbacks, and loadShare
  deadlock avoidance.
- Added security and observability support for SRI/SHA-256 manifest asset metadata, manifest asset
  verification modes, authenticated manifest fetches, telemetry hooks, and stable runtime error
  codes.
- Added compatibility coverage for OriginJS-style `virtual:__federation__` consumers and legacy
  Webpack/SystemJS remote migration paths.

### Changed

- Declared the supported Vite peer range as `^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0`, including
  Vite 8/Rolldown-specific output handling and module-preload helper rewrites.
- Clarified the beta support contract in the README, comparison guide, release checklist, compiler
  adapter notes, and security guidance.
- Hardened release gates with deterministic package smoke output, install timeouts, dynamic E2E
  port preflight checks, and a packed-package Vite peer matrix.

### Fixed

- Gated React SSR example query-string manifest overrides behind
  `REACT_REMOTE_MANIFEST_QUERY_OVERRIDES=1` and restricted enabled overrides to configured manifest
  origins to avoid SSRF and server-side remote code execution risks.
- Stabilized SSR manifest fallback behavior so the SSR example can fall back deterministically and
  expose the served manifest source to the client.
- Stabilized remote transform sourcemaps, manual CSS compatibility flows, shared loadShare runtime
  paths, explicit shared version lookup, DTS abort-on-error handling, and dev SSR node remote
  loading.

### Tests

- Added Vite 5 / 6 / 7 / 8 peer runtime smoke coverage for the packed package, including preload
  helper, manual chunks, and Rolldown-related paths.
- Added SSR failure/fallback E2E coverage, including the default-denied manifest override path.
- Added manifest integrity tamper E2E coverage.
- Expanded Playwright E2E coverage across default browser federation, compatibility, shared
  negotiation/fallbacks, multi-remote hosts, browser matrix, SSR, and DTS dev hot sync.
