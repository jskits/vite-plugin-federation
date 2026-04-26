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

## Update Strategies

Remote updates are classified before they are broadcast to hosts:

| Strategy | Action | Trigger |
| --- | --- | --- |
| `partial` | `partial-reload` | A changed file is a configured expose entry or is inside an expose importer graph. |
| `style` | `style-update` | A changed stylesheet belongs to a known expose. |
| `types` | `types-update` | A declaration file changed. |
| `full` | `full-reload` | The file is outside the known expose graph or partial reload cannot be applied. |

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
