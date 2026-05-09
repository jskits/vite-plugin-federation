# vite-plugin-federation

## 1.0.0

`vite-plugin-federation` is now generally available for production Vite Module Federation 2.0
deployments.

### Stable Support Scope

- Manifest-first Vite remotes and browser hosts that publish and consume `mf-manifest.json`,
  `mf-stats.json`, and `mf-debug.json` artifacts with manifest schema `1.0.0`.
- Node SSR hosts with dedicated `ssrRemoteEntry` output, server runtime creation, target-aware
  manifest registration, and preload link collection for streaming HTML.
- DTS generation and consumption workflows, including manifest-derived type URLs, build-time type
  fetching, failure handling, and dev hot sync.
- Dev remote HMR, devtools diagnostics, multi-tenant runtime scopes, production rollout controls,
  and stable `MFV-*` error-code diagnostics.
- Compatibility paths for OriginJS `virtual:__federation__`, Webpack/SystemJS remotes, and `var`
  entries. These paths are covered by repository tests but should still be validated for each
  migration.

### Major Capabilities

- Added manifest runtime controls for cache TTL, stale-while-revalidate, retries, timeouts, fallback
  URLs, request collapsing, circuit breakers, authenticated fetches, and telemetry hooks.
- Added manifest integrity support with SRI and SHA-256 content-hash metadata, plus
  `verifyFederationManifestAssets()` for expose and preload asset verification.
- Added shared dependency controls for singleton diagnostics, strict singleton failures, strict
  version checks, host-only shares, package-subpath keys, and pnpm/workspace suffix matching.
- Added `createFederationRuntimeScope()` for tenant or experiment isolation across manifest cache,
  breaker state, debug records, and remote load metrics.
- Added preload helpers for route-level preload planning and SSR-ready `modulepreload` /
  stylesheet link collection.
- Added first-class Vite `^5 || ^6 || ^7 || ^8` support, including Vite 8/Rolldown-aware output
  handling and module-preload helper rewrites.

### Known Limitations

- Node SSR still requires launching Node with `--experimental-vm-modules` because the underlying
  Module Federation runtime uses the VM module loader for ESM remote evaluation.
- Browser CommonJS remote entries are unsupported. Publish ESM/manifest entries for browser hosts or
  use a Node SSR target where appropriate.
- `systemjs` remotes require a compatible `globalThis.System.import` implementation at runtime.
- Webpack/SystemJS/`var` interoperability is a migration compatibility surface, not the recommended
  greenfield path; validate shared singleton and version policies per application.
- Signed manifest verification remains an application-supplied custom `fetch` wrapper. The default
  runtime verifies declared SRI/content hashes but does not include a signing trust model.
- Node-target remotes execute server-side code. Route SSR manifest URLs through an operator-controlled
  allowlist and do not pass request-controlled URLs directly to runtime helpers.

### Migration Notes

- Prefer manifest URLs in `remotes` for new hosts:
  `catalog: 'https://cdn.example.com/catalog/mf-manifest.json'`.
- Prefer `vite-plugin-federation/runtime` for runtime helpers; direct
  `@module-federation/runtime` imports still share state through the runtime bridge.
- Keep the OriginJS compatibility shim enabled during migration, then disable it with
  `compat: { originjs: false, virtualFederationShim: false }` after all consumers have moved.
- Use explicit shared singleton and version policy for React/Vue/Svelte/Lit and any design-system
  packages that must not load multiple providers.
- Run SSR hosts with `node --experimental-vm-modules server.js` and publish `ssrRemoteEntry` from
  remotes intended for server loading.
- The long-term v1 support floor is Node `>=20.19.0` and Vite
  `^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0`.

### Tests

- Added packed-package smoke tests, a Vite 5 / 6 / 7 / 8 peer matrix, package tarball checks, and
  Playwright coverage for default browser federation, browser matrix, compatibility, shared
  negotiation/fallbacks, multi-remote hosts, SSR, and DTS dev hot sync.
- Added targeted coverage for SSR manifest fallback and default-denied manifest overrides, manifest
  integrity tampering, OriginJS compatibility, Webpack/SystemJS remotes, and workspace shared
  dependencies.

## 0.2.0

### Fixed

- Stabilized dev remote HMR socket lifecycle, event-only updates, and reconnect attempts.
- Fixed HTML entry injection and module script attribute parsing across reordered or attributed
  tags.
- Preserved default namespace remote imports and dev shared optimizer behavior.
- Fixed pnpm store fallback loops and `createRequire` URL handling for file paths.
- Scoped default E2E config behavior and refreshed README documentation.

## 0.1.1

### Patch Changes

- Completed package metadata and npm-facing README content for the public package.

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
