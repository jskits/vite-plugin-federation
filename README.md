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

Use the following commands:

```bash
pnpm examples:build
pnpm examples:dev
```

## Release Flow

1. Run `pnpm changeset` after finishing development work.
2. Make sure `pnpm check` passes before merging into the main branch.
3. Run `pnpm version-packages` for manual local versioning.
4. Run `pnpm release`.

## CI/CD

- `.github/workflows/ci.yml` runs `pnpm check` on `push` and `pull_request`.
- `.github/workflows/release.yml` uses Changesets to open a release PR or publish directly after pushes to `main`.
- Configure `NPM_TOKEN` in the GitHub repository before enabling automated publishing.
