# Manifest Protocol

The federation manifest protocol is the stable artifact contract between remote builds, host
runtime loading, debug tooling, and external deployment tooling.

## Artifacts

Remote builds emit three related JSON artifacts:

- `mf-manifest.json`: the runtime contract consumed by hosts.
- `mf-stats.json`: the manifest plus build output summaries and diagnostics.
- `mf-debug.json`: plugin options, capability flags, diagnostics, and a manifest snapshot.

JSON Schemas are committed in:

- [mf-manifest.schema.json](schemas/mf-manifest.schema.json)
- [mf-stats.schema.json](schemas/mf-stats.schema.json)
- [mf-debug.schema.json](schemas/mf-debug.schema.json)

Compatibility fixtures are committed in [fixtures/manifest-protocol](fixtures/manifest-protocol).
The test suite validates the exact `1.0.0` fixtures against these schemas and checks the runtime
compatibility policy for legacy, same-major, and next-major manifest fixtures.

## Schema Version

All new artifacts include a top-level `schemaVersion` field. The current version is `1.0.0`.

Runtime compatibility rules:

- Missing `schemaVersion` is accepted as a legacy manifest for backward compatibility.
- Same-major versions are accepted, so `1.1.0` can be consumed by a `1.0.0` runtime.
- Different major versions are rejected with `MFV-004`.
- Non-string schema versions are rejected with `MFV-004`.
- Malformed known fields are rejected with `MFV-004`.
- Target-specific entry validation happens when a host registers a manifest remote.

The JSON Schemas describe the exact emitted `1.0.0` shape. Runtime validation is intentionally more
permissive than schema validation so hosts can consume older manifests and same-major future
manifests.

## Manifest Shape

Required top-level fields:

- `schemaVersion`: manifest protocol version.
- `id`: remote application id.
- `name`: remote runtime name.
- `metaData`: remote entry, build, type, public path, and plugin metadata.
- `remotes`: remotes referenced by this build.

Optional fields:

- `shared`: shared modules used by the build. It is omitted when asset analysis is disabled.
- `exposes`: exposed modules and their JS/CSS assets. It is omitted when asset analysis is disabled.

`metaData.remoteEntry` is the browser entry. `metaData.ssrRemoteEntry` is the Node/SSR entry when
available. Browser hosts prefer `remoteEntry`; Node hosts prefer `ssrRemoteEntry` and fall back to
`remoteEntry` only when necessary.

Generated entries can include `integrity` and `contentHash`. `integrity` uses the Subresource
Integrity format for the emitted entry file, and `contentHash` is a SHA-256 hex digest for
deployment tooling. Generated manifests also include a top-level `release` object and
`metaData.buildInfo.releaseId`; set `VITE_PLUGIN_FEDERATION_RELEASE_ID` or `MF_RELEASE_ID` in CI
when the release id should differ from the default `buildName:buildVersion` value.

Runtime target validation:

- `target: 'web'` requires a usable `metaData.remoteEntry.name`; `ssrRemoteEntry.name` is accepted
  only as a compatibility fallback.
- `target: 'node'` requires a usable `metaData.ssrRemoteEntry.name`; `remoteEntry.name` is accepted
  as the legacy fallback when no SSR entry exists.
- If `remoteEntry` or `ssrRemoteEntry` is present, `name`, `path`, and `type` must be strings when
  provided.
- A malformed SSR entry is reported as `MFV-006` for Node targets instead of silently falling back
  to a browser entry.

## Compatibility Policy

Patch and minor changes within major version `1` must be additive.

Backward-compatible changes:

- Adding optional top-level fields.
- Adding optional fields to `metaData`, entries, `shared`, `remotes`, `exposes`, stats, or debug
  artifacts.
- Adding new diagnostic fields or capability flags.
- Adding new enum-like string values when older runtimes can ignore them safely.

Forward-compatible runtime behavior:

- A `1.0.0` runtime accepts missing `schemaVersion` as a legacy manifest.
- A `1.0.0` runtime accepts `1.x.y` manifests when required runtime fields are still usable.
- A `1.0.0` runtime rejects `2.x.y` manifests because required fields or semantics may have
  changed.
- Exact JSON Schema validation remains stricter than runtime validation and is intended for
  deployment pipelines and external tooling.

Breaking changes that require a new major schema version:

- Removing required fields from generated artifacts.
- Changing the type or meaning of an existing field.
- Changing URL resolution semantics for `remoteEntry`, `ssrRemoteEntry`, or asset paths.
- Requiring hosts to use a different target-selection or share-scope behavior.

Schema fixture policy:

- Every schema version should have exact artifact fixtures.
- Legacy and future-version fixtures should remain in the suite to prevent accidental compatibility
  regressions.
- A schema major bump must add new fixtures before changing runtime acceptance logic.

## Hosting And Cache Rules

The manifest is the deployment coordination artifact. It should be served with `no-cache`,
`max-age=0, must-revalidate`, or another short revalidation policy. Hosts may cache it in memory
with runtime `cacheTtl`, but CDNs should not make stale manifests difficult to invalidate.

Recommended headers:

```text
mf-manifest.json      Cache-Control: no-cache
mf-stats.json         Cache-Control: no-cache
mf-debug.json         Cache-Control: no-cache
remoteEntry*.js       Cache-Control: public, max-age=31536000, immutable
assets/*              Cache-Control: public, max-age=31536000, immutable
@mf-types*            Cache-Control: public, max-age=31536000, immutable
```

Hosting requirements:

- The manifest URL must be stable for a deployed remote environment.
- Entry and asset files referenced by a manifest must remain available for at least as long as any
  host can cache that manifest.
- Cross-origin hosts need CORS for manifest JSON, ESM entries, chunks, CSS, and type artifacts.
- `publicPath: "auto"` keeps asset URLs relative to the manifest URL; an explicit `publicPath`
  should be absolute or resolvable from the manifest URL.
- Deployments should publish manifest, stats, debug, entries, assets, and type artifacts
  atomically. If atomic publishing is unavailable, publish immutable assets first and the manifest
  last.

Rollback guidance:

- Roll back by restoring the previous manifest after confirming its referenced immutable assets are
  still hosted.
- Do not mutate files referenced by an already published manifest; publish a new manifest instead.
- Keep `release.id` and `contentHash` in logs so production incidents can identify the exact remote
  build.

Hosts should:

- Validate exact artifact shape with the committed JSON Schema in build/deployment pipelines.
- Rely on runtime validation for production loading.
- Treat `MFV-004` schema failures as deployment incompatibilities.

Remote deployments should:

- Publish all three artifacts for each build.
- Keep manifests short-lived or revalidated in caches.
- Serve hashed JS/CSS assets with long immutable caching.
