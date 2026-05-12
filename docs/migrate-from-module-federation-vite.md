# Migrating from `@module-federation/vite`

`vite-plugin-federation` is API-compatible with `@module-federation/vite` for the build-time
plugin shape and exact-pins its Module Federation runtime stack at `2.3.3`. Current
`@module-federation/vite` releases may pin a newer MF runtime, so check your lockfile when
your application imports `@module-federation/runtime` directly. Most applications can still
switch with a one-line dependency change. The net gains are a curated runtime entry,
manifest-first host loading policy, multi-tenant scoping, integrity verification, SSR helpers,
classified dev remote HMR, and stable error codes.

This guide does not treat official runtime/core features as missing. `@module-federation/vite`
already exposes official runtime behavior through `@module-federation/runtime`, including
helpers such as `registerPlugins`, `registerRemotes`, `preloadRemote`, `loadRemote`, runtime
hooks, manifest cache state, debug globals, and optional official plugins such as
`@module-federation/retry-plugin`. The migration value here is the higher-level policy wrapper
and compatibility surface this package adds around those primitives.

A full feature comparison lives in [`../COMPARISON.md`](../COMPARISON.md).

---

## 1. Replace the dependency

```diff
- "@module-federation/vite": "^1.15.4"
+ "vite-plugin-federation": "^1.0.0"
```

The `@module-federation/runtime`, `@module-federation/sdk`, and `@module-federation/dts-plugin`
versions are all exact-pinned to `2.3.3` inside this package. If you import
`@module-federation/runtime` directly elsewhere in your app, prefer switching those runtime calls
to `vite-plugin-federation/runtime`; the plugin also aliases runtime imports during Vite builds so
federation state stays shared through the configured bridge.

## 2. Update the plugin import

```diff
- import { federation } from '@module-federation/vite';
+ import federation from 'vite-plugin-federation';
```

`vite-plugin-federation` exports a default function. Named import via `import { federation }`
also works.

## 3. Plugin options — what carries over verbatim

These options have identical names and semantics:

| Option                                         | Notes                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| `name`                                         | unchanged                                                         |
| `filename`, `varFilename`                      | unchanged                                                         |
| `exposes`, `remotes`, `shared`                 | unchanged                                                         |
| `manifest: boolean \| object`                  | superset — see §4                                                 |
| `dts: boolean \| object`                       | superset; this package uses `@module-federation/dts-plugin@2.3.3` |
| `dev: boolean \| object`                       | superset — see §5                                                 |
| `target: 'web' \| 'node'`                      | unchanged (auto-detect from `build.ssr`)                          |
| `runtimePlugins`                               | unchanged                                                         |
| `publicPath`, `getPublicPath`                  | unchanged                                                         |
| `shareStrategy`, `shareScope`                  | unchanged                                                         |
| `virtualModuleDir`                             | unchanged                                                         |
| `hostInitInjectLocation`                       | unchanged                                                         |
| `moduleParseTimeout`, `moduleParseIdleTimeout` | unchanged                                                         |

## 4. Manifest options — additive

`vite-plugin-federation` emits a third artifact, `mf-debug.json`, in addition to
`mf-manifest.json` and `mf-stats.json`. No config change is required — it just shows up in
your build output. The host can ignore it; CI can use it for build diagnostics. See
`docs/manifest-protocol.md`.

## 5. Dev — remote HMR with classification

`@module-federation/vite`'s `dev: { remoteHmr: true }` has websocket metadata, reconnect
handling, a React native HMR strategy, and a full-reload fallback. `vite-plugin-federation`
keeps remote HMR opt-in, but when you enable `dev: { remoteHmr: true }`, it classifies each
update so the host can react proportionally:

- **`partial`** — try `server.reloadModule()` for the affected expose.
- **`style`** — refresh the affected stylesheet only.
- **`types`** — sync `.d.ts` to the host without reload.
- **`full`** — fall back to a full reload.

Add `dev: { remoteHmr: true }` to opt in. See `docs/dev-hmr.md` for the strategy table and
the disable flags (`disableLiveReload`, `disableHotTypesReload`,
`disableDynamicRemoteTypeHints`).

## 6. Runtime API — new curated entry

If you previously imported runtime helpers directly:

```ts
import { loadRemote, registerRemotes } from '@module-federation/runtime';
```

…you can keep that import working unchanged (the plugin aliases it). Official runtime imports
also already expose helpers such as `registerPlugins` and `preloadRemote`. To get this
package's manifest-first loading wrapper with cache TTL, retries, circuit breaker state, scoped
debug records, and integrity checks, switch selected call sites to:

```ts
import {
  registerManifestRemote,
  loadRemoteFromManifest,
  fetchFederationManifest,
  warmFederationRemotes,
  createFederationManifestPreloadPlan,
  verifyFederationManifestAssets,
  createFederationRuntimeScope,
  getFederationDebugInfo,
} from 'vite-plugin-federation/runtime';
```

The full surface and option shape is documented in `docs/runtime-api.md`. There is no
behavioral conflict with continuing to use `@module-federation/runtime` directly for
non-manifest paths.

## 7. SSR — opt-in helpers

`@module-federation/vite@1.15.4` emits `metaData.ssrRemoteEntry` in the manifest metadata; in
that package version it points at the same entry as `remoteEntry`. `vite-plugin-federation`
emits a separate `ssrRemoteEntry.js` per remote and exposes:

```ts
import {
  createServerFederationInstance,
  collectFederationManifestPreloadLinks,
} from 'vite-plugin-federation/runtime';
```

See `docs/production-runtime.md` for entry selection rules and `docs/runtime-api.md` for the
preload-link collector. Node currently needs `--experimental-vm-modules`.

## 8. Multi-tenant deployments

If you serve multiple tenants on the same page (e.g., per-customer remote sets), wrap each
tenant in its own runtime scope:

```ts
import { createFederationRuntimeScope } from 'vite-plugin-federation/runtime';
const tenant = createFederationRuntimeScope(tenantId);
await tenant.registerManifestRemote('catalog', tenantCatalogManifestUrl, {
  shareScope: tenantId,
});
```

This isolates the manifest cache, circuit breaker, and debug records per tenant. The official
runtime has lower-level instances and share scopes, but not this `runtimeKey` cache/breaker/debug
partitioning wrapper. See `docs/multi-tenant.md`.

## 9. Things that change behavior on switch (read carefully)

- **Default build artifacts** include `mf-debug.json` (extra file, harmless if ignored).
- **`runtimeInit` / `loadShare` chunk isolation** is enforced on both Rolldown and Rollup;
  if your build sets `output.manualChunks`, the plugin replaces it with federation-specific
  chunk rules and prints a one-time warning. `output.codeSplitting.groups` is removed because
  it can group federation control chunks with app code.
- **Dev `remoteHmr` is opt-in.** Add `dev: { remoteHmr: true }` when you want host/remote HMR
  wiring during local development.
- **`compat.virtualFederationShim` is on by default** (the `virtual:__federation__` API
  works). It costs nothing if unused. Disable with `compat: { originjs: false,
virtualFederationShim: false }` if you want a strict manifest-only surface.

## 10. Verification checklist

After switching:

1. `pnpm build` — confirm `dist/mf-manifest.json` and `dist/mf-stats.json` look the same.
2. Smoke-test `loadRemote('alias/expose')` (existing call sites keep working).
3. If you load remotes from a URL, change the URL to point at `mf-manifest.json` and call
   `loadRemoteFromManifest('alias/expose')` to pick up retries and cache TTL.
4. Check `getFederationDebugInfo()` in dev to confirm registered remotes match your config.

---

_See [`../COMPARISON.md`](../COMPARISON.md) for the full plugin-by-plugin feature matrix._
