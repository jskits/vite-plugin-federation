# vite-plugin-federation

[![CI](https://github.com/jskits/vite-plugin-federation/actions/workflows/ci.yml/badge.svg)](https://github.com/jskits/vite-plugin-federation/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/vite-plugin-federation.svg)](https://www.npmjs.com/package/vite-plugin-federation)
![license](https://img.shields.io/npm/l/vite-plugin-federation)

> A production-oriented beta [Module Federation 2.0][mf2] plugin for **Vite 5 / 6 / 7 / 8**
> (including Rolldown). Manifest-first. SSR-aware. Multi-tenant. Includes an
> OriginJS-compatible `virtual:__federation__` migration shim.

```bash
pnpm add -D vite-plugin-federation
```

[mf2]: https://module-federation.io/

---

## Table of Contents

- [Why this plugin](#why-this-plugin)
- [Compared to Other Vite Federation Plugins](#compared-to-other-vite-federation-plugins)
- [Install](#install)
- [Quick Start](#quick-start)
  - [Remote](#a-remote)
  - [Host](#a-host)
  - [SSR Host](#an-ssr-host)
- [Plugin Options](#plugin-options)
- [Runtime API](#runtime-api)
- [Manifest Protocol](#manifest-protocol)
- [Dev Experience](#dev-experience)
- [SSR](#ssr)
- [TypeScript / DTS](#typescript--dts)
- [Production Runtime](#production-runtime)
- [Multi-Tenant Deployments](#multi-tenant-deployments)
- [Preload & Performance](#preload--performance)
- [Security](#security)
- [OriginJS Compatibility & Migration](#originjs-compatibility--migration)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)
- [Repository Layout](#repository-layout)
- [Development](#development)
- [Release Flow](#release-flow)
- [CI / CD](#ci--cd)
- [License](#license)

---

## Why this plugin

| Need                                            | What this plugin gives you                                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vite 5 / 6 / 7 / 8 + Rolldown** in one plugin | First-class compiler adapter, including the Vite 8 module-preload helper rewrite and `rolldownOptions` handling.                                |
| **Manifest-first remote loading**               | Builds emit `mf-manifest.json` + `mf-stats.json` + `mf-debug.json`. Hosts consume via curated `vite-plugin-federation/runtime` helpers.         |
| **Real dev HMR for remotes**                    | Sidecar dev runtime with classified updates when `dev.remoteHmr: true`: `partial`, `style`, `types`, `full`.                                    |
| **SSR (Node)**                                  | Dedicated `ssrRemoteEntry`, `createServerFederationInstance`, asset-preload collection for streaming HTML.                                      |
| **Production-grade host loader**                | Cache TTL, `staleWhileRevalidate`, retries with jitter, timeouts, fallback URLs, circuit breaker, request collapsing.                           |
| **Multi-tenant**                                | `createFederationRuntimeScope(runtimeKey)` for isolated manifest cache, breaker, and debug records per tenant on a single page.                 |
| **Security**                                    | SRI / SHA-256 integrity verification (multi-mode), private/authenticated manifests, CSP & Trusted Types guidance, and a signed-manifest recipe. |
| **Observability**                               | `getFederationDebugInfo()`, telemetry hooks, dev devtools panel, stable error codes (`MFV-001` … `MFV-007`).                                    |
| **OriginJS migration shim**                     | `virtual:__federation__` and `__federation_method_*` shim enabled by default for common OriginJS migration paths.                               |

A side-by-side feature table against `@module-federation/vite` and
`@originjs/vite-plugin-federation` lives in [`COMPARISON.md`](COMPARISON.md).

### Beta Scope

The beta support target is manifest-first Vite remotes, browser hosts, Node SSR hosts, DTS
generation/consumption, dev remote HMR, and the curated runtime APIs. Webpack/SystemJS/`var` remotes
are compatibility paths covered by e2e but should be validated in each migration. Signed manifests
are a documented supply-chain pattern; signature verification is intentionally provided through a
custom fetch wrapper rather than built into the default runtime.

---

## Compared to Other Vite Federation Plugins

See [**COMPARISON.md**](COMPARISON.md) for the full feature matrix, decision guide, and
citations against:

- [`@module-federation/vite`](https://www.npmjs.com/package/@module-federation/vite)
- [`@originjs/vite-plugin-federation`](https://www.npmjs.com/package/@originjs/vite-plugin-federation)

Migration cheatsheets:

- [docs/originjs-migration.md](docs/originjs-migration.md) — from `@originjs/vite-plugin-federation`
- [docs/migrate-from-module-federation-vite.md](docs/migrate-from-module-federation-vite.md) — from `@module-federation/vite`

---

## Install

```bash
pnpm add -D vite-plugin-federation
# or
npm install -D vite-plugin-federation
# or
yarn add -D vite-plugin-federation
```

**Peer dependency:** `vite@^5 || ^6 || ^7 || ^8` (Rolldown supported).
**Node:** `>=20.19.0`.

The plugin pulls in `@module-federation/runtime@2.3.3`, `@module-federation/sdk@2.3.3`, and
`@module-federation/dts-plugin@2.3.3` as exact-pin dependencies, and aliases all
`@module-federation/runtime` imports to a single bridge so federation state stays shared
across consumers in your app.

---

## Quick Start

### A remote

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from 'vite-plugin-federation';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'catalog',
      filename: 'remoteEntry.js', // stable name for examples; default is remoteEntry-[hash]
      exposes: {
        './Button': './src/Button.tsx',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^19.2.4' },
        'react/': { singleton: true, requiredVersion: '^19.2.4' },
      },
      // manifest defaults to true → emits mf-manifest.json + mf-stats.json + mf-debug.json
    }),
  ],
  build: {
    target: 'esnext',
    cssCodeSplit: true,
  },
});
```

### A host

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from 'vite-plugin-federation';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'shell',
      remotes: {
        // String value → manifest-first remote (recommended)
        catalog: 'https://cdn.example.com/catalog/mf-manifest.json',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^19.2.4' },
      },
    }),
  ],
  build: { target: 'esnext' },
});
```

Load a remote at runtime:

```tsx
// app.tsx
import { lazy, Suspense } from 'react';
import { loadRemoteFromManifest } from 'vite-plugin-federation/runtime';

const CatalogButton = lazy(async () => {
  const mod = await loadRemoteFromManifest(
    'catalog/Button',
    'https://cdn.example.com/catalog/mf-manifest.json',
    { cacheTtl: 30_000, retries: 2, timeout: 4_000 },
  );
  return { default: mod.default ?? mod };
});

export function App() {
  return (
    <Suspense fallback={null}>
      <CatalogButton />
    </Suspense>
  );
}
```

If you prefer the classic `loadRemote('catalog/Button')` style, that works too:

```ts
import { loadRemote } from 'vite-plugin-federation/runtime';
const mod = await loadRemote('catalog/Button');
```

### An SSR host

```ts
// vite.config.ts
import federation from 'vite-plugin-federation';

export default {
  plugins: [
    federation({
      name: 'ssr-shell',
      remotes: { catalog: 'https://cdn.example.com/catalog/mf-manifest.json' },
      target: 'node', // optional; auto-detected from `build.ssr`
    }),
  ],
};
```

```ts
// server.ts
import {
  createServerFederationInstance,
  fetchFederationManifest,
  loadRemoteFromManifest,
  collectFederationManifestPreloadLinks,
} from 'vite-plugin-federation/runtime';

createServerFederationInstance({ name: 'ssr-shell', remotes: [], shared: {} });

const manifestUrl = process.env.CATALOG_MANIFEST_URL!;
const manifest = await fetchFederationManifest(manifestUrl, { cacheTtl: 30_000 });

const mod = await loadRemoteFromManifest('catalog/Button', manifestUrl, {
  target: 'node',
});

// Stream <link rel="modulepreload"> / <link rel="stylesheet"> hints
const links = collectFederationManifestPreloadLinks(manifestUrl, manifest, './Button');
```

> Node must currently run with `--experimental-vm-modules` because the underlying MF runtime
> uses the VM module loader for ESM remote evaluation. See [docs/production-runtime.md](docs/production-runtime.md).

---

## Plugin Options

The full reference lives in [`docs/plugin-api.md`](docs/plugin-api.md). The most-used
options:

| Option                   | Type                                           | Default               | Notes                                                         |
| ------------------------ | ---------------------------------------------- | --------------------- | ------------------------------------------------------------- |
| `name`                   | `string`                                       | **required**          | Public application/container name.                            |
| `filename`               | `string`                                       | `remoteEntry-[hash]`  | Browser remote entry filename.                                |
| `varFilename`            | `string`                                       | —                     | Emits an additional var-style entry for legacy hosts.         |
| `exposes`                | `Record<string, string \| ExposeConfig>`       | `{}`                  | Remote expose map.                                            |
| `remotes`                | `Record<string, string \| RemoteObjectConfig>` | `{}`                  | Manifest URLs or object configs.                              |
| `shared`                 | `string[] \| Record<string, SharedConfig>`     | `{}`                  | Shared providers/consumers.                                   |
| `manifest`               | `boolean \| PluginManifestOptions`             | `true`                | Emits `mf-manifest.json` + `mf-stats.json` + `mf-debug.json`. |
| `dts`                    | `boolean \| PluginDtsOptions`                  | auto for TS projects  | Type generation / consumption; set `false` to disable.        |
| `dev`                    | `boolean \| PluginDevOptions`                  | enabled               | Devtools and type hints default on; remote HMR is opt-in.     |
| `compat`                 | `boolean \| CompatibilityOptions`              | `true`                | OriginJS `virtual:__federation__` shim.                       |
| `shareStrategy`          | `'loaded-first' \| 'version-first'`            | `'version-first'`     | Shared provider selection.                                    |
| `shareScope`             | `string`                                       | `'default'`           | Default share scope.                                          |
| `publicPath`             | `string`                                       | Vite `base` or `auto` | Public path for manifest asset URLs.                          |
| `bundleAllCSS`           | `boolean`                                      | `false`               | Add all CSS to every expose entry.                            |
| `runtimePlugins`         | `Array<string \| [string, object]>`            | `[]`                  | Runtime plugin imports.                                       |
| `target`                 | `'web' \| 'node'`                              | from build            | Forces browser/server output.                                 |
| `hostInitInjectLocation` | `'entry' \| 'html'`                            | `'html'`              | Where host runtime init is injected.                          |
| `moduleParseTimeout`     | `number` (s)                                   | `10`                  | Total module parse budget.                                    |
| `moduleParseIdleTimeout` | `number` (s)                                   | —                     | Idle parse timeout, reset per module.                         |

### Exposes

```ts
exposes: {
  './Button': './src/Button.tsx',
  './ManualCssButton': {
    import: './src/ManualCssButton.tsx',
    css: { inject: 'manual' }, // 'head' | 'manual' | 'none' | true | false
  },
}
```

`'manual'` writes CSS hrefs to the global CSS bucket instead of appending styles to
`document.head` — useful for Shadow DOM or staged migration. `dontAppendStylesToHead: true` is
accepted as the OriginJS-compatible alias.

### Remotes

```ts
remotes: {
  // Recommended: manifest-first
  catalog: 'https://cdn.example.com/catalog/mf-manifest.json',

  // Object form for legacy / mixed setups
  legacy: {
    name: 'legacyRemote',
    entry: 'https://cdn.example.com/legacy/remoteEntry.js',
    type: 'module',
    entryGlobalName: 'legacyRemote',
    from: 'vite',     // 'vite' | 'webpack'
    format: 'esm',    // 'esm' | 'systemjs' | 'var'
    shareScope: 'default',
  },
}
```

### Shared

```ts
shared: {
  react: {
    singleton: true,
    strictSingleton: true,
    requiredVersion: '^19.2.4',
    strictVersion: true,
    allowNodeModulesSuffixMatch: true, // pnpm/symlinked layouts
  },
  'react/': { // trailing slash → matches package subpaths
    singleton: true,
    requiredVersion: '^19.2.4',
    allowNodeModulesSuffixMatch: true,
  },
  // Host-only share — host must provide; remote must not bundle a fallback
  'design-system': { import: false, requiredVersion: '^2.0.0' },
}
```

---

## Runtime API

Imported from `vite-plugin-federation/runtime`. Full reference in
[`docs/runtime-api.md`](docs/runtime-api.md).

```ts
import {
  // Instances
  createFederationInstance,
  createServerFederationInstance,
  createFederationRuntimeScope,

  // Manifest
  fetchFederationManifest,
  registerManifestRemote,
  registerManifestRemotes,
  loadRemoteFromManifest,
  refreshRemote,

  // Loading
  loadRemote,
  loadShare,
  loadShareSync,

  // Preload & warmup
  warmFederationRemotes,
  preloadRemote,
  createFederationManifestPreloadPlan,
  collectFederationManifestPreloadLinks,

  // Security
  verifyFederationManifestAssets,

  // Observability
  getFederationDebugInfo,
  clearFederationRuntimeCaches,

  // Re-exports of @module-federation/runtime
  registerPlugins,
  registerRemotes,
  registerShared,
} from 'vite-plugin-federation/runtime';
```

The most useful production helper is `loadRemoteFromManifest()` — it fetches + validates the
manifest, picks the correct entry for the target (`web` or `node`), optionally verifies
integrity, registers the remote with the MF runtime, and loads the expose, all with cache
TTL / retries / circuit breaker support.

---

## Manifest Protocol

Every manifest-enabled build emits three artifacts under the configured `manifest.filePath`:

| Artifact           | Purpose                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mf-manifest.json` | Primary contract: name, version, exposes, shared, remotes, build metadata, optional `ssrRemoteEntry`, optional integrity / content hashes, optional preload hints. |
| `mf-stats.json`    | Build diagnostics, shared resolution metadata, asset analysis.                                                                                                     |
| `mf-debug.json`    | Plugin options snapshot, capability flags, diagnostics. Useful in CI.                                                                                              |

Schema and field definitions: [`docs/manifest-protocol.md`](docs/manifest-protocol.md).
JSON Schemas: [`docs/schemas/`](docs/schemas).

---

## Dev Experience

The dev pipeline runs the federation virtual modules through a sidecar runtime so the host
sees real updates from a remote without a rebuild cycle. See [`docs/dev-hmr.md`](docs/dev-hmr.md)
for the full strategy table.

```ts
federation({
  // ...
  dev: {
    remoteHmr: true, // opt in to host <-> remote HMR wiring
    devtools: true, // default; set false to disable the devtools endpoint/overlay
    disableLiveReload: true, // DTS worker default: avoid page reloads for type-only changes
    disableHotTypesReload: false,
    disableDynamicRemoteTypeHints: false,
  },
});
```

Update classification:

| Update kind | What happens                                                           |
| ----------- | ---------------------------------------------------------------------- |
| `partial`   | `server.reloadModule()` for the affected expose, falls back to `full`. |
| `style`     | Refresh the affected stylesheet(s); no reload.                         |
| `types`     | Sync `.d.ts` to the host; no reload.                                   |
| `full`      | Full host reload.                                                      |

Dev endpoints exposed by the dev server:

- `/mf-manifest.json` (or your configured `manifest.filePath` / `manifest.fileName`)
- `/mf-debug.json` (derived from the manifest file name)
- `/remoteEntry.js` or the configured `filename` in dev
- `/__mf_hmr` when `dev.remoteHmr: true`
- `/__mf_devtools` unless `dev.devtools: false`
- `dist/.dev-server.zip` and `dist/.dev-server.d.ts` when dev DTS generation is active

---

## SSR

- `target: 'node'` (auto-detected from `build.ssr`) emits a separate `ssrRemoteEntry.js` per
  remote and tree-shakes browser-only branches via the `ENV_TARGET` define.
- The runtime exposes `createServerFederationInstance()` with `inBrowser: false` and the Node
  remote-entry loader; the manifest registration helpers prefer `ssrRemoteEntry` for `node`
  targets and fall back to `remoteEntry` if no SSR entry is declared.
- `collectFederationManifestPreloadLinks()` returns deduplicated `<link>` descriptors
  (`modulepreload` / `stylesheet`) for streaming HTML, deduped across multiple expose hits in
  the same render pass.
- Vite's module-preload helper is patched to short-circuit when `document` / `window` are
  absent, so an expose evaluated during SSR cannot crash the renderer.

End-to-end flow and operational tips: [`docs/production-runtime.md`](docs/production-runtime.md).

---

## TypeScript / DTS

```ts
federation({
  // ...
  dts: {
    generateTypes: { abortOnError: true },
    consumeTypes: { typesOnBuild: true, abortOnError: true },
  },
});
```

- Wraps `@module-federation/dts-plugin@2.3.3`.
- Remote builds emit `@mf-types.zip` and a per-expose `@mf-types.d.ts`.
- Hosts discover type URLs from the manifest (`metaData.types.path / .api`) with optional
  `remoteTypeUrls` override.
- Dev hosts receive **live type updates** via the dev WebSocket channel without a page reload.
- `typesOnBuild: true` fails the host build if remote types cannot be fetched.

Workflows: [`docs/dts-workflows.md`](docs/dts-workflows.md).

---

## Production Runtime

Manifest-first loading with operational guardrails:

```ts
import { loadRemoteFromManifest } from 'vite-plugin-federation/runtime';

const mod = await loadRemoteFromManifest('catalog/Button', catalogManifestUrl, {
  target: 'web', // or 'node'
  cacheTtl: 30_000, // ms; 0 = always refetch
  staleWhileRevalidate: true, // serve cached, refresh in the background
  force: false, // bypass cache for this call
  fallbackUrls: [backupManifestUrl],
  retries: 2,
  retryDelay: 200, // ms, with jitter
  timeout: 4_000, // ms, per attempt
  circuitBreaker: { failureThreshold: 3, cooldownMs: 30_000 },
  integrity: { mode: 'prefer-integrity' }, // or true / { mode: 'integrity' | 'content-hash' | 'both' }
  fetch, // bring your own
  fetchInit: { credentials: 'include' },
  shareScope: 'default',
  hooks: {
    manifestFetch: (e) => log(e),
    remoteRegister: (e) => log(e),
    remoteLoad: (e) => log(e),
    remoteRefresh: (e) => log(e),
  },
});
```

Concurrent calls for the same manifest URL **collapse into a single in-flight fetch**.
Cached entries record `sourceUrl` (which fallback URL actually served), latency, integrity
mode used, and breaker state for each call.

See [`docs/production-runtime.md`](docs/production-runtime.md) and the full option reference in
[`docs/runtime-api.md`](docs/runtime-api.md).

---

## Multi-Tenant Deployments

If you serve multiple tenants on the same page (per-customer remote sets, A/B variants, etc.),
isolate them with a runtime scope:

```ts
import { createFederationRuntimeScope } from 'vite-plugin-federation/runtime';

const tenant = createFederationRuntimeScope(tenantId);
await tenant.registerManifestRemote('shop', tenantManifestUrl, { shareScope: tenantId });
const Page = await tenant.loadRemoteFromManifest('shop/Page', tenantManifestUrl);
```

Each scope owns its own manifest cache, in-flight registrations, circuit breaker, debug
records, and load metrics — so a noisy tenant cannot affect any other tenant's failure budget
or cache state. See [`docs/multi-tenant.md`](docs/multi-tenant.md).

---

## Preload & Performance

```ts
import {
  createFederationManifestPreloadPlan,
  fetchFederationManifest,
  warmFederationRemotes,
} from 'vite-plugin-federation/runtime';

// Warm a set of remotes at app boot. Set preload: false to register only.
await warmFederationRemotes({
  catalog: {
    manifestUrl: catalogManifestUrl,
    preload: { resourceCategory: 'sync' },
  },
  checkout: {
    manifestUrl: checkoutManifestUrl,
    preload: false,
  },
});

// Build a route-aware preload plan
const catalogManifest = await fetchFederationManifest(catalogManifestUrl, { cacheTtl: 30_000 });
const plan = createFederationManifestPreloadPlan(
  catalogManifestUrl,
  catalogManifest,
  { '/product/:id': './Button' },
  {
    asyncChunkPolicy: 'css', // 'none' | 'js' | 'css' | 'all'
  },
);
// plan.links → [{ rel: 'modulepreload', href }, { rel: 'stylesheet', href }, ...]

// Per-remote runtime metrics surface through getFederationDebugInfo()
//   .runtime.remoteLoadMetrics
```

Background and tuning: [`docs/preload-performance.md`](docs/preload-performance.md).

---

## Security

| Capability                                                                                               | Where                 |
| -------------------------------------------------------------------------------------------------------- | --------------------- |
| Subresource integrity in manifest (SRI + SHA-256)                                                        | `docs/security.md`    |
| `verifyFederationManifestAssets()` (multi-mode: `prefer-integrity`, `integrity`, `content-hash`, `both`) | `docs/runtime-api.md` |
| Private / authenticated manifests via `fetchInit` + custom `fetch`                                       | `docs/security.md`    |
| Signed manifest workflow (detached signature verified in `fetch` wrapper)                                | `docs/security.md`    |
| CSP / Trusted Types guidance (manifest-first ESM, no inline scripts)                                     | `docs/security.md`    |

---

## OriginJS Compatibility & Migration

The OriginJS `virtual:__federation__` API is enabled by default for migration. All five common
legacy methods work unchanged:

```ts
import {
  __federation_method_setRemote,
  __federation_method_getRemote,
  __federation_method_ensure,
  __federation_method_unwrapDefault,
  __federation_method_wrapDefault,
} from 'virtual:__federation__';
```

Legacy paths like `./Button` are normalized to `remote/Button` and routed through
`@module-federation/runtime`. CSS migration: `dontAppendStylesToHead: true` is preserved as a
synonym for `css.inject: 'manual'`. The end-to-end `examples/originjs-compat-host` validates
this against a real `remoteEntry.js` and a webpack `library.type: 'system'` remote.

Compatibility is intentionally scoped: browser CommonJS remotes are not supported, `systemjs`
remotes require `globalThis.System.import`, and unsupported `from` values produce `MFV-007`
warnings.

Turn the shim off when you've fully migrated:

```ts
federation({
  // ...
  compat: { originjs: false, virtualFederationShim: false },
});
```

Migration walkthrough: [`docs/originjs-migration.md`](docs/originjs-migration.md).
Compatibility matrix: [`docs/compatibility-matrix.md`](docs/compatibility-matrix.md).

---

## Examples

The repo ships working examples for the main supported frameworks and production scenarios:

| Path                                              | What it covers                                                 |
| ------------------------------------------------- | -------------------------------------------------------------- |
| `examples/react-remote` & `examples/react-host`   | Baseline React remote ↔ host.                                  |
| `examples/react-ssr-host`                         | React SSR host consuming a remote.                             |
| `examples/vue-remote` & `examples/vue-host`       | Vue 3.                                                         |
| `examples/svelte-remote` & `examples/svelte-host` | Svelte.                                                        |
| `examples/lit-remote` & `examples/lit-host`       | Lit / web components.                                          |
| `examples/multi-remote-host`                      | Single host loading multiple remotes.                          |
| `examples/workspace-shared-{lib,remote,host}`     | pnpm workspace + symlinked shared dependency.                  |
| `examples/dts-remote` & `examples/dts-host`       | DTS auto-generation + host consumption.                        |
| `examples/shared-host-only-{remote,host}`         | Host-only shares (`import: false`).                            |
| `examples/shared-negotiation-{remote,host}`       | Cross-remote shared version negotiation.                       |
| `examples/shared-strict-fallback-app`             | Strict-singleton fallback policy.                              |
| `examples/originjs-compat-host`                   | `virtual:__federation__` shim against real remotes.            |
| `examples/webpack-systemjs-remote`                | Vite host consuming a webpack `library.type: 'system'` remote. |

Useful local commands:

```bash
pnpm install
pnpm examples:build          # React host/remote + SSR + DTS smoke path
pnpm examples:dev            # React host/remote dev loop
pnpm examples:dts:build
pnpm examples:ssr:build
pnpm build                   # package + all workspaces with build scripts
pnpm --filter vite-plugin-federation test:e2e:browser-matrix
pnpm --filter vite-plugin-federation test:e2e:compat
pnpm --filter vite-plugin-federation test:e2e:shared
```

---

## Troubleshooting

The plugin uses stable, greppable error codes:

| Code      | Meaning                                                        |
| --------- | -------------------------------------------------------------- |
| `MFV-001` | Plugin configuration error (missing `name`, etc.)              |
| `MFV-002` | Alias conflict between a shared key and another resolver.      |
| `MFV-003` | Shared dependency miss / fallback / strict-singleton conflict. |
| `MFV-004` | Manifest fetch / validation failed (with `sourceUrl`).         |
| `MFV-005` | Expose missing or unsupported legacy `format`.                 |
| `MFV-006` | SSR remote entry missing for `target: 'node'`.                 |
| `MFV-007` | Dynamic import rewrite warning or unsupported legacy `from`.   |

Snapshot the runtime in dev:

```ts
import { getFederationDebugInfo } from 'vite-plugin-federation/runtime';
console.log(getFederationDebugInfo());
// → instance, registered remotes, manifest cache + fetch timeline,
//   integrity verification log, circuit breaker state, load metrics,
//   shared providers + sharedResolutionGraph
```

Full guide: [`docs/troubleshooting.md`](docs/troubleshooting.md).

---

## Repository Layout

| Path                               | Purpose                                                        |
| ---------------------------------- | -------------------------------------------------------------- |
| `packages/vite-plugin-federation/` | Published plugin package and runtime implementation.           |
| `examples/`                        | Local host/remote apps used by smoke tests and e2e suites.     |
| `docs/`                            | API references, production runtime, migration, and operations. |
| `COMPARISON.md`                    | Feature matrix against the two comparison snapshots.           |
| `other1/`                          | Local snapshot of `@module-federation/vite` for comparison.    |
| `other2/`                          | Local snapshot of `@originjs/vite-plugin-federation`.          |
| `.github/workflows/`               | CI, extended e2e, and release automation.                      |

---

## Development

Requirements: **Node ≥ 20.19**, **pnpm 10.33.0**.

```bash
pnpm install
pnpm check          # lint + type-check + unit tests for everything
pnpm dev            # turbo dev for the package
pnpm build          # build the package
pnpm lint
pnpm test           # vitest, all workspaces
pnpm format
```

End-to-end suites (Playwright):

```bash
pnpm --filter vite-plugin-federation test:e2e                     # default + compat + shared + dts:dev
pnpm --filter vite-plugin-federation test:e2e:browser-matrix      # Chromium / Firefox / WebKit
pnpm --filter vite-plugin-federation test:e2e:multi-remote
pnpm --filter vite-plugin-federation test:e2e:shared
pnpm --filter vite-plugin-federation test:e2e:ssr
pnpm --filter vite-plugin-federation test:e2e:compat
pnpm --filter vite-plugin-federation test:e2e:dts:dev
pnpm test:vite-matrix:smoke
```

E2E ports default to the documented local ports. If a local process already owns one of them, set
the matching `MF_E2E_<NAME>_PORT` variable before running the suite, for example
`MF_E2E_REACT_REMOTE_PORT=5274 pnpm --filter vite-plugin-federation test:e2e:multi-remote`.

To run an SSR example by hand:

```bash
pnpm --filter example-react-remote preview
pnpm --filter example-react-ssr-host serve
```

The SSR host launches Node with `--experimental-vm-modules` because the MF runtime uses the
VM module loader for remote ESM evaluation on the server.

### Internal docs

- [`tech.md`](tech.md) — design rationale, virtual module layout, dev sidecar architecture.
- [`docs/compiler-adapter.md`](docs/compiler-adapter.md) — Rolldown vs Rollup transform notes,
  control-chunk rules, the known CJS bundle warning.
- [`docs/devtools-runtime-contract.md`](docs/devtools-runtime-contract.md) — devtools event
  contract.
- [`docs/manifest-protocol.md`](docs/manifest-protocol.md) — manifest schema + field rules.

---

## Release Flow

Versioning is managed by [Changesets](https://github.com/changesets/changesets):

```bash
pnpm changeset             # author a changeset
pnpm version-packages      # bump versions + update generated release files
pnpm release               # build the package and publish via Changesets
```

The release workflow publishes from a semver tag (`v*.*.*`) or manual dispatch with a matching
tag. The full policy, quality gates, and step-by-step instructions live in
[`docs/release-checklist.md`](docs/release-checklist.md).

---

## CI / CD

- **`.github/workflows/ci.yml`** — runs `pnpm check` on PRs and pushes to `main`; Node 22 also
  runs the package smoke test and Vite peer matrix smoke.
- **`.github/workflows/extended-e2e.yml`** — manual and weekly Playwright coverage for compat,
  shared runtime, multi-remote, browser matrix, SSR, and DTS dev sync on Node 20 and 22.
- **`.github/workflows/release.yml`** — publishes matching `v*.*.*` tags or a manual tag dispatch.
- Publishing requires `NPM_AUTH_TOKEN` / `NODE_AUTH_TOKEN` to be configured in GitHub secrets.
- Published packages use `provenance: true`.

---

## License

[`MIT`](https://github.com/jskits/vite-plugin-federation/blob/main/LICENSE).
