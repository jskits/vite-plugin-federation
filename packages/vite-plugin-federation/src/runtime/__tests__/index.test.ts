import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createInstanceMock,
  getInstanceMock,
  loadRemoteMock,
  preloadRemoteMock,
  registerPluginsMock,
  registerRemotesMock,
  registerSharedMock,
} = vi.hoisted(() => ({
  createInstanceMock: vi.fn((options) => ({ options })),
  getInstanceMock: vi.fn(() => ({ name: 'host', options: { name: 'host' } })),
  loadRemoteMock: vi.fn(),
  preloadRemoteMock: vi.fn(),
  registerPluginsMock: vi.fn(),
  registerRemotesMock: vi.fn(),
  registerSharedMock: vi.fn(),
}));

vi.mock('@module-federation/runtime', () => ({
  createInstance: createInstanceMock,
  getInstance: getInstanceMock,
  getRemoteEntry: vi.fn(),
  getRemoteInfo: vi.fn(),
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
    loadRemoteMock.mockReset();
    preloadRemoteMock.mockReset();
    registerPluginsMock.mockReset();
    registerRemotesMock.mockReset();
    registerSharedMock.mockReset();
    vi.unstubAllGlobals();
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
    expect(createInstanceMock).toHaveBeenCalled();
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

    expect(createInstanceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inBrowser: false,
        name: 'server-host',
      })
    );
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
