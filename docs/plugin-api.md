# Plugin API Reference

Import the plugin from the package root:

```ts
import federation from 'vite-plugin-federation';
```

## Minimal Remote

```ts
federation({
  name: 'catalog',
  exposes: {
    './Button': './src/Button.tsx',
  },
  manifest: true,
  shared: {
    react: {
      singleton: true,
      requiredVersion: '^19.2.4',
    },
    'react/': {
      singleton: true,
      requiredVersion: '^19.2.4',
    },
  },
});
```

## Minimal Host

```ts
federation({
  name: 'shell',
  remotes: {
    catalog: 'https://cdn.example.com/catalog/mf-manifest.json',
  },
  shared: {
    react: {
      singleton: true,
      requiredVersion: '^19.2.4',
    },
  },
});
```

## `ModuleFederationOptions`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `string` | required | Public application/container name. |
| `filename` | `string` | `remoteEntry.js` | Browser remote entry filename. |
| `varFilename` | `string` | `undefined` | Emits an additional var-style remote entry for legacy hosts. |
| `exposes` | `Record<string, string | ExposeConfig>` | `{}` | Remote expose map. Keys should usually start with `./`. |
| `remotes` | `Record<string, string | RemoteObjectConfig>` | `{}` | Host remote map. Values may be manifest URLs or object configs. |
| `shared` | `string[] | Record<string, string | SharedConfig>` | `{}` | Shared dependency providers/consumers. |
| `manifest` | `boolean | PluginManifestOptions` | `true` | Emits `mf-manifest.json`, `mf-stats.json`, and `mf-debug.json` when enabled. |
| `dts` | `boolean | PluginDtsOptions` | `false` | Enables type generation and/or type consumption through `@module-federation/dts-plugin`. |
| `dev` | `boolean | PluginDevOptions` | `true` | Controls devtools, live reload, remote HMR, type hints, and hot type reload. |
| `compat` | `boolean | CompatibilityOptions` | `true` | Enables OriginJS-compatible virtual federation APIs. |
| `shareStrategy` | `'loaded-first' | 'version-first'` | runtime default | Shared provider selection strategy passed to the runtime. |
| `shareScope` | `string` | `default` | Default share scope. |
| `publicPath` | `string` | Vite `base` or `auto` | Public path used for generated manifest asset URLs. |
| `bundleAllCSS` | `boolean` | `false` | Adds all CSS assets from the bundle to every expose manifest entry. |
| `runtimePlugins` | `Array<string | [string, object]>` | `[]` | Runtime plugin imports passed to Module Federation runtime init. |
| `target` | `'web' | 'node'` | build target | Overrides generated remote target. SSR builds normally use `node`. |
| `virtualModuleDir` | `string` | internal default | Internal virtual module directory name. It cannot contain `/`. |
| `hostInitInjectLocation` | `'entry' | 'html'` | `entry` | Where host runtime initialization is injected. |
| `moduleParseTimeout` | `number` | `10` | Total module parsing timeout in seconds. |
| `moduleParseIdleTimeout` | `number` | `undefined` | Idle parsing timeout in seconds, reset after every parsed module. |

## Exposes

```ts
exposes: {
  './Button': './src/Button.tsx',
  './ManualCssButton': {
    import: './src/ManualCssButton.tsx',
    css: {
      inject: 'manual',
    },
  },
}
```

Expose config:

| Field | Type | Description |
| --- | --- | --- |
| `import` | `string` | Source module path. |
| `css.inject` | `true | false | 'head' | 'manual' | 'none'` | CSS injection mode. |
| `dontAppendStylesToHead` | `boolean` | OriginJS-compatible alias for manual CSS handling. |

`manual` CSS exposes write hrefs to the global CSS bucket instead of appending styles to `head`.
Use this for Shadow DOM or migration compatibility.

## Remotes

String remotes are treated as manifest-first remotes:

```ts
remotes: {
  catalog: 'https://cdn.example.com/catalog/mf-manifest.json',
}
```

Object remotes support compatibility fields:

```ts
remotes: {
  legacy: {
    name: 'legacyRemote',
    entry: 'https://cdn.example.com/legacy/remoteEntry.js',
    type: 'module',
    entryGlobalName: 'legacyRemote',
    from: 'vite',
    format: 'esm',
    shareScope: 'default',
  },
}
```

Prefer manifest URLs for new applications. Use object remotes for legacy `remoteEntry.js`,
OriginJS migration, or explicit `systemjs`/`var` compatibility.

## Shared

```ts
shared: {
  react: {
    singleton: true,
    strictSingleton: true,
    requiredVersion: '^19.2.4',
    strictVersion: true,
    allowNodeModulesSuffixMatch: true,
  },
  'react/': {
    singleton: true,
    requiredVersion: '^19.2.4',
    allowNodeModulesSuffixMatch: true,
  },
}
```

Shared config fields:

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | Runtime share name override. |
| `version` | `string` | Provided version override. |
| `shareScope` | `string` | Share scope override. |
| `singleton` | `boolean` | Prefer one provider for this package. |
| `strictSingleton` | `boolean` | Turn singleton conflicts into `MFV-003` errors. |
| `requiredVersion` | `string` | Consumer version range. |
| `strictVersion` | `boolean` | Treat incompatible versions as strict failures. |
| `allowNodeModulesSuffixMatch` | `boolean` | Match pnpm/nested `node_modules` resolved ids by package suffix. |
| `import` | `string | false` | Local fallback import override, or `false` for host-only shared modules. |

Use trailing slash shared keys for package subpaths, for example `react/` or `@scope/pkg/`.

## Manifest Options

```ts
manifest: {
  fileName: 'mf-manifest.json',
  filePath: 'federation',
  disableAssetsAnalyze: false,
}
```

Manifest builds also emit `mf-stats.json` and `mf-debug.json`. See
[manifest-protocol.md](manifest-protocol.md).

## Dev Options

```ts
dev: {
  remoteHmr: true,
  devtools: true,
  disableLiveReload: false,
  disableHotTypesReload: false,
  disableDynamicRemoteTypeHints: false,
}
```

The devtools contract is documented in
[devtools-runtime-contract.md](devtools-runtime-contract.md).

## DTS Options

```ts
dts: {
  generateTypes: {
    abortOnError: true,
  },
  consumeTypes: {
    typesOnBuild: true,
    abortOnError: true,
  },
}
```

See [dts-workflows.md](dts-workflows.md) for complete DTS workflows and defaults.

## Compatibility Options

```ts
compat: {
  originjs: true,
  virtualFederationShim: true,
}
```

Disable compatibility for strictly manifest-first applications:

```ts
compat: false;
```

See [originjs-migration.md](originjs-migration.md) and
[compatibility-matrix.md](compatibility-matrix.md).
