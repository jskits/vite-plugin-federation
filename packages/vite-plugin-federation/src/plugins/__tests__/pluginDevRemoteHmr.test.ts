import { beforeEach, describe, expect, it, vi } from 'vitest';
import pluginDevRemoteHmr from '../pluginDevRemoteHmr';
import { packageNameEncode } from '../../utils/packageUtils';

const { mfWarn } = vi.hoisted(() => ({
  mfWarn: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  mfWarn,
}));

type WatcherEvent = 'change' | 'add' | 'unlink';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CLOSING = 2;
  static CLOSED = 3;

  readonly CLOSING = MockWebSocket.CLOSING;
  readonly CLOSED = MockWebSocket.CLOSED;
  readonly close = vi.fn(() => {
    this.readyState = this.CLOSED;
  });

  readyState = 1;
  onmessage?: (event: { data: unknown }) => void;
  onopen?: () => void;
  onerror?: (error: unknown) => void;
  onclose?: () => void;

  constructor(
    readonly url: string,
    readonly protocol: string,
  ) {
    MockWebSocket.instances.push(this);
  }
}

function createServer(overrides: Record<string, any> = {}) {
  const watcherHandlers = new Map<WatcherEvent, Set<(file: string) => void>>();
  const closeHandlers: Array<() => void> = [];
  const middlewares: Array<(req: any, res: any, next: () => void) => void> = [];

  const server = {
    config: {
      base: '/',
      root: '/repo',
      webSocketToken: 'dev-token',
      server: {
        host: 'localhost',
        port: 5173,
        https: false,
        hmr: undefined,
      },
    },
    middlewares: {
      use: vi.fn((handler: (req: any, res: any, next: () => void) => void) => {
        middlewares.push(handler);
      }),
    },
    watcher: {
      on: vi.fn((event: WatcherEvent, handler: (file: string) => void) => {
        const handlers = watcherHandlers.get(event) || new Set();
        handlers.add(handler);
        watcherHandlers.set(event, handlers);
      }),
      off: vi.fn((event: WatcherEvent, handler: (file: string) => void) => {
        watcherHandlers.get(event)?.delete(handler);
      }),
    },
    ws: {
      send: vi.fn(),
    },
    reloadModule: vi.fn(async () => {}),
    moduleGraph: {
      getModulesByFile: vi.fn(() => undefined),
      idToModuleMap: new Map(),
    },
    httpServer: {
      once: vi.fn((event: string, handler: () => void) => {
        if (event === 'close') closeHandlers.push(handler);
      }),
    },
    ...overrides,
  };

  return {
    server,
    middlewares,
    emit(event: WatcherEvent, file: string) {
      watcherHandlers.get(event)?.forEach((handler) => handler(file));
    },
    close() {
      closeHandlers.forEach((handler) => handler());
    },
  };
}

function getRemoteVirtualModuleId(remoteRequestId: string) {
  const encodedTag = packageNameEncode('__loadRemote__');
  return `/repo/node_modules/__mf__virtual/${encodedTag}${packageNameEncode(remoteRequestId)}${encodedTag}.js`;
}

describe('pluginDevRemoteHmr', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    MockWebSocket.instances = [];
  });

  it('serves remote metadata and classifies remote updates', () => {
    const buttonModule = {
      id: '/repo/src/Button.tsx',
      importers: new Set(),
    };
    const buttonStyleModule = {
      id: '/repo/src/Button.css',
      importers: new Set([buttonModule]),
    };
    const { server, middlewares, emit, close } = createServer({
      config: {
        base: 'https://remote.example/app/',
        root: '/repo',
        webSocketToken: 'token-123',
        server: {
          host: '0.0.0.0',
          port: 4173,
          https: true,
          hmr: {
            host: 'hmr.example',
            clientPort: 24678,
            path: '/hmr',
          },
        },
      },
      moduleGraph: {
        getModulesByFile: vi.fn((file: string) => {
          if (file === '/repo/src/Button.css') {
            return new Set([buttonStyleModule]);
          }
          return undefined;
        }),
      },
    });

    const plugin = pluginDevRemoteHmr({
      name: 'remote-app',
      dev: { remoteHmr: true },
      exposes: { './Button': { import: './src/Button.tsx' } },
      remotes: {},
      virtualModuleDir: '__mf__virtual',
    } as any);

    plugin.configureServer?.(server as any);

    expect(middlewares).toHaveLength(1);

    const res = {
      setHeader: vi.fn(),
      end: vi.fn(),
    };
    const next = vi.fn();
    middlewares[0]({ url: '/app/__mf_hmr?x=1' }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({
      remote: 'remote-app',
      event: 'mf:remote-update',
      wsUrl: 'wss://hmr.example:24678/app/hmr?token=token-123',
    });

    emit('change', '/repo/src/Button.tsx');
    emit('change', '/repo/src/Button.css');
    emit('change', '/node_modules/react/index.js');
    emit('add', '/repo/src/other.tsx');
    emit('unlink', '/repo/src/__mf__virtual/chunk.js');

    expect(server.ws.send).toHaveBeenCalledTimes(3);
    expect(server.ws.send).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'custom',
        event: 'mf:remote-update',
        data: expect.objectContaining({
          action: 'partial-reload',
          expose: './Button',
          kind: 'expose',
          remote: 'remote-app',
          file: '/repo/src/Button.tsx',
        }),
      }),
    );
    expect(server.ws.send).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'custom',
        event: 'mf:remote-update',
        data: expect.objectContaining({
          action: 'style-update',
          expose: './Button',
          kind: 'style',
          remote: 'remote-app',
          file: '/repo/src/Button.css',
        }),
      }),
    );
    expect(server.ws.send).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: 'custom',
        event: 'mf:remote-update',
        data: expect.objectContaining({
          action: 'full-reload',
          kind: 'boundary',
          remote: 'remote-app',
          file: '/repo/src/other.tsx',
        }),
      }),
    );

    close();
    expect(server.watcher.off).toHaveBeenCalledTimes(3);
  });

  it('connects host to remote hmr websocket and triggers full reload for boundary updates', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        event: 'mf:remote-update',
        wsUrl: 'ws://remote.example:4174/app?token=abc',
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('WebSocket', MockWebSocket as any);

    const { server, close } = createServer({
      config: {
        base: '/',
        webSocketToken: 'host-token',
        server: {
          host: '127.0.0.1',
          port: 5173,
          https: false,
          hmr: undefined,
        },
      },
    });

    const plugin = pluginDevRemoteHmr({
      name: 'host-app',
      dev: { remoteHmr: true },
      exposes: {},
      remotes: {
        remoteApp: {
          entry: 'http://remote.example/assets/remoteEntry.js?x=1#hash',
        },
      },
      virtualModuleDir: '__mf__virtual',
    } as any);

    plugin.configureServer?.(server as any);

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('http://remote.example/assets/__mf_hmr'),
    );
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

    const socket = MockWebSocket.instances[0];
    expect(socket.url).toBe('ws://remote.example:4174/app?token=abc');
    expect(socket.protocol).toBe('vite-hmr');

    socket.onmessage?.({
      data: JSON.stringify({
        type: 'custom',
        event: 'mf:remote-update',
        data: {
          action: 'full-reload',
          file: '/src/bootstrap.ts',
          kind: 'boundary',
          remote: 'remoteApp',
          ts: 1,
        },
      }),
    });

    expect(server.ws.send).toHaveBeenCalledWith({ type: 'full-reload' });

    close();
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('reloads matching host virtual modules for remote expose updates', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        event: 'mf:remote-update',
        wsUrl: 'ws://remote.example:4174/app?token=abc',
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('WebSocket', MockWebSocket as any);

    const remoteButtonModule = {
      id: getRemoteVirtualModuleId('remoteApp/Button'),
      importers: new Set(),
      url: '/node_modules/__mf__virtual/remoteApp__loadRemote__Button.js',
    };
    const { server } = createServer({
      moduleGraph: {
        getModulesByFile: vi.fn(() => undefined),
        idToModuleMap: new Map([[remoteButtonModule.id, remoteButtonModule]]),
      },
    });

    const plugin = pluginDevRemoteHmr({
      name: 'host-app',
      dev: { remoteHmr: true },
      exposes: {},
      remotes: {
        remoteApp: {
          entry: 'http://remote.example/assets/remoteEntry.js',
          name: 'remoteApp',
        },
      },
      virtualModuleDir: '__mf__virtual',
    } as any);

    plugin.configureServer?.(server as any);

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

    MockWebSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'custom',
        event: 'mf:remote-update',
        data: {
          action: 'partial-reload',
          expose: './Button',
          file: '/repo/src/Button.tsx',
          kind: 'expose',
          remote: 'remoteApp',
          ts: 123,
        },
      }),
    });

    await vi.waitFor(() => expect(server.reloadModule).toHaveBeenCalledWith(remoteButtonModule));

    expect(server.ws.send).toHaveBeenCalledWith({
      type: 'custom',
      event: 'vite-plugin-federation:remote-expose-update',
      data: expect.objectContaining({
        action: 'partial-reload',
        expose: './Button',
        hostRemote: 'remoteApp',
        remote: 'remoteApp',
        remoteOrigin: 'http://remote.example',
        remoteRequestId: 'remoteApp/Button',
        ts: 123,
      }),
    });
    expect(server.ws.send).not.toHaveBeenCalledWith({ type: 'full-reload' });
  });

  it('matches remote virtual modules from urlToModuleMap when idToModuleMap is empty', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        event: 'mf:remote-update',
        wsUrl: 'ws://remote.example:4174/app?token=abc',
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('WebSocket', MockWebSocket as any);

    const remoteButtonModule = {
      id: undefined,
      importers: new Set(),
      url: '/node_modules/__mf__virtual/__mfe_internal__hostApp__loadRemote__remoteApp_mf_1_Button__loadRemote__.mjs',
    };
    const { server } = createServer({
      moduleGraph: {
        getModulesByFile: vi.fn(() => undefined),
        idToModuleMap: new Map(),
        urlToModuleMap: new Map([[remoteButtonModule.url, remoteButtonModule]]),
      },
    });

    const plugin = pluginDevRemoteHmr({
      name: 'host-app',
      dev: { remoteHmr: true },
      exposes: {},
      remotes: {
        remoteApp: {
          entry: 'http://remote.example/assets/remoteEntry.js',
          name: 'remoteApp',
        },
      },
      virtualModuleDir: '__mf__virtual',
    } as any);

    plugin.configureServer?.(server as any);

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

    MockWebSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'custom',
        event: 'mf:remote-update',
        data: {
          action: 'partial-reload',
          expose: './Button',
          file: '/repo/src/Button.tsx',
          kind: 'expose',
          remote: 'remoteApp',
          ts: 124,
        },
      }),
    });

    await vi.waitFor(() => expect(server.reloadModule).toHaveBeenCalledWith(remoteButtonModule));
    expect(server.ws.send).not.toHaveBeenCalledWith({ type: 'full-reload' });
  });

  it('matches remote virtual modules from getModulesByFile using the expected virtual file path', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        event: 'mf:remote-update',
        wsUrl: 'ws://remote.example:4174/app?token=abc',
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('WebSocket', MockWebSocket as any);

    const remoteButtonVirtualFile =
      '/repo/node_modules/__mf__virtual/__mfe_internal__hostApp__loadRemote__remoteApp_mf_1_Button__loadRemote__.mjs';
    const remoteButtonModule = {
      id: undefined,
      importers: new Set(),
      url: '/node_modules/__mf__virtual/__mfe_internal__hostApp__loadRemote__remoteApp_mf_1_Button__loadRemote__.mjs',
    };
    const { server } = createServer({
      moduleGraph: {
        getModulesByFile: vi.fn((file: string) =>
          file === remoteButtonVirtualFile ? new Set([remoteButtonModule]) : undefined,
        ),
        idToModuleMap: new Map(),
        urlToModuleMap: new Map(),
      },
    });

    const plugin = pluginDevRemoteHmr({
      name: 'host-app',
      internalName: '__mfe_internal__hostApp',
      dev: { remoteHmr: true },
      exposes: {},
      remotes: {
        remoteApp: {
          entry: 'http://remote.example/assets/remoteEntry.js',
          name: 'remoteApp',
        },
      },
      virtualModuleDir: '__mf__virtual',
    } as any);

    plugin.configureServer?.(server as any);

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

    MockWebSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'custom',
        event: 'mf:remote-update',
        data: {
          action: 'partial-reload',
          expose: './Button',
          file: '/repo/src/Button.tsx',
          kind: 'expose',
          remote: 'remoteApp',
          ts: 125,
        },
      }),
    });

    await vi.waitFor(() => expect(server.reloadModule).toHaveBeenCalledWith(remoteButtonModule));
    expect(server.ws.send).not.toHaveBeenCalledWith({ type: 'full-reload' });
  });

  it('forwards remote style updates without forcing a full reload', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        event: 'mf:remote-update',
        wsUrl: 'ws://remote.example:4174/app?token=abc',
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('WebSocket', MockWebSocket as any);

    const { server } = createServer();

    const plugin = pluginDevRemoteHmr({
      name: 'host-app',
      dev: { remoteHmr: true },
      exposes: {},
      remotes: {
        remoteApp: {
          entry: 'http://remote.example/assets/remoteEntry.js',
        },
      },
      virtualModuleDir: '__mf__virtual',
    } as any);

    plugin.configureServer?.(server as any);

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

    MockWebSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'custom',
        event: 'mf:remote-update',
        data: {
          action: 'style-update',
          expose: './Button',
          file: '/repo/src/Button.css',
          kind: 'style',
          remote: 'remote-app',
          ts: 123,
        },
      }),
    });

    expect(server.ws.send).toHaveBeenCalledWith({
      type: 'custom',
      event: 'vite-plugin-federation:remote-style-update',
      data: expect.objectContaining({
        action: 'style-update',
        expose: './Button',
        remote: 'remote-app',
        remoteOrigin: 'http://remote.example',
        ts: 123,
      }),
    });
    expect(server.ws.send).not.toHaveBeenCalledWith({ type: 'full-reload' });
  });

  it('forwards remote type-only updates without forcing a full reload', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        event: 'mf:remote-update',
        wsUrl: 'ws://remote.example:4174/app?token=abc',
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('WebSocket', MockWebSocket as any);

    const { server } = createServer();

    const plugin = pluginDevRemoteHmr({
      name: 'host-app',
      dev: { remoteHmr: true },
      exposes: {},
      remotes: {
        remoteApp: {
          entry: 'http://remote.example/assets/remoteEntry.js',
        },
      },
      virtualModuleDir: '__mf__virtual',
    } as any);

    plugin.configureServer?.(server as any);

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

    MockWebSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        type: 'custom',
        event: 'mf:remote-update',
        data: {
          action: 'types-update',
          file: '/repo/src/types.d.ts',
          kind: 'types',
          remote: 'remote-app',
          ts: 456,
        },
      }),
    });

    expect(server.ws.send).toHaveBeenCalledWith({
      type: 'custom',
      event: 'vite-plugin-federation:remote-types-update',
      data: expect.objectContaining({
        action: 'types-update',
        remote: 'remote-app',
        remoteOrigin: 'http://remote.example',
        ts: 456,
      }),
    });
    expect(server.ws.send).not.toHaveBeenCalledWith({ type: 'full-reload' });
  });

  it('injects a host-side client handler for remote HMR updates', () => {
    const plugin = pluginDevRemoteHmr({
      name: 'host-app',
      dev: { remoteHmr: true },
      exposes: {},
      remotes: {
        remoteApp: {
          entry: 'http://remote.example/assets/remoteEntry.js',
        },
      },
      virtualModuleDir: '__mf__virtual',
    } as any);

    const tags = plugin.transformIndexHtml?.();

    expect(tags).toHaveLength(1);
    expect(tags?.[0]).toMatchObject({
      tag: 'script',
      injectTo: 'head',
      attrs: {
        type: 'module',
      },
    });
    expect(tags?.[0].children).toContain('/@id/virtual:vite-plugin-federation/remote-hmr-client');

    const resolvedId = plugin.resolveId?.('virtual:vite-plugin-federation/remote-hmr-client');
    expect(resolvedId).toBe('\0virtual:vite-plugin-federation/remote-hmr-client');

    const clientModule = plugin.load?.('\0virtual:vite-plugin-federation/remote-hmr-client');
    expect(clientModule).toContain('vite-plugin-federation:remote-style-update');
    expect(clientModule).toContain('vite-plugin-federation:remote-types-update');
    expect(clientModule).toContain('vite-plugin-federation:remote-expose-update');
    expect(clientModule).toContain('window.location.reload()');
  });

  it('triggers full reload for host local file changes', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        event: 'mf:remote-update',
        wsUrl: 'ws://remote.example:4174/app?token=abc',
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('WebSocket', MockWebSocket as any);

    const { server, emit } = createServer();

    const plugin = pluginDevRemoteHmr({
      name: 'host-app',
      dev: { remoteHmr: true },
      exposes: {},
      remotes: {
        remoteApp: {
          entry: 'http://remote.example/assets/remoteEntry.js',
        },
      },
      virtualModuleDir: '__mf__virtual',
    } as any);

    plugin.configureServer?.(server as any);

    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

    emit('change', '/src/components/Counter.vue');
    emit('change', '/node_modules/vue/index.js');
    emit('change', '/src/__mf__virtual/chunk.js');

    expect(server.ws.send).toHaveBeenCalledWith({ type: 'full-reload' });
    expect(server.ws.send).toHaveBeenCalledTimes(1);
  });
});
