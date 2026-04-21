# Production Runtime Guide

This guide defines the production contract for manifest-first federation in this repository. It
focuses on behavior that matters after deployment: artifact traceability, resilient manifest
loading, SSR entry selection, asset discovery, and runtime observability.

## Remote Artifact Contract

Remote applications should keep `manifest` enabled in the federation config. Build output includes:

- `mf-manifest.json`: stable machine-readable contract used by hosts.
- `mf-stats.json`: compatibility-oriented artifact summary for external tooling.
- `mf-debug.json`: plugin diagnostics, normalized options, and manifest generation metadata.

New artifacts include `schemaVersion: "1.0.0"`. See
[manifest-protocol.md](manifest-protocol.md) for JSON Schemas and compatibility rules.

The manifest `metaData.buildInfo` is generated from environment variables at build time. Preferred
variables are checked first, then common CI provider variables are used, and local builds fall back
to the remote name plus `local`.

```bash
VITE_PLUGIN_FEDERATION_BUILD_VERSION=8f3c2d1
VITE_PLUGIN_FEDERATION_BUILD_NAME=main
pnpm --filter example-react-remote build
```

Supported build metadata variables:

- Build version: `VITE_PLUGIN_FEDERATION_BUILD_VERSION`, `MF_BUILD_VERSION`, `GITHUB_SHA`, `VERCEL_GIT_COMMIT_SHA`.
- Build name: `VITE_PLUGIN_FEDERATION_BUILD_NAME`, `MF_BUILD_NAME`, `GITHUB_REF_NAME`, `VERCEL_GIT_COMMIT_REF`.

The emitted `pluginVersion` is injected from the package version during the package build, so
published artifacts can be traced back to the plugin version that generated them.

Generated manifests also include `release.id`, `metaData.buildInfo.releaseId`, and entry-level
`integrity`/`contentHash` metadata for `remoteEntry` and `ssrRemoteEntry` when those files are in
the build output. Set `VITE_PLUGIN_FEDERATION_RELEASE_ID` or `MF_RELEASE_ID` in CI for a stable
application release id; otherwise it defaults to `buildName:buildVersion`.

## Manifest Hosting Rules

Host `mf-manifest.json` with a short cache TTL or `no-cache`, because hosts use it as the deployment
coordination point. Hashed JS and CSS assets referenced by the manifest can use long immutable
caching.

Recommended headers:

```text
mf-manifest.json      Cache-Control: no-cache
remoteEntry*.js       Cache-Control: public, max-age=31536000, immutable
assets/*              Cache-Control: public, max-age=31536000, immutable
```

If the manifest and remote assets are on a different origin, configure CORS for both manifest JSON
and ESM assets. Browser hosts need the manifest, remote entries, shared chunks, CSS, and dynamic
imports to be reachable from the host origin.

## Shared Resolution

Use exact shared keys for package roots and trailing-slash keys for subpaths:

```ts
federation({
  name: 'remote',
  shared: {
    react: {
      singleton: true,
      requiredVersion: '^19.2.4',
      allowNodeModulesSuffixMatch: true,
    },
    'react/': {
      singleton: true,
      requiredVersion: '^19.2.4',
      allowNodeModulesSuffixMatch: true,
    },
  },
});
```

`allowNodeModulesSuffixMatch` lets resolved ids from pnpm, nested `node_modules`, and symlinked
workspace layouts match by the path segment after the final `node_modules/`. This is useful when a
shared package appears at different absolute paths between host and remote builds. Generated
`mf-stats.json` diagnostics include the flag so production incidents can distinguish exact,
trailing-slash, and suffix-enabled shared rules.

Runtime hosts created through `vite-plugin-federation/runtime` also install a shared diagnostics
plugin. The runtime records registered shared providers, the active share scope, each async/sync
`loadShare` decision, candidate versions, selected provider, fallback mode, and `MFV-003`
diagnostics for shared misses or fallback selection.

## Browser Host Loading

Use `loadRemoteFromManifest` when one remote module is needed immediately. It fetches the manifest,
registers the correct remote entry, and delegates loading to the Module Federation runtime.

```ts
import { createFederationInstance, loadRemoteFromManifest } from 'vite-plugin-federation/runtime';

createFederationInstance({
  name: 'web-host',
  remotes: [],
  shared: {},
});

const catalogManifestUrl = 'https://cdn.example.com/catalog/mf-manifest.json';
const remoteModule = await loadRemoteFromManifest('catalog/Button', catalogManifestUrl, {
  cacheTtl: 60_000,
  retries: 2,
  timeout: 5_000,
});

export const CatalogButton = remoteModule.default ?? remoteModule;
```

Use `registerManifestRemotes` when the host wants to register several remotes during boot and load
modules later with `loadRemote`.

```ts
import {
  createFederationInstance,
  loadRemote,
  registerManifestRemotes,
} from 'vite-plugin-federation/runtime';

createFederationInstance({ name: 'shell', remotes: [], shared: {} });

await registerManifestRemotes({
  catalog: {
    manifestUrl: 'https://cdn.example.com/catalog/mf-manifest.json',
    cacheTtl: 60_000,
    retries: 2,
    timeout: 5_000,
  },
  checkout: 'https://cdn.example.com/checkout/mf-manifest.json',
});

const checkout = await loadRemote('checkout/App');
```

## Manifest Fetch Controls

`fetchFederationManifest`, `registerManifestRemote`, `registerManifestRemotes`, and
`loadRemoteFromManifest` share the same production fetch controls.

| Option       | Default            | Use case                                                                 |
| ------------ | ------------------ | ------------------------------------------------------------------------ |
| `cache`      | `true`             | Set `false` when every call must hit the manifest URL.                   |
| `cacheTtl`   | no expiry          | Expire cached manifests after a fixed number of milliseconds.            |
| `force`      | `false`            | Drop cached and pending manifest work before fetching/registering again. |
| `fetch`      | `globalThis.fetch` | Provide a platform fetch in tests, legacy Node, or custom runtimes.      |
| `fetchInit`  | `undefined`        | Pass credentials, headers, or request mode to manifest fetches.          |
| `retries`    | `0`                | Retry network failures, timeouts, `408`, `429`, and `5xx` responses.     |
| `retryDelay` | capped backoff     | Use a fixed delay or function for retry pacing.                          |
| `timeout`    | no timeout         | Abort and reject slow manifest requests.                                 |

Concurrent manifest fetches for the same URL are collapsed into one request. Concurrent manifest
registrations for the same target, alias, and manifest URL are also collapsed.

Example with credentials and custom retry pacing:

```ts
await loadRemoteFromManifest('catalog/Button', catalogManifestUrl, {
  cacheTtl: 30_000,
  fetchInit: {
    credentials: 'include',
    headers: {
      'x-host-version': import.meta.env.VITE_APP_VERSION,
    },
  },
  retries: 3,
  retryDelay: (attempt) => attempt * 250,
  timeout: 4_000,
});
```

## Refresh And Rollout Behavior

Use `refreshRemote` when a running host needs to pick up a newly deployed manifest or remote entry
without recreating the entire runtime instance.

```ts
import { refreshRemote } from 'vite-plugin-federation/runtime';

await refreshRemote('catalog', {
  cacheTtl: 30_000,
  force: true,
  timeout: 4_000,
});
```

For browser targets, forced refreshes append a timestamp query to the remote entry URL. This avoids
stale remote entry caches while keeping immutable asset caching for hashed chunks.

## SSR And Node Hosts

Server hosts should create a server runtime instance and pass `target: 'node'` when loading from a
manifest. The runtime selects `ssrRemoteEntry` first and falls back to `remoteEntry` only if the SSR
entry is absent.

```ts
import {
  createServerFederationInstance,
  fetchFederationManifest,
  loadRemoteFromManifest,
} from 'vite-plugin-federation/runtime';

createServerFederationInstance({
  name: 'ssr-host',
  remotes: [],
  shared: {},
});

const manifestUrl = process.env.CATALOG_MANIFEST_URL!;
const [manifest, remoteModule] = await Promise.all([
  fetchFederationManifest(manifestUrl, {
    cacheTtl: 30_000,
    retries: 2,
    timeout: 5_000,
  }),
  loadRemoteFromManifest('catalog/Button', manifestUrl, {
    cacheTtl: 30_000,
    retries: 2,
    target: 'node',
    timeout: 5_000,
  }),
]);
```

Node SSR currently relies on the VM module loader for remote ESM evaluation. Run SSR examples with
`--experimental-vm-modules` until the Node loading strategy is replaced or no longer needs the flag.

## SSR Asset Collection

SSR HTML should include the CSS and synchronous JS assets declared for the rendered expose. Use
`collectFederationManifestPreloadLinks` instead of duplicating manifest URL resolution or link
deduplication.

```ts
import {
  collectFederationManifestPreloadLinks,
  fetchFederationManifest,
} from 'vite-plugin-federation/runtime';

const manifest = await fetchFederationManifest(manifestUrl, { cacheTtl: 30_000 });
const links = collectFederationManifestPreloadLinks(manifestUrl, manifest, './Button');

const linkTags = links.map((link) => {
  if (link.rel === 'stylesheet') {
    return `<link rel="stylesheet" href="${link.href}" />`;
  }

  const crossorigin = link.crossorigin ? ` crossorigin="${link.crossorigin}"` : '';
  return `<link rel="modulepreload"${crossorigin} href="${link.href}" />`;
});
```

The helper resolves relative asset paths against `metaData.publicPath` when it is set and not
`auto`; otherwise it resolves relative to the manifest URL. By default it includes sync CSS, async
CSS, and sync JS. Set `includeAsyncJs: true` when the host wants to eagerly modulepreload async JS
chunks as well. Module preload links default to `crossorigin="anonymous"`; set
`crossorigin: false` to omit the attribute.

If browser and remote assets are served from different origins, also account for root-relative
dependencies emitted inside remote chunks. Either configure the remote so those preloads resolve to
the remote origin, or proxy the relevant asset paths from the SSR host. The React SSR example proxies
`/assets/*` to the origin that serves the remote manifest so hydration can reuse the same manifest
URL without asset 404s.

## Observability

Use `getFederationDebugInfo()` to inspect the active runtime. The snapshot includes:

- Last remote load and last load error.
- Registered runtime remotes and registered manifest remotes.
- Registered shared providers, active share scope entries, and shared resolution graph entries.
- Manifest cache entries with `manifestUrl`, `name`, `fetchedAt`, and `expiresAt`.
- Manifest fetch history with `success`, `retry`, `failure`, and `cache-hit` entries.
- Pending manifest requests and pending remote registrations.
- Package-level diagnostics emitted through the plugin logger.

```ts
import { getFederationDebugInfo } from 'vite-plugin-federation/runtime';

console.table(getFederationDebugInfo().runtime.manifestFetches);
console.table(getFederationDebugInfo().runtime.sharedResolutionGraph);
```

Browser runtimes also dispatch `vite-plugin-federation:debug` events after runtime mutations. The
devtools sidecar consumes the same event stream.

## Error Handling

Production hosts should handle these runtime error categories explicitly:

- `MFV-003`: shared package miss, fallback selection, or strict shared resolution failure.
- `MFV-004`: manifest fetch, manifest validation, or runtime remote load failure.
- `MFV-005`: requested expose is missing from a manifest during asset collection.
- `MFV-006`: Node target cannot find a usable SSR remote entry.

Recommended host behavior:

- Render a route-level fallback for failed non-critical remotes.
- Fail fast for shell-critical remotes during boot.
- Log `getFederationDebugInfo()` with the application release id when remote loading fails.
- Use `retries` and `timeout` for startup resilience, not as a substitute for remote health checks.

## Deployment Checklist

- Publish `mf-manifest.json`, `mf-stats.json`, and `mf-debug.json` with each remote deployment.
- Set build metadata variables in CI so manifests can be traced to commits or release ids.
- Serve manifests with short or revalidated caching; serve hashed assets with immutable caching.
- Verify CORS for manifest JSON, remote entries, CSS, and dynamic chunks.
- Use `cacheTtl`, `timeout`, and bounded `retries` in production hosts.
- Use `target: 'node'` for SSR loads and include remote CSS/modulepreload links in rendered HTML.
- Capture `getFederationDebugInfo()` in remote load error logs.
