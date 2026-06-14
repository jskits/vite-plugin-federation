---
layout: home

hero:
  name: vite-plugin-federation
  text: Production Module Federation for Vite
  tagline: Manifest-first remotes, SSR-aware loading, runtime rollout controls, and migration paths for modern Vite applications.
  image:
    src: /logo.svg
    alt: vite-plugin-federation logo
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: Runtime API
      link: /runtime-api
    - theme: alt
      text: Compare Plugins
      link: /comparison

features:
  - title: Manifest-first loading
    details: Remotes emit mf-manifest.json, mf-stats.json, and mf-debug.json so hosts can load, validate, debug, and roll back releases with explicit metadata.
  - title: Production host controls
    details: The curated runtime adds cache TTL, stale-while-revalidate, retries, fallback URLs, timeouts, circuit breakers, request collapsing, and telemetry hooks.
  - title: SSR and preload helpers
    details: Node hosts can select SSR entries, create server federation instances, and collect preload links for streamed HTML.
  - title: Dev remote HMR
    details: Opt-in remote HMR classifies updates as partial, style, types, or full reload so local federation workflows stay fast.
  - title: Migration compatibility
    details: OriginJS virtual APIs and common Module Federation Vite options are supported while teams move toward manifest-first runtime APIs.
  - title: Stable public contract
    details: v1 documents plugin options, runtime exports, manifest schema, devtools events, and MFV error-code meanings.
---

## Federation Flow

<div class="federation-flow">
  <span><strong>Build</strong>Generate remote entries, manifest artifacts, type bundles, and debug metadata.</span>
  <span><strong>Publish</strong>Serve manifests with short cache policy and immutable entries/assets behind a stable URL.</span>
  <span><strong>Register</strong>Fetch, validate, cache, and register remotes through the curated runtime entry.</span>
  <span><strong>Operate</strong>Observe remote loads, refresh manifests, isolate tenants, and roll back by manifest.</span>
</div>

```ts
import { loadRemoteFromManifest } from 'vite-plugin-federation/runtime';

const catalog = await loadRemoteFromManifest(
  'catalog/Button',
  'https://cdn.example.com/catalog/mf-manifest.json',
  {
    cacheTtl: 30_000,
    integrity: true,
    retries: 2,
    timeout: 4_000,
  },
);
```

## Where To Start

<div class="federation-home-grid">
  <div class="federation-home-panel">
    <h2>New host or remote</h2>
    <p>Start with the quick guide, then use the plugin and runtime references for the full option surface.</p>
  </div>
  <div class="federation-home-panel">
    <h2>Production rollout</h2>
    <p>Use the manifest, runtime, security, preload, and troubleshooting guides before publishing remote artifacts.</p>
  </div>
  <div class="federation-home-panel">
    <h2>Migration</h2>
    <p>Use the comparison and migration guides when moving from OriginJS or the official Module Federation Vite adapter.</p>
  </div>
</div>

## Documentation Map

- [Getting Started](/getting-started) gives a minimal remote, host, and runtime load path.
- [Plugin API](/plugin-api), [Runtime API](/runtime-api), and [Public API Contract](/public-api-contract) define the stable v1 surface.
- [Manifest Protocol](/manifest-protocol), [Production Runtime](/production-runtime), [Preload And Performance](/preload-performance), [Multi-Tenant Isolation](/multi-tenant), and [Security](/security) cover rollout behavior.
- [Dev Remote HMR](/dev-hmr), [DTS Workflows](/dts-workflows), [DevTools Contract](/devtools-runtime-contract), and [Compiler Adapter](/compiler-adapter) cover local development and build internals.
- [Plugin Comparison](/comparison), [From @module-federation/vite](/migrate-from-module-federation-vite), and [From OriginJS](/originjs-migration) cover adoption choices.
- [Reference](/reference/), [Examples](/reference/examples), [Schemas](/reference/schemas), [llms.txt](/llms.txt), and [llms-full.txt](/llms-full.txt) are generated from the current repository.
