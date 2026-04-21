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

Remaining work:

- Implement full `allowNodeModulesSuffixMatch` support for pnpm, symlinked workspaces, and nested
  `node_modules` layouts.
- Build a real shared resolution graph that records exact match, package-root match, trailing-slash
  subpath match, suffix match, and fallback mode.
- Add deterministic version negotiation diagnostics for `loaded-first` and `version-first`.
- Enforce or clearly report singleton conflicts instead of only passing `singleton` through.
- Emit `MFV-003` diagnostics for shared misses, version mismatches, and fallback selection.
- Add runtime debug output for shared provider, consumer, selected version, fallback source, and
  decision reason.
- Validate `strictVersion` behavior under local fallback and host-only shared packages.
- Add tests for React singleton mismatch, Vue subpath shared packages, pnpm symlinked packages, and
  workspace package aliases.

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

Remaining work:

- Add e2e tests proving remote type generation creates `@mf-types.zip` and `@mf-types.d.ts`.
- Add host e2e tests proving generated remote types are consumed by TypeScript.
- Add dev e2e tests for type hot sync after a remote type change.
- Validate `remoteTypeUrls` with manifest-derived URLs and custom URLs.
- Validate `abortOnError`, `displayErrorInTerminal`, `typesOnBuild`, `consumeAPITypes`, and
  `generateAPITypes`.
- Add failure-mode tests for unavailable type URLs, corrupt zip payloads, and invalid TS projects.
- Document exact DTS defaults and recommended production settings.
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

Remaining work:

- Validate hydration uses the same manifest URL and compatible share scope.
- Validate React singleton sharing across server render and browser hydration.
- Add tests for `ssr.external` and `ssr.noExternal` interactions.
- Add tests for server-only remote entry failure and fallback behavior.
- Decide whether Node VM module loading is a permanent strategy or a temporary bridge.
- If temporary, design a path to remove or hide the `--experimental-vm-modules` requirement.
- Validate SSR public path behavior when browser and server assets are served from different origins.
- Add SSR failure diagnostics for entry selection, node loader failures, and hydration mismatch risks.

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

Remaining work:

- Define backward and forward compatibility rules.
- Decide whether manifest should include integrity, content hash, or release id fields.
- Document manifest hosting and cache rules as part of the protocol, not only runtime guidance.

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

Remaining work:

- Add e2e coverage for OriginJS migration APIs:
  - `__federation_method_setRemote`
  - `__federation_method_getRemote`
  - `__federation_method_ensure`
  - `__federation_method_unwrapDefault`
  - `__federation_method_wrapDefault`
- Validate `format: 'esm'`, `format: 'var'`, and `format: 'systemjs'`.
- Validate `from: 'vite'`, `from: 'webpack'`, and mixed host/remote combinations.
- Validate remoteEntry-first and manifest-first compatibility behavior.
- Validate `dontAppendStylesToHead` migration to the new CSS behavior.
- Add explicit errors or warnings for unsupported legacy combinations.
- Publish a compatibility matrix with supported, partially supported, and unsupported combinations.

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

Remaining work:

- Implement true module-level partial HMR for remote exposes where feasible.
- Preserve host application state when only a remote expose implementation changes.
- Define fallback rules from partial HMR to full reload.
- Add framework-aware validation for React Fast Refresh and Vue HMR.
- Track remote expose dependency graph in dev sidecar.
- Add debouncing and batching for rapid remote changes.
- Add dev diagnostics showing why a change used partial reload or full reload.

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
- A minimal devtools overlay exists.

Remaining work:

- Add shared resolution graph visualization.
- Add manifest cache and fetch timeline visualization.
- Add preload graph visualization.
- Add remote registry and refresh history visualization.
- Add runtime error panel with error code, remote id, manifest URL, and stack.
- Add copy/export debug snapshot action.
- Add a stable `window.__VITE_PLUGIN_FEDERATION_DEVTOOLS__` contract document.
- Add tests for overlay payload shape and event retention behavior.

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

Remaining work:

- Add optional multi-origin manifest fallback list.
- Add stale-while-revalidate behavior for manifests.
- Add circuit breaker style protection for repeatedly failing remotes.
- Add runtime plugin hooks around manifest fetch, remote register, remote load, and refresh.
- Add optional integrity checks for manifest-declared assets if the manifest includes hashes.
- Add structured telemetry hooks for manifest fetch latency and remote load latency.
- Add route-level fallback recipes for host applications.

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

Remaining work:

- Expand Vite version matrix tests for Vite 5, 6, 7, and 8 where feasible.
- Expand Rolldown-specific tests for CJS interop, dynamic import, and manual chunks.
- Add source map validation for transformed remote imports.
- Add stress tests for large module graphs and module parse timeout/idle timeout behavior.
- Replace fragile text placeholders where a safer transform hook exists.
- Resolve or intentionally document the CJS named/default export warning emitted by `tsup`.
- Add build output snapshot tests for key control chunks.

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
- React SSR host exists.
- Dev remote HMR e2e exists.

Remaining work:

- Add Vue host/remote example.
- Add Svelte host/remote example.
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

Remaining work:

- Add complete plugin config API reference.
- Add runtime API reference for `vite-plugin-federation/runtime`.
- Add manifest protocol reference.
- Add OriginJS migration guide.
- Add troubleshooting guide organized by error code.
- Add SSR deployment guide.
- Add DTS guide.
- Add compatibility matrix.
- Add release checklist for maintainers.

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
- Release workflow is manual-only.
- Package exports include root and runtime entry.
- Build produces ESM, CJS, and DTS.

Remaining work:

- Add package publish dry-run validation.
- Add `pnpm pack` artifact smoke test.
- Add install smoke test in a temporary Vite app.
- Add scheduled or manual extended e2e workflow for heavier framework matrix tests.
- Add changeset policy documentation.
- Validate package side effects and tree-shaking behavior.
- Decide package versioning policy before first public release.

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

Remaining work:

- Generate preload plans from actual route/expose usage.
- Add optional async chunk prefetching policy.
- Add manifest-level preload hints.
- Add runtime metrics for remote module load waterfalls.
- Add host-side APIs for warming selected remotes.
- Add performance budget tests for runtime bootstrap and manifest fetch overhead.

Acceptance criteria:

- Hosts can intentionally warm critical remotes without overfetching.
- Preload behavior is observable and tunable.

### 14. Security And Supply Chain Controls

Remaining work:

- Define optional integrity fields in manifest schema.
- Add optional runtime integrity verification for manifest-declared assets.
- Document CORS, CSP, Trusted Types, and remote script policies.
- Add guidance for private manifests and authenticated remote loading.
- Add signed manifest design notes if needed.

Acceptance criteria:

- Enterprise users have a clear security story for remote manifests and assets.
- Security controls are optional and do not complicate the default path.

### 15. Multi-Tenant And Runtime Instance Isolation

Remaining work:

- Validate multiple federation instances on one page.
- Add explicit APIs or examples for tenant-specific remote registries.
- Ensure manifest caches can be isolated by tenant/runtime instance if needed.
- Add tests for separate share scopes with same remote alias.

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
