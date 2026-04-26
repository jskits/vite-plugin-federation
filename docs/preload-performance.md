# Federation Preload And Performance

This guide covers the production APIs for route-aware preload planning, remote warming, and
runtime load metrics.

## Route-Level Preload Plans

Use `createFederationManifestPreloadPlan` when the host knows which exposes are needed for a route.
The helper resolves manifest asset paths, dedupes links across routes, and applies an async chunk
policy.

```ts
import { createFederationManifestPreloadPlan } from 'vite-plugin-federation/runtime';

const plan = createFederationManifestPreloadPlan(manifestUrl, manifest, {
  '/checkout': ['./Cart', './PaymentForm'],
  '/account': './AccountHome',
});
```

The returned plan contains:

- `routes`: one entry per route with the route-local preload links.
- `links`: all deduped links across every route.
- `remoteName` and `manifestUrl`: useful for logging and SSR diagnostics.

The async chunk policy defaults to `css`: sync JS, sync CSS, and async CSS are preloaded, while async
JS is left lazy. Set `asyncChunkPolicy: 'all'` for critical routes, `js` for JS-only warmups, or
`none` for only sync assets.

```ts
createFederationManifestPreloadPlan(manifestUrl, manifest, routes, {
  asyncChunkPolicy: 'all',
  crossorigin: 'anonymous',
});
```

## Manifest-Level Preload Hints

Manifests may include optional preload hints for assets that are not tied directly to a single
expose, such as shared runtime chunks or route-critical CSS.

```json
{
  "preload": {
    "assets": {
      "js": ["assets/remote-runtime.js"]
    },
    "routes": [
      {
        "route": "/checkout",
        "expose": "./Cart",
        "assets": {
          "css": ["assets/checkout-critical.css"]
        }
      }
    ]
  }
}
```

Hints are additive. They do not replace expose assets from `exposes[].assets`, and duplicate links
are removed by URL and relation.

## Host-Side Remote Warming

Use `warmFederationRemotes` to register selected manifest remotes and ask the Module Federation
runtime to preload them before user navigation reaches a critical route.

```ts
import { warmFederationRemotes } from 'vite-plugin-federation/runtime';

await warmFederationRemotes({
  catalog: {
    manifestUrl: catalogManifestUrl,
    cacheTtl: 30_000,
    preload: {
      resourceCategory: 'sync',
    },
  },
});
```

Set `preload: false` when you only want registration and manifest cache warming.

## Runtime Metrics

`getFederationDebugInfo().runtime.remoteLoadMetrics` records recent remote module load waterfalls.
Entries include:

- `remoteId`, `remoteAlias`, `remoteName`, `manifestUrl`, `sourceUrl`, `entry`, and `target`.
- `registrationDurationMs`, `loadDurationMs`, and total `durationMs`.
- `phase`, `status`, `timestamp`, and `error` for failures.

Use this data in devtools, logs, or synthetic checks to identify slow manifests, CDN propagation
issues, remote entry startup cost, or over-eager preload policies.

## Performance Budget Guidance

Recommended production checks:

- Manifest fetch should hit cache for repeated route transitions.
- Route preload plans should avoid `asyncChunkPolicy: 'all'` outside critical above-the-fold routes.
- Warm only remotes likely to be used by the next navigation step.
- Alert on repeated `remoteLoadMetrics.status === 'failure'` or high `durationMs` for critical
  routes.
