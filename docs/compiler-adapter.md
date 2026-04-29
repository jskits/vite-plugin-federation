# Compiler Adapter Notes

The plugin supports Vite/Rollup and Rolldown-backed Vite versions through a small set of adapter
rules.

## Remote Import Transforms

Rolldown does not synthesize named exports from federated remote proxy modules in the same way as
Rollup. The `pluginRemoteNamedExports` transform rewrites named imports and explicit named
re-exports to consume the generated `__moduleExports` namespace.

The transform now emits high-resolution sourcemaps with `source` and `sourcesContent`, so transformed
consumer modules remain debuggable in Vite/Rolldown development and production builds.

Unsupported dynamic import variables still warn and should be replaced with explicit
`loadRemote()` calls.

## Control Chunks

Federation control chunks are protected from user `manualChunks` rules because shared dependency
wrappers can contain top-level await. Grouping those chunks together can create circular async
dependencies and deadlock remote bootstrap.

Sanitizer tests cover:

- Empty Vite preload helper removal.
- Load-share preload helper inlining.
- Remote entry side-effect import removal from control chunks.
- Vite 8-style preload helper output.

## Vite Version Matrix

The package peer range is:

```text
^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0
```

`pnpm test:vite-matrix:smoke` packs the package and builds isolated temporary apps against pinned
Vite 5 / 6 / 7 / 8 versions. The smoke app exercises the root export, runtime export, manifest
emission, dynamic imports, and a user `manualChunks` rule. The full Playwright examples still run
against the repository-pinned Vite version because they validate framework and browser behavior,
not every peer major.

## Known `tsup` CJS Warning

`tsup` currently warns that `dist/index.cjs` uses named and default exports together. This is
intentional for compatibility with default plugin imports and named type/runtime exports. The
package smoke test validates the generated tarball exports and a clean Vite app install before
release.
