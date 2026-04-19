import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createInstanceMock,
  getInstanceMock,
  initMock,
  loadRemoteMock,
  preloadRemoteMock,
  registerPluginsMock,
  registerRemotesMock,
  registerSharedMock,
  SourceTextModuleMock,
} = vi.hoisted(() => ({
  createInstanceMock: vi.fn((options) => ({ options })),
  getInstanceMock: vi.fn(() => ({ name: 'host', options: { name: 'host' } })),
  initMock: vi.fn((options) => ({ options })),
  loadRemoteMock: vi.fn(),
  preloadRemoteMock: vi.fn(),
  registerPluginsMock: vi.fn(),
  registerRemotesMock: vi.fn(),
  registerSharedMock: vi.fn(),
  SourceTextModuleMock: class {
    code: string;
    namespace: Record<string, unknown>;
    options: {
      importModuleDynamically: (specifier: string) => Promise<any>;
    };

    constructor(
      code: string,
      options: {
        importModuleDynamically: (specifier: string) => Promise<any>;
      }
    ) {
      this.code = code;
      this.namespace = {};
      this.options = options;
    }

    async link() {}

    async evaluate() {
      const bindings: Record<string, unknown> = {};

      for (const match of this.code.matchAll(/export const (\w+) = "([^"]+)";/g)) {
        bindings[match[1]] = match[2];
        this.namespace[match[1]] = match[2];
      }

      for (const match of this.code.matchAll(/const\s+(\w+)\s*=\s*await import\("([^"]+)"\);/g)) {
        const importedModule = await this.options.importModuleDynamically(match[2]);
        bindings[match[1]] = importedModule.namespace ?? importedModule;
      }

      for (const match of this.code.matchAll(/const\s+(\w+)\s*=\s*(\w+)\.(\w+);/g)) {
        const source = bindings[match[2]] as Record<string, unknown> | undefined;
        bindings[match[1]] = source?.[match[3]];
      }

      for (const match of this.code.matchAll(/export\s*\{\s*(\w+)\s+as\s+(\w+)\s*\};/g)) {
        this.namespace[match[2]] = bindings[match[1]];
      }

      for (const match of this.code.matchAll(/export\s*\{\s*(\w+)\.(\w+)\s+as\s+(\w+)\s*\};/g)) {
        const source = bindings[match[1]] as Record<string, unknown> | undefined;
        this.namespace[match[3]] = source?.[match[2]];
      }
    }
  },
}));

vi.mock('@module-federation/runtime', () => ({
  createInstance: createInstanceMock,
  getInstance: getInstanceMock,
  getRemoteEntry: vi.fn(),
  getRemoteInfo: vi.fn(),
  init: initMock,
  loadRemote: loadRemoteMock,
  loadScript: vi.fn(),
  loadScriptNode: vi.fn(),
  loadShare: vi.fn(),
  loadShareSync: vi.fn(),
  preloadRemote: preloadRemoteMock,
  registerGlobalPlugins: vi.fn(),
  registerPlugins: registerPluginsMock,
  registerRemotes: registerRemotesMock,
  registerShared: registerSharedMock,
}));

import {
  clearFederationRuntimeCaches,
  createFederationInstance,
  createServerFederationInstance,
  fetchFederationManifest,
  getFederationDebugInfo,
  loadRemote,
  loadRemoteFromManifest,
  preloadRemote,
  registerManifestRemote,
  registerPlugins,
  registerRemotes,
  registerShared,
} from '../index';
import { clearModuleFederationDebugState } from '../../utils/logger';

describe('runtime api', () => {
  beforeEach(() => {
    clearModuleFederationDebugState();
    clearFederationRuntimeCaches();
    createInstanceMock.mockClear();
    getInstanceMock.mockClear();
    initMock.mockClear();
    loadRemoteMock.mockReset();
    preloadRemoteMock.mockReset();
    registerPluginsMock.mockReset();
    registerRemotesMock.mockReset();
    registerSharedMock.mockReset();
    vi.unstubAllGlobals();
    vi.stubGlobal('__VITE_PLUGIN_FEDERATION_IMPORT_NODE_VM__', async () => ({
      SourceTextModule: SourceTextModuleMock,
    }));
    delete (globalThis as any).__VITE_PLUGIN_FEDERATION_DEVTOOLS__;
  });

  it('tracks registered remotes and shared keys in debug info', () => {
    registerRemotes([{ name: 'remoteApp', entry: 'http://localhost/remoteEntry.js' }] as any);
    registerShared({
      react: [{ version: '19.0.0' }],
    } as any);
    registerPlugins([] as any);

    const debugInfo = getFederationDebugInfo();

    expect(registerRemotesMock).toHaveBeenCalled();
    expect(registerSharedMock).toHaveBeenCalled();
    expect(registerPluginsMock).toHaveBeenCalled();
    expect(debugInfo.runtime.registeredRemotes[0]).toMatchObject({
      name: 'remoteApp',
    });
    expect(debugInfo.runtime.registeredSharedKeys).toEqual(['react']);
  });

  it('tracks remote load failures for debug inspection', async () => {
    loadRemoteMock.mockRejectedValueOnce(new Error('manifest fetch failed'));

    await expect(loadRemote('remoteApp/Button')).rejects.toThrow('manifest fetch failed');

    const debugInfo = getFederationDebugInfo();
    expect(debugInfo.runtime.lastLoadError).toMatchObject({
      code: 'MFV-004',
      remoteId: 'remoteApp/Button',
    });
  });

  it('exposes instance snapshot and preload history', () => {
    preloadRemote([{ nameOrAlias: 'remoteApp' }] as any);
    createFederationInstance({
      name: 'host',
      remotes: [],
      shared: {},
      plugins: [],
      inBrowser: false,
    });

    const debugInfo = getFederationDebugInfo();

    expect(preloadRemoteMock).toHaveBeenCalled();
    expect(initMock).toHaveBeenCalled();
    expect(debugInfo.instance).toMatchObject({
      name: 'host',
    });
    expect(debugInfo.runtime.lastPreloadRemote).toHaveLength(1);
  });

  it('creates a server runtime instance with inBrowser disabled', () => {
    createServerFederationInstance({
      name: 'server-host',
      remotes: [],
      shared: {},
      plugins: [],
      inBrowser: true,
    });

    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inBrowser: false,
        name: 'server-host',
      })
    );
  });

  it('installs a node entry loader plugin for server runtimes', async () => {
    createServerFederationInstance({
      name: 'server-host',
      remotes: [],
      shared: {},
      plugins: [],
      inBrowser: true,
    });

    const initOptions = initMock.mock.calls.at(-1)?.[0];
    const normalizerPlugin = initOptions.plugins.find(
      (plugin: { name: string }) =>
        plugin.name === 'vite-plugin-federation:node-entry-loader'
    );

    expect(normalizerPlugin).toBeTruthy();

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/dep.js?mf_target=node')) {
        return new Response('export const foo = "dep-value";', {
          headers: {
            'content-type': 'text/javascript',
          },
          status: 200,
        });
      }

      return new Response(
        [
          'const __vite_ssr_import_0__ = await __vite_ssr_import__("/dep.js", {"importedNames":["foo"]});',
          'export { __vite_ssr_import_0__.foo as foo };',
        ].join('\n'),
        {
          headers: {
            'content-type': 'text/javascript',
          },
          status: 200,
        }
      );
    });

    vi.stubGlobal('fetch', fetchMock);

    const namespace = await normalizerPlugin.loadEntry({
      remoteInfo: {
        entry: 'http://127.0.0.1:4175/@fs/runtime/index.js?mf_target=node',
        type: 'module',
      },
    });

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4175/@fs/runtime/index.js?mf_target=node');
    expect(
      fetchMock.mock.calls.some(([url]) => url === 'http://127.0.0.1:4175/dep.js?mf_target=node')
    ).toBe(true);
    expect(namespace).toBeTruthy();
  });

  it('collapses concurrent manifest fetches into a single request', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'remoteApp',
        metaData: {
          globalName: 'remoteApp',
          remoteEntry: {
            name: 'remoteEntry.js',
            path: '',
            type: 'module',
          },
        },
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);

    const [manifestA, manifestB] = await Promise.all([
      fetchFederationManifest('http://remote.example/mf-manifest.json'),
      fetchFederationManifest('http://remote.example/mf-manifest.json'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(manifestA).toEqual(manifestB);
  });

  it('registers manifest remotes with the node entry when target=node', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'remoteApp',
        metaData: {
          globalName: 'remote-app',
          publicPath: 'https://cdn.example/assets/',
          remoteEntry: {
            name: 'remoteEntry.js',
            path: '',
            type: 'module',
          },
          ssrRemoteEntry: {
            name: 'remoteEntry.ssr.js',
            path: 'server',
            type: 'module',
          },
        },
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);

    await registerManifestRemote('catalog', 'https://remote.example/mf-manifest.json', {
      target: 'node',
    });

    expect(registerRemotesMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          alias: 'catalog',
          entry: 'https://cdn.example/assets/server/remoteEntry.ssr.js',
          entryGlobalName: 'remote-app',
          name: 'remoteApp',
        }),
      ],
      { force: undefined }
    );

    const debugInfo = getFederationDebugInfo();
    expect(debugInfo.runtime.registeredManifestRemotes).toEqual([
      expect.objectContaining({
        alias: 'catalog',
        target: 'node',
      }),
    ]);
  });

  it('resolves relative manifest public paths against the manifest url', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'remoteApp',
        metaData: {
          globalName: 'remoteApp',
          publicPath: '/',
          remoteEntry: {
            name: 'remoteEntry.js',
            path: 'assets',
            type: 'module',
          },
        },
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);

    await registerManifestRemote('remoteApp', 'http://localhost:4174/nested/mf-manifest.json');

    expect(registerRemotesMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          entry: 'http://localhost:4174/assets/remoteEntry.js',
        }),
      ],
      { force: undefined }
    );
  });

  it('collapses concurrent manifest registrations', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'remoteApp',
        metaData: {
          globalName: 'remoteApp',
          remoteEntry: {
            name: 'remoteEntry.js',
            path: '',
            type: 'module',
          },
        },
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([
      registerManifestRemote('remoteApp', 'http://remote.example/mf-manifest.json'),
      registerManifestRemote('remoteApp', 'http://remote.example/mf-manifest.json'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(registerRemotesMock).toHaveBeenCalledTimes(1);
  });

  it('loads remotes after manifest registration', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'remoteApp',
        metaData: {
          globalName: 'remoteApp',
          remoteEntry: {
            name: 'remoteEntry.js',
            path: '',
            type: 'module',
          },
        },
      }),
    }));

    loadRemoteMock.mockResolvedValueOnce({ default: 'button' });
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadRemoteFromManifest(
      'remoteApp/Button',
      'http://remote.example/mf-manifest.json'
    );

    expect(registerRemotesMock).toHaveBeenCalledTimes(1);
    expect(loadRemoteMock).toHaveBeenCalledWith('remoteApp/Button', { from: 'runtime' });
    expect(result).toEqual({ default: 'button' });
  });

  it('publishes runtime debug snapshots to the devtools hook', () => {
    const dispatchEvent = vi.fn();
    class MockCustomEvent {
      constructor(
        public type: string,
        public init?: { detail?: unknown }
      ) {}
    }

    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal('CustomEvent', MockCustomEvent as any);

    registerRemotes([{ name: 'remoteApp', entry: 'http://localhost/remoteEntry.js' }] as any);

    const devtoolsHook = (globalThis as any).__VITE_PLUGIN_FEDERATION_DEVTOOLS__;
    expect(devtoolsHook.runtime).toBeTruthy();
    expect(devtoolsHook.events.at(-1)).toMatchObject({
      event: 'register-remotes',
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0][0]).toMatchObject({
      type: 'vite-plugin-federation:debug',
    });
  });
});
