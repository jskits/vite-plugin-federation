# Getting Started

`vite-plugin-federation` lets Vite applications publish remote modules and load them from a host at
runtime. The recommended production path is manifest-first: remotes publish `mf-manifest.json`, and
hosts load exposed modules through `vite-plugin-federation/runtime`.

## Install

```bash
pnpm add -D vite-plugin-federation
```

The package supports Node `>=20.19.0` and Vite `^5 || ^6 || ^7 || ^8`.

## Remote

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from 'vite-plugin-federation';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'catalog',
      filename: 'remoteEntry.js',
      exposes: {
        './Button': './src/Button.tsx',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^19.2.4' },
        'react-dom': { singleton: true, requiredVersion: '^19.2.4' },
        'react/': { singleton: true, requiredVersion: '^19.2.4' },
        'react-dom/': { singleton: true, requiredVersion: '^19.2.4' },
      },
    }),
  ],
  build: {
    target: 'esnext',
    cssCodeSplit: true,
  },
});
```

Manifest generation is enabled by default. A production remote build emits:

- `mf-manifest.json`
- `mf-stats.json`
- `mf-debug.json`
- browser and optional SSR remote entries
- exposed JavaScript, CSS, and DTS artifacts

## Host

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from 'vite-plugin-federation';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'shell',
      remotes: {
        catalog: 'https://cdn.example.com/catalog/mf-manifest.json',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^19.2.4' },
        'react-dom': { singleton: true, requiredVersion: '^19.2.4' },
      },
    }),
  ],
  build: { target: 'esnext' },
});
```

## Load A Remote

```tsx
import { lazy, Suspense, type ComponentType } from 'react';
import { loadRemoteFromManifest } from 'vite-plugin-federation/runtime';

type RemoteButtonModule = { default: ComponentType };

const CatalogButton = lazy(async () => {
  const mod = await loadRemoteFromManifest<RemoteButtonModule>(
    'catalog/Button',
    'https://cdn.example.com/catalog/mf-manifest.json',
    {
      cacheTtl: 30_000,
      integrity: true,
      retries: 2,
      timeout: 4_000,
    },
  );

  return { default: mod.default };
});

export function App() {
  return (
    <Suspense fallback={null}>
      <CatalogButton />
    </Suspense>
  );
}
```

Use [Runtime API](runtime-api.md) for the complete helper surface.

## SSR Host

```ts
import {
  collectFederationManifestPreloadLinks,
  createServerFederationInstance,
  fetchFederationManifest,
  loadRemoteFromManifest,
} from 'vite-plugin-federation/runtime';

createServerFederationInstance({
  name: 'ssr-shell',
  remotes: [],
  shared: {},
});

const manifestUrl = 'https://cdn.example.com/catalog/mf-manifest.json';
const manifest = await fetchFederationManifest(manifestUrl, { cacheTtl: 30_000 });
const links = collectFederationManifestPreloadLinks(manifestUrl, manifest, ['./Button']);
const mod = await loadRemoteFromManifest('catalog/Button', manifestUrl, { target: 'node' });
```

See [Production Runtime](production-runtime.md) for SSR entry selection, streaming preload links,
refresh behavior, and deployment checklists.

## Next Steps

- Review [Plugin API](plugin-api.md) before expanding `exposes`, `remotes`, `shared`, `dev`, `dts`, or `compat`.
- Review [Manifest Protocol](manifest-protocol.md) before wiring deployment and cache policy.
- Review [Security](security.md) before loading private manifests or enabling integrity verification.
- Review [Troubleshooting](troubleshooting.md) when an `MFV-*` error code appears.
