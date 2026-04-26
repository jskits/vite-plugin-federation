# OriginJS Migration Guide

This guide covers migration from `@originjs/vite-plugin-federation` style hosts to this
manifest-first plugin.

## Recommended Path

1. Enable this plugin with the same public remote aliases.
2. Keep `compat` enabled while migrating host code.
3. Move new remotes to `mf-manifest.json` URLs.
4. Keep legacy `remoteEntry.js` remotes as object configs only where needed.
5. Remove compatibility APIs after imports have moved to manifest-first runtime APIs.

## Compatibility Defaults

Compatibility is enabled by default:

```ts
federation({
  name: 'shell',
  compat: true,
});
```

Equivalent explicit config:

```ts
compat: {
  originjs: true,
  virtualFederationShim: true,
}
```

Disable compatibility for new manifest-only applications:

```ts
compat: false;
```

## Supported Virtual APIs

The plugin provides `virtual:__federation__` with these OriginJS-style APIs:

- `__federation_method_setRemote`
- `__federation_method_getRemote`
- `__federation_method_ensure`
- `__federation_method_unwrapDefault`
- `__federation_method_wrapDefault`

Example:

```ts
import {
  __federation_method_getRemote,
  __federation_method_setRemote,
} from 'virtual:__federation__';

__federation_method_setRemote('catalog', {
  url: 'https://cdn.example.com/catalog/mf-manifest.json',
  format: 'esm',
  from: 'vite',
});

const module = await __federation_method_getRemote('catalog', './Button');
```

## Remote Config Mapping

OriginJS style:

```ts
remotes: {
  catalog: 'https://cdn.example.com/catalog/assets/remoteEntry.js',
}
```

Preferred manifest-first config:

```ts
remotes: {
  catalog: 'https://cdn.example.com/catalog/mf-manifest.json',
}
```

Legacy remote entry config:

```ts
remotes: {
  catalog: {
    name: 'catalog',
    entry: 'https://cdn.example.com/catalog/remoteEntry.js',
    type: 'module',
    format: 'esm',
    from: 'vite',
  },
}
```

## CSS Migration

OriginJS `dontAppendStylesToHead` maps to manual CSS mode:

```ts
exposes: {
  './Widget': {
    import: './src/Widget.tsx',
    dontAppendStylesToHead: true,
  },
}
```

Equivalent explicit config:

```ts
exposes: {
  './Widget': {
    import: './src/Widget.tsx',
    css: {
      inject: 'manual',
    },
  },
}
```

Manual CSS hrefs are exposed through the compatibility CSS bucket so hosts can inject them into
Shadow DOM or controlled style containers.

## Webpack And SystemJS Remotes

Webpack remotes built with `library.type = 'system'` can be consumed through the compatibility
shim when a SystemJS runtime is loaded by the host. Configure:

```ts
__federation_method_setRemote('legacySystem', {
  url: 'https://cdn.example.com/legacy/remoteEntry.js',
  format: 'systemjs',
  from: 'webpack',
  entryGlobalName: 'legacySystem',
});
```

Unsupported `format` values throw `MFV-005`. Unsupported `from` values emit `MFV-007` warnings.

## Migration Checklist

- Use manifest URLs for all new Vite remotes.
- Keep legacy `remoteEntry.js` only for remotes that cannot emit `mf-manifest.json` yet.
- Use `varFilename` only when a var-style host still needs it.
- Keep `compat` enabled until all `virtual:__federation__` imports are removed.
- Run `pnpm --filter vite-plugin-federation test:e2e:compat` after compatibility config changes.

See [compatibility-matrix.md](compatibility-matrix.md) for the exact supported matrix.
