# Release Checklist

This repository publishes `vite-plugin-federation` from `packages/vite-plugin-federation`.
Releases are tag-driven or manually dispatched through `.github/workflows/release.yml`.

## Versioning Policy

- Use Changesets for every user-facing package change: runtime behavior, plugin options, emitted
  artifacts, public types, package exports, or documented defaults.
- Test-only, CI-only, and documentation-only changes do not require a Changeset unless they change
  published package behavior.
- For `1.x`, use patch versions for fixes and compatible internal hardening, minor versions for
  additive public capabilities, and major versions for breaking changes to the public API contract.
- The release tag must exactly match the package version as `v<version>`.
- Review [public-api-contract.md](public-api-contract.md) before every stable release. Changes to the
  plugin option surface, `vite-plugin-federation/runtime` exports, manifest schema, devtools
  contract, `MFV-*` meanings, Node floor, or Vite peer range must be additive for `1.x`.

## Package Quality Gates

Run these locally before creating a release tag:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test:package:smoke
P0_P1_SMOKE_PACKAGE_SPEC=1.0.0-rc.0 pnpm test:p0-p1:smoke
pnpm test:vite-matrix:smoke
pnpm --filter vite-plugin-federation pack --dry-run
```

The package smoke test validates:

- The workspace package builds ESM, CJS, and declaration outputs.
- A real `pnpm pack` tarball contains root and runtime exports.
- The tarball installs in a clean Vite app and builds successfully.
- `package.json` declares `sideEffects: false`.
- Production output does not include the devtools overlay bootstrap.

The Vite peer matrix smoke test validates that the packed tarball installs, builds, previews, and
loads a manifest remote in Chromium using pinned Vite 5, 6, 7, and 8 versions. It is a compact
packaging/compiler-adapter runtime gate; the Playwright examples remain the broader browser
behavior gate.

The P0/P1 smoke test validates an installed package spec, not the local workspace source. By
default it installs the npm `latest` dist-tag for published-version regression checks. Before
publishing a release candidate or stable release, set `P0_P1_SMOKE_PACKAGE_SPEC` to the exact
published prerelease version, a dist-tag, or a packed tarball path. It creates temporary Vite
example workspaces that install `vite-plugin-federation` from that spec and exercise the
production-critical P0/P1 surface: manifest runtime loading, shared diagnostics, DTS
generation/consumption, SSR target selection, OriginJS ESM/VAR compatibility, runtime rollout
controls, integrity checks, devtools, dev remote loading, and compiler chunk/named export behavior.
No-reload dev remote HMR remains guarded by the Playwright e2e suite.

For a local tarball candidate, run the smoke with a concrete tarball path, for example
`P0_P1_SMOKE_PACKAGE_SPEC=./vite-plugin-federation-1.0.0.tgz pnpm test:p0-p1:smoke`.

Run the manual `Extended E2E` workflow before publishing a release candidate or stable release when
changes touched runtime loading, shared resolution, DTS, SSR, or compatibility behavior.

The Extended E2E workflow runs on Node 20 and 22. Local runs use fixed default ports but support
`MF_E2E_<NAME>_PORT` overrides; the package scripts run a port preflight before Playwright starts so
port collisions fail with a direct override hint.

## Release Steps

1. Confirm the worktree is clean.
2. Add or review Changesets with `pnpm changeset`; document the user-visible change in
   `CHANGELOG.md` or the generated package changelog during versioning.
3. Version packages with `pnpm version-packages`.
4. Run the package quality gates above.
5. Commit the version and changelog changes.
6. Create and push a tag that matches `packages/vite-plugin-federation/package.json`, for example
   `v1.0.0`.
7. Let the Release workflow validate the tag, dry-run the package tarball, and publish with npm
   provenance.

## Rollback Notes

- Do not republish the same version.
- If a release is broken, publish a new patch or prerelease with a Changeset that explains the
  rollback/fix.
- Keep `release.id`, `metaData.buildInfo.releaseId`, and CI commit metadata in remote manifests so
  production incidents can identify the exact remote artifact.
