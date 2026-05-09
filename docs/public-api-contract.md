# Public API Contract

This document defines the compatibility surface that `vite-plugin-federation` keeps stable for the
1.x release line.

## Compatibility Policy

- Patch and minor releases in `1.x` must preserve existing public option names, runtime export names,
  manifest schema semantics, devtools contract fields, and `MFV-*` error-code meanings.
- Minor releases may add new options, optional manifest fields, runtime helpers, devtools fields, or
  error codes when existing consumers can ignore them safely.
- Deprecations must keep the old behavior working for the rest of the `1.x` line unless a security or
  upstream runtime issue makes that impossible. Removing or changing a documented contract requires a
  new major version.
- Internal virtual modules, generated chunk filenames, private debug state not documented here, and
  implementation details under `src/` are not public contracts.

## Package And Engine Contract

The published package keeps these entry points stable:

- `vite-plugin-federation`
- `vite-plugin-federation/runtime`

The v1.x support floor is:

- Node `>=20.19.0`
- Vite `^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0`

Dropping support for Node `>=20.19.0` or any currently declared Vite major in that peer range is a
major-version change unless a security or upstream end-of-life issue requires a documented exception.

## Plugin Options

The package root exports the default plugin function and the named `federation` function. It also
exports the public `ModuleFederationOptions` and `PluginManifestOptions` types.

The `ModuleFederationOptions` field names and current defaults are part of the v1.x contract:

| Option                   | Compatibility commitment                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `name`                   | Required public app/container name.                                                                   |
| `filename`               | Browser remote entry filename; default remains `remoteEntry-[hash]`.                                  |
| `varFilename`            | Additional var-style entry filename for legacy hosts.                                                 |
| `exposes`                | String and object expose forms, including `css.inject` and `dontAppendStylesToHead`.                  |
| `remotes`                | Manifest URL strings and object remote configs.                                                       |
| `shared`                 | Array and object forms, including singleton, strict version, host-only, and suffix matching controls. |
| `manifest`               | `boolean` or `PluginManifestOptions`; default remains enabled.                                        |
| `dts`                    | `boolean` or DTS options; TypeScript projects keep automatic enablement unless disabled.              |
| `dev`                    | `boolean` or dev options for devtools, live reload, type hints, hot types, and remote HMR.            |
| `compat`                 | `boolean` or compatibility options; OriginJS compatibility remains enabled by default.                |
| `shareStrategy`          | Runtime share strategy; default remains `version-first`.                                              |
| `shareScope`             | Default share scope; default remains `default`.                                                       |
| `publicPath`             | Public path for generated manifest asset URLs.                                                        |
| `bundleAllCSS`           | Adds CSS assets to expose manifest entries; default remains `false`.                                  |
| `runtimePlugins`         | Runtime plugin import list passed to the Module Federation runtime.                                   |
| `target`                 | `web` or `node`; SSR builds continue to auto-detect `node`.                                           |
| `hostInitInjectLocation` | Host runtime init injection location; default remains `html`.                                         |
| `moduleParseTimeout`     | Total module parse timeout in seconds; default remains `10`.                                          |
| `moduleParseIdleTimeout` | Optional idle parse timeout in seconds.                                                               |
| `virtualModuleDir`       | Virtual module directory option; slash rejection remains `MFV-001`.                                   |
| `library`                | Passed through for Module Federation compatibility.                                                   |
| `runtime`                | Passed through for Module Federation compatibility.                                                   |
| `getPublicPath`          | Passed through for Module Federation compatibility.                                                   |
| `implementation`         | Runtime implementation override.                                                                      |
| `ignoreOrigin`           | Origin handling compatibility flag.                                                                   |

## Runtime Exports

The `vite-plugin-federation/runtime` function export names are part of the v1.x contract:

- `getInstance`
- `createFederationInstance`
- `createServerFederationInstance`
- `registerPlugins`
- `registerGlobalPlugins`
- `registerRemotes`
- `registerShared`
- `getRemoteEntry`
- `getRemoteInfo`
- `loadScript`
- `loadScriptNode`
- `loadShare`
- `loadShareSync`
- `loadRemote`
- `preloadRemote`
- `fetchFederationManifest`
- `registerManifestRemote`
- `registerManifestRemotes`
- `loadRemoteFromManifest`
- `refreshRemote`
- `warmFederationRemotes`
- `resolveFederationManifestAssetUrl`
- `findFederationManifestExpose`
- `collectFederationManifestExposeAssets`
- `collectFederationManifestPreloadLinks`
- `createFederationManifestPreloadPlan`
- `verifyFederationManifestAssets`
- `clearFederationRuntimeCaches`
- `getFederationDebugInfo`
- `getFederationRuntimeScopeDebugInfo`
- `createFederationRuntimeScope`

Exported TypeScript types from `vite-plugin-federation/runtime` are also public. Existing type names,
required fields, and return shapes must remain assignable for `1.x`; additive optional fields are
allowed.

## Manifest Schema

Manifest-enabled builds emit `mf-manifest.json`, `mf-stats.json`, and `mf-debug.json` artifacts. The
v1 schema contract is `schemaVersion: "1.0.0"` and is documented in
[manifest-protocol.md](manifest-protocol.md).

Compatibility rules:

- A `1.0.0` runtime accepts missing `schemaVersion` as a legacy manifest.
- A `1.0.0` runtime accepts same-major `1.x.y` manifests when required runtime fields remain usable.
- A `1.0.0` runtime rejects future major manifests with `MFV-004`.
- Patch and minor schema changes in major version `1` must be additive.

## Devtools Contract

The devtools browser global and dev server payload are versioned as contract `1.0.0` in
[devtools-runtime-contract.md](devtools-runtime-contract.md).

These names remain stable for `1.x`:

- `window.__VITE_PLUGIN_FEDERATION_DEVTOOLS__`
- `/<base>/__mf_devtools`
- `vite-plugin-federation:debug`
- `vite-plugin-federation:remote-update`
- `vite-plugin-federation:remote-style-update`
- `vite-plugin-federation:remote-types-update`

New fields and events may be added, but existing top-level fields and event meanings must remain
compatible.

## Error Codes

The `MFV-*` code meanings are stable for `1.x`:

| Code      | Meaning                                                         |
| --------- | --------------------------------------------------------------- |
| `MFV-001` | Plugin configuration error.                                     |
| `MFV-002` | Alias conflict between a shared key and another resolver.       |
| `MFV-003` | Shared dependency miss, fallback, or strict-singleton conflict. |
| `MFV-004` | Manifest fetch or validation failure.                           |
| `MFV-005` | Missing expose or unsupported legacy remote format.             |
| `MFV-006` | SSR remote entry missing for a Node-target load.                |
| `MFV-007` | Dynamic import rewrite warning or unsupported legacy `from`.    |

New codes may be added for new failure classes. Existing codes must not be reused for unrelated
failure semantics.
