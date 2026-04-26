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

The extended e2e workflow runs the current repository-pinned Vite version. Add explicit version
matrix jobs when the examples are expanded to install multiple Vite versions in isolated workspaces.

## Known `tsup` CJS Warning

`tsup` currently warns that `dist/index.cjs` uses named and default exports together. This is
intentional for compatibility with default plugin imports and named type/runtime exports. The
package smoke test validates the generated tarball exports and a clean Vite app install before
release.
