# Dev Remote HMR

Remote HMR is enabled with:

```ts
federation({
  name: 'remote',
  dev: {
    remoteHmr: true,
  },
});
```

Hosts that configure remotes automatically inject a lightweight HMR client during Vite dev server
usage.

## Configured vs Runtime Remotes

The built-in host bridge connects remotes declared in `federation({ remotes })`, because the dev
server can read those URLs during startup.

Remotes registered later with runtime APIs such as `registerRemotes()` or
`loadRemoteFromManifest()` are only known in the browser. For those dynamic remotes, connect the
runtime-side HMR client after registration:

```ts
import { connectRuntimeRemoteHmr, registerRemotes } from 'vite-plugin-federation/runtime';

registerRemotes([{ name: 'catalog', entry: catalogManifestUrl, type: 'module' }]);

const hmr = connectRuntimeRemoteHmr('catalog', catalogManifestUrl);

if (import.meta.hot) {
  import.meta.hot.dispose(() => hmr.close());
}
```

`connectRuntimeRemoteHmr()` reads the remote `/__mf_hmr` metadata, opens the remote Vite WebSocket,
dispatches the same browser events listed below, refreshes remote stylesheet links, and calls
`refreshRemote()` for partial expose updates. The remote still needs `dev.remoteHmr: true`.

Framework-native HMR can still work without the federation bridge when the remote dev server serves
modules that import its own Vite client. For example, Vue SFC updates can patch already mounted
remote components through the remote Vite client. The runtime connector is still useful for dynamic
remote cache invalidation, stylesheet refreshes, type events, and full-reload fallback decisions.

## Update Strategies

Remote updates are classified before they are broadcast to hosts:

| Strategy  | Action           | Trigger                                                                            |
| --------- | ---------------- | ---------------------------------------------------------------------------------- |
| `partial` | `partial-reload` | A changed file is a configured expose entry or is inside an expose importer graph. |
| `style`   | `style-update`   | A changed stylesheet belongs to a known expose.                                    |
| `types`   | `types-update`   | A declaration file changed.                                                        |
| `full`    | `full-reload`    | The file is outside the known expose graph or partial reload cannot be applied.    |

Every payload includes `reason`, `strategy`, `batchId`, and a small `dependencyGraph` object with
the matched expose, changed file, importer preview, and match mode.

## Batching

Remote file events are batched with a short debounce window. Duplicate changes to the same file are
collapsed before the remote sends `mf:remote-update` messages. This avoids a burst of host reloads
when a framework or compiler writes several files during one save.

## Host Behavior

For `partial-reload`, the host tries to reload the matching virtual remote module with Vite
`server.reloadModule()`. This keeps application state when the framework HMR boundary supports it,
for example React Fast Refresh-compatible component exposes.

Fallback rules:

- If `server.reloadModule()` is unavailable, the host emits a diagnostic update and performs a full
  reload.
- If no matching host virtual module is found, the host emits a diagnostic update and performs a
  full reload.
- Style updates refresh matching remote stylesheet links. If no stylesheet can be refreshed, the
  browser reloads.
- Type updates are forwarded without forcing a page reload.

## Browser Events

Hosts dispatch these browser events for devtools and custom app integrations:

- `vite-plugin-federation:remote-update`
- `vite-plugin-federation:remote-expose-update`
- `vite-plugin-federation:remote-style-update`
- `vite-plugin-federation:remote-types-update`

The built-in devtools overlay records the same events and displays the update reason.
