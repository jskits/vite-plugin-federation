# Compatibility Matrix

This document records the current compatibility contract for projects migrating from OriginJS-style
Vite federation and for hosts consuming mixed remote formats.

## Recommended Path

Use manifest-first Vite remotes whenever possible:

```ts
federation({
  name: 'host',
  remotes: {
    catalog: 'https://cdn.example.com/catalog/mf-manifest.json',
  },
});
```

Manifest-first remotes are the primary production path. They provide browser and SSR entry
metadata, type artifact metadata, debug artifacts, content hashes, and runtime validation.

## OriginJS Virtual API

The `virtual:__federation__` migration shim is enabled by default through compatibility options.

Supported APIs:

- `__federation_method_setRemote`
- `__federation_method_getRemote`
- `__federation_method_ensure`
- `__federation_method_unwrapDefault`
- `__federation_method_wrapDefault`

The shim registers remotes through `@module-federation/runtime` and normalizes OriginJS component
requests such as `./Button` to `remote/Button`.

Disable the shim when a project wants the manifest-first API only:

```ts
federation({
  name: 'host',
  compat: {
    originjs: false,
    virtualFederationShim: false,
  },
});
```

## Remote Formats

| Format                  | Status                        | Notes                                                                                                                            |
| ----------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `esm` / `module`        | Supported                     | Preferred for Vite-to-Vite remotes and manifest-first loading.                                                                   |
| `var`                   | Partially supported           | `varFilename` can emit an additional var-style entry. Browser-only legacy interop should be validated per app.                   |
| `systemjs` / `system`   | Partially supported           | Normalized to runtime `system`; requires the host environment to provide the expected SystemJS runtime behavior.                 |
| Webpack manifest remote | Partially supported           | Runtime registration can consume compatible manifest-like entries, but mixed Webpack/Vite deployments need app-level validation. |
| CommonJS remote entry   | Unsupported for browser hosts | Use SSR/node-specific loading or expose an ESM/manifest entry instead.                                                           |

## `from` Combinations

| Host    | Remote        | Status                              | Notes                                                                                                                 |
| ------- | ------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Vite    | Vite          | Supported                           | Primary path. Use manifest-first URLs.                                                                                |
| Vite    | OriginJS Vite | Supported for common migration APIs | Use the virtual shim or migrate to manifest-first config.                                                             |
| Vite    | Webpack       | Partially supported                 | Prefer manifest/runtime-compatible remotes; validate shared dependency semantics.                                     |
| Webpack | Vite          | Not a primary target                | Vite remotes should publish manifest and module entries; Webpack-host compatibility is not guaranteed by this plugin. |

## CSS Compatibility

OriginJS `dontAppendStylesToHead` maps to the new expose CSS behavior:

- `dontAppendStylesToHead: true` maps to manual CSS injection.
- `css.inject: 'head'` appends CSS to `document.head`.
- `css.inject: 'manual'` leaves CSS collection to the consumer.
- `css.inject: 'none'` disables CSS injection for that expose.

Prefer the explicit `css.inject` option for new code.

## Unsupported Or Risky Combinations

The plugin should fail clearly or require app-level validation for:

- Browser hosts consuming CommonJS-only remote entries.
- `systemjs` remotes without a compatible SystemJS runtime.
- Mixed Vite/Webpack shared singleton setups without explicit version and singleton policy.
- Legacy remote entries that do not expose a runtime-compatible container.
- Remote CSS migration paths that rely on implicit global side effects.

Current shim guardrails:

- Unsupported legacy `format` values throw `MFV-005`.
- `systemjs` remotes throw `MFV-005` when `globalThis.System.import` is unavailable.
- Unsupported legacy `from` values emit a one-time `MFV-007` warning.

## Verification Status

Current repository coverage:

- Unit coverage executes the OriginJS virtual APIs.
- Unit coverage validates legacy `from` and `format` normalization.
- Unit coverage validates unsupported legacy `format`, missing `systemjs` runtime support, and
  one-time warnings for unsupported `from` values.
- Build examples validate manifest-first browser, SSR, and DTS paths.
- Browser e2e validates `virtual:__federation__` against real `remoteEntry.js` and
  `remoteEntry.var.js` assets through `examples/originjs-compat-host`, and verifies
  manifest-first and remoteEntry-first remotes can coexist on the same host.
- `varFilename` generation is supported at build configuration level.

Still needed:

- Real `esm`, `var`, and `systemjs` remote matrix examples.
- Mixed Vite/Webpack remote validation if this plugin officially supports that deployment mode.
