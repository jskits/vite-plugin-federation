# vite-plugin-federation

基于 `npm workspaces` + `turbo` 的 monorepo，用来开发和发布 `vite-plugin-federation`。

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

1. 开发完成后执行 `npm run changeset`
2. 合并到主分支前保持 `npm run check` 通过
3. 本地手动发版时执行 `npm run version-packages`
4. 执行 `npm run release`

## CI/CD

- `.github/workflows/ci.yml` 会在 `push` 和 `pull_request` 上执行 `npm run check`
- `.github/workflows/release.yml` 会在 `main` 分支 push 后通过 Changesets 创建 release PR 或直接发布
- 使用自动发布前，需要在 GitHub 仓库配置 `NPM_TOKEN`
