# vite-plugin-federation

[![CI](https://github.com/jskits/vite-plugin-federation/actions/workflows/ci.yml/badge.svg)](https://github.com/jskits/vite-plugin-federation/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/vite-plugin-federation.svg)](https://www.npmjs.com/package/vite-plugin-federation)
![license](https://img.shields.io/npm/l/vite-plugin-federation)

A production-ready GA Module Federation 2.0 plugin for Vite 5, 6, 7, and 8.

It is built around manifest-first remote loading, Node SSR, live DTS workflows, dev remote HMR,
multi-tenant runtime scopes, and operational runtime controls. It also includes an
OriginJS-compatible `virtual:__federation__` migration shim for existing Vite federation apps.

`vite-plugin-federation` 1.0 is generally available for manifest-first Vite remotes, browser hosts,
Node SSR hosts, DTS generation and consumption, dev remote HMR, and the curated runtime APIs.
Webpack/SystemJS/`var` remotes are supported compatibility paths, but mixed migrations should be
validated per application. Signed manifest verification is intentionally handled through a custom
`fetch` wrapper so teams can use their own signing and trust model.

## Install

```bash
pnpm add -D vite-plugin-federation
```

```bash
npm install -D vite-plugin-federation
```

```bash
yarn add -D vite-plugin-federation
```

Requirements:

- Node `>=20.19.0`
- Vite `^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0`

The package exports:

- `vite-plugin-federation`: the Vite plugin.
- `vite-plugin-federation/runtime`: runtime helpers for manifest loading, SSR, preload, integrity,
  diagnostics, and scoped runtimes.

## Why Use It

| Need                           | What this package provides                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Vite 5 through Vite 8          | Rollup and Rolldown-aware output handling, including module-preload helper rewrites.                            |
| Manifest-first federation      | `mf-manifest.json`, `mf-stats.json`, and `mf-debug.json` outputs by default.                                    |
| Production host loading        | Cache TTL, stale-while-revalidate, retries, timeouts, fallback URLs, request collapsing, and circuit breakers.  |
| Node SSR                       | `ssrRemoteEntry`, server runtime creation, target-aware manifest registration, and SSR preload link collection. |
| Shared dependency control      | Singleton diagnostics, strict singleton mode, version checks, host-only shares, and pnpm suffix matching.       |
| DTS workflows                  | Remote type archives, host type consumption, manifest-derived type URLs, and dev hot sync.                      |
| Multi-tenant runtime isolation | Per-runtime-key manifest cache, breaker state, debug records, and load metrics.                                 |
| Migration                      | OriginJS-compatible `virtual:__federation__` shim and legacy remote compatibility paths.                        |

## Quick Start

### Remote

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
      exposes: {
        './Button': './src/Button.tsx',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^19.0.0' },
        'react/': { singleton: true, requiredVersion: '^19.0.0' },
      },
    }),
  ],
  build: {
    target: 'esnext',
  },
});
```

By default, a remote build emits:

- `remoteEntry-[hash].js`
- `mf-manifest.json`
- `mf-stats.json`
- `mf-debug.json`

Use a fixed remote entry name when your deployment needs one:

```ts
federation({
  name: 'catalog',
  filename: 'remoteEntry.js',
  exposes: {
    './Button': './src/Button.tsx',
  },
});
```

### Browser Host

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
        catalog: 'https://cdn.example.com/catalog/mf-manifest.json',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^19.0.0' },
        'react/': { singleton: true, requiredVersion: '^19.0.0' },
      },
    }),
  ],
  build: {
    target: 'esnext',
  },
});
```

Load a manifest remote explicitly:

```tsx
import { lazy, Suspense } from 'react';
import { loadRemoteFromManifest } from 'vite-plugin-federation/runtime';

const catalogManifestUrl = 'https://cdn.example.com/catalog/mf-manifest.json';

const CatalogButton = lazy(async () => {
  const mod = await loadRemoteFromManifest('catalog/Button', catalogManifestUrl, {
    cacheTtl: 30_000,
    retries: 2,
    timeout: 4_000,
  });

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

You can also use the classic Module Federation runtime style after remotes are registered:

```ts
import { loadRemote } from 'vite-plugin-federation/runtime';

const mod = await loadRemote('catalog/Button');
```

### Node SSR Host

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

export default defineConfig({
  plugins: [
    federation({
      name: 'ssr-shell',
      remotes: {
        catalog: 'https://cdn.example.com/catalog/mf-manifest.json',
      },
      target: 'node',
    }),
  ],
  build: {
    ssr: true,
    target: 'esnext',
  },
});
```

```ts
// server.ts
import {
  collectFederationManifestPreloadLinks,
  createServerFederationInstance,
  fetchFederationManifest,
  loadRemoteFromManifest,
} from 'vite-plugin-federation/runtime';

createServerFederationInstance({
  name: 'ssr-shell',
  remotes: [],
  shared: {},
});

const manifestUrl = process.env.CATALOG_MANIFEST_URL!;
const manifest = await fetchFederationManifest(manifestUrl, { cacheTtl: 30_000 });

const mod = await loadRemoteFromManifest('catalog/Button', manifestUrl, {
  target: 'node',
  timeout: 4_000,
});

const preloadLinks = collectFederationManifestPreloadLinks(manifestUrl, manifest, './Button');
```

Node SSR currently requires Node's VM ESM loader support:

```bash
node --experimental-vm-modules server.js
```

Do not accept tenant- or request-controlled manifest URLs directly in SSR. Treat a Node-target
remote as server-executed code, and route all manifest URLs through an operator-controlled allowlist.

## Plugin Configuration

```ts
import federation from 'vite-plugin-federation';

federation({
  name: 'shell',
  remotes: {},
  exposes: {},
  shared: {},
});
```

Common options:

| Option                   | Default                      | Description                                                              |
| ------------------------ | ---------------------------- | ------------------------------------------------------------------------ |
| `name`                   | Required                     | Public application/container name.                                       |
| `filename`               | `remoteEntry-[hash]`         | Browser remote entry filename.                                           |
| `varFilename`            | None                         | Emits an additional var-style remote entry for legacy hosts.             |
| `exposes`                | `{}`                         | Remote expose map. Keys usually start with `./`.                         |
| `remotes`                | `{}`                         | Host remote map. Manifest URLs are recommended.                          |
| `shared`                 | `{}`                         | Shared providers and consumers.                                          |
| `manifest`               | `true`                       | Emits manifest, stats, and debug artifacts.                              |
| `dts`                    | Auto for TypeScript projects | Type generation and consumption through `@module-federation/dts-plugin`. |
| `dev`                    | Enabled                      | Devtools, type hints, live reload, hot types, and opt-in remote HMR.     |
| `compat`                 | `true`                       | OriginJS-compatible virtual federation shim.                             |
| `shareStrategy`          | `version-first`              | Runtime shared provider selection.                                       |
| `shareScope`             | `default`                    | Default share scope.                                                     |
| `publicPath`             | Vite `base` or `auto`        | Public path used in generated manifest asset URLs.                       |
| `bundleAllCSS`           | `false`                      | Adds all CSS assets to every expose manifest entry.                      |
| `runtimePlugins`         | `[]`                         | Runtime plugin imports passed to Module Federation runtime init.         |
| `target`                 | Build target                 | `web` or `node`; SSR builds auto-detect `node`.                          |
| `hostInitInjectLocation` | `html`                       | Inject host runtime initialization in HTML or entry.                     |
| `moduleParseTimeout`     | `10`                         | Total module parse timeout in seconds.                                   |
| `moduleParseIdleTimeout` | None                         | Idle parse timeout in seconds, reset after every parsed module.          |

### Exposes

```ts
federation({
  name: 'catalog',
  exposes: {
    './Button': './src/Button.tsx',
    './ManualCssButton': {
      import: './src/ManualCssButton.tsx',
      css: { inject: 'manual' },
    },
  },
});
```

CSS modes:

- `head`: append CSS to `document.head`.
- `manual`: write CSS hrefs to the global CSS bucket for the consumer to apply.
- `none`: do not inject CSS.

`dontAppendStylesToHead: true` is accepted as an OriginJS-compatible alias for manual CSS handling.

### Remotes

Prefer manifest URLs for new hosts:

```ts
federation({
  name: 'shell',
  remotes: {
    catalog: 'https://cdn.example.com/catalog/mf-manifest.json',
  },
});
```

Use object remotes for compatibility paths:

```ts
federation({
  name: 'shell',
  remotes: {
    legacy: {
      name: 'legacyRemote',
      entry: 'https://cdn.example.com/legacy/remoteEntry.js',
      entryGlobalName: 'legacyRemote',
      from: 'vite',
      format: 'esm',
      type: 'module',
      shareScope: 'default',
    },
  },
});
```

`format: 'systemjs'` expects `globalThis.System.import` at runtime. Browser CommonJS remotes are not
part of the supported compatibility scope.

### Shared Dependencies

```ts
federation({
  name: 'shell',
  shared: {
    react: {
      singleton: true,
      strictSingleton: true,
      requiredVersion: '^19.0.0',
      strictVersion: true,
      allowNodeModulesSuffixMatch: true,
    },
    'react/': {
      singleton: true,
      requiredVersion: '^19.0.0',
      allowNodeModulesSuffixMatch: true,
    },
    'design-system': {
      import: false,
      requiredVersion: '^2.0.0',
    },
  },
});
```

Notes:

- Use trailing slash keys such as `react/` or `@scope/pkg/` for package subpaths.
- Use `allowNodeModulesSuffixMatch` for pnpm or symlinked workspace layouts.
- Use `import: false` for host-only shared modules. The host must provide the share; the remote will
  not bundle a fallback.
- Use `strictSingleton` when singleton conflicts should fail instead of silently falling back.

### DTS

```ts
federation({
  name: 'catalog',
  dts: {
    generateTypes: {
      abortOnError: true,
    },
    consumeTypes: {
      typesOnBuild: true,
      abortOnError: true,
    },
  },
});
```

In TypeScript projects, DTS support is enabled automatically unless `dts: false` is configured.
Remote builds emit `@mf-types.zip` and per-expose `.d.ts` artifacts; hosts can discover type URLs
from `mf-manifest.json`.

### Dev HMR And Devtools

```ts
federation({
  name: 'shell',
  dev: {
    remoteHmr: true,
    devtools: true,
    disableLiveReload: true,
    disableHotTypesReload: false,
    disableDynamicRemoteTypeHints: false,
  },
});
```

Remote HMR is opt-in. Devtools and dynamic type hints are enabled by default in dev.

Dev servers expose:

- `/mf-manifest.json` or your configured manifest path.
- `/mf-debug.json`.
- `/remoteEntry.js` or the configured `filename`.
- `/__mf_hmr` when `dev.remoteHmr: true`.
- `/__mf_devtools` unless `dev.devtools: false`.

## Runtime API

Import runtime helpers from `vite-plugin-federation/runtime`:

```ts
import {
  clearFederationRuntimeCaches,
  collectFederationManifestExposeAssets,
  collectFederationManifestPreloadLinks,
  createFederationInstance,
  createFederationManifestPreloadPlan,
  createFederationRuntimeScope,
  createServerFederationInstance,
  fetchFederationManifest,
  getFederationDebugInfo,
  loadRemote,
  loadRemoteFromManifest,
  loadShare,
  loadShareSync,
  preloadRemote,
  refreshRemote,
  registerManifestRemote,
  registerManifestRemotes,
  registerPlugins,
  registerRemotes,
  registerShared,
  verifyFederationManifestAssets,
  warmFederationRemotes,
} from 'vite-plugin-federation/runtime';
```

The high-level production path is `loadRemoteFromManifest()`:

```ts
const mod = await loadRemoteFromManifest('catalog/Button', catalogManifestUrl, {
  target: 'web',
  cacheTtl: 30_000,
  staleWhileRevalidate: true,
  fallbackUrls: [backupManifestUrl],
  retries: 2,
  retryDelay: 200,
  timeout: 4_000,
  circuitBreaker: {
    failureThreshold: 3,
    cooldownMs: 30_000,
  },
  integrity: { mode: 'prefer-integrity' },
  fetch,
  fetchInit: { credentials: 'include' },
  hooks: {
    manifestFetch: (event) => console.debug(event),
    remoteRegister: (event) => console.debug(event),
    remoteLoad: (event) => console.debug(event),
    remoteRefresh: (event) => console.debug(event),
  },
});
```

### Runtime Scopes

Use runtime scopes when multiple tenants, experiments, or apps share one page:

```ts
import { createFederationRuntimeScope } from 'vite-plugin-federation/runtime';

const tenant = createFederationRuntimeScope('tenant-a');

await tenant.registerManifestRemote('catalog', tenantManifestUrl, {
  shareScope: 'tenant-a',
});

const mod = await tenant.loadRemoteFromManifest('catalog/Button', tenantManifestUrl);
```

Each scope partitions manifest cache, in-flight requests, remote registration records, circuit
breaker state, load metrics, and debug snapshots.

### Preload

```ts
import {
  createFederationManifestPreloadPlan,
  fetchFederationManifest,
  warmFederationRemotes,
} from 'vite-plugin-federation/runtime';

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

const manifest = await fetchFederationManifest(catalogManifestUrl, { cacheTtl: 30_000 });
const plan = createFederationManifestPreloadPlan(
  catalogManifestUrl,
  manifest,
  {
    '/product/:id': './Button',
  },
  {
    asyncChunkPolicy: 'css',
  },
);
```

For SSR rendering, use `collectFederationManifestPreloadLinks()` to create deduped
`modulepreload` and `stylesheet` descriptors.

### Integrity And Authenticated Manifests

```ts
const mod = await loadRemoteFromManifest('catalog/Button', catalogManifestUrl, {
  integrity: { mode: 'both' },
  fetchInit: {
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  },
});
```

Integrity modes:

- `prefer-integrity`: use SRI when present, otherwise use `contentHash`.
- `integrity`: require SRI.
- `content-hash`: require `contentHash`.
- `both`: require both values when verifying annotated assets.

Use `verifyFederationManifestAssets()` when you need to verify expose and preload assets declared in
the manifest:

```ts
await verifyFederationManifestAssets(catalogManifestUrl, manifest, {
  integrity: { mode: 'both' },
  requireIntegrity: true,
});
```

For signed manifests, verify the detached signature in a custom `fetch` wrapper before returning the
`Response` to the runtime.

### Diagnostics

```ts
import { getFederationDebugInfo } from 'vite-plugin-federation/runtime';

console.log(getFederationDebugInfo());
```

The debug snapshot includes:

- Module Federation runtime instance state.
- Registered remotes and shared providers.
- Manifest cache entries and source URLs.
- Manifest fetch timeline.
- Integrity verification results.
- Circuit breaker state.
- Remote load metrics.
- Shared resolution graph and singleton conflict diagnostics.

## OriginJS Migration

The OriginJS-compatible virtual module is enabled by default:

```ts
import {
  __federation_method_ensure,
  __federation_method_getRemote,
  __federation_method_setRemote,
  __federation_method_unwrapDefault,
  __federation_method_wrapDefault,
} from 'virtual:__federation__';
```

Disable it after migration:

```ts
federation({
  name: 'shell',
  compat: {
    originjs: false,
    virtualFederationShim: false,
  },
});
```

## Security Notes

- Prefer manifest-first ESM remotes over legacy script injection paths.
- Treat Node SSR remotes as server-executed code.
- Do not pass user-controlled manifest URLs into SSR runtime helpers.
- Use origin allowlists for manifest URLs, remote entries, CSP, and Trusted Types policies.
- Use `fetchInit` or custom `fetch` for private manifests.
- Verify SRI/content hashes for high-trust deployments.
- Verify signed manifests outside the default runtime with a custom fetch wrapper.
- Keep Webpack/SystemJS/`var` compatibility paths isolated if they need looser CSP.

## Error Codes

| Code      | Meaning                                                            |
| --------- | ------------------------------------------------------------------ |
| `MFV-001` | Plugin configuration error.                                        |
| `MFV-002` | Alias conflict between a shared key and another resolver.          |
| `MFV-003` | Shared dependency miss, fallback, or strict-singleton conflict.    |
| `MFV-004` | Manifest fetch or validation failure.                              |
| `MFV-005` | Missing expose or unsupported legacy remote format.                |
| `MFV-006` | SSR remote entry missing for a Node-target load.                   |
| `MFV-007` | Dynamic import rewrite warning or unsupported legacy `from` value. |

## Documentation

- [Full repository README](https://github.com/jskits/vite-plugin-federation#readme)
- [Plugin API](https://github.com/jskits/vite-plugin-federation/blob/main/docs/plugin-api.md)
- [Runtime API](https://github.com/jskits/vite-plugin-federation/blob/main/docs/runtime-api.md)
- [Manifest protocol](https://github.com/jskits/vite-plugin-federation/blob/main/docs/manifest-protocol.md)
- [Production runtime](https://github.com/jskits/vite-plugin-federation/blob/main/docs/production-runtime.md)
- [DTS workflows](https://github.com/jskits/vite-plugin-federation/blob/main/docs/dts-workflows.md)
- [Dev HMR](https://github.com/jskits/vite-plugin-federation/blob/main/docs/dev-hmr.md)
- [Security](https://github.com/jskits/vite-plugin-federation/blob/main/docs/security.md)
- [OriginJS migration](https://github.com/jskits/vite-plugin-federation/blob/main/docs/originjs-migration.md)
- [Compatibility matrix](https://github.com/jskits/vite-plugin-federation/blob/main/docs/compatibility-matrix.md)

## Examples

The repository includes E2E-backed examples for React, Vue, Svelte, Lit, SSR, DTS, shared
negotiation, workspace shared dependencies, OriginJS migration, and Webpack/SystemJS compatibility:

https://github.com/jskits/vite-plugin-federation/tree/main/examples

## License

MIT
