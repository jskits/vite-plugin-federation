# vite-plugin-federation 1.0: Bringing Module Federation Into the Production Era for Vite

> A manifest-first, SSR-aware, multi-tenant, observable Module Federation 2.x runtime wrapper for Vite 5 / 6 / 7 / 8, including Rolldown.

> Published package status: as of the npm registry check on 2026-05-11, `vite-plugin-federation` is published as `1.0.0` and the npm `latest` dist-tag points to `1.0.0`.

```bash
pnpm add -D vite-plugin-federation
```

---

## 1. Why Micro-Frontends Still Have Production Gaps in the Vite Ecosystem

Module Federation became the de facto micro-frontend standard with Webpack 5. Anyone who has tried to land a micro-frontend system in the Vite ecosystem has likely run into the same set of constraints:

- **Vite does not implement Webpack's container protocol natively.** The two mainstream community options take different approaches: `@originjs/vite-plugin-federation` ships its own runtime around `virtual:__federation__`, while `@module-federation/vite` connects directly to `@module-federation/runtime`. Both are useful, but production governance often still has to be implemented in application code.
- **Production systems need a long list of resilience controls:** manifest caching and TTL, stale-while-revalidate, timeouts, jittered retries, circuit breakers, fallback URLs, request coalescing, SRI verification, multi-tenant isolation, CSP / Trusted Types, signed manifests, SSR, and observability. Without a unified runtime wrapper, these concerns tend to be scattered across the host application, gateway, CDN, and monitoring code.
- **Remote development experience has historically lagged behind.** With `@originjs`, remote development commonly relies on `vite build --watch`. In `@module-federation/vite@1.15.4`, `remoteHmr: true` has special handling for React Fast Refresh, while other cases more often fall back to a full page reload. Shared dependencies can also resolve inconsistently in pnpm/workspace setups, and singleton conflicts are difficult to diagnose at runtime.
- **Vite 8 plus Rolldown introduces another compatibility surface.** Bundle behavior, `modulePreload` helper rewriting, `output.codeSplitting.groups`, and top-level await all require federation plugins to handle another layer of compiler-specific behavior.

`vite-plugin-federation` 1.0 is designed to address that full checklist at once: **manifest-first loading, native SSR support, multi-tenant isolation, security and governance controls, deep observability, and one API across Vite 5 through Vite 8, including Rolldown.**

---

## 2. Positioning and Core Differences

| Dimension              | `vite-plugin-federation`                                                                                 | `@module-federation/vite`                                                           | `@originjs/vite-plugin-federation`                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Vite versions          | `^5 \|\| ^6 \|\| ^7 \|\| ^8`                                                                             | `^5 \|\| ^6 \|\| ^7 \|\| ^8`                                                        | No peer constraint; repository dev dependency is `vite@^4.0.5` |
| Runtime                | `@module-federation/runtime@2.3.3` pinned exactly, plus a production-oriented wrapper layer              | Direct pass-through to the MF runtime; current npm `1.15.4` uses `2.4.0`            | Custom runtime                                                 |
| Manifest protocol      | `mf-manifest.json` + `mf-stats.json` + `mf-debug.json`                                                   | First two only                                                                      | None                                                           |
| Production loading API | `loadRemoteFromManifest`, with cache TTL, SWR, retries, timeout, circuit breaker, fallback, and SRI      | Implement it yourself                                                               | Not supported                                                  |
| Multi-tenant isolation | `createFederationRuntimeScope(runtimeKey)`, with isolated cache and circuit breaker state                | None                                                                                | None                                                           |
| Remote dev HMR         | Opt-in, classified as `partial` / `style` / `types` / `full`                                             | `remoteHmr: true` supports a React special case; other cases are often full reloads | Remote development commonly depends on build watch             |
| SSR                    | Dedicated `ssrRemoteEntry` + `createServerFederationInstance` + asset preload collection                 | Only `target: 'node'` tree-shaking                                                  | Not supported                                                  |
| OriginJS compatibility | Default `virtual:__federation__` compatibility bridge                                                    | Not supported                                                                       | Native API                                                     |
| Error codes            | Stable `MFV-001` through `MFV-007`                                                                       | Generic logs                                                                        | None                                                           |
| Browser e2e            | `browser-matrix` covers Chromium / Firefox / WebKit; other e2e suites run according to their own configs | Depends on that repository's CI                                                     | -                                                              |

The repository's `COMPARISON.md` records the structured comparison and local evidence. External package versions change quickly, so any exact version claim should be checked against both the npm registry and the repository snapshot. The versions in this article, `vite-plugin-federation@1.0.0`, `@module-federation/vite@1.15.4`, and `@originjs/vite-plugin-federation@1.4.1`, were verified against the npm registry on 2026-05-11.

---

## 3. Architecture: Build-Time Plugins, Virtual Modules, Runtime, and Protocol

Structurally, `vite-plugin-federation` is a **plugin composition**, not a single monolithic plugin. Calling `federation()` injects a set of cooperating Vite plugins and pushes the core capability into four orthogonal layers:

```text
+-------------------------------------------------------------+
| 1. Build-time plugin layer (packages/.../src/plugins/*.ts)  |
| - early-init / proxy-remote-entry / proxy-remotes           |
| - originjs-compat / remote-named-exports / dev-remote-hmr   |
| - devtools / dts / mf-manifest / module-parse-end ...       |
|         |                                                   |
| 2. Virtual module layer (src/virtualModules/*.ts)           |
| - remoteEntry / ssrRemoteEntry / hostAutoInit               |
| - localSharedImportMap / loadShare / preBuildLib / exposes  |
|         |                                                   |
| 3. Runtime layer (src/runtime/index.ts, 4,366 lines)        |
| - createFederationInstance / createServerFederationInstance |
| - fetchFederationManifest / loadRemoteFromManifest ...      |
| - createFederationRuntimeScope / verifyFederationManifest...|
|         |                                                   |
| 4. Manifest protocol (docs/manifest-protocol.md, v1.0.0)    |
| - mf-manifest.json / mf-stats.json / mf-debug.json          |
| - JSON Schema + fixtures                                    |
+-------------------------------------------------------------+
```

The reason for this split is simple: **the hard part of production Module Federation is not importing code.** The hard part is allowing three different surfaces to evolve independently:

- **Build artifacts** are the public contract: manifest, entry files, assets, and type archives.
- **Runtime behavior** can evolve internally: caching policy, circuit breakers, SRI, and multi-tenant scope isolation.
- **Developer experience** can evolve separately: HMR, DevTools, and DTS synchronization.

This separation lets the plugin handle manifest tolerance independently from Vite compiler adaptation. It also allows users to import only the runtime subpath, `vite-plugin-federation/runtime`, for SSR, CDN warming, or tenant-isolated loading.

---

## 4. Manifest Protocol: Turning a Remote Into a Governable Deployment Unit

The manifest is the most important design choice in this project. Every remote build with `manifest: true` emits three files:

| File               | Role                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `mf-manifest.json` | Runtime contract with the host: `name`, `exposes`, `shared`, `remoteEntry`, `ssrRemoteEntry`, `preload`, `integrity`, and `buildInfo` |
| `mf-stats.json`    | Asset and shared-dependency analysis for external tooling                                                                             |
| `mf-debug.json`    | Snapshot for CI and diagnostics, including plugin options, capability flags, and normalized results                                   |

The manifest schema includes `schemaVersion: "1.0.0"`. The runtime guarantees the following behavior:

- Missing version: treated as a legacy manifest.
- Same major version, for example `1.x.y`: accepted.
- Different major version: rejected with **`MFV-004`**.
- Field deserialization failure: also reported as `MFV-004`.

The manifest also carries deployment semantics. The repository recommends the following cache policy:

```text
mf-manifest.json      Cache-Control: no-cache
remoteEntry*.js       Cache-Control: public, max-age=31536000, immutable
assets/*              Cache-Control: public, max-age=31536000, immutable
@mf-types*            Cache-Control: public, max-age=31536000, immutable
```

The manifest is short-lived; all referenced assets are immutable. That makes rollback a matter of switching the manifest back to a previous version, rather than purging the CDN or fighting ETags inside a worker. The paired `release.id` and `contentHash` fields also make incident analysis precise: you can identify exactly which build produced the failing artifact.

The JSON Schemas live in `docs/schemas/`. CI validates fixtures for three compatibility paths: legacy manifests, same-major manifests, and next-major manifests. Protocol changes therefore cannot silently break existing hosts.

---

## 5. Runtime: Production Behavior Built Into the SDK

`vite-plugin-federation/runtime` is the other half of the project. It wraps `@module-federation/runtime` with production behavior that most real micro-frontend systems need, but few teams want to reimplement for every host.

### 5.1 One `loadRemoteFromManifest` Call Covers the Production Parameters

```ts
import { loadRemoteFromManifest } from 'vite-plugin-federation/runtime';

const mod = await loadRemoteFromManifest('catalog/Button', catalogManifestUrl, {
  cacheTtl: 30_000, // 30s in-memory cache
  staleWhileRevalidate: true, // serve stale data first, refresh silently in the background
  fallbackUrls: [backupManifestUrl], // fall back automatically if the primary source fails
  retries: 2, // jittered retry on failure
  retryDelay: 200,
  timeout: 4_000, // per-request timeout
  circuitBreaker: { failureThreshold: 3, cooldownMs: 30_000 }, // open for 30s after 3 failures
  integrity: { mode: 'prefer-integrity' }, // SRI / content-hash verification
  fetchInit: { credentials: 'include' }, // private manifests
  hooks: {
    manifestFetch: log,
    remoteRegister: log,
    remoteLoad: log,
    remoteRefresh: log,
  },
});
```

That call does far more than `fetch + import`:

- **Request coalescing:** concurrent requests for the same manifest share one in-flight Promise.
- **Source tracking:** cache entries record `sourceUrl`, `fetchedAt`, `expiresAt`, and `runtimeKey`, so you know whether the primary or fallback URL was used.
- **Metrics collection:** every success and failure is written to `remoteLoadMetrics`, including `registrationDurationMs`, `loadDurationMs`, and total `durationMs`.
- **Circuit breaker state and last error context:** `lastLoadError` includes the entry, target, and share scope, making it easier to route into Sentry, Grafana, or another telemetry system.
- **SRI / content-hash verification:** four modes are supported: `prefer-integrity`, `integrity`, `content-hash`, and `both`. `verifyFederationManifestAssets()` can also validate all expose and preload assets during warmup.

### 5.2 Multi-Tenant Isolation With `createFederationRuntimeScope`

This capability is not directly provided by either of the two mainstream Vite Module Federation plugins compared in this article. If a shell runs multiple tenant-specific remote sets, A/B experiment groups, or white-label products in the same page, each tenant can get its own runtime scope:

```ts
import { createFederationRuntimeScope } from 'vite-plugin-federation/runtime';

const tenantA = createFederationRuntimeScope('tenant-a');
const tenantB = createFederationRuntimeScope('tenant-b');

await tenantA.registerManifestRemote('shop', tenantAManifestUrl, { shareScope: 'tenant-a' });
await tenantB.registerManifestRemote('shop', tenantBManifestUrl, { shareScope: 'tenant-b' });

const PageA = await tenantA.loadRemoteFromManifest('shop/Page', tenantAManifestUrl);
```

Each scope has its own manifest cache, in-flight request map, circuit breakers, debug records, and load metrics. A failed remote in one tenant cannot poison another tenant's failure budget or cache key. `getFederationRuntimeScopeDebugInfo(runtimeKey)` returns a snapshot for one tenant only, which keeps telemetry isolated as well.

### 5.3 Route-Aware Preloading

```ts
import { createFederationManifestPreloadPlan } from 'vite-plugin-federation/runtime';

const plan = createFederationManifestPreloadPlan(
  catalogManifestUrl,
  manifest,
  {
    '/checkout': ['./Cart', './PaymentForm'],
    '/account': './AccountHome',
  },
  {
    asyncChunkPolicy: 'css', // 'none' | 'js' | 'css' | 'all'
  },
);

// plan.links -> [{ rel: 'modulepreload', href }, { rel: 'stylesheet', href }, ...]
```

The default policy, `'css'`, adds synchronous JS, synchronous CSS, and asynchronous CSS to `<link>` tags, while leaving asynchronous JS to the framework's lazy-loading behavior. That is a pragmatic default for first-paint and LCP-sensitive routes. `warmFederationRemotes` can register and warm multiple remotes at application startup; for critical routes, `asyncChunkPolicy: 'all'` can then push the core chunks into the document head.

### 5.4 Stable Error Codes and Observability

Most diagnosable runtime, build-time, and compatibility-layer failures carry an `MFV-NNN` code:

| Code      | Meaning                                                                          |
| --------- | -------------------------------------------------------------------------------- |
| `MFV-001` | Plugin configuration error                                                       |
| `MFV-002` | Shared key and alias conflict                                                    |
| `MFV-003` | Missing shared dependency, fallback, or strict-singleton conflict                |
| `MFV-004` | Manifest fetch or validation failure, including `sourceUrl`                      |
| `MFV-005` | Missing expose or unsupported legacy `format`                                    |
| `MFV-006` | `target: 'node'` cannot find a usable `ssrRemoteEntry` or `remoteEntry` fallback |
| `MFV-007` | Unsupported legacy `from` value or dynamic import rewrite warning                |

`getFederationDebugInfo()` returns the current instance, registered remotes, manifest cache, fetch timeline, SRI check records, circuit breaker state, load metrics, and the shared-resolution graph, including rejected candidate versions. That makes it possible to inspect shared resolution with `console.table` instead of reverse-engineering why React, or any other singleton, was loaded twice.

---

## 6. Build-Time Behavior: Fixing the Sharp Edges in Bundle Output

Manifest and runtime behavior ultimately depend on the shape of the compiled output. This is the most compiler-sensitive part of the project, and it is also where federation plugins tend to fail in subtle ways.

### 6.1 The `early-init` Plugin and Virtual Modules

`createEarlyVirtualModulesPlugin` starts in the `config` hook with `enforce: 'pre'`:

- It creates the `__mf__virtual` directory early, avoiding Vite optimizer 504 errors such as "Outdated Optimize Dep".
- It writes `usedRemotes` and `usedShares` into `localSharedImportMap` early, so build-time tracing of `remoteEntry` does not encounter an empty `usedRemotes` array and produce surprising chunks.
- It handles `optimizeDeps.include / exclude` carefully under Vite 8 / Rolldown. A bare-specifier remote must not be prebundled into `_vite/deps/remote_x.js`, because that breaks named exports in frameworks such as Angular. At the same time, a local npm package with the same name must still be preserved, so the plugin probes with `getInstalledPackageJson` before deciding.
- Shared IDs such as Lit, which need to remain ESM-shaped in dev, are routed through `optimizeDeps.exclude`. Under Vite 8 / Rolldown, the plugin also avoids handing TLA-bearing virtual modules such as `loadShare` to the dependency optimizer for CJS conversion. Otherwise, shared modules can become unresolved Promises, which breaks plugins such as Pinia that depend on shared initialization order.

### 6.2 Chunk Isolation and Rolldown Adaptation

Module Federation's `runtimeInit` and `loadShare` modules are top-level-await control chunks. They must not be merged with business code. The plugin handles both Rollup and Rolldown inside `module-federation-esm-shims`:

```ts
const mfManualChunks = function (id) {
  if (id.includes(runtimeInitId)) return 'runtimeInit';
  if (id.includes(LOAD_SHARE_TAG))
    return id.match(/([^/\\]+__loadShare__[^/\\]+)/)?.[1] ?? 'loadShare';
};
```

If the user configures `output.manualChunks`, the plugin prints a one-time warning and replaces it with federation-specific `mfManualChunks` rules. Non-federation modules return to the bundler's default chunking rather than continuing to use the user's custom vendor grouping. That tradeoff protects `runtimeInit` and `loadShare` from being merged into application chunks and breaking their top-level-await semantics.

`output.codeSplitting.groups`, introduced in Vite 8, is also removed. It can bind share-init wrappers and dependency modules together, causing standalone remotes to fail before mounting. The full compiler-adapter notes are documented in `docs/compiler-adapter.md`.

### 6.3 `pluginRemoteNamedExports`: Named Remote Imports Under Rolldown

Rollup-era builds could rely on `syntheticNamedExports` for named exports from remote modules. Rolldown, used by Vite 8, does not support that hook. This plugin rewrites consumer code instead:

```ts
import { foo } from 'remote/x';

// becomes
import { __moduleExports as __mf_ns_0 } from 'remote/x';
const { foo } = __mf_ns_0;
```

Dynamic `import('remote/x')` is wrapped with a `then` handler that expands `__moduleExports` into a namespace while preserving `default`. This allows Vite 8 + Rolldown users to keep writing ordinary ES named imports instead of changing application code for remote modules.

### 6.4 Cross-Origin `modulePreload` Helper Rewriting

Vite's default `modulePreload` helper computes dependencies from relative paths. When a remote is served from a cross-origin CDN, that base calculation is wrong. The plugin rewrites the helper across esbuild, terser, arrow-function, and regular-function output forms so that the base becomes `import.meta.url`. It also short-circuits `document` / `window` branches during SSR, preventing the helper itself from crashing during hydration.

### 6.5 SSR: `ssrRemoteEntry` as a First-Class Artifact

The plugin generates an additional SSR entry for remotes with `exposes`. On the host side, server loading chooses the Node-oriented entry when `target: 'node'` is passed, or when the runtime infers a non-browser environment from the absence of `window`:

- Remote builds emit an additional `*.ssr.js`, the `ssrRemoteEntry`. Build-side `target` / `build.ssr` affects the `ENV_TARGET` define, making browser or Node branches easier to tree-shake.
- The manifest records the artifact in `metaData.ssrRemoteEntry`. A Node host prefers the SSR entry when registering a remote. If the manifest does not declare an SSR entry, `remoteEntry` is used as a compatibility fallback. `MFV-006` is thrown only when no usable entry exists or the SSR entry structure is invalid.
- The runtime provides `createServerFederationInstance({ inBrowser: false })` and `collectFederationManifestPreloadLinks()`. The former evaluates ESM through Node's `vm` module; the latter returns deduplicated `<link rel="modulepreload"|"stylesheet">` descriptors so streaming SSR can write critical remote assets into the document head.
- If Vite's `modulePreload` helper is evaluated during SSR, missing `document` / `window` globals no longer crash the helper itself. Browser global access inside business exposes still has to be written in an SSR-safe way.

The cost is that Node currently still needs `--experimental-vm-modules`. That requirement comes from the `SourceTextModule` bridge used for server-side entry loading, and the repository README and examples document it explicitly.

---

## 7. Developer Experience: Classified HMR, DevTools, and Live Type Synchronization

### 7.1 Classified HMR

`@module-federation/vite` remote HMR is closer to a full reload, while the common OriginJS development path depends on `vite build --watch` for the remote. After explicitly enabling `dev: { remoteHmr: true }`, this plugin classifies remote updates:

| Category  | Trigger                                                                         | Behavior                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `partial` | Changed file hits an expose or its dependency graph                             | Host calls `server.reloadModule()`; when the framework HMR boundary supports it, component state can be preserved, for example with a React Fast Refresh-compatible expose |
| `style`   | CSS, SCSS, or Less file changed                                                 | Refresh only the matching stylesheet link                                                                                                                                  |
| `types`   | `.d.ts` file changed                                                            | Push through WebSocket to the host; no reload required                                                                                                                     |
| `full`    | No expose graph or valid boundary is found, or partial update is not applicable | Fall back to full page reload                                                                                                                                              |

Every update includes a `reason`, `batchId`, and a compact `dependencyGraph` with matched exposes, files, importer previews, and match patterns. Multiple file writes from one save are coalesced with a 25 ms debounce to avoid a reload storm.

### 7.2 DevTools

When `dev.devtools !== false`, which is the default, the plugin starts a `/__mf_devtools` endpoint and injects a browser panel. The panel reads from the contract-stable `window.__VITE_PLUGIN_FEDERATION_DEVTOOLS__` global and displays:

- Registered runtime and manifest remotes.
- Manifest fetch timeline.
- Shared-resolution graph, including rejected candidates.
- Last preload and last error.
- The latest 50 DevTools events.

Capacity, field names, and event names such as `vite-plugin-federation:debug` and `vite-plugin-federation:remote-update` are stable within the `1.x` contract, so external tools can integrate against them.

### 7.3 Live Type Synchronization

DTS output is no longer only a zip written after build. During development, the remote publishes `dist/.dev-server.zip` and `dist/.dev-server.d.ts`. The host syncs the latest declarations over the dev WebSocket, allowing it to type-check the current remote API without restarting the host dev server. This updates TypeScript's view of `loadRemote` hints and host-side type checking; it does not change runtime module values. In production builds, `typesOnBuild: true` fails the build when required types are unavailable, preventing a release with incompatible host and remote types.

---

## 8. Security and Supply Chain: From SRI to Signed Manifests

### 8.1 Built-In SRI and Content Hashes

During build, the plugin calculates `integrity` and `contentHash` for `remoteEntry` and `ssrRemoteEntry`, then writes them into the manifest. Expose and preload assets can also use object-form records with hashes. The runtime's four verification modes, `prefer-integrity`, `integrity`, `content-hash`, and `both`, cover different deployment combinations, while `verifyFederationManifestAssets()` can validate the full asset set during warmup.

### 8.2 Private and Signed Manifests

`fetchInit` plus a custom `fetch` function is the standard path for Bearer or cookie authentication. For high-assurance deployments, the repository's signed-manifest recipe intentionally keeps signature verification inside a custom `fetch` wrapper. The signature, key ID, and algorithm can come from headers or a sidecar file; after verification, the wrapper returns the `Response` to the runtime. This decouples the runtime from enterprise key-management systems and avoids embedding a KMS concern into the federation loader itself.

### 8.3 Explicit SSR Risk Boundaries

One warning in the documentation is especially important: **never allow tenant-controlled or user-controlled strings to become the SSR Node manifest URL directly.** A manifest remote runs server-side code; URL injection can become RCE or SSRF. The React SSR example disables query-based overrides by default. The e2e path enables `REACT_REMOTE_MANIFEST_QUERY_OVERRIDES=1` only with an allowlist.

The CSP / Trusted Types guidance is similarly direct. The manifest-first ESM path does not need inline scripts, and tenant-level CSP is safer than wildcard policies.

---

## 9. Compatibility: Smooth Migration From OriginJS and @module-federation/vite

### 9.1 OriginJS Users: The Default Shim Keeps Existing Code Running

`compat.virtualFederationShim` is enabled by default. The five most commonly used `virtual:__federation__` methods in OriginJS migrations have corresponding shims:

```ts
import {
  __federation_method_setRemote,
  __federation_method_getRemote,
  __federation_method_ensure,
  __federation_method_unwrapDefault,
  __federation_method_wrapDefault,
} from 'virtual:__federation__';
```

Legacy OriginJS paths such as `./Button` are normalized to `remote/Button` and then handled by `@module-federation/runtime`. `dontAppendStylesToHead: true` remains valid and maps to `css.inject: 'manual'`.

The repository includes `examples/originjs-compat-host` and `examples/webpack-systemjs-remote`, demonstrating a Vite host that uses the shim to load a real webpack remote with `library.type: 'system'`. The compat e2e suite covers that path. The three-browser `browser-matrix` covers cross-browser behavior for React and Lit manifest remotes; it does not claim that the compat case itself is part of the three-browser matrix.

### 9.2 @module-federation/vite Users: One Dependency Switch

```diff
- "@module-federation/vite": "^1.15.4"
+ "vite-plugin-federation": "^1.0.0"
```

```diff
- import { federation } from '@module-federation/vite';
+ import federation from 'vite-plugin-federation';
```

This package pins `@module-federation/runtime@2.3.3`, `@module-federation/sdk@2.3.3`, and `@module-federation/dts-plugin@2.3.3` exactly to one version set. It also aliases `@module-federation/runtime` imports in Vite config to the same bridge to reduce the chance of multiple federation states in one application.

One caveat matters: the current npm `@module-federation/vite@1.15.4` already uses MF runtime `2.4.0`. If your application directly depends on `@module-federation/runtime@2.4.x`, check the lockfile during migration and prefer runtime APIs from `vite-plugin-federation/runtime`. The core configuration surfaces are close, and existing `manifest`, `dts`, `dev`, `runtimePlugins`, `shareStrategy`, and `shareScope` settings can usually be carried over. Custom options and lockfile differences should still be reviewed one by one.

The differences are explicit: `mf-debug.json` is new and can be ignored safely; `runtimeInit` / `loadShare` chunk isolation is enforced and replaces user `manualChunks` with a one-time warning; dev `remoteHmr` is opt-in and requires `dev: { remoteHmr: true }`. The full migration checklist is in `docs/migrate-from-module-federation-vite.md`.

---

## 10. Engineering Quality: Six Playwright Suites, Multi-Version Vite, and JSON Schema Validation

The 1.0 label is backed by executable quality gates:

- **Six Playwright e2e configs:** default, `compat`, `shared`, `multi-remote`, `ssr`, and `browser-matrix` with Chromium / Firefox / WebKit.
- **Vite peer matrix smoke tests:** the release tarball is built and run against Vite 5 / 6 / 7 / 8.
- **DTS hot-sync e2e:** `e2e/dts-dev-hot-sync.mjs` verifies type synchronization during dev hot updates.
- **Twenty-three examples:** React, Vue, Svelte, Lit, SSR, DTS, multi-remote, workspace sharing, shared negotiation, host-only, strict-singleton, OriginJS compatibility, and webpack/SystemJS interop.
- **JSON Schema plus fixtures:** `docs/schemas/` and `docs/fixtures/manifest-protocol/` cover legacy, same-major, and next-major manifests.
- **Public API contracts:** `docs/public-api-contract.md` fixes plugin options, runtime exports, and error codes; `docs/devtools-runtime-contract.md` fixes DevTools fields and event contracts.
- **GitHub Actions:** `ci.yml` validates pull requests, `extended-e2e.yml` runs the full e2e set on Mondays and manually, and `release.yml` is triggered by `v*.*.*` tags with `provenance: true`.

The repository also provides a local verification path:

```bash
pnpm install
pnpm check                         # format check + lint + typecheck + unit tests + build
pnpm examples:build                # React + SSR + DTS smoke
pnpm test:vite-matrix:smoke        # multi-major Vite smoke tests
pnpm --filter vite-plugin-federation test:e2e:browser-matrix
```

These commands answer the practical production-readiness question with executable evidence rather than README claims.

---

## 11. Getting Started in Three Steps

### Step 1: Remote

```ts
// remote/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from 'vite-plugin-federation';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'catalog',
      filename: 'remoteEntry.js',
      exposes: { './Button': './src/Button.tsx' },
      shared: {
        react: { singleton: true, requiredVersion: '^19.2.4' },
        'react-dom': { singleton: true, requiredVersion: '^19.2.4' },
        'react/': { singleton: true, requiredVersion: '^19.2.4' },
        'react-dom/': { singleton: true, requiredVersion: '^19.2.4' },
      },
      // manifest defaults to true and emits all three manifest artifacts
    }),
  ],
  build: { target: 'esnext', cssCodeSplit: true },
});
```

### Step 2: Host

```ts
// host/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from 'vite-plugin-federation';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'shell',
      remotes: { catalog: 'https://cdn.example.com/catalog/mf-manifest.json' },
      shared: {
        react: { singleton: true, requiredVersion: '^19.2.4' },
        'react-dom': { singleton: true, requiredVersion: '^19.2.4' },
        'react/': { singleton: true, requiredVersion: '^19.2.4' },
        'react-dom/': { singleton: true, requiredVersion: '^19.2.4' },
      },
    }),
  ],
});
```

### Step 3: Load the Remote in Application Code

```tsx
import { lazy, Suspense, type ComponentType } from 'react';
import { loadRemoteFromManifest } from 'vite-plugin-federation/runtime';

type RemoteButtonModule = { default: ComponentType };

const CatalogButton = lazy(async () => {
  const mod = await loadRemoteFromManifest<RemoteButtonModule>(
    'catalog/Button',
    'https://cdn.example.com/catalog/mf-manifest.json',
    {
      cacheTtl: 30_000,
      integrity: true,
      retries: 2,
      timeout: 4_000,
    },
  );
  return { default: mod.default };
});

export const App = () => (
  <Suspense fallback={null}>
    <CatalogButton />
  </Suspense>
);
```

At this point the host already has 30-second manifest caching, automatic retries, entry SRI / content-hash verification, remote loading metrics, and stable error codes. DevTools are enabled by default in the dev server. Add `dev: { remoteHmr: true }` for classified remote HMR. Pass `target: 'node'` to `loadRemoteFromManifest` for SSR-first entry selection. Wrap calls with `createFederationRuntimeScope(tenantId)` to get multi-tenant isolation.

---

## 12. When to Choose It, and When Not To

Evaluate or adopt this repository's `vite-plugin-federation` 1.0.0 if you:

- Need a **production-grade host loader** with cache TTL, SWR, jittered retries, fallback URLs, circuit breakers, SRI, and request coalescing.
- Serve **multiple tenants, A/B experiment groups, or white-label products** in the same page. Among the two mainstream Vite MF plugins compared in this article, only this repository provides a `runtimeKey`-level runtime isolation API.
- Use **Node SSR** and need a server-aware federation instance plus asset preloading. The repository validates this path with the React SSR example and e2e suite. Vue, Svelte, Vinext, and similar frameworks can integrate through the same runtime path, but each project should still add its own SSR validation.
- Want **stable error codes** (`MFV-NNN`) and observable debug snapshots.
- Are **migrating away from OriginJS** and want existing `virtual:__federation__` code to keep running while you move gradually to manifest-first loading.
- Are adopting **Vite 8 / Rolldown** and are willing to validate against this repository's 1.0.0 snapshot before release.

Another option may be a better fit if:

- Your product **does not need runtime governance** and only wants the thinnest official Vite adapter. `@module-federation/vite` can work, but you will need to implement caching, retries, and circuit breakers yourself.
- You are **still on Vite 4** and do not plan to upgrade. `@originjs/vite-plugin-federation` is closer to that historical target, but it comes with weaker shared-dependency governance and a remote development path that commonly depends on build watch.

---

## Closing

The real micro-frontend problem is not whether code can be split into another build. The production question is whether that split code can be released, rolled back, diagnosed, and monitored reliably. `vite-plugin-federation` 1.0 is designed to complete that production checklist and make Module Federation a governable capability in the Vite era.

- GitHub: [jskits/vite-plugin-federation](https://github.com/jskits/vite-plugin-federation)
- Full comparison and migration guides: [COMPARISON.md](../../COMPARISON.md), [docs/migrate-from-module-federation-vite.md](../migrate-from-module-federation-vite.md), [docs/originjs-migration.md](../originjs-migration.md)
- Public API contract: [docs/public-api-contract.md](../public-api-contract.md)

If you are starting a new micro-frontend project, or preparing to move Vite 5+ federation into production, install `vite-plugin-federation@1.0.0`, validate it against your deployment topology, open issues, and contribute cases.
