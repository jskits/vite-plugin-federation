# Vite Module Federation — Plugin Comparison

A feature-by-feature comparison of three Vite Module Federation plugins, based on the
checked-in comparison snapshots and npm metadata where noted.

| Symbol | Meaning                                   |
| ------ | ----------------------------------------- |
| ✅     | First-class support (documented + tested) |
| 🟡     | Partial / experimental / behind a flag    |
| ❌     | Not supported                             |
| n/a    | Not applicable to that plugin's design    |

> Sources: package metadata, source code, shipped docs, and local comparison snapshots
> as of the reviewed versions below. Footnote markers like `[1]` link to the
> source-of-truth citations at the bottom of this document.

---

## At a Glance

|                          | **`vite-plugin-federation`** (this repo)                         | **`@module-federation/vite`**                                   | **`@originjs/vite-plugin-federation`** |
| ------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------- |
| Reviewed version         | `0.0.4` [1]                                                      | `1.14.4` snapshot (`1.14.5` latest npm) [2]                     | `1.4.1` [3]                            |
| Vite peer range          | `^5 \|\| ^6 \|\| ^7 \|\| ^8` [1]                                 | `^5 \|\| ^6 \|\| ^7 \|\| ^8` [2]                                | not declared (devDep `^4.0.5`) [3]     |
| Rolldown / Vite 8        | ✅ first-class compiler adapter                                  | ✅ supported                                                    | ❌ not targeted                        |
| Underlying MF runtime    | `@module-federation/runtime@2.3.3` (wrapped + extended)          | `@module-federation/runtime@2.3.3` (passthrough)                | hand-rolled (`virtual:__federation__`) |
| Manifest protocol        | ✅ `mf-manifest.json` + `mf-stats.json` + `mf-debug.json`        | ✅ `mf-manifest.json` + `mf-stats.json`                         | ❌ none                                |
| Curated runtime entry    | ✅ `vite-plugin-federation/runtime` [1]                          | ❌ (must import `@module-federation/runtime` directly)          | ❌ (`virtual:__federation__` only)     |
| Dev mode for **remotes** | ✅ true HMR with strategy classification                         | 🟡 full-reload only                                             | ❌ remote must be `vite build --watch` |
| SSR (Node)               | ✅ dedicated `ssrRemoteEntry` + `createServerFederationInstance` | 🟡 `target: 'node'` tree-shake; no SSR-specific runtime helpers | ❌                                     |
| OriginJS migration shim  | ✅ `virtual:__federation__` compat layer enabled by default      | ❌                                                              | n/a (it _is_ this API)                 |

---

## 1. Module Federation Core

| Capability                                                              |            `vite-plugin-federation`             | `@module-federation/vite`  | `@originjs/vite-plugin-federation` |
| ----------------------------------------------------------------------- | :---------------------------------------------: | :------------------------: | :--------------------------------: |
| `name` / `filename`                                                     |                       ✅                        |             ✅             |                 ✅                 |
| `exposes`                                                               |                       ✅                        |             ✅             |                 ✅                 |
| `remotes`                                                               | ✅ (string or object form, manifest-first URLs) |             ✅             |                 ✅                 |
| `shared`                                                                |                       ✅                        |             ✅             |                 ✅                 |
| Custom `shareScope`                                                     |                       ✅                        |             ✅             |               ✅ [3]               |
| Multiple scopes / runtime keys                                          |      ✅ `createFederationRuntimeScope` [4]      |             ❌             |                 ❌                 |
| Runtime plugins (`registerPlugins`)                                     |  ✅ `runtimePlugins` option + re-exported [5]   | ✅ `runtimePlugins` option |   ❌ (no runtime plugin system)    |
| Custom compiler adapter / `compat: { originjs, virtualFederationShim }` |                     ✅ [6]                      |             ❌             |                 ❌                 |
| `from: 'vite' \| 'webpack'` normalization                               |   ✅ (one-time `MFV-007` warning on unknown)    |             ❌             |          ✅ legacy field           |

## 2. Remote Formats

| Format                                                     |                      `vite-plugin-federation`                       |     `@module-federation/vite`     |    `@originjs/vite-plugin-federation`     |
| ---------------------------------------------------------- | :-----------------------------------------------------------------: | :-------------------------------: | :---------------------------------------: |
| `esm` / `module`                                           |                             ✅ primary                              |            ✅ primary             |                ✅ primary                 |
| `var` (browser global)                                     |                      ✅ via `varFilename` [6]                       |       ✅ via `varFilename`        |       ✅ via `loadJS()` script tag        |
| `systemjs` / `system`                                      | ✅ runtime-guarded; throws `MFV-005` if `System.import` missing [6] |                ❌                 |        ✅ same code path as `esm`         |
| Manifest-first remote URL (`https://.../mf-manifest.json`) |                         ✅ recommended path                         |                ✅                 |                    ❌                     |
| Webpack-built remote consumed by Vite host                 |   ✅ via compat e2e (webpack `library.type: 'system'` remote) [6]   | ✅ `vite-webpack-rspack` e2e [12] | ✅ legacy `from: 'webpack'` examples [13] |
| CommonJS browser remote                                    |           ❌ unsupported by design (use SSR/ESM instead)            |                ❌                 |                    ❌                     |

## 3. Shared Dependencies

| Capability                                          |            `vite-plugin-federation`            |              `@module-federation/vite`               |   `@originjs/vite-plugin-federation`   |
| --------------------------------------------------- | :--------------------------------------------: | :--------------------------------------------------: | :------------------------------------: |
| `singleton`                                         |                       ✅                       |                          ✅                          | ❌ (commented out in public types) [3] |
| `eager`                                             | ❌ plugin config (runtime API can register it) |    ❌ plugin config (runtime API can register it)    | ❌ (commented out in public types) [3] |
| `strictVersion`                                     |                       ✅                       |                          ✅                          |                   ❌                   |
| `requiredVersion` (semver range)                    |                       ✅                       |                          ✅                          |       ✅ (custom `satisfy` impl)       |
| Version negotiation across remotes                  |               ✅ via MF runtime                |                  ✅ via MF runtime                   |          🟡 first-match only           |
| Workspace / scoped shares (`react/`, pnpm symlinks) |      ✅ `allowNodeModulesSuffixMatch` [4]      | 🟡 workspace e2e; no documented suffix matching [12] |                   ❌                   |
| Host-only shares (`import: false`)                  |       ✅ explicit `MFV-003` on miss [4]        |                  🟡 not documented                   |                   ❌                   |
| Strict-singleton fallback policy                    |   ✅ recorded in `sharedResolutionGraph` [4]   |                          ❌                          |                   ❌                   |
| `bundleAllCSS` option                               |      ✅ option + per-expose CSS modes [4]      |                      ✅ option                       |                   ❌                   |
| Shared module preload (`<link rel="preload">`)      |            ✅ via preload plan API             |           🟡 manifest asset analysis only            |        ✅ `modulePreload` flag         |

## 4. Exposes & Named Exports

| Capability                                                     |                    `vite-plugin-federation`                    |              `@module-federation/vite`              |    `@originjs/vite-plugin-federation`    |
| -------------------------------------------------------------- | :------------------------------------------------------------: | :-------------------------------------------------: | :--------------------------------------: |
| Default export                                                 |                               ✅                               |                         ✅                          |                    ✅                    |
| Named exports (`import { foo } from 'remote/x'`)               | ✅ — Rolldown-aware via `pluginRemoteNamedExports` rewrite [6] | ✅ Rollup `syntheticNamedExports`; Rolldown limited |          🟡 single-import only           |
| Per-expose CSS injection mode (`'head' \| 'manual' \| 'none'`) |                             ✅ [4]                             |           🟡 single global `bundleAllCSS`           | ✅ `dontAppendStylesToHead` (per-expose) |
| Custom expose chunk name (`exposes[].name`)                    |                               ❌                               |                         ❌                          |                  ✅ [3]                  |
| `varFilename` for additional var-style entry                   |                               ✅                               |                         ✅                          |                   n/a                    |

## 5. Dev Experience

| Capability                             |                    `vite-plugin-federation`                    |           `@module-federation/vite`           |   `@originjs/vite-plugin-federation`    |
| -------------------------------------- | :------------------------------------------------------------: | :-------------------------------------------: | :-------------------------------------: |
| Dev server for **host**                |                               ✅                               |                      ✅                       |                   ✅                    |
| Dev server for **remote** (no rebuild) |                  ✅ — sidecar dev runtime [4]                  |                      ✅                       | ❌ remote must `vite build --watch` [3] |
| Remote-change HMR signal to host       | ✅ classified updates: `partial`, `style`, `types`, `full` [4] |    🟡 `remoteHmr: true` → full reload only    |                   ❌                    |
| Batched / coalesced updates            |                             ✅ [4]                             |                      ❌                       |                   ❌                    |
| Live `.d.ts` sync (no reload)          |            ✅ via `dts-plugin` dev worker + WS [4]             |   🟡 dev worker present; no local e2e found   |                   ❌                    |
| Dynamic remote-type hints injection    |                           ✅ option                            |    ✅ via `@module-federation/dts-plugin`     |                   ❌                    |
| Dev top-level-await proxy              |                               ✅                               |                      ✅                       |                   n/a                   |
| Dev manifest endpoints (`/__mf__/...`) |                               ✅                               | 🟡 (manifest served in dev for consumer apps) |                   ❌                    |

## 6. TypeScript / DTS

| Capability                                         |           `vite-plugin-federation`           |        `@module-federation/vite`         | `@originjs/vite-plugin-federation` |
| -------------------------------------------------- | :------------------------------------------: | :--------------------------------------: | :--------------------------------: |
| Auto `.d.ts` generation for `exposes`              | ✅ via `@module-federation/dts-plugin@2.3.3` |            ✅ via same plugin            |    ❌ (hand-written types only)    |
| `@mf-types.zip` artifact                           |                      ✅                      |                    ✅                    |                 ❌                 |
| Manifest-derived type URL on host                  |      ✅ + `remoteTypeUrls` override [4]      |                    ✅                    |                 ❌                 |
| `typesOnBuild: true` (fail build on missing types) |                      ✅                      |                    ✅                    |                 ❌                 |
| Hot type updates in dev (no reload)                |                      ✅                      | 🟡 dev worker exists; no local e2e found |                 ❌                 |

## 7. SSR (Node)

| Capability                                                     |              `vite-plugin-federation`               |   `@module-federation/vite`    | `@originjs/vite-plugin-federation` |
| -------------------------------------------------------------- | :-------------------------------------------------: | :----------------------------: | :--------------------------------: |
| `target: 'web' \| 'node'` resolution                           | ✅ (auto from `build.ssr`, `ENV_TARGET` define) [6] |       ✅ same mechanism        |                 ❌                 |
| Dedicated `ssrRemoteEntry` artifact                            |              ✅ separate file emitted               |               ❌               |                 ❌                 |
| Server runtime instance API (`createServerFederationInstance`) |                       ✅ [4]                        |               ❌               |                 ❌                 |
| Asset-preload collection for streaming HTML                    |   ✅ `collectFederationManifestPreloadLinks` [4]    | 🟡 manifest assetAnalysis only |                 ❌                 |
| Hydration-safe module-preload helper                           | ✅ short-circuits when `document` is undefined [6]  |        ✅ similar patch        |                 ❌                 |
| Required Node flags                                            |           `--experimental-vm-modules` [4]           |              n/a               |                n/a                 |

## 8. Production Runtime (host loader)

| Capability                                                      |        `vite-plugin-federation`         |             `@module-federation/vite`              | `@originjs/vite-plugin-federation` |
| --------------------------------------------------------------- | :-------------------------------------: | :------------------------------------------------: | :--------------------------------: |
| Manifest-first `loadRemoteFromManifest()`                       |                 ✅ [4]                  | ❌ (use `@module-federation/runtime` API directly) |                 ❌                 |
| Cache TTL / `staleWhileRevalidate` / `force` refresh            |                 ✅ [4]                  |                         ❌                         |                 ❌                 |
| Retry with jitter + timeout                                     |                 ✅ [4]                  |                         ❌                         |                 ❌                 |
| Fallback URLs                                                   |    ✅ records effective `sourceUrl`     |                         ❌                         |                 ❌                 |
| Circuit breaker (`failureThreshold`, `cooldownMs`)              |                 ✅ [4]                  |                         ❌                         |                 ❌                 |
| Concurrent-fetch request collapsing                             |                 ✅ [4]                  |                         ❌                         |                 ❌                 |
| Integrity verification (SRI / SHA-256, multi-mode)              | ✅ `verifyFederationManifestAssets` [7] |                         ❌                         |                 ❌                 |
| Private / authenticated manifests (`fetchInit`, custom `fetch`) |                 ✅ [7]                  |                         ❌                         |                 ❌                 |
| Signed manifest workflow                                        |  ✅ documented + custom-fetch hook [7]  |                         ❌                         |                 ❌                 |
| CSP / Trusted Types guidance                                    |                 ✅ [7]                  |                         ❌                         |                 ❌                 |

## 9. Multi-Tenant / Scoping

| Capability                                      |             `vite-plugin-federation`              |         `@module-federation/vite`         | `@originjs/vite-plugin-federation` |
| ----------------------------------------------- | :-----------------------------------------------: | :---------------------------------------: | :--------------------------------: |
| Per-tenant `runtimeKey` scope                   | ✅ `createFederationRuntimeScope(runtimeKey)` [8] |                    ❌                     |                 ❌                 |
| Tenant-isolated manifest cache                  |                        ✅                         |                    ❌                     |                 ❌                 |
| Tenant-isolated circuit breaker / debug records |                        ✅                         |                    ❌                     |                 ❌                 |
| Per-tenant `shareScope`                         |                        ✅                         | ✅ (one global scope per plugin instance) |             ✅ (same)              |

## 10. Preload & Performance

| Capability                                                      |           `vite-plugin-federation`           | `@module-federation/vite` | `@originjs/vite-plugin-federation` |
| --------------------------------------------------------------- | :------------------------------------------: | :-----------------------: | :--------------------------------: |
| Route-aware preload plan                                        | ✅ `createFederationManifestPreloadPlan` [9] |            ❌             |                 ❌                 |
| Async-chunk preload policy (`'css' \| 'none' \| 'js' \| 'all'`) |                    ✅ [9]                    |            ❌             |                 ❌                 |
| Remote warming (`warmFederationRemotes`)                        |                    ✅ [9]                    |            ❌             |                 ❌                 |
| Per-remote load metrics (registration / load / total)           |                    ✅ [9]                    |            ❌             |                 ❌                 |
| Manifest-declared route hints                                   |                      ✅                      |            ❌             |                 ❌                 |

## 11. Observability & DevTools

| Capability                                                                         |                                `vite-plugin-federation`                                 | `@module-federation/vite` | `@originjs/vite-plugin-federation` |
| ---------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------: | :-----------------------: | :--------------------------------: |
| Dev devtools panel + browser events                                                |                               ✅ `pluginDevtools.ts` [4]                                |            ❌             |                 ❌                 |
| `getFederationDebugInfo()` snapshot                                                | ✅ (instance, manifests, fetch timeline, integrity, breaker, metrics, shared graph) [4] |            ❌             |                 ❌                 |
| Telemetry hooks (`manifestFetch`, `remoteRegister`, `remoteLoad`, `remoteRefresh`) |                                         ✅ [4]                                          |            ❌             |                 ❌                 |
| Stable error codes (`MFV-001` … `MFV-007`)                                         |                                         ✅ [10]                                         |     ❌ generic logger     |         ❌ generic strings         |
| `mf-debug.json` build artifact                                                     |                                           ✅                                            |            ❌             |                 ❌                 |

## 12. Security

| Capability                          |                        `vite-plugin-federation`                         |   `@module-federation/vite`    |   `@originjs/vite-plugin-federation`   |
| ----------------------------------- | :---------------------------------------------------------------------: | :----------------------------: | :------------------------------------: |
| Subresource integrity in manifest   |                                 ✅ [7]                                  |               ❌               |                   ❌                   |
| Content-hash verification           | ✅ multi-mode (`prefer-integrity`, `integrity`, `content-hash`, `both`) |               ❌               |                   ❌                   |
| CSP / nonce friendly browser builds |         ✅ documented; browser target avoids inline scripts [7]         | 🟡 similar target tree-shaking | 🟡 script-tag legacy paths need review |
| Trusted Types support               |                              ✅ documented                              |               ❌               |                   ❌                   |
| Signed manifest pattern             |                         ✅ via `fetch` wrapper                          |               ❌               |                   ❌                   |

## 13. Compiler / Build Adapter

| Capability                                                                                           |                         `vite-plugin-federation`                          |     `@module-federation/vite`      | `@originjs/vite-plugin-federation` |
| ---------------------------------------------------------------------------------------------------- | :-----------------------------------------------------------------------: | :--------------------------------: | :--------------------------------: |
| Rollup output handling                                                                               |                                    ✅                                     |                 ✅                 |                 ✅                 |
| Rolldown output handling (Vite 8)                                                                    |   ✅ separate `rolldownOptions` path + `getRolldownOptions` rewrite [6]   | ✅ separate `rolldownOptions` path |                 ❌                 |
| Top-level-await deadlock prevention (CJS-proxy helper inlining)                                      |                     ✅ two-pass `generateBundle` [6]                      |  ✅ same algorithm (forked here)   |                n/a                 |
| `runtimeInit` + `loadShare` chunk isolation                                                          | ✅ enforced (rejects user `manualChunks` that conflict, with warning) [6] |              ✅ same               |                n/a                 |
| Module-preload helper rewrite to `import.meta.url` (so cross-origin remote chunks resolve correctly) |       ✅ covers Vite 8, esbuild, terser, arrow + function form [6]        |              ✅ same               |             🟡 partial             |
| `commonjsOptions.strictRequires: 'auto'` defaulting                                                  |                                    ✅                                     |                 ✅                 |                 ❌                 |
| `output.codeSplitting.groups` guard (Vite 8)                                                         |                                    ✅                                     |                 ✅                 |                n/a                 |

## 14. OriginJS Compatibility

| Capability                                                           |                                 `vite-plugin-federation`                                 | `@module-federation/vite` | `@originjs/vite-plugin-federation` |
| -------------------------------------------------------------------- | :--------------------------------------------------------------------------------------: | :-----------------------: | :--------------------------------: |
| `virtual:__federation__` shim                                        |          ✅ enabled by default; toggle via `compat.virtualFederationShim` [11]           |            ❌             |       n/a (it _is_ the API)        |
| `__federation_method_setRemote / getRemote / ensure / unwrap / wrap` |                                       ✅ all five                                        |            ❌             |                 ✅                 |
| Normalizes OriginJS `./Button` → `remote/Button`                     |                                            ✅                                            |            ❌             |                n/a                 |
| `dontAppendStylesToHead` → `css.inject: 'manual'` mapping            |                                            ✅                                            |            ❌             |             ✅ native              |
| Drop-in adoption from OriginJS apps                                  | ✅ + e2e validates a Vite host loading a webpack `systemjs` remote through the shim [11] |    ❌ requires rewrite    |                n/a                 |

## 15. Public API Surface

### `vite-plugin-federation` (this repo)

```ts
// Build-time plugin
import federation, { type ModuleFederationOptions } from 'vite-plugin-federation';

// Production runtime helpers (curated subpath export)
import {
  createFederationInstance,
  createServerFederationInstance,
  createFederationRuntimeScope,
  fetchFederationManifest,
  registerManifestRemote,
  registerManifestRemotes,
  loadRemoteFromManifest,
  refreshRemote,
  warmFederationRemotes,
  preloadRemote,
  createFederationManifestPreloadPlan,
  collectFederationManifestPreloadLinks,
  verifyFederationManifestAssets,
  getFederationDebugInfo,
  clearFederationRuntimeCaches,
  // re-exports of @module-federation/runtime
  registerPlugins,
  registerRemotes,
  registerShared,
  loadRemote,
  loadShare,
  loadShareSync,
} from 'vite-plugin-federation/runtime';
```

### `@module-federation/vite`

```ts
import { federation } from '@module-federation/vite';
// runtime API: import directly from '@module-federation/runtime'
import { loadRemote, registerRemotes } from '@module-federation/runtime';
```

### `@originjs/vite-plugin-federation`

```ts
import federation from '@originjs/vite-plugin-federation';
import {
  __federation_method_ensure,
  __federation_method_getRemote,
  __federation_method_setRemote,
  __federation_method_unwrapDefault,
  __federation_method_wrapDefault,
} from 'virtual:__federation__';
```

## 16. Test & Example Surface

| Surface                            |                         `vite-plugin-federation`                         |            `@module-federation/vite`            | `@originjs/vite-plugin-federation` |
| ---------------------------------- | :----------------------------------------------------------------------: | :---------------------------------------------: | :--------------------------------: |
| Unit tests                         |                                ✅ vitest                                 |                    ✅ vitest                    |             ✅ vitest              |
| Integration tests (build pipeline) |                                    ✅                                    |               ✅ (`integration/`)               |                 🟡                 |
| Browser e2e (Playwright)           | ✅ 6 configs: default, compat, multi-remote, shared, ssr, browser-matrix |       ✅ vite-vite + vite-webpack-rspack        |                 ✅                 |
| SSR e2e                            |                                    ✅                                    |                       ❌                        |                 ❌                 |
| Browser matrix                     |                      ✅ Chromium / Firefox / WebKit                      |                ❌ Chromium only                 |                 ❌                 |
| Vite peer-version smoke            |       ✅ packed tarball builds and runs against Vite 5 / 6 / 7 / 8       | ✅ Vite 6 / 7 / 8 in `vite-webpack-rspack` [12] |         ❌ Vite 4-focused          |
| Webpack-remote interop e2e         |        ✅ `examples/webpack-systemjs-remote` through compat shim         |          ✅ `vite-webpack-rspack` [12]          | ✅ webpack/SystemJS examples [13]  |
| Workspace / pnpm-symlink shared    |                     ✅ `examples/workspace-shared-*`                     |       ✅ `@vite-vite/shared-lib` e2e [12]       |                 ❌                 |
| DTS hot-sync e2e                   |                      ✅ `e2e/dts-dev-hot-sync.mjs`                       |                       ❌                        |                 ❌                 |

---

## 17. Ecosystem, Options & Governance

| Surface                           |                  `vite-plugin-federation`                  |                                `@module-federation/vite`                                |       `@originjs/vite-plugin-federation`        |
| --------------------------------- | :--------------------------------------------------------: | :-------------------------------------------------------------------------------------: | :---------------------------------------------: |
| Framework examples                | ✅ React / Vue / Svelte / Lit / SSR / DTS / workspace [4]  | ✅ Alpine, Angular, Lit, Nuxt, Preact, React, Solid, Svelte, TanStack, Vinext, Vue [12] | ✅ Vue / React / Rollup / Webpack examples [13] |
| `@module-federation/vite` options | ✅ baseline options plus runtime / SSR / compat extensions |                            ✅ baseline adapter options [12]                             |             ❌ legacy option model              |
| Migration docs                    |     ✅ OriginJS + `@module-federation/vite` guides [4]     |                 🟡 README/examples, no migration guide in snapshot [12]                 |    🟡 legacy docs, no MF-runtime guide [13]     |
| License                           |                          MIT [14]                          |                                        MIT [14]                                         |                MulanPSL-2.0 [14]                |

---

## When to Choose Which

### Pick `vite-plugin-federation` (this repo) when…

- You need **production-oriented host loading** with cache TTL, retries, circuit breaker, fallback
  URLs, and integrity verification.
- You ship to **multiple tenants on the same page** and need scoped manifest caches and share
  scopes.
- You serve **SSR** (React, Vinext, etc.) and need a server-aware federation instance with
  asset-preload collection.
- You want **stable error codes** (`MFV-NNN`) and a debug snapshot for ops.
- You're **migrating off OriginJS** and want the legacy `virtual:__federation__` API to keep
  working while you move to manifest-first config.
- You target **Vite 8 + Rolldown** today.

### Pick `@module-federation/vite` when…

- You're already in the `@module-federation/*` ecosystem and want a thin, official Vite adapter
  whose runtime semantics exactly match `@module-federation/runtime` defaults.
- You value its broad external framework examples and are comfortable importing runtime helpers
  directly from `@module-federation/runtime`.
- You don't need multi-tenant scoping, integrity, retries, or curated runtime helpers — you'll
  build them yourself or rely on framework wrappers.
- You want the **smallest MF-runtime-based adapter surface** that still produces a manifest.

### Pick `@originjs/vite-plugin-federation` when…

- You have an existing app already on OriginJS and **don't yet need dev mode for remotes**
  (e.g., remotes are deployed as built artifacts and the host is the only thing under active
  dev).
- You rely on OriginJS's legacy `format` / `from` / `externalType` model or its webpack/SystemJS
  examples.
- You can't add the `@module-federation/runtime` dependency (e.g., the project disallows new
  runtime deps), and the lack of singleton / strictVersion negotiation is acceptable.
- You're targeting **Vite 4** specifically.

> If you're starting a new micro-frontend in 2026 on Vite 5+, the OriginJS plugin's
> "remote must be `vite build --watch`" constraint and lack of a shared-version negotiator
> make it the wrong default for new code.

---

## Migration Notes

- **From `@originjs/vite-plugin-federation` → `vite-plugin-federation`:** the `virtual:__federation__`
  API works unchanged; map `dontAppendStylesToHead: true` to `css.inject: 'manual'` (or leave
  it — the shim normalizes both). See `docs/originjs-migration.md` and
  `examples/originjs-compat-host`.
- **From `@module-federation/vite` → `vite-plugin-federation`:** the plugin options shape is a
  superset; replace `import { federation } from '@module-federation/vite'` with
  `import federation from 'vite-plugin-federation'`. Direct `@module-federation/runtime` imports
  keep working (the alias is preserved); switch them to `vite-plugin-federation/runtime` to
  pick up cached/retried/integrity-checked variants.
