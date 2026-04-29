# Federation Security And Supply Chain

Security controls are opt-in. The default path stays simple, but production shells can add stronger
verification for enterprise or multi-tenant deployments.

## Integrity Metadata

Generated manifests include `integrity` and `contentHash` for remote entries. The manifest schema
also accepts optional integrity metadata for expose assets and preload hints:

```json
{
  "exposes": [
    {
      "name": "Button",
      "path": "./Button",
      "assets": {
        "js": {
          "sync": [
            {
              "path": "assets",
              "name": "Button.js",
              "integrity": "sha384-...",
              "contentHash": "..."
            }
          ],
          "async": []
        },
        "css": {
          "sync": [],
          "async": []
        }
      }
    }
  ]
}
```

String asset entries remain valid for compatibility. Use object asset entries when the producing
pipeline can emit per-asset hashes.

## Runtime Verification

Remote entry verification is available during registration:

```ts
await registerManifestRemote('catalog', catalogManifestUrl, {
  integrity: { mode: 'prefer-integrity' },
});
```

Use `verifyFederationManifestAssets()` to verify annotated expose/preload assets before warming a
critical route or during synthetic checks:

```ts
const manifest = await fetchFederationManifest(catalogManifestUrl, { cacheTtl: 30_000 });

await verifyFederationManifestAssets(catalogManifestUrl, manifest, {
  integrity: { mode: 'both' },
  requireIntegrity: false,
});
```

Modes:

- `prefer-integrity`: use SRI when present, otherwise `contentHash`.
- `integrity`: require SRI.
- `content-hash`: require SHA-256 content hash.
- `both`: require both values to match.

Set `requireIntegrity: true` when every manifest-declared expose/preload asset must carry metadata.
Without it, unannotated string assets are skipped so existing manifests keep working.

## Private Manifests

Authenticated manifests should use `fetchInit` or a custom `fetch` implementation:

```ts
await registerManifestRemote('tenantCatalog', manifestUrl, {
  fetchInit: {
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  },
});
```

Keep private manifests cacheable only by the intended tenant or user. If a CDN is involved, vary the
cache by authorization context and avoid sharing tenant-specific manifests through public cache keys.

## CORS And CSP

Recommended browser policy:

- Serve manifests with explicit `Access-Control-Allow-Origin` for trusted shell origins.
- Serve module remote entries with CORS headers that allow `crossorigin="anonymous"` modulepreload.
- Prefer `script-src` and `connect-src` allowlists for remote manifest and asset origins.
- If remote origins are tenant-specific, generate CSP per tenant rather than using a broad wildcard.
- Avoid `unsafe-eval`; legacy `var` and some third-party SystemJS flows may require looser policy,
  so isolate them from the manifest-first path when possible.

## Trusted Types And Script Policies

Manifest-first ESM remotes primarily use module loading instead of direct string script injection.
If the host uses Trusted Types, create a narrow policy for remote URLs and validate the URL against
the same manifest origin allowlist used by CSP. Do not pass tenant-controlled strings directly into
script creation hooks.

## Signed Manifest Design

For high-assurance deployments, sign the manifest body outside this plugin and verify it in a custom
`fetch` wrapper before returning the `Response` to the runtime. Built-in signature verification is
not part of the beta runtime surface; this keeps the default loader key-management-neutral. The
recommended shape is detached:

- Manifest body stays valid JSON and schema-compatible.
- Signature, key id, and algorithm are delivered by headers or a sidecar file.
- The verifier checks signature, schema version, release id, and allowed remote origin before runtime
  registration.

This keeps signing independent from the runtime loader and avoids coupling default users to a
specific key-management system.
