# Runtime API Reference

Import production runtime helpers from:

```ts
import {
  createFederationInstance,
  createServerFederationInstance,
  loadRemoteFromManifest,
} from 'vite-plugin-federation/runtime';
```

The runtime wraps `@module-federation/runtime` and adds manifest-first loading, SSR target
selection, preload helpers, rollout controls, and debug snapshots.

## Instance APIs

### `createFederationInstance(options)`

Creates a browser/runtime host instance and installs shared diagnostics plugins.

```ts
createFederationInstance({
  name: 'shell',
  remotes: [],
  shared: {},
});
```

### `createServerFederationInstance(options)`

Creates a server-side runtime instance with `inBrowser: false` and the Node remote entry loader.
Use this in SSR hosts before loading node-target remotes.

```ts
createServerFederationInstance({
  name: 'ssr-shell',
  remotes: [],
  shared: {},
});
```

## Manifest Fetching

### `fetchFederationManifest(manifestUrl, options?)`

Fetches and validates `mf-manifest.json`.

Important options:

- `cache`, `cacheTtl`, `force`
- `fallbackUrls`
- `staleWhileRevalidate`
- `circuitBreaker`
- `fetch`, `fetchInit`
- `retries`, `retryDelay`, `timeout`
- `hooks`

```ts
const manifest = await fetchFederationManifest(catalogManifestUrl, {
  cacheTtl: 30_000,
  fallbackUrls: [catalogBackupManifestUrl],
  staleWhileRevalidate: true,
  timeout: 4_000,
});
```

## Manifest Remote Registration

### `registerManifestRemote(remoteAlias, manifestUrl, options?)`

Fetches a manifest, selects the correct entry for the target, optionally verifies entry integrity,
and registers the remote with the Module Federation runtime.

```ts
await registerManifestRemote('catalog', catalogManifestUrl, {
  target: 'web',
  shareScope: 'default',
  integrity: true,
});
```

For `target: 'node'`, `ssrRemoteEntry` is selected first and `remoteEntry` is used only when no SSR
entry is declared.

### `registerManifestRemotes(remotes, target?)`

Registers multiple manifest remotes concurrently.

```ts
await registerManifestRemotes({
  catalog: catalogManifestUrl,
  checkout: {
    manifestUrl: checkoutManifestUrl,
    cacheTtl: 60_000,
  },
});
```

## Remote Loading

### `loadRemoteFromManifest(remoteId, manifestUrl, options?)`

Registers the manifest remote if needed and then loads an exposed module.

```ts
const remoteModule = await loadRemoteFromManifest('catalog/Button', catalogManifestUrl, {
  cacheTtl: 30_000,
  retries: 2,
  timeout: 4_000,
});

const CatalogButton = remoteModule.default ?? remoteModule;
```

### `loadRemote(remoteId, options?)`

Delegates to `@module-federation/runtime` and records load success/failure in
`getFederationDebugInfo()`.

### `refreshRemote(remoteIdOrAlias, options?)`

Invalidates manifest registration and re-registers the remote. Browser targets append a timestamp
query to remote entries on forced refresh.

```ts
await refreshRemote('catalog', {
  invalidateManifest: true,
  timeout: 4_000,
});
```

## Shared APIs

The runtime re-exports and wraps shared APIs:

- `loadShare`
- `loadShareSync`
- `registerShared`

The wrappers record shared resolution graph entries, selected providers, fallbacks, version
compatibility, and singleton conflicts.

## Preload And Manifest Assets

### `collectFederationManifestExposeAssets(manifestUrl, manifest, exposePath)`

Returns resolved CSS and JS asset URLs for one expose.

### `collectFederationManifestPreloadLinks(manifestUrl, manifest, exposePaths, options?)`

Returns deduped SSR-ready `<link>` descriptors for exposes.

```ts
const links = collectFederationManifestPreloadLinks(manifestUrl, manifest, ['./Button']);
```

Options:

- `includeCss`
- `includeJs`
- `includeAsyncCss`
- `includeAsyncJs`
- `crossorigin`

## Integrity

`registerManifestRemote` and `loadRemoteFromManifest` support:

```ts
integrity: true
integrity: { mode: 'prefer-integrity' | 'integrity' | 'content-hash' | 'both' }
```

The runtime verifies `metaData.remoteEntry` or `metaData.ssrRemoteEntry` hashes before
registration. Results are visible in `getFederationDebugInfo().runtime.manifestIntegrityChecks`.

## Hooks And Telemetry

Manifest runtime controls accept:

```ts
hooks: {
  manifestFetch(event) {},
  remoteRegister(event) {},
  remoteLoad(event) {},
  remoteRefresh(event) {},
  telemetry(event) {},
}
```

Events include `kind`, `stage`, `timestamp`, and contextual fields such as `manifestUrl`,
`sourceUrl`, `remoteId`, `entry`, `target`, `status`, `statusCode`, `durationMs`, and `error`.

## Debugging

### `getFederationDebugInfo()`

Returns diagnostics, runtime instance snapshot, registered remotes, manifest cache, fetch timeline,
integrity checks, circuit breaker state, shared providers, and shared resolution graph.

### `clearFederationRuntimeCaches()`

Clears manifest cache, node module cache, registration requests, debug histories, and shared
resolution history. Use only in tests or controlled runtime resets.

## Re-exports

The runtime also re-exports selected Module Federation runtime helpers:

- `getInstance`
- `getRemoteEntry`
- `getRemoteInfo`
- `loadScript`
- `loadScriptNode`
- `preloadRemote`
- `registerGlobalPlugins`
- `registerPlugins`
- `registerRemotes`
