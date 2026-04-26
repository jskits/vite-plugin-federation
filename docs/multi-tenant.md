# Multi-Tenant Runtime Isolation

Use `runtimeKey` when one shell hosts multiple tenants, experiments, or isolated runtime scopes on
the same page. The key partitions manifest caches, pending manifest requests, circuit breaker state,
registered manifest remote debug records, and remote load metrics.

## Scoped Runtime API

`createFederationRuntimeScope(runtimeKey)` returns wrappers that automatically pass the same
`runtimeKey` to manifest runtime APIs.

```ts
import { createFederationRuntimeScope } from 'vite-plugin-federation/runtime';

const tenantA = createFederationRuntimeScope('tenant-a');
const tenantB = createFederationRuntimeScope('tenant-b');

await tenantA.registerManifestRemote('catalog', tenantAManifestUrl, {
  shareScope: 'tenant-a',
});

await tenantB.registerManifestRemote('catalog', tenantBManifestUrl, {
  shareScope: 'tenant-b',
});
```

The scoped object exposes:

- `fetchFederationManifest`
- `registerManifestRemote`
- `loadRemoteFromManifest`
- `refreshRemote`
- `warmFederationRemotes`
- `getFederationDebugInfo`

## Cache And Circuit Breaker Isolation

The same manifest URL can be fetched independently by multiple runtime keys:

```ts
await tenantA.fetchFederationManifest(manifestUrl, { cacheTtl: 30_000 });
await tenantB.fetchFederationManifest(manifestUrl, { cacheTtl: 30_000 });
```

Each tenant gets its own cache entry and circuit breaker state, so one tenant's failing rollout does
not poison another tenant's manifest cache.

## Share Scopes And Aliases

Use tenant-specific `shareScope` values when tenants may provide different singleton/shared versions.
`runtimeKey` isolates plugin-side manifest state and diagnostics; the underlying Module Federation
runtime still needs remote aliases to be unambiguous for actual module requests. If two tenants must
load different implementations at the same time, prefer tenant-specific request aliases such as
`tenantACatalog` and `tenantBCatalog`, or route requests through a tenant-aware runtime scope.

## Debugging

Global debug snapshots include `runtimeKey` on manifest cache entries, fetch history, circuit
breakers, registered manifest remotes, last load errors, and remote load metrics.

```ts
console.table(tenantA.getFederationDebugInfo().runtime.manifestCache);
console.table(tenantA.getFederationDebugInfo().runtime.remoteLoadMetrics);
```

Use scoped debug snapshots when sending tenant-specific telemetry so unrelated tenants do not leak
into logs.
