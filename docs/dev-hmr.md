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
modules that import its own Vite client. This is framework-specific and depends on the framework HMR
runtime being able to find the already mounted component instances. The runtime connector is still
useful for dynamic remote cache invalidation, stylesheet refreshes, type events, and full-reload
fallback decisions.

## Vue Runtime HMR Caveat

`connectRuntimeRemoteHmr()` keeps the federation runtime synchronized with a remote registered in
the browser. It does not merge framework-native HMR runtimes.

Vue dev mode exposes its HMR API on `globalThis.__VUE_HMR_RUNTIME__`, while the component record map
used by that API lives inside the evaluated Vue runtime module. If a host and a remote on different
dev origins both evaluate separate Vue dev runtimes, the later runtime can replace the global
`__VUE_HMR_RUNTIME__` reference. In that state, remote update events may still arrive, but Vue can
miss already mounted component records because they belong to the other runtime instance. A common
symptom is that a remote SFC update only appears after the component is unmounted and mounted again.

Prefer these options for Vue dev setups:

- Share `vue` and `vue/*` as singletons between host and remote.
- Avoid evaluating a second Vue dev runtime in the host page when possible.
- Use `connectRuntimeRemoteHmr()` for remotes added through `registerRemotes()` or
  `loadRemoteFromManifest()`.
- Expose components, route modules, or loaders instead of the HTML bootstrap entry such as
  `src/main.ts` or `src/main.tsx`.

For vendor-style dev flows where a remote is attached to a running host at runtime and a second Vue
dev runtime is unavoidable, a host can use a dev-only workaround that preserves the host Vue HMR
runtime after Vue is imported and restores it after loading the remote:

```ts
import { loadRemote } from 'vite-plugin-federation/runtime';
import { createApp } from 'vue';
import App from './App.vue';

const hostVueHmrRuntime = import.meta.env.DEV ? (globalThis as any).__VUE_HMR_RUNTIME__ : undefined;

createApp(App).mount('#app');

async function loadVendorRemote() {
  const mod = await loadRemote('vendor/Button');

  if (import.meta.env.DEV && hostVueHmrRuntime) {
    (globalThis as any).__VUE_HMR_RUNTIME__ = hostVueHmrRuntime;
  }

  return mod;
}
```

Treat this as a development integration workaround, not a production API. Test the exact host and
remote combination because framework-native HMR behavior is owned by the framework runtime.

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
