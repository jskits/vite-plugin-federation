# Troubleshooting

This guide is organized by runtime and build error code.

## `MFV-001` Configuration Errors

Typical causes:

- Missing `name`.
- Invalid `virtualModuleDir`.
- Reserved internal name prefix used in public names.

Actions:

- Add a stable `name` to every host and remote.
- Use a single directory name for `virtualModuleDir`; do not include `/`.
- Avoid names starting with `__mfe_internal__`.

## `MFV-002` Build Or Transform Errors

Typical causes:

- Remote import transform failed.
- Build output cannot preserve federation bootstrap ordering.
- Module parsing timed out on a large graph.

Actions:

- Increase `moduleParseTimeout` or use `moduleParseIdleTimeout`.
- Check custom `manualChunks` rules for remote entry/control chunk interference.
- Re-run with `pnpm --filter vite-plugin-federation test` when changing transform behavior.

## `MFV-003` Shared Resolution Errors

Typical causes:

- No host provider exists for `import: false`.
- Selected shared version does not satisfy `requiredVersion`.
- `strictSingleton` detected a singleton conflict.
- pnpm or symlinked paths do not match shared keys.

Actions:

- Inspect `getFederationDebugInfo().runtime.sharedResolutionGraph`.
- Add root and trailing-slash shared keys, for example `react` and `react/`.
- Enable `allowNodeModulesSuffixMatch` for pnpm or workspace layouts.
- Use `strictSingleton: true` only when conflicting providers must fail fast.
- For host-only modules, ensure the host provides the shared package before remote code loads.

## `MFV-004` Manifest, Runtime Load, Or Integrity Errors

Typical causes:

- Manifest URL is unavailable, slow, or blocked by CORS.
- Manifest shape is invalid.
- Runtime remote loading failed after registration.
- Remote entry integrity or content hash verification failed.
- Manifest circuit breaker is open.
- SSR Node entry failed to fetch or evaluate.

Actions:

- Check `getFederationDebugInfo().runtime.manifestFetches`.
- Check `runtime.lastLoadError` for `manifestUrl`, selected `entry`, `target`, and `shareScope`.
- Add `timeout`, bounded `retries`, `fallbackUrls`, and `circuitBreaker` for production hosts.
- Enable `staleWhileRevalidate` when serving the last known good manifest is acceptable.
- Verify CORS for `mf-manifest.json`, remote entries, chunks, and CSS.
- For SSR, run the server with `--experimental-vm-modules` while the VM module bridge is required.
- If integrity fails, compare the deployed remote entry with the manifest that references it.

## `MFV-005` Missing Exposes Or Unsupported Compatibility Format

Typical causes:

- `collectFederationManifestPreloadLinks()` asked for an expose not present in the manifest.
- OriginJS compatibility requested an unsupported `format`.
- SystemJS remote was used without a SystemJS runtime.

Actions:

- Confirm expose names include the expected `./` prefix.
- Inspect the deployed `mf-manifest.json`.
- Use supported compatibility formats from [compatibility-matrix.md](compatibility-matrix.md).
- Load SystemJS before consuming `format: 'systemjs'` remotes.

## `MFV-006` SSR Entry Selection Errors

Typical causes:

- Node target cannot find a usable `ssrRemoteEntry`.
- Manifest has a malformed `ssrRemoteEntry`.
- Remote SSR build was not merged into the deployed client artifact directory.

Actions:

- Build the remote SSR output and publish it next to the browser manifest.
- Confirm `metaData.ssrRemoteEntry.name` exists and points to an ESM SSR entry.
- Run `pnpm --filter vite-plugin-federation test:e2e:ssr`.
- Compare server and browser debug payloads in the React SSR example.

## `MFV-007` Compatibility Warnings

Typical causes:

- Legacy `from` value is not fully supported.
- Migration config depends on behavior outside the supported compatibility matrix.

Actions:

- Prefer manifest-first remotes for new Vite applications.
- Keep unsupported compatibility combinations isolated behind migration code.
- See [originjs-migration.md](originjs-migration.md).

## Debug Snapshot Checklist

Capture this when reporting production incidents:

- Application release id and host commit.
- Remote manifest URL and remote release id.
- `getFederationDebugInfo()` output.
- Browser console errors and network status for manifest/remote entry requests.
- SSR server logs when `target: 'node'` is involved.
