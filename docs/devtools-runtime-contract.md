# DevTools Runtime Contract

This document defines the browser global used by the optional development overlay and by external
debug tooling.

## Global

When devtools are enabled, the plugin creates or reuses:

```ts
window.__VITE_PLUGIN_FEDERATION_DEVTOOLS__
```

The current contract version is `1.0.0`.

```ts
interface FederationDevtoolsGlobal {
  activeApp?: string;
  apps: Record<string, FederationDevtoolsAppPayload>;
  contractVersion: '1.0.0';
  eventLimit: number;
  events: FederationDevtoolsEvent[];
  exportSnapshot: () => FederationDevtoolsSnapshot;
  copySnapshot?: () => Promise<string>;
  lastUpdatedAt?: string;
  runtime?: ReturnType<typeof getFederationDebugInfo>;
}
```

The runtime and overlay both retain at most `eventLimit` events. The default is `50`.

## App Payload

The dev server endpoint and injected bootstrap register one payload per configured federation app.

```ts
interface FederationDevtoolsAppPayload {
  capabilities: {
    copySnapshot: boolean;
    manifestTimeline: boolean;
    preloadGraph: boolean;
    remoteRegistry: boolean;
    runtimeErrors: boolean;
    sharedGraph: boolean;
  };
  contractVersion: '1.0.0';
  debugUrl: string | null;
  endpoint: string;
  eventLimit: number;
  exposes: Array<{
    cssMode: 'head' | 'manual' | string;
    exposeName: string;
    import: string | string[];
  }>;
  manifestUrl: string | null;
  name: string;
  remoteHmrUrl: string | null;
  remotes: Array<{
    alias: string;
    entry: string;
    name: string;
    type: string;
  }>;
  role: 'host' | 'remote' | 'hybrid' | 'isolated';
  shared: string[];
}
```

The same payload is served as JSON from `/<base>/__mf_devtools`.

## Runtime Events

The runtime dispatches `vite-plugin-federation:debug` after relevant state changes. Event details
have this shape:

```ts
interface FederationRuntimeDebugEvent {
  event:
    | 'create-instance'
    | 'register-remotes'
    | 'register-shared'
    | 'shared-resolution'
    | 'load-remote'
    | 'refresh-remote'
    | 'load-error'
    | 'manifest-fetched'
    | 'manifest-integrity'
    | 'manifest-registered'
    | 'clear-caches';
  snapshot: ReturnType<typeof getFederationDebugInfo>;
  timestamp: string;
}
```

The overlay also listens to:

- `vite-plugin-federation:remote-update`
- `vite-plugin-federation:remote-style-update`
- `vite-plugin-federation:remote-types-update`

## Snapshot Export

`exportSnapshot()` returns a JSON-safe object containing apps, recent events, last runtime snapshot,
contract version, and update timestamp. `copySnapshot()` writes the same object to
`navigator.clipboard` when available and resolves with the JSON string.

External tooling should prefer `exportSnapshot()` over reading individual fields one by one. The
top-level field names are the stable contract; nested runtime data follows
`getFederationDebugInfo()`.

## Overlay Panels

The built-in overlay renders these optional panels from the runtime snapshot:

- Runtime errors from `runtime.lastLoadError`.
- Registered runtime and manifest remotes.
- Manifest fetch timeline from `runtime.manifestFetches`.
- Shared resolution graph from `runtime.sharedResolutionGraph`.
- Last preload call from `runtime.lastPreloadRemote`.
- Recent devtools events.

The overlay is only injected during Vite dev server usage when `dev.devtools !== false`. It is not
included in production builds.
