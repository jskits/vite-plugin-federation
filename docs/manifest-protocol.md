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

Patch and minor changes within major version `1` must be additive. Required field removals, field
type changes, or semantic changes require a new major schema version.

Hosts should:

- Validate exact artifact shape with the committed JSON Schema in build/deployment pipelines.
- Rely on runtime validation for production loading.
- Treat `MFV-004` schema failures as deployment incompatibilities.

Remote deployments should:

- Publish all three artifacts for each build.
- Keep manifests short-lived or revalidated in caches.
- Serve hashed JS/CSS assets with long immutable caching.
