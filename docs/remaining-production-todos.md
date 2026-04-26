# Remaining Production TODOs

This document lists the remaining work needed to move the plugin from a usable beta-quality
implementation to a production-grade, GA-ready "best-in-class" Vite Module Federation plugin.

## Current Baseline

Already implemented:

- Manifest-first remote consumption through `mf-manifest.json`.
- Runtime bridge over `@module-federation/runtime`.
- Manifest fetch cache, TTL, retries, timeout, force refresh, and request collapsing.
- Runtime manifest registration, refresh, debug snapshots, and SSR target selection.
- Manifest, stats, debug artifacts, and traceable build metadata.
- SSR React host/remote example with manifest-driven preload link collection.
- Dev remote live reload coverage and basic devtools overlay/event stream.
- OriginJS-style compatibility shim for `virtual:__federation__`.
- DTS plugin integration at the build/dev plugin level.
- Core monorepo tooling, CI, format/lint/typecheck/test/build checks.

The remaining TODOs below are the gaps that still need deeper implementation, broader validation,
or stronger production ergonomics.

## P0 - GA Blockers

These items should be completed before calling the plugin production complete.

### 1. Shared Runtime Semantics And Diagnostics

Current state:

- Shared config is normalized and passed into generated runtime code.
- `singleton`, `requiredVersion`, and `strictVersion` are present in generated share metadata.
- Local fallback and `import: false` paths exist.
- Several shared prebuild and subpath tests exist.
- `allowNodeModulesSuffixMatch` is normalized, passed to generated runtime share config, matched
  against pnpm/nested `node_modules` suffixes in the proxy path, and exposed in manifest
  diagnostics.
- `vite-plugin-federation/runtime` installs a shared diagnostics runtime plugin and wraps
  `loadShare`/`loadShareSync`.
- `getFederationDebugInfo()` exposes registered shared providers, the active share scope, and a
  shared resolution graph with candidate versions, selected provider, fallback source, and decision
  reason.
- `MFV-003` diagnostics are emitted for shared misses, local fallback selection, semver range
  mismatches, and strict shared resolution failures observed by the runtime wrapper/plugin.
- Shared resolution graph entries include deterministic candidate ordering, selected strategy, and
  `versionSatisfied` for `requiredVersion` comparisons.
- Singleton conflicts emit `MFV-003` with the selected provider/version and rejected candidate
  versions.
- Shared packages can opt into `strictSingleton: true` to upgrade singleton conflicts from
  diagnostic-only warnings to `MFV-003` runtime errors.
- Generated local shared providers and internal `loadShare` requests include `sourcePath` and
  `resolvedImportSource` annotations so runtime debug snapshots can identify the exact local import
  or resolved file path involved in shared resolution.
- Runtime/unit coverage validates package-root, trailing-slash subpath, and pnpm
  `node_modules`-suffix shared matching for Vue-style subpath consumers, scoped workspace packages,
  and pnpm-resolved package paths.
- `examples/shared-negotiation-host` and `examples/shared-negotiation-remote` validate
  deterministic `loaded-first` and `version-first` provider selection in real production
  build/preview flows.
- `examples/shared-strict-fallback-app`, `examples/shared-host-only-host`, and
  `examples/shared-host-only-remote` validate browser-side `strictVersion` local fallback and
  actionable `import: false` host-only shared errors in production build/preview flows.
- Generated shared wrappers throw an actionable host-only error when `import: false` is configured
  and no host provider is available, and normal shared wrappers fall back to the local prebuild
  source when runtime share resolution returns `false`.

Remaining work:

Acceptance criteria:

- A host can explain why every shared package was resolved from host, remote, or local fallback.
- A singleton/version conflict creates an actionable diagnostic.
- pnpm workspace and symlinked dependency layouts pass both unit and e2e tests.
- `getFederationDebugInfo()` exposes enough shared graph data to debug production incidents.

Suggested commits:

- `feat: add shared resolution graph diagnostics`
- `feat: support node_modules suffix shared matching`
- `test: add shared version negotiation coverage`

### 2. Type System End-to-End Coverage

Current state:

- `@module-federation/dts-plugin` is integrated.
- Manifest metadata can describe type artifact names.
- Dev worker and dynamic remote type hints are wired.
- `examples/dts-remote` validates build-time remote type generation, manifest type metadata, API
  declaration output, and zipped expose declarations.
- `examples/dts-host` validates build-time host type consumption from manifest-derived
  `remoteTypeUrls`, `typesOnBuild`, `consumeAPITypes`, and `abortOnError` happy-path behavior.
- `packages/vite-plugin-federation/e2e/dts-dev-hot-sync.mjs` validates dev-time live DTS serving,
  remote type regeneration, host hot type sync, and no-restart host type-checking after a remote
  API expansion.
- Build-time DTS generation/consumption errors are rethrown when the corresponding scoped
  `abortOnError` option is enabled.
- `examples/dts-host` validates unavailable remote type artifacts fail build-time consumption with
  a clear missing-types diagnostic when `abortOnError` is enabled.
- `examples/dts-host` validates corrupt remote type archives fail build-time consumption with the
  same deterministic missing-types diagnostic.
- `examples/dts-remote` validates invalid TypeScript exposes fail build-time generation when
  `generateTypes.abortOnError` is enabled.
- Unit coverage validates `displayErrorInTerminal`, disabled `generateTypes`/`consumeTypes`, and
  fully disabled DTS behavior.
- Exact DTS workflows, defaults, and recommended production settings are documented in
  `docs/dts-workflows.md`.

Remaining work:

- Verify Vue/Svelte style TS projects if those frameworks are added to the example matrix.

Acceptance criteria:

- A host can type-check imports from a remote without manual type copying.
- Dev type changes are reflected without restarting the host.
- DTS failures have clear diagnostics and predictable `abortOnError` behavior.
- Type artifacts are covered in CI, not only by unit-level plugin smoke tests.

Suggested commits:

- `test: add federation dts generation e2e`
- `test: add federation dts consumption e2e`
- `docs: document federation dts workflows`

### 3. SSR Production Hardening

Current state:

- Node target selection exists.
- `ssrRemoteEntry` is emitted and consumed.
- React SSR host/remote example builds.
- Manifest-driven asset/preload helper exists.
- A dedicated SSR Playwright config validates manifest remote server rendering and browser
  hydration.
- Runtime SSR diagnostics preserve manifest URL, selected remote entry, target, share scope, and
  remote alias/name on `lastLoadError`.
- Node SSR entry loader failures are wrapped with actionable `MFV-004` guidance for server-side
  fetch reachability, ESM SSR output, and the current `--experimental-vm-modules` requirement.
- The React SSR example injects server-side federation debug data into the HTML, recreates matching
  browser-side hydration debug data, and fails hydration early if manifest URL, remote id, share
  scope, or React version diverges.
- SSR e2e validates request-level HTML, server/client manifest consistency, React singleton version
  consistency, selected node/web entries, remote preload links, host `ssr.external`, and remote
  `ssrRemoteEntry` output.
- The production runtime guide documents SSR deployment patterns, public path/proxy behavior,
  `ssr.external`/`ssr.noExternal` expectations, and the VM module loader migration strategy.

Remaining work:

- No further SSR-specific P0 gaps are currently tracked beyond keeping the SSR example and e2e
  matrix green in CI.

Acceptance criteria:

- CI proves SSR host can consume remote and hydrate successfully.
- Server and browser use consistent share scopes and remote manifests.
- SSR failure modes produce actionable error codes and debug snapshots.
- Users have a documented deployment recipe for SSR remotes.

Suggested commits:

- `test: add ssr manifest consumption e2e`
- `feat: improve ssr remote diagnostics`
- `docs: document ssr deployment patterns`

### 4. Manifest Protocol And Schema Freezing

Current state:

- `mf-manifest.json`, `mf-stats.json`, and `mf-debug.json` are emitted.
- Runtime validates a minimal manifest shape.
- Build metadata and plugin version are traceable.
- `schemaVersion` is emitted for manifest, stats, and debug artifacts.
- JSON Schemas are committed under `docs/schemas`.
- Runtime accepts missing legacy schema versions and same-major future versions, while rejecting
  unsupported major versions.
- Runtime validates malformed known manifest fields and enforces target-specific entry requirements
  during manifest remote registration.
- Schema compatibility fixtures cover exact `1.0.0`, legacy, same-major, and future-major manifest
  cases.
- Generated manifests include `release.id`, `metaData.buildInfo.releaseId`, and entry-level
  `integrity`/`contentHash` metadata for remote entries.
- Manifest remotes can opt into runtime remote-entry verification through
  `registerManifestRemote(..., { integrity: true | { mode } })`, with debug snapshots recording
  successful and failed integrity checks.
- Backward/forward compatibility rules and manifest hosting/cache rules are documented as part of
  the manifest protocol.

Remaining work:

- No further manifest protocol gaps are currently tracked beyond keeping schema and integrity
  checks covered in CI.

Acceptance criteria:

- Every generated manifest validates against a committed schema.
- Runtime errors distinguish malformed manifests from unavailable manifests.
- Future schema changes can be tested against fixtures.
- External tools can safely consume the manifest and stats artifacts.

Suggested commits:

- `test: add manifest schema compatibility fixtures`
- `feat: add target-specific manifest validation`
- `feat: add manifest integrity metadata`

### 5. Compatibility Matrix

Current state:

- Basic OriginJS-style `virtual:__federation__` shim exists.
- `from` and `format` are normalized enough for the main migration path.
- `varFilename` can generate an additional var-style remote entry.
- Unit coverage executes the OriginJS shim APIs for static and dynamic remotes:
  `__federation_method_setRemote`, `__federation_method_getRemote`,
  `__federation_method_ensure`, `__federation_method_unwrapDefault`, and
  `__federation_method_wrapDefault`.
- `examples/originjs-compat-host` and `packages/vite-plugin-federation/e2e/originjs-compat.spec.ts`
  validate browser-side OriginJS migration APIs against real `remoteEntry.js` and
  `remoteEntry.var.js` assets, while also proving manifest-first and remoteEntry-first remotes can
  coexist on the same host.
- The OriginJS compatibility shim now throws `MFV-005` for unsupported legacy `format` values and
  missing `systemjs` runtimes, and emits a one-time `MFV-007` warning for unsupported `from`
  values.
- `examples/react-remote` exposes `./ManualCssButton` with `dontAppendStylesToHead: true`, and
  enables `bundleAllCSS: true` so `examples/originjs-compat-host` can verify the host receives the
  manual CSS href bucket and injects the stylesheet explicitly.
- `examples/webpack-systemjs-remote` gives the repository a real webpack Module Federation remote
  built with `library.type = 'system'`, and `examples/originjs-compat-host` now injects a local
  SystemJS runtime asset before consuming that remote through `virtual:__federation__`.
- A compatibility matrix documents supported, partially supported, and unsupported remote formats,
  `from` combinations, OriginJS APIs, and CSS migration behavior.

Remaining work:

- No further compatibility-specific gaps are currently tracked beyond keeping the matrix covered in CI.

Acceptance criteria:

- Common OriginJS migration paths work without rewriting app code.
- Unsupported compatibility combinations fail with clear messages.
- Compatibility logic stays isolated from the main manifest-first runtime path.

Suggested commits:

- `test: add originjs compatibility e2e`
- `feat: harden legacy remote format adapters`
- `docs: add compatibility matrix`

## P1 - Production Quality Improvements

These are not blockers for a beta, but they are important for a polished production release.

### 6. Dev HMR Beyond Full Reload

Current state:

- Remote dev updates can trigger host-side refresh behavior.
- CSS and type update events exist.
- Unit and one Playwright e2e cover the current dev remote HMR path.
- Remote update payloads include strategy, reason, batch id, and a small expose dependency graph so
  hosts/devtools can explain why partial reload, style update, type update, or full reload was used.
- Remote file events are debounced and duplicate file changes are batched before broadcasting.
- Host partial reload uses Vite `server.reloadModule()` for matching remote virtual modules and
  falls back to full reload when the module cannot be matched or Vite cannot reload it.
- Style and type updates remain page-state preserving when the host can refresh stylesheet links or
  type data without reloading.
- `docs/dev-hmr.md` documents strategies, batching, browser events, and fallback rules.

Remaining work:

- No further Dev HMR P1 gaps are currently tracked beyond expanding framework-specific e2e coverage
  when Vue/Svelte/Lit examples are added.

Acceptance criteria:

- Remote component edits update host without full page reload when the framework supports it.
- Unsupported HMR cases fall back predictably.
- Devtools or debug output explains the chosen reload strategy.

Suggested commits:

- `feat: add remote expose partial hmr graph`
- `test: add react remote partial hmr e2e`
- `docs: document dev hmr fallback behavior`

### 7. DevTools And Observability

Current state:

- `mf-debug.json` exists.
- `getFederationDebugInfo()` exposes runtime state.
- Browser runtime dispatches debug events.
- The browser global `window.__VITE_PLUGIN_FEDERATION_DEVTOOLS__` now exposes a documented
  `contractVersion`, bounded event retention, app payloads, the latest runtime snapshot, and
  `exportSnapshot()`/`copySnapshot()` helpers.
- The devtools endpoint advertises overlay capabilities and serves the same payload shape injected
  into the page.
- The built-in overlay renders runtime errors, registered remotes, manifest fetch timeline, shared
  resolution graph, preload state, and recent devtools events.
- Unit coverage validates endpoint payload shape, injected overlay panels, runtime event publishing,
  and event retention behavior.
- `docs/devtools-runtime-contract.md` documents the stable global contract for external tooling.

Remaining work:

- No further DevTools-specific P1 gaps are currently tracked beyond keeping the overlay optional and
  the contract backward compatible.

Acceptance criteria:

- A developer can inspect remotes, shared modules, manifest fetches, and recent errors in one place.
- Runtime debug information is stable enough for external tooling.
- DevTools stays optional and has no production overhead when disabled.

Suggested commits:

- `feat: expand federation devtools overlay`
- `docs: document devtools runtime contract`
- `test: cover devtools debug snapshots`

### 8. Runtime Resilience And Rollout Controls

Current state:

- Manifest fetch has timeout, retry, cache TTL, force refresh, and request collapsing.
- Remote refresh can invalidate manifest cache and update registered remotes.
- Manifest fetch can try an ordered `fallbackUrls` list, and relative remote entries resolve from
  the manifest origin that actually succeeded.
- `staleWhileRevalidate` can serve an expired cached manifest immediately while a background
  refresh updates cache and debug snapshots.
- Manifest circuit breaker controls can stop repeatedly failing remote manifests for a bounded
  cooldown window, with `circuit-open` events in the manifest fetch timeline.
- Runtime hooks/telemetry cover manifest fetch, manifest remote registration, manifest remote load,
  and remote refresh with `before`/`after`/`error` stages and latency fields.
- Runtime debug snapshots expose fallback `sourceUrl` and manifest circuit breaker state.
- Remote-entry integrity checks are available when manifest entry hashes are emitted and runtime
  verification is enabled.
- Route-level fallback recipes are documented in the production runtime guide.

Remaining work:

- No further runtime resilience P1 gaps are currently tracked beyond keeping rollout controls
  covered by unit tests and docs.

Acceptance criteria:

- Hosts can safely roll out remotes across CDN propagation windows.
- Repeated remote failures can be observed and throttled.
- Runtime controls are documented and covered by unit tests.

Suggested commits:

- `feat: add manifest fallback urls`
- `feat: add runtime telemetry hooks`
- `docs: add remote rollout recipes`

### 9. Compiler Adapter Robustness

Current state:

- Vite/Rolldown differences are handled in several places.
- Control chunks, TLA placeholders, and manual chunk protection exist.
- Remote import named export transforms are covered by unit tests.
- Remote named export transforms now emit sourcemaps with `source` and `sourcesContent`, and unit
  tests validate those fields.
- Control chunk sanitizer tests snapshot key output shapes for preload helper removal,
  load-share preload helper inlining, side-effect import removal, and Vite 8-style helpers.
- `docs/compiler-adapter.md` documents Vite/Rolldown adapter rules, control chunk constraints, Vite
  version policy, and the intentional `tsup` CJS named/default export warning.

Remaining work:

- No further compiler adapter P1 gaps are currently tracked beyond adding explicit multi-version
  Vite matrix jobs when the example matrix is expanded.

Acceptance criteria:

- Compiler behavior is deterministic across supported Vite versions.
- Manual chunk customization cannot break federation bootstrap ordering.
- Transforms preserve useful source maps.

Suggested commits:

- `test: add vite version compatibility matrix`
- `test: add control chunk output snapshots`
- `fix: stabilize federation transform sourcemaps`

## P2 - Ecosystem And Documentation Completeness

These items make the plugin easier to adopt and maintain across real projects.

### 10. Example And E2E Matrix

Current state:

- React host/remote examples exist.
- Vue host/remote examples validate SFC remotes, manifest consumption, and shared Vue singleton
  metadata in production builds.
- Svelte host/remote examples validate Svelte component remotes, manifest consumption, and shared
  Svelte singleton metadata in production builds.
- React SSR host exists.
- Dev remote HMR e2e exists.

Remaining work:

- Add Lit host/remote example.
- Add multi-remote host example.
- Add host consuming both manifest and legacy remoteEntry remotes.
- Add pnpm workspace/symlink shared dependency example.
- Add DTS producer/consumer example.
- Add SSR e2e with request-level HTML assertions.
- Add browser matrix if CI time allows.

Acceptance criteria:

- Examples cover the main framework and deployment patterns users will copy.
- E2E tests cover at least one path for every production-critical feature.
- Example commands are documented and run through CI or a scheduled workflow.

Suggested commits:

- `example: add vue federation example`
- `example: add dts federation example`
- `test: add multi-remote federation e2e`

### 11. API Reference And Migration Documentation

Current state:

- README includes quick start and production runtime entry.
- `docs/production-runtime.md` documents manifest runtime controls.
- `tech.md` documents the architecture.
- `docs/plugin-api.md` documents plugin options for remotes, hosts, shared packages, manifest
  output, devtools, DTS, and compatibility.
- `docs/runtime-api.md` documents `vite-plugin-federation/runtime`, manifest loading, rollout
  controls, SSR target selection, integrity, hooks, preload helpers, and debug APIs.
- `docs/manifest-protocol.md` documents manifest schema rules, compatibility fixtures, and hosting
  guidance.
- `docs/originjs-migration.md` documents the OriginJS migration path, virtual API mapping, CSS
  migration, and webpack SystemJS compatibility.
- `docs/troubleshooting.md` is organized by `MFV-*` error code and links errors to debug snapshot
  fields and recommended actions.
- Existing DTS, compatibility matrix, production SSR, devtools contract, and release checklist docs
  are linked from README.

Remaining work:

- No further API/migration documentation gaps are currently tracked beyond keeping references in
  sync with public API changes.

Acceptance criteria:

- A new user can configure host, remote, shared, DTS, SSR, and compat modes from docs alone.
- Error codes link to troubleshooting steps.
- Migration users can predict required code/config changes.

Suggested commits:

- `docs: add plugin api reference`
- `docs: add originjs migration guide`
- `docs: add troubleshooting guide`

### 12. CI, Release, And Package Quality

Current state:

- CI runs `pnpm check`.
- CI now installs a clean temporary Vite app from a real `pnpm pack` tarball and verifies the
  package can build there.
- Package smoke also verifies `sideEffects: false` and checks that production output does not
  include the devtools overlay bootstrap.
- Release workflow validates `pnpm pack --dry-run` before publishing.
- Release workflow is manual-only.
- A separate manual/scheduled Extended E2E workflow runs compatibility, shared runtime, SSR, and DTS
  dev e2e suites on Node 22 without adding release workflow pressure to normal pushes.
- `docs/release-checklist.md` documents Changeset policy, pre-`1.0.0` versioning policy, package
  quality gates, release steps, and rollback notes.
- Package exports include root and runtime entry.
- Build produces ESM, CJS, and DTS.

Remaining work:

- No further CI/release P1 gaps are currently tracked beyond keeping release docs and workflows
  aligned with package policy.

Acceptance criteria:

- A generated package tarball can be installed and used in a clean Vite app.
- CI catches broken exports, missing files, and invalid generated types.
- Release steps are reproducible and documented.

Suggested commits:

- `ci: add package smoke test`
- `ci: add extended e2e workflow`
- `docs: add release checklist`

## P3 - Advanced Differentiators

These items are valuable, but they can follow after the GA baseline.

### 13. Advanced Preload And Performance Optimization

Current state:

- `createFederationManifestPreloadPlan()` generates route-level preload plans from actual
  route-to-expose usage.
- Preload plans support `asyncChunkPolicy` values for no async chunks, async CSS, async JS, or all
  async chunks.
- The manifest schema accepts optional `preload` hints for route-critical assets and shared runtime
  assets that are not directly tied to one expose.
- `warmFederationRemotes()` registers selected manifest remotes and optionally calls runtime
  `preloadRemote` for host-side warmups.
- `getFederationDebugInfo().runtime.remoteLoadMetrics` records registration, load, and total
  durations for remote module load waterfalls.
- Unit coverage validates route preload plans, warm remote behavior, and remote load metrics.
- `docs/preload-performance.md` documents the API and performance budget guidance.

Remaining work:

- No further advanced preload/performance P3 gaps are currently tracked beyond adding broader
  browser-level budget checks when the example matrix is expanded.

Acceptance criteria:

- Hosts can intentionally warm critical remotes without overfetching.
- Preload behavior is observable and tunable.

### 14. Security And Supply Chain Controls

Current state:

- Manifest schema defines optional `integrity` and `contentHash` fields for remote entries.
- Manifest schema also accepts object-form expose/preload asset references with optional
  `integrity` and `contentHash` metadata.
- `registerManifestRemote(..., { integrity })` verifies manifest-declared remote entries before
  registration.
- `verifyFederationManifestAssets()` verifies annotated expose and preload assets, supports
  `prefer-integrity`, `integrity`, `content-hash`, and `both` modes, and can require integrity
  metadata for every declared asset.
- Debug snapshots record successful and failed integrity checks in
  `runtime.manifestIntegrityChecks`.
- `docs/security.md` documents CORS, CSP, Trusted Types, remote script policy, private manifests,
  authenticated loading, and signed manifest design notes.

Remaining work:

- No further security/supply-chain P3 gaps are currently tracked beyond integrating signed manifest
  verification if a concrete key-management requirement is added later.

Acceptance criteria:

- Enterprise users have a clear security story for remote manifests and assets.
- Security controls are optional and do not complicate the default path.

### 15. Multi-Tenant And Runtime Instance Isolation

Current state:

- Manifest runtime options accept `runtimeKey` for tenant or experiment partitioning.
- `runtimeKey` isolates manifest caches, pending manifest requests, manifest source URL tracking,
  circuit breaker state, registered manifest remote debug records, and remote load metrics.
- `createFederationRuntimeScope(runtimeKey)` exposes scoped wrappers for manifest fetch,
  registration, remote loading, refresh, warmups, and filtered debug snapshots.
- Runtime hooks and debug timeline entries include `runtimeKey` when a scoped runtime is used.
- Unit coverage validates same-URL manifest cache isolation and same-alias registered manifest
  remote diagnostics across separate runtime keys/share scopes.
- `docs/multi-tenant.md` documents scoped runtime usage and tenant-specific share scope guidance.

Remaining work:

- No further multi-tenant P3 gaps are currently tracked beyond adding a browser example if a
  concrete tenant shell scenario is added to the example matrix.

Acceptance criteria:

- A shell can host multiple tenants or experiments without remote registry collisions.
- Debug snapshots identify the relevant runtime instance.

## Known Local Worktree Note

At the time this TODO file was created, the local worktree already contained an unrelated version
change in `packages/vite-plugin-federation/package.json`:

```diff
-  "version": "0.0.0",
+  "version": "0.0.2",
```

This TODO file does not depend on that version change.
