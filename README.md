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
- `examples/vue-remote`
- `examples/vue-host`
- `examples/svelte-remote`
- `examples/svelte-host`
- `examples/lit-remote`
- `examples/lit-host`
- `examples/multi-remote-host`
- `examples/workspace-shared-lib`
- `examples/workspace-shared-remote`
- `examples/workspace-shared-host`
- `examples/dts-remote`
- `examples/dts-host`

Use the following commands:

```bash
pnpm examples:build
pnpm examples:dts:build
pnpm examples:dev
pnpm examples:ssr:build
pnpm --filter vite-plugin-federation test:e2e:browser-matrix
pnpm --filter vite-plugin-federation test:e2e:multi-remote
pnpm --filter vite-plugin-federation test:e2e:shared
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

See [docs/plugin-api.md](docs/plugin-api.md) for plugin configuration and
[docs/runtime-api.md](docs/runtime-api.md) for `vite-plugin-federation/runtime`.

See [docs/dts-workflows.md](docs/dts-workflows.md) for remote type artifact generation, host type
consumption, manifest-derived type URLs, and recommended production DTS settings.

See [docs/originjs-migration.md](docs/originjs-migration.md) and
[docs/compatibility-matrix.md](docs/compatibility-matrix.md) for OriginJS migration APIs, remote
format support, CSS migration behavior, and unsupported legacy combinations.

See [docs/troubleshooting.md](docs/troubleshooting.md) for error-code based debugging.

See [docs/preload-performance.md](docs/preload-performance.md) for route-aware preload plans,
remote warming, and runtime load metrics.

See [docs/security.md](docs/security.md) for integrity verification, private manifests, CSP,
Trusted Types, and signed manifest guidance.

See [docs/multi-tenant.md](docs/multi-tenant.md) for runtime key scoping, tenant-specific manifest
caches, and scoped debug snapshots.

See [docs/dev-hmr.md](docs/dev-hmr.md) for remote dev HMR strategies, batching, and fallback
rules.

See [docs/compiler-adapter.md](docs/compiler-adapter.md) for Vite/Rolldown transform behavior,
control chunk rules, and the known CJS bundle warning.

## Release Flow

See [docs/release-checklist.md](docs/release-checklist.md) for Changeset policy, versioning,
package quality gates, and release steps.

## CI/CD

- `.github/workflows/ci.yml` runs `pnpm check` on `push` and `pull_request`.
- `.github/workflows/release.yml` is manual-only and uses Changesets to open a release PR or publish.
- Configure `NPM_TOKEN` in the GitHub repository before enabling automated publishing.
