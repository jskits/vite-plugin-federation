# vite-plugin-federation

An `npm workspaces` + `turbo` monorepo for developing and publishing `vite-plugin-federation`.

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
npm install
npm run check
```

## Common Commands

```bash
npm run dev
npm run build
npm run lint
npm run test
npm run format
npm run changeset
npm run commit
```

## Release Flow

1. Run `npm run changeset` after finishing development work.
2. Make sure `npm run check` passes before merging into the main branch.
3. Run `npm run version-packages` for manual local versioning.
4. Run `npm run release`.

## CI/CD

- `.github/workflows/ci.yml` runs `npm run check` on `push` and `pull_request`.
- `.github/workflows/release.yml` uses Changesets to open a release PR or publish directly after pushes to `main`.
- Configure `NPM_TOKEN` in the GitHub repository before enabling automated publishing.
