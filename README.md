# vite-plugin-federation

A `pnpm workspace` + `turbo` monorepo for developing and publishing `vite-plugin-federation`.

## Structure

```text
.
├── packages/
│   └── vite-plugin-federation/
├── .changeset/
├── .husky/
├── eslint.config.mjs
├── prettier.config.mjs
├── turbo.json
└── vitest.workspace.ts
```

## Quick Start

```bash
pnpm install
pnpm check
```

## Common Commands

```bash
pnpm dev
pnpm build
pnpm examples:build
pnpm examples:dev
pnpm lint
pnpm test
pnpm format
pnpm changeset
pnpm commit
```

## Examples

This repo includes a minimal React host/remote verification pair:

- `examples/react-remote`
- `examples/react-host`
- `examples/react-ssr-host`
- `examples/dts-remote`
- `examples/dts-host`

Use the following commands:

```bash
pnpm examples:build
pnpm examples:dts:build
pnpm examples:dev
pnpm examples:ssr:build
pnpm --filter vite-plugin-federation test:e2e:ssr
```

To verify the SSR path locally, start the remote preview first and then start the SSR host:

```bash
pnpm --filter example-react-remote preview
pnpm --filter example-react-ssr-host serve
```

The SSR host example starts Node with `--experimental-vm-modules`, because the current
Module Federation runtime uses the VM module loader for remote ESM evaluation on the server.

## Production Runtime

The plugin is manifest-first by default. Remote builds publish `mf-manifest.json`, `mf-stats.json`,
and `mf-debug.json`; hosts can consume manifests through `vite-plugin-federation/runtime` with
cache TTLs, retries, timeouts, SSR entry selection, asset preloading helpers, and debug snapshots.

See [docs/production-runtime.md](docs/production-runtime.md) for the production loading contract,
CI build metadata, SSR asset collection, and operational recommendations.

See [docs/dts-workflows.md](docs/dts-workflows.md) for remote type artifact generation, host type
consumption, manifest-derived type URLs, and recommended production DTS settings.

## Release Flow

1. Run `pnpm changeset` after finishing development work.
2. Make sure `pnpm check` passes before merging into the main branch.
3. Run `pnpm version-packages` for manual local versioning.
4. Run `pnpm release`.

## CI/CD

- `.github/workflows/ci.yml` runs `pnpm check` on `push` and `pull_request`.
- `.github/workflows/release.yml` is manual-only and uses Changesets to open a release PR or publish.
- Configure `NPM_TOKEN` in the GitHub repository before enabling automated publishing.
