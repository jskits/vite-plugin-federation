# Federation DTS Workflows

This document describes the production type-generation and type-consumption contract for
`vite-plugin-federation`.

## Artifacts

Remote TypeScript builds can emit:

- `@mf-types.zip`: zipped declarations consumed by hosts.
- `@mf-types.d.ts`: API-level declaration hints for the remote.
- `@mf-types/`: the unpacked declaration folder in the remote build output.
- `mf-manifest.json`: includes `metaData.types.path`, `metaData.types.name`, and
  `metaData.types.api` so hosts can discover type artifacts from the manifest URL.

The default artifact names are `@mf-types.zip` and `@mf-types.d.ts`. A remote can change the folder
name with `dts.generateTypes.typesFolder`; the manifest metadata follows that setting.

## Recommended Remote Config

```ts
import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

export default defineConfig({
  plugins: [
    federation({
      name: 'catalogRemote',
      filename: 'remoteEntry.js',
      manifest: true,
      exposes: {
        './api': './src/api.ts',
      },
      dts: {
        generateTypes: {
          abortOnError: true,
          generateAPITypes: true,
          typesFolder: '@mf-types',
        },
        consumeTypes: false,
      },
    }),
  ],
});
```

Production guidance:

- Use `abortOnError: true` for remotes so CI fails when declarations cannot be generated.
- Keep `generateAPITypes: true` enabled for host tooling and dynamic runtime type APIs.
- Publish `@mf-types.zip`, `@mf-types.d.ts`, and `mf-manifest.json` atomically with the JS assets.
- Serve type artifacts with the same CORS policy as manifests and remote entries.

## Recommended Host Config

Manifest remotes can derive type URLs automatically when the remote entry is an HTTP(S)
`mf-manifest.json` URL and the manifest includes `metaData.types`.

```ts
import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

export default defineConfig({
  plugins: [
    federation({
      name: 'catalogHost',
      remotes: {
        catalogRemote: 'https://cdn.example.com/catalog/mf-manifest.json',
      },
      dts: {
        generateTypes: false,
        consumeTypes: {
          abortOnError: true,
          consumeAPITypes: true,
          typesOnBuild: true,
        },
      },
    }),
  ],
});
```

Explicit `remoteTypeUrls` are still supported and take precedence over manifest-derived URLs:

```ts
dts: {
  generateTypes: false,
  consumeTypes: {
    abortOnError: true,
    consumeAPITypes: true,
    typesOnBuild: true,
    remoteTypeUrls: {
      catalogRemote: {
        alias: 'catalogRemote',
        api: 'https://types.example.com/catalog/@mf-types.d.ts',
        zip: 'https://types.example.com/catalog/@mf-types.zip',
      },
    },
  },
}
```

For static remote imports, add a TypeScript path mapping to the consumed declaration folder:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "catalogRemote/*": ["@mf-types/catalogRemote/*"]
    }
  },
  "include": ["src", "@mf-types/**/*.d.ts"]
}
```

Production guidance:

- Use `typesOnBuild: true` in CI so hosts fail before deployment if remote types are unavailable.
- Use `abortOnError: true` for build-time host consumption failures.
- Keep `consumeAPITypes: true` enabled for typed `loadRemote` APIs.
- If `displayErrorInTerminal: false` is set, logs are suppressed, but `abortOnError: true` still
  fails the build.

## Dev Behavior

In dev, the DTS integration can start the upstream DTS worker and dynamic type hints plugin. The
plugin also supports hot type reload events through the dev remote HMR channel.

Relevant dev options:

- `dev.disableDynamicRemoteTypeHints`: disables dynamic remote type hints injection.
- `dev.disableHotTypesReload`: disables hot type reload events.
- `dev.disableLiveReload`: disables broader dev worker live reload behavior.

Use build-time DTS checks in CI even when dev type hints are enabled. Dev type hints improve local
feedback, but CI should still validate generated artifacts and host consumption.

## Repository Verification

This repository includes two focused examples:

- `examples/dts-remote`: proves remote generation creates `@mf-types.zip`, `@mf-types.d.ts`,
  manifest metadata, and expose declarations.
- `examples/dts-host`: proves a host can derive type URLs from the remote manifest, consume those
  declarations during build, and type-check `dtsRemote/answer`.

Run the full DTS verification:

```bash
pnpm examples:dts:build
```
