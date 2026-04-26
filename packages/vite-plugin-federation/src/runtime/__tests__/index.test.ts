import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createInstanceMock,
  getInstanceMock,
  initMock,
  loadRemoteMock,
  loadShareMock,
  loadShareSyncMock,
  preloadRemoteMock,
  registerPluginsMock,
  registerRemotesMock,
  registerSharedMock,
  removeRemoteMock,
  SourceTextModuleMock,
} = vi.hoisted(() => ({
  createInstanceMock: vi.fn((options) => ({ options })),
  getInstanceMock: vi.fn(() => ({ name: 'host', options: { name: 'host' } })),
  initMock: vi.fn((options) => ({ options })),
  loadRemoteMock: vi.fn(),
  loadShareMock: vi.fn(),
  loadShareSyncMock: vi.fn(),
  preloadRemoteMock: vi.fn(),
  registerPluginsMock: vi.fn(),
  registerRemotesMock: vi.fn(),
  registerSharedMock: vi.fn(),
  removeRemoteMock: vi.fn(),
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
      },
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
  loadShare: loadShareMock,
  loadShareSync: loadShareSyncMock,
  preloadRemote: preloadRemoteMock,
  registerGlobalPlugins: vi.fn(),
  registerPlugins: registerPluginsMock,
  registerRemotes: registerRemotesMock,
  registerShared: registerSharedMock,
}));

import {
  clearFederationRuntimeCaches,
  collectFederationManifestExposeAssets,
  collectFederationManifestPreloadLinks,
  createFederationManifestPreloadPlan,
  createFederationInstance,
  createFederationRuntimeScope,
  createServerFederationInstance,
  fetchFederationManifest,
  findFederationManifestExpose,
  getFederationDebugInfo,
  loadRemote,
  loadRemoteFromManifest,
  loadShare,
  loadShareSync,
  preloadRemote,
  registerManifestRemote,
  registerPlugins,
  registerRemotes,
  registerShared,
  refreshRemote,
  verifyFederationManifestAssets,
  warmFederationRemotes,
} from '../index';
import { clearModuleFederationDebugState } from '../../utils/logger';

function toArrayBuffer(value: string) {
  return new TextEncoder().encode(value).buffer;
}

function toSha384Integrity(value: string) {
  return `sha384-${createHash('sha384').update(value).digest('base64')}`;
}

function toSha256ContentHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

describe('runtime api', () => {
  beforeEach(() => {
    vi.useRealTimers();
    clearModuleFederationDebugState();
    clearFederationRuntimeCaches();
    createInstanceMock.mockClear();
    getInstanceMock.mockClear();
    initMock.mockClear();
    loadRemoteMock.mockReset();
    loadShareMock.mockReset();
    loadShareSyncMock.mockReset();
    preloadRemoteMock.mockReset();
    registerPluginsMock.mockReset();
    registerRemotesMock.mockReset();
    registerSharedMock.mockReset();
    removeRemoteMock.mockReset();
    vi.unstubAllGlobals();
    vi.stubGlobal('__VITE_PLUGIN_FEDERATION_IMPORT_NODE_VM__', async () => ({
      SourceTextModule: SourceTextModuleMock,
    }));
    delete (globalThis as any).__VITE_PLUGIN_FEDERATION_DEVTOOLS__;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tracks registered remotes and shared keys in debug info', () => {
    getInstanceMock.mockReturnValue({
      name: 'host',
      options: {
        name: 'host',
        remotes: [{ name: 'remoteApp', entry: 'http://localhost/remoteEntry.js' }],
      },
    });

    registerRemotes([{ name: 'remoteApp', entry: 'http://localhost/remoteEntry.js' }] as any);
    registerShared({
      react: [
        {
          sourcePath: '/repo/node_modules/react/index.js',
          version: '19.0.0',
          shareConfig: {
            resolvedImportSource: 'virtual:prebuild:react',
          },
        },
      ],
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
    expect(debugInfo.runtime.registeredShared[0]).toMatchObject({
      key: 'react',
      versions: [
        expect.objectContaining({
          resolvedImportSource: 'virtual:prebuild:react',
          sourcePath: '/repo/node_modules/react/index.js',
          version: '19.0.0',
        }),
      ],
    });
  });

  it('installs the shared diagnostics runtime plugin during instance creation', () => {
    createFederationInstance({
      name: 'host',
      remotes: [],
      shared: {},
      plugins: [],
      inBrowser: false,
    });

    const initOptions = initMock.mock.calls.at(-1)?.[0];
    expect(initOptions.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'vite-plugin-federation:shared-diagnostics' }),
      ]),
    );
  });

  it('records MFV-003 diagnostics for non-strict shared version mismatches', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createFederationInstance({
      name: 'host',
      remotes: [],
      shared: {},
      plugins: [],
      inBrowser: false,
    });
    const initOptions = initMock.mock.calls.at(-1)?.[0];
    const diagnosticsPlugin = initOptions.plugins.find(
      (plugin: { name: string }) => plugin.name === 'vite-plugin-federation:shared-diagnostics',
    );
    const selectedShared = {
      from: 'remoteApp',
      loaded: true,
      scope: ['default'],
      shareConfig: {
        requiredVersion: '^18.0.0',
        singleton: true,
      },
      strategy: 'version-first',
      useIn: ['host'],
      version: '18.2.0',
    };

    const result = diagnosticsPlugin.resolveShare({
      pkgName: 'react',
      resolver: () => ({
        shared: selectedShared,
        useTreesShaking: false,
      }),
      scope: 'default',
      shareInfo: {
        from: 'host',
        scope: ['default'],
        shareConfig: {
          requiredVersion: '^19.0.0',
          singleton: true,
          strictVersion: false,
        },
        strategy: 'version-first',
        version: '19.0.0',
      },
      shareScopeMap: {
        default: {
          react: {
            '18.2.0': selectedShared,
          },
        },
      },
      version: '18.2.0',
    });

    expect(result.resolver()?.shared).toBe(selectedShared);
    const debugInfo = getFederationDebugInfo();
    expect(debugInfo.runtime.sharedResolutionGraph.at(-1)).toMatchObject({
      pkgName: 'react',
      requestedVersion: '^19.0.0',
      selected: expect.objectContaining({
        provider: 'remoteApp',
        version: '18.2.0',
      }),
      status: 'resolved',
      strategy: 'version-first',
      versionSatisfied: false,
    });
    expect(debugInfo.diagnostics.recentEvents.at(-1)).toMatchObject({
      code: 'MFV-003',
      level: 'warn',
    });

    warnSpy.mockRestore();
  });

  it('records rejected singleton candidates for shared conflicts', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createFederationInstance({
      name: 'host',
      remotes: [],
      shared: {},
      plugins: [],
      inBrowser: false,
    });
    const initOptions = initMock.mock.calls.at(-1)?.[0];
    const diagnosticsPlugin = initOptions.plugins.find(
      (plugin: { name: string }) => plugin.name === 'vite-plugin-federation:shared-diagnostics',
    );
    const selectedShared = {
      from: 'host',
      loaded: true,
      scope: ['default'],
      shareConfig: {
        requiredVersion: '^19.0.0',
        singleton: true,
      },
      strategy: 'loaded-first',
      useIn: ['host'],
      version: '19.0.0',
    };
    const rejectedShared = {
      from: 'remoteApp',
      loaded: true,
      scope: ['default'],
      shareConfig: {
        requiredVersion: '^18.0.0',
        singleton: true,
      },
      strategy: 'loaded-first',
      useIn: [],
      version: '18.2.0',
    };

    diagnosticsPlugin.resolveShare({
      pkgName: 'react',
      resolver: () => ({
        shared: selectedShared,
        useTreesShaking: false,
      }),
      scope: 'default',
      shareInfo: {
        from: 'host',
        scope: ['default'],
        shareConfig: {
          requiredVersion: '^19.0.0',
          singleton: true,
        },
        strategy: 'loaded-first',
        version: '19.0.0',
      },
      shareScopeMap: {
        default: {
          react: {
            '18.2.0': rejectedShared,
            '19.0.0': selectedShared,
          },
        },
      },
      version: '19.0.0',
    });

    const debugInfo = getFederationDebugInfo();
    expect(debugInfo.runtime.sharedResolutionGraph.at(-1)).toMatchObject({
      pkgName: 'react',
      rejected: [expect.objectContaining({ provider: 'remoteApp', version: '18.2.0' })],
      selected: expect.objectContaining({ provider: 'host', version: '19.0.0' }),
      singleton: true,
      status: 'resolved',
      strategy: 'loaded-first',
      versionSatisfied: true,
    });
    expect(debugInfo.diagnostics.recentEvents.at(-1)).toMatchObject({
      code: 'MFV-003',
      level: 'warn',
    });

    warnSpy.mockRestore();
  });

  it('throws on singleton conflicts when strictSingleton is enabled', () => {
    createFederationInstance({
      name: 'host',
      remotes: [],
      shared: {},
      plugins: [],
      inBrowser: false,
    });
    const initOptions = initMock.mock.calls.at(-1)?.[0];
    const diagnosticsPlugin = initOptions.plugins.find(
      (plugin: { name: string }) => plugin.name === 'vite-plugin-federation:shared-diagnostics',
    );
    const selectedShared = {
      from: 'host',
      loaded: true,
      scope: ['default'],
      shareConfig: {
        requiredVersion: '^19.0.0',
        singleton: true,
        strictSingleton: true,
      },
      strategy: 'loaded-first',
      useIn: ['host'],
      version: '19.0.0',
    };
    const rejectedShared = {
      from: 'remoteApp',
      loaded: true,
      scope: ['default'],
      shareConfig: {
        requiredVersion: '^18.0.0',
        singleton: true,
      },
      strategy: 'loaded-first',
      useIn: [],
      version: '18.2.0',
    };

    expect(() =>
      diagnosticsPlugin.resolveShare({
        pkgName: 'react',
        resolver: () => ({
          shared: selectedShared,
          useTreesShaking: false,
        }),
        scope: 'default',
        shareInfo: {
          from: 'host',
          scope: ['default'],
          shareConfig: {
            requiredVersion: '^19.0.0',
            singleton: true,
            strictSingleton: true,
          },
          strategy: 'loaded-first',
          version: '19.0.0',
        },
        shareScopeMap: {
          default: {
            react: {
              '18.2.0': rejectedShared,
              '19.0.0': selectedShared,
            },
          },
        },
        version: '19.0.0',
      }),
    ).toThrow('Shared singleton "react" selected version "19.0.0" and rejected 18.2.0');

    const debugInfo = getFederationDebugInfo();
    expect(debugInfo.runtime.sharedResolutionGraph.at(-1)).toMatchObject({
      pkgName: 'react',
      singleton: true,
      strictSingleton: true,
      status: 'resolved',
    });
    expect(debugInfo.diagnostics.recentEvents.at(-1)).toMatchObject({
      code: 'MFV-003',
      level: 'error',
    });
  });

  it('records shared resolution graph entries for async shared loads', async () => {
    getInstanceMock.mockReturnValue({
      name: 'host',
      options: {
        name: 'host',
        shared: {
          react: [
            {
              from: 'host',
              scope: ['default'],
              shareConfig: {
                requiredVersion: '^19.0.0',
                singleton: true,
                strictVersion: true,
              },
              strategy: 'loaded-first',
              useIn: ['host'],
              version: '19.0.0',
            },
          ],
        },
      },
      shareScopeMap: {
        default: {
          react: {
            '19.0.0': {
              from: 'host',
              loaded: true,
              scope: ['default'],
              sourcePath: '/repo/node_modules/react/index.js',
              shareConfig: {
                requiredVersion: '^19.0.0',
                resolvedImportSource: 'virtual:prebuild:react',
                singleton: true,
                strictVersion: true,
              },
              strategy: 'loaded-first',
              useIn: ['host'],
              version: '19.0.0',
            },
          },
        },
      },
    });
    loadShareMock.mockResolvedValueOnce(() => ({ default: 'react' }));

    await loadShare('react' as any);

    expect(loadShareMock).toHaveBeenCalledWith('react');
    expect(getFederationDebugInfo().runtime.sharedResolutionGraph.at(-1)).toMatchObject({
      fallbackSource: 'runtime-share',
      matchType: 'exact',
      pkgName: 'react',
      requestedVersion: '^19.0.0',
      selected: expect.objectContaining({
        from: 'host',
        resolvedImportSource: 'virtual:prebuild:react',
        sourcePath: '/repo/node_modules/react/index.js',
        version: '19.0.0',
      }),
      singleton: true,
      status: 'loaded',
      strictVersion: true,
    });
  });

  it('records package-root shared matches for vue subpath consumers', async () => {
    getInstanceMock.mockReturnValue({
      name: 'host',
      options: {
        name: 'host',
        shared: {
          vue: [
            {
              from: 'host',
              scope: ['default'],
              shareConfig: {
                requiredVersion: '^3.5.0',
                resolvedImportSource: 'virtual:prebuild:vue',
                singleton: true,
              },
              strategy: 'loaded-first',
              useIn: ['host'],
              version: '3.5.0',
            },
          ],
        },
      },
      shareScopeMap: {
        default: {
          vue: {
            '3.5.0': {
              from: 'host',
              loaded: true,
              scope: ['default'],
              sourcePath: '/repo/node_modules/vue/index.js',
              shareConfig: {
                requiredVersion: '^3.5.0',
                resolvedImportSource: 'virtual:prebuild:vue',
                singleton: true,
              },
              strategy: 'loaded-first',
              useIn: ['host'],
              version: '3.5.0',
            },
          },
        },
      },
    });
    loadShareMock.mockResolvedValueOnce(() => ({ default: 'runtime-dom' }));

    await loadShare('vue/runtime-dom' as any);

    expect(getFederationDebugInfo().runtime.sharedResolutionGraph.at(-1)).toMatchObject({
      matchType: 'package-root',
      pkgName: 'vue/runtime-dom',
      requestedResolvedImportSource: 'virtual:prebuild:vue',
      requestedVersion: '^3.5.0',
      selected: expect.objectContaining({
        provider: 'host',
        version: '3.5.0',
      }),
      status: 'loaded',
    });
  });

  it('records trailing-slash shared matches for workspace subpath consumers', async () => {
    getInstanceMock.mockReturnValue({
      name: 'host',
      options: {
        name: 'host',
        shared: {
          '@workspace/ui/': [
            {
              from: 'host',
              scope: ['default'],
              shareConfig: {
                requiredVersion: '^1.0.0',
                resolvedImportSource: '/repo/packages/ui/src/index.ts',
                singleton: true,
              },
              strategy: 'loaded-first',
              useIn: ['host'],
              version: '1.0.0',
            },
          ],
        },
      },
      shareScopeMap: {
        default: {
          '@workspace/ui': {
            '1.0.0': {
              from: 'host',
              loaded: true,
              scope: ['default'],
              sourcePath: '/repo/packages/ui/src/index.ts',
              shareConfig: {
                requiredVersion: '^1.0.0',
                resolvedImportSource: '/repo/packages/ui/src/index.ts',
                singleton: true,
              },
              strategy: 'loaded-first',
              useIn: ['host'],
              version: '1.0.0',
            },
          },
        },
      },
    });
    loadShareMock.mockResolvedValueOnce(() => ({ default: 'workspace-ui' }));

    await loadShare('@workspace/ui/button' as any);

    expect(getFederationDebugInfo().runtime.sharedResolutionGraph.at(-1)).toMatchObject({
      matchType: 'trailing-slash-subpath',
      pkgName: '@workspace/ui/button',
      requestedResolvedImportSource: '/repo/packages/ui/src/index.ts',
      requestedVersion: '^1.0.0',
      selected: expect.objectContaining({
        provider: 'host',
        version: '1.0.0',
      }),
      status: 'loaded',
    });
  });

  it('records node_modules suffix shared matches for pnpm-resolved subpaths', async () => {
    getInstanceMock.mockReturnValue({
      name: 'host',
      options: {
        name: 'host',
        shared: {
          '@workspace/ui/': [
            {
              from: 'host',
              scope: ['default'],
              shareConfig: {
                allowNodeModulesSuffixMatch: true,
                requiredVersion: '^1.0.0',
                resolvedImportSource: '/repo/packages/ui/src/index.ts',
                singleton: true,
              },
              strategy: 'loaded-first',
              useIn: ['host'],
              version: '1.0.0',
            },
          ],
        },
      },
      shareScopeMap: {
        default: {
          '@workspace/ui': {
            '1.0.0': {
              from: 'host',
              loaded: true,
              scope: ['default'],
              sourcePath: '/repo/packages/ui/src/index.ts',
              shareConfig: {
                allowNodeModulesSuffixMatch: true,
                requiredVersion: '^1.0.0',
                resolvedImportSource: '/repo/packages/ui/src/index.ts',
                singleton: true,
              },
              strategy: 'loaded-first',
              useIn: ['host'],
              version: '1.0.0',
            },
          },
        },
      },
    });
    loadShareMock.mockResolvedValueOnce(() => ({ default: 'workspace-ui' }));

    await loadShare(
      '/repo/node_modules/.pnpm/@workspace+ui@1.0.0/node_modules/@workspace/ui/button/index.mjs' as any,
    );

    expect(getFederationDebugInfo().runtime.sharedResolutionGraph.at(-1)).toMatchObject({
      matchType: 'node-modules-suffix',
      pkgName:
        '/repo/node_modules/.pnpm/@workspace+ui@1.0.0/node_modules/@workspace/ui/button/index.mjs',
      requestedResolvedImportSource: '/repo/packages/ui/src/index.ts',
      requestedVersion: '^1.0.0',
      selected: expect.objectContaining({
        provider: 'host',
        version: '1.0.0',
      }),
      status: 'loaded',
    });
  });

  it('records MFV-003 diagnostics when shared resolution falls back locally', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getInstanceMock.mockReturnValue({
      name: 'host',
      options: {
        name: 'host',
        shared: {
          vue: [
            {
              scope: ['default'],
              shareConfig: {
                requiredVersion: '^3.5.0',
              },
              version: '3.5.0',
            },
          ],
        },
      },
      shareScopeMap: {
        default: {},
      },
    });
    loadShareMock.mockResolvedValueOnce(false);

    await loadShare(
      'vue' as any,
      {
        customShareInfo: {
          sourcePath: '/repo/node_modules/vue/index.js',
          shareConfig: {
            requiredVersion: '^3.5.0',
            resolvedImportSource: 'virtual:prebuild:vue',
          },
        },
      } as any,
    );

    const debugInfo = getFederationDebugInfo();
    expect(debugInfo.runtime.sharedResolutionGraph.at(-1)).toMatchObject({
      fallbackSource: 'local-fallback',
      pkgName: 'vue',
      requestedResolvedImportSource: 'virtual:prebuild:vue',
      requestedSourcePath: '/repo/node_modules/vue/index.js',
      status: 'fallback',
    });
    expect(debugInfo.diagnostics.recentEvents.at(-1)).toMatchObject({
      code: 'MFV-003',
      level: 'warn',
    });

    warnSpy.mockRestore();
  });

  it('records shared resolution graph entries for sync shared loads', () => {
    getInstanceMock.mockReturnValue({
      name: 'host',
      options: {
        name: 'host',
        shared: {
          pinia: [
            {
              from: 'host',
              scope: ['default'],
              shareConfig: {
                requiredVersion: '^3.0.0',
              },
              useIn: ['host'],
              version: '3.0.0',
            },
          ],
        },
      },
      shareScopeMap: {
        default: {
          pinia: {
            '3.0.0': {
              from: 'host',
              loaded: true,
              scope: ['default'],
              shareConfig: {
                requiredVersion: '^3.0.0',
              },
              useIn: ['host'],
              version: '3.0.0',
            },
          },
        },
      },
    });
    loadShareSyncMock.mockReturnValueOnce(() => ({ default: 'pinia' }));

    loadShareSync('pinia' as any);

    expect(getFederationDebugInfo().runtime.sharedResolutionGraph.at(-1)).toMatchObject({
      pkgName: 'pinia',
      selected: expect.objectContaining({
        version: '3.0.0',
      }),
      status: 'sync-loaded',
    });
  });

  it('classifies import:false host-only provider errors as host-only fallbacks', async () => {
    loadShareMock.mockRejectedValueOnce(
      new Error(
        '[Module Federation] Shared module "host-only-dep" must be provided by the host because import: false is configured. requiredVersion=^1.2.3, strictVersion=true',
      ),
    );

    await expect(
      loadShare(
        'host-only-dep' as any,
        {
          customShareInfo: {
            shareConfig: {
              import: false,
              requiredVersion: '^1.2.3',
              singleton: true,
              strictVersion: true,
            },
          },
        } as any,
      ),
    ).rejects.toThrow('must be provided by the host because import: false is configured');

    expect(getFederationDebugInfo().runtime.sharedResolutionGraph.at(-1)).toMatchObject({
      fallbackSource: 'host-only',
      pkgName: 'host-only-dep',
      requestedVersion: '^1.2.3',
      status: 'fallback',
      strictVersion: true,
    });
  });

  it('refreshes registered runtime remotes with force enabled', async () => {
    getInstanceMock.mockReturnValue({
      name: 'host',
      options: {
        name: 'host',
        remotes: [{ name: 'remoteApp', entry: 'http://localhost/remoteEntry.js', type: 'module' }],
      },
    });

    await refreshRemote('remoteApp/Button', { target: 'web' });

    expect(registerRemotesMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          name: 'remoteApp',
          entry: expect.stringMatching(/^http:\/\/localhost\/remoteEntry\.js\?t=\d+$/),
          type: 'module',
        }),
      ],
      { force: true },
    );
  });

  it('refreshes manifest-style runtime remotes via manifest registration', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'reactRemote',
        metaData: {
          globalName: 'reactRemote',
          remoteEntry: {
            name: 'remoteEntry.js',
            path: '',
            type: 'module',
          },
        },
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);
    getInstanceMock.mockReturnValue({
      name: 'host',
      options: {
        name: 'host',
        remotes: [
          {
            name: 'reactRemote',
            entry: 'http://remote.example/mf-manifest.json',
            type: 'var',
            shareScope: 'default',
          },
        ],
      },
    });

    await refreshRemote('reactRemote/Card', { target: 'web' });

    expect(fetchMock).toHaveBeenCalledWith('http://remote.example/mf-manifest.json', undefined);
    expect(registerRemotesMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          entry: expect.stringMatching(/^http:\/\/remote\.example\/remoteEntry\.js\?t=\d+$/),
          name: 'reactRemote',
          type: 'module',
        }),
      ],
      { force: true },
    );
  });

  it('silently replaces runtime remotes when internal removeRemote is available', async () => {
    getInstanceMock.mockReturnValue({
      name: 'host',
      options: {
        name: 'host',
        remotes: [{ name: 'remoteApp', entry: 'http://localhost/remoteEntry.js', type: 'module' }],
      },
      remoteHandler: {
        removeRemote: removeRemoteMock,
      },
    });

    await refreshRemote('remoteApp/Button', { target: 'web' });

    expect(removeRemoteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'remoteApp',
        entry: 'http://localhost/remoteEntry.js',
      }),
    );
    expect(registerRemotesMock).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'remoteApp',
        entry: expect.stringMatching(/^http:\/\/localhost\/remoteEntry\.js\?t=\d+$/),
        type: 'module',
      }),
    ]);
    expect(registerRemotesMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ force: true }),
    );
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
      }),
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
      (plugin: { name: string }) => plugin.name === 'vite-plugin-federation:node-entry-loader',
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
        },
      );
    });

    vi.stubGlobal('fetch', fetchMock);

    const namespace = await normalizerPlugin.loadEntry({
      remoteInfo: {
        entry: 'http://127.0.0.1:4175/@fs/runtime/index.js?mf_target=node',
        type: 'module',
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4175/@fs/runtime/index.js?mf_target=node',
    );
    expect(
      fetchMock.mock.calls.some(([url]) => url === 'http://127.0.0.1:4175/dep.js?mf_target=node'),
    ).toBe(true);
    expect(namespace).toBeTruthy();
  });

  it('reports actionable diagnostics when node entry loading fails', async () => {
    createServerFederationInstance({
      name: 'server-host',
      remotes: [],
      shared: {},
      plugins: [],
      inBrowser: true,
    });

    const initOptions = initMock.mock.calls.at(-1)?.[0];
    const normalizerPlugin = initOptions.plugins.find(
      (plugin: { name: string }) => plugin.name === 'vite-plugin-federation:node-entry-loader',
    );
    const fetchMock = vi.fn(async () => new Response('missing', { status: 404 }));

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      normalizerPlugin.loadEntry({
        remoteInfo: {
          entry: 'http://127.0.0.1:4175/remoteEntry.ssr.js?mf_target=node',
          type: 'module',
        },
      }),
    ).rejects.toMatchObject({
      code: 'MFV-004',
      message: expect.stringContaining('Failed to load node federation entry'),
    });
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

  it('isolates manifest caches and debug snapshots by runtime key', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'tenantRemoteA',
          metaData: {
            remoteEntry: {
              name: 'remoteEntry.js',
              path: '',
              type: 'module',
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'tenantRemoteB',
          metaData: {
            remoteEntry: {
              name: 'remoteEntry.js',
              path: '',
              type: 'module',
            },
          },
        }),
      });
    const manifestUrl = 'http://remote.example/mf-manifest.json';
    const tenantA = createFederationRuntimeScope('tenant-a');
    const tenantB = createFederationRuntimeScope('tenant-b');

    vi.stubGlobal('fetch', fetchMock);

    await tenantA.fetchFederationManifest(manifestUrl, { cacheTtl: 10_000 });
    await tenantB.fetchFederationManifest(manifestUrl, { cacheTtl: 10_000 });
    await tenantA.fetchFederationManifest(manifestUrl, { cacheTtl: 10_000 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getFederationDebugInfo().runtime.manifestCache).toEqual([
      expect.objectContaining({
        manifestUrl,
        name: 'tenantRemoteA',
        runtimeKey: 'tenant-a',
      }),
      expect.objectContaining({
        manifestUrl,
        name: 'tenantRemoteB',
        runtimeKey: 'tenant-b',
      }),
    ]);
    expect(tenantA.getFederationDebugInfo().runtime.manifestCache).toEqual([
      expect.objectContaining({
        name: 'tenantRemoteA',
        runtimeKey: 'tenant-a',
      }),
    ]);
    expect(tenantB.getFederationDebugInfo().runtime.manifestCache).toEqual([
      expect.objectContaining({
        name: 'tenantRemoteB',
        runtimeKey: 'tenant-b',
      }),
    ]);
  });

  it('retries retriable manifest fetch failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
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
      });

    vi.stubGlobal('fetch', fetchMock);

    const manifest = await fetchFederationManifest('http://remote.example/mf-manifest.json', {
      retries: 1,
      retryDelay: 0,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(manifest.name).toBe('remoteApp');
    expect(getFederationDebugInfo().runtime.manifestFetches.map((entry) => entry.status)).toEqual([
      'retry',
      'success',
    ]);
  });

  it('does not retry non-retriable manifest fetch failures', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    }));

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchFederationManifest('http://remote.example/mf-manifest.json', {
        retries: 3,
        retryDelay: 0,
      }),
    ).rejects.toThrow('status 404');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getFederationDebugInfo().runtime.manifestFetches.at(-1)).toMatchObject({
      status: 'failure',
      statusCode: 404,
    });
  });

  it('falls back across manifest URLs and resolves assets from the winning origin', async () => {
    const primaryManifestUrl = 'https://primary.example/mf-manifest.json';
    const fallbackManifestUrl = 'https://fallback.example/mf-manifest.json';
    const fetchMock = vi.fn(async (url: string) => {
      if (url === primaryManifestUrl) {
        return {
          ok: false,
          status: 503,
          json: async () => ({}),
        };
      }

      return {
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
      };
    });

    vi.stubGlobal('fetch', fetchMock);

    await registerManifestRemote('remoteApp', primaryManifestUrl, {
      fallbackUrls: [fallbackManifestUrl],
      target: 'web',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(registerRemotesMock).toHaveBeenCalledWith([
      expect.objectContaining({
        entry: 'https://fallback.example/remoteEntry.js',
      }),
    ]);
    expect(getFederationDebugInfo().runtime.manifestCache[0]).toMatchObject({
      manifestUrl: primaryManifestUrl,
      sourceUrl: fallbackManifestUrl,
    });
    expect(getFederationDebugInfo().runtime.registeredManifestRemotes[0]).toMatchObject({
      manifestUrl: primaryManifestUrl,
      sourceUrl: fallbackManifestUrl,
    });
  });

  it('serves stale manifests while revalidating expired cache entries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const manifestUrl = 'https://remote.example/mf-manifest.json';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'remoteV1',
          metaData: {
            remoteEntry: {
              name: 'remoteEntry.js',
              type: 'module',
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'remoteV2',
          metaData: {
            remoteEntry: {
              name: 'remoteEntry.js',
              type: 'module',
            },
          },
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const fresh = await fetchFederationManifest(manifestUrl, { cacheTtl: 1000 });
    expect(fresh.name).toBe('remoteV1');

    vi.setSystemTime(new Date('2026-01-01T00:00:02.000Z'));
    const stale = await fetchFederationManifest(manifestUrl, {
      cacheTtl: 1000,
      staleWhileRevalidate: true,
    });
    expect(stale.name).toBe('remoteV1');

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const refreshed = await fetchFederationManifest(manifestUrl, { cacheTtl: 1000 });
    expect(refreshed.name).toBe('remoteV2');
    const cachedAgain = await fetchFederationManifest(manifestUrl, { cacheTtl: 1000 });
    expect(cachedAgain.name).toBe('remoteV2');
    expect(getFederationDebugInfo().runtime.manifestFetches.map((entry) => entry.status)).toEqual([
      'success',
      'stale-cache-hit',
      'success',
      'cache-hit',
    ]);
  });

  it('opens a manifest circuit breaker after repeated failures', async () => {
    const manifestUrl = 'https://remote.example/mf-manifest.json';
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchFederationManifest(manifestUrl, {
        circuitBreaker: {
          cooldownMs: 10_000,
          failureThreshold: 1,
        },
      }),
    ).rejects.toThrow('status 503');

    await expect(
      fetchFederationManifest(manifestUrl, {
        circuitBreaker: {
          cooldownMs: 10_000,
          failureThreshold: 1,
        },
      }),
    ).rejects.toThrow('Manifest circuit breaker is open');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getFederationDebugInfo().runtime.manifestCircuitBreakers[0]).toMatchObject({
      failureCount: 1,
      manifestUrl,
      state: 'open',
    });
    expect(getFederationDebugInfo().runtime.manifestFetches.at(-1)).toMatchObject({
      status: 'circuit-open',
    });
  });

  it('accepts legacy and same-major manifest schema versions', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'legacyRemote',
          metaData: {},
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'futureMinorRemote',
          schemaVersion: '1.1.0',
          metaData: {},
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchFederationManifest('http://remote.example/legacy-mf-manifest.json'),
    ).resolves.toMatchObject({
      name: 'legacyRemote',
    });
    await expect(
      fetchFederationManifest('http://remote.example/future-minor-mf-manifest.json'),
    ).resolves.toMatchObject({
      name: 'futureMinorRemote',
      schemaVersion: '1.1.0',
    });
  });

  it('rejects unsupported manifest schema major versions', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'remoteApp',
        schemaVersion: '2.0.0',
        metaData: {},
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchFederationManifest('http://remote.example/mf-manifest.json')).rejects.toThrow(
      'unsupported schemaVersion "2.0.0"',
    );
  });

  it('rejects invalid manifest schema version types', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'remoteApp',
        schemaVersion: 1,
        metaData: {},
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchFederationManifest('http://remote.example/mf-manifest.json')).rejects.toThrow(
      'unsupported schemaVersion 1',
    );
  });

  it('rejects malformed manifest entry fields during fetch validation', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'remoteApp',
        metaData: {
          remoteEntry: {
            name: 'remoteEntry.js',
            path: 42,
            type: 'module',
          },
        },
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchFederationManifest('http://remote.example/mf-manifest.json')).rejects.toThrow(
      'metaData.remoteEntry.path must be a string',
    );
  });

  it('reports missing target-specific manifest entries during registration', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'remoteApp',
        metaData: {},
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      registerManifestRemote('remoteApp', 'http://remote.example/mf-manifest.json', {
        target: 'web',
      }),
    ).rejects.toThrow('usable remoteEntry or ssrRemoteEntry fallback for target "web"');

    expect(getFederationDebugInfo().runtime.lastLoadError).toMatchObject({
      code: 'MFV-004',
      manifestUrl: 'http://remote.example/mf-manifest.json',
      remoteAlias: 'remoteApp',
      remoteId: 'remoteApp',
      target: 'web',
    });
  });

  it('times out manifest fetches even when fetch ignores abort signals', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise(() => {}));

    vi.stubGlobal('fetch', fetchMock);

    const manifestPromise = fetchFederationManifest('http://remote.example/mf-manifest.json', {
      timeout: 100,
    });
    const expectation = expect(manifestPromise).rejects.toThrow(
      'Timed out fetching federation manifest',
    );
    await vi.advanceTimersByTimeAsync(100);

    await expectation;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getFederationDebugInfo().runtime.manifestFetches.at(-1)).toMatchObject({
      status: 'failure',
    });
  });

  it('expires manifest cache entries using cacheTtl', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

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

    await fetchFederationManifest('http://remote.example/mf-manifest.json', { cacheTtl: 1000 });
    await fetchFederationManifest('http://remote.example/mf-manifest.json', { cacheTtl: 1000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-01-01T00:00:01.500Z'));
    await fetchFederationManifest('http://remote.example/mf-manifest.json', { cacheTtl: 1000 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getFederationDebugInfo().runtime.manifestCache[0]).toMatchObject({
      manifestUrl: 'http://remote.example/mf-manifest.json',
      name: 'remoteApp',
    });
  });

  it('can bypass the manifest response cache', async () => {
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

    await fetchFederationManifest('http://remote.example/mf-manifest.json', { cache: false });
    await fetchFederationManifest('http://remote.example/mf-manifest.json', { cache: false });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getFederationDebugInfo().runtime.manifestCacheKeys).toEqual([]);
  });

  it('falls back to browser remoteEntry when target=node and ssrRemoteEntry is absent', async () => {
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
        },
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);

    await registerManifestRemote('catalog', 'https://remote.example/mf-manifest.json', {
      target: 'node',
    });

    expect(registerRemotesMock).toHaveBeenCalledWith([
      expect.objectContaining({
        alias: 'catalog',
        entry: 'https://cdn.example/assets/remoteEntry.js',
        entryGlobalName: 'remote-app',
        name: 'remoteApp',
      }),
    ]);
  });

  it('rejects malformed ssrRemoteEntry before falling back for target=node', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'remoteApp',
        metaData: {
          globalName: 'remote-app',
          remoteEntry: {
            name: 'remoteEntry.js',
            path: '',
            type: 'module',
          },
          ssrRemoteEntry: {
            path: 'server',
            type: 'module',
          },
        },
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      registerManifestRemote('catalog', 'https://remote.example/mf-manifest.json', {
        target: 'node',
      }),
    ).rejects.toThrow('usable ssrRemoteEntry or remoteEntry fallback for target "node"');

    expect(getFederationDebugInfo().runtime.lastLoadError).toMatchObject({
      code: 'MFV-006',
      manifestUrl: 'https://remote.example/mf-manifest.json',
      remoteAlias: 'catalog',
      remoteId: 'catalog',
      target: 'node',
    });
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

    expect(registerRemotesMock).toHaveBeenCalledWith([
      expect.objectContaining({
        alias: 'catalog',
        entry: 'https://cdn.example/assets/server/remoteEntry.ssr.js',
        entryGlobalName: 'remote-app',
        name: 'remoteApp',
      }),
    ]);

    const debugInfo = getFederationDebugInfo();
    expect(debugInfo.runtime.registeredManifestRemotes).toEqual([
      expect.objectContaining({
        alias: 'catalog',
        target: 'node',
      }),
    ]);
  });

  it('keeps manifest and entry context on node remote load failures', async () => {
    const manifestUrl = 'https://remote.example/mf-manifest.json';
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
    const loadError = Object.assign(new Error('server entry failed'), { code: 'MFV-004' });

    vi.stubGlobal('fetch', fetchMock);
    loadRemoteMock.mockRejectedValueOnce(loadError);

    await expect(
      loadRemoteFromManifest('catalog/Button', manifestUrl, {
        target: 'node',
      }),
    ).rejects.toThrow('server entry failed');

    expect(getFederationDebugInfo().runtime.lastLoadError).toMatchObject({
      code: 'MFV-004',
      entry: 'https://cdn.example/assets/server/remoteEntry.ssr.js',
      manifestUrl,
      remoteAlias: 'catalog',
      remoteId: 'catalog/Button',
      remoteName: 'remoteApp',
      shareScope: 'default',
      target: 'node',
    });
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

    expect(registerRemotesMock).toHaveBeenCalledWith([
      expect.objectContaining({
        entry: 'http://localhost:4174/assets/remoteEntry.js',
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

  it('tracks same remote aliases separately across runtime keys and share scopes', async () => {
    const manifestUrl = 'http://remote.example/mf-manifest.json';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'catalog',
        metaData: {
          globalName: 'catalog',
          remoteEntry: {
            name: 'remoteEntry.js',
            path: '',
            type: 'module',
          },
        },
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);

    await registerManifestRemote('catalog', manifestUrl, {
      runtimeKey: 'tenant-a',
      shareScope: 'tenant-a',
      target: 'web',
    });
    await registerManifestRemote('catalog', manifestUrl, {
      runtimeKey: 'tenant-b',
      shareScope: 'tenant-b',
      target: 'web',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getFederationDebugInfo().runtime.registeredManifestRemotes).toEqual([
      expect.objectContaining({
        alias: 'catalog',
        runtimeKey: 'tenant-a',
        shareScope: 'tenant-a',
      }),
      expect.objectContaining({
        alias: 'catalog',
        runtimeKey: 'tenant-b',
        shareScope: 'tenant-b',
      }),
    ]);
  });

  it('verifies manifest remoteEntry integrity metadata when enabled', async () => {
    const assetSource = 'export const remoteValue = "verified";';
    const manifestUrl = 'http://remote.example/mf-manifest.json';
    const remoteEntryUrl = 'http://remote.example/remoteEntry.js';
    const expectedIntegrity = toSha384Integrity(assetSource);
    const fetchMock = vi.fn(async (url: string) => {
      if (url === manifestUrl) {
        return {
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
                integrity: expectedIntegrity,
              },
            },
          }),
        };
      }

      if (url === remoteEntryUrl) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => toArrayBuffer(assetSource),
        };
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    await registerManifestRemote('remoteApp', manifestUrl, {
      integrity: true,
      target: 'web',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getFederationDebugInfo().runtime.manifestIntegrityChecks).toEqual([
      expect.objectContaining({
        assetUrl: remoteEntryUrl,
        expectedIntegrity,
        manifestUrl,
        mode: 'prefer-integrity',
        status: 'success',
        target: 'web',
        verifiedWith: ['integrity'],
      }),
    ]);
  });

  it('falls back to contentHash verification when integrity metadata is absent', async () => {
    const assetSource = 'export const remoteValue = "content-hash-only";';
    const manifestUrl = 'http://remote.example/mf-manifest.json';
    const remoteEntryUrl = 'http://remote.example/remoteEntry.js';
    const expectedContentHash = toSha256ContentHash(assetSource);
    const fetchMock = vi.fn(async (url: string) => {
      if (url === manifestUrl) {
        return {
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
                contentHash: expectedContentHash,
              },
            },
          }),
        };
      }

      if (url === remoteEntryUrl) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => toArrayBuffer(assetSource),
        };
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    await registerManifestRemote('remoteApp', manifestUrl, {
      integrity: true,
      target: 'web',
    });

    expect(getFederationDebugInfo().runtime.manifestIntegrityChecks).toEqual([
      expect.objectContaining({
        actualContentHash: expectedContentHash,
        assetUrl: remoteEntryUrl,
        expectedContentHash,
        manifestUrl,
        mode: 'prefer-integrity',
        status: 'success',
        target: 'web',
        verifiedWith: ['contentHash'],
      }),
    ]);
  });

  it('rejects manifest remote entries when runtime integrity verification fails', async () => {
    const manifestUrl = 'http://remote.example/mf-manifest.json';
    const remoteEntryUrl = 'http://remote.example/remoteEntry.js';
    const fetchMock = vi.fn(async (url: string) => {
      if (url === manifestUrl) {
        return {
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
                integrity: toSha384Integrity('expected-source'),
              },
            },
          }),
        };
      }

      if (url === remoteEntryUrl) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => toArrayBuffer('tampered-source'),
        };
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      registerManifestRemote('remoteApp', manifestUrl, {
        integrity: true,
        target: 'web',
      }),
    ).rejects.toThrow('failed integrity verification');

    expect(registerRemotesMock).not.toHaveBeenCalled();
    expect(getFederationDebugInfo().runtime.manifestIntegrityChecks).toEqual([
      expect.objectContaining({
        assetUrl: remoteEntryUrl,
        manifestUrl,
        mode: 'prefer-integrity',
        status: 'failure',
        target: 'web',
        verifiedWith: ['integrity'],
      }),
    ]);
  });

  it('verifies annotated manifest-declared expose and preload assets', async () => {
    const buttonSource = 'export const Button = "verified";';
    const preloadSource = 'export const shared = "verified";';
    const manifestUrl = 'http://remote.example/mf-manifest.json';
    const manifest = {
      name: 'remoteApp',
      metaData: {},
      preload: {
        assets: {
          js: [
            {
              name: 'shared.js',
              path: 'assets',
              contentHash: toSha256ContentHash(preloadSource),
            },
          ],
        },
      },
      exposes: [
        {
          name: 'Button',
          path: './Button',
          assets: {
            css: {
              sync: ['Button.css'],
            },
            js: {
              sync: [
                {
                  name: 'Button.js',
                  path: 'assets',
                  integrity: toSha384Integrity(buttonSource),
                },
              ],
            },
          },
        },
      ],
    } as any;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'http://remote.example/assets/Button.js') {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => toArrayBuffer(buttonSource),
        };
      }

      if (url === 'http://remote.example/assets/shared.js') {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => toArrayBuffer(preloadSource),
        };
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(verifyFederationManifestAssets(manifestUrl, manifest)).resolves.toEqual({
      checked: 2,
      skipped: 1,
      verifiedAssets: [
        'http://remote.example/assets/Button.js',
        'http://remote.example/assets/shared.js',
      ],
    });
    expect(getFederationDebugInfo().runtime.manifestIntegrityChecks).toEqual([
      expect.objectContaining({
        assetUrl: 'http://remote.example/assets/Button.js',
        status: 'success',
        verifiedWith: ['integrity'],
      }),
      expect.objectContaining({
        assetUrl: 'http://remote.example/assets/shared.js',
        status: 'success',
        verifiedWith: ['contentHash'],
      }),
    ]);
  });

  it('requires manifest asset integrity metadata when configured', async () => {
    await expect(
      verifyFederationManifestAssets(
        'http://remote.example/mf-manifest.json',
        {
          name: 'remoteApp',
          metaData: {},
          exposes: [
            {
              name: 'Button',
              path: './Button',
              assets: {
                css: {
                  sync: ['Button.css'],
                },
                js: {
                  sync: [],
                },
              },
            },
          ],
        } as any,
        {
          requireIntegrity: true,
        },
      ),
    ).rejects.toThrow('does not declare integrity metadata');
  });

  it('refreshes registered manifest remotes and invalidates the manifest cache', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'catalog',
          metaData: {
            globalName: 'catalog',
            remoteEntry: {
              name: 'remoteEntry.js',
              path: '',
              type: 'module',
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'catalog',
          metaData: {
            globalName: 'catalog',
            remoteEntry: {
              name: 'remoteEntry.js',
              path: '',
              type: 'module',
            },
          },
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    await registerManifestRemote('catalog', 'http://remote.example/mf-manifest.json', {
      target: 'web',
    });
    await refreshRemote('catalog/Button', {
      invalidateManifest: true,
      target: 'web',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(registerRemotesMock).toHaveBeenNthCalledWith(
      2,
      [
        expect.objectContaining({
          entry: expect.stringMatching(/^http:\/\/remote\.example\/remoteEntry\.js\?t=\d+$/),
          name: 'catalog',
        }),
      ],
      { force: true },
    );
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
      'http://remote.example/mf-manifest.json',
    );

    expect(registerRemotesMock).toHaveBeenCalledTimes(1);
    expect(loadRemoteMock).toHaveBeenCalledWith('remoteApp/Button', { from: 'runtime' });
    expect(result).toEqual({ default: 'button' });
  });

  it('records remote load metrics with manifest registration context', async () => {
    const manifestUrl = 'http://remote.example/mf-manifest.json';
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

    await loadRemoteFromManifest('remoteApp/Button', manifestUrl, {
      target: 'web',
    });

    expect(getFederationDebugInfo().runtime.remoteLoadMetrics).toEqual([
      expect.objectContaining({
        entry: 'http://remote.example/remoteEntry.js',
        loadDurationMs: expect.any(Number),
        manifestUrl,
        phase: 'load',
        registrationDurationMs: expect.any(Number),
        remoteAlias: 'remoteApp',
        remoteId: 'remoteApp/Button',
        remoteName: 'remoteApp',
        shareScope: 'default',
        sourceUrl: manifestUrl,
        status: 'success',
        target: 'web',
      }),
    ]);
  });

  it('warms selected manifest remotes through registration and runtime preload', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'catalog',
        metaData: {
          globalName: 'catalog',
          remoteEntry: {
            name: 'remoteEntry.js',
            path: '',
            type: 'module',
          },
        },
      }),
    }));

    vi.stubGlobal('fetch', fetchMock);

    await warmFederationRemotes({
      catalog: {
        manifestUrl: 'http://remote.example/mf-manifest.json',
        preload: {
          resourceCategory: 'sync',
        },
        target: 'web',
      },
    });

    expect(registerRemotesMock).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'catalog',
      }),
    ]);
    expect(preloadRemoteMock).toHaveBeenCalledWith([
      {
        nameOrAlias: 'catalog',
        resourceCategory: 'sync',
      },
    ]);
  });

  it('emits runtime hooks and telemetry around manifest remote loading', async () => {
    const manifestUrl = 'http://remote.example/mf-manifest.json';
    const events: string[] = [];
    const telemetry = vi.fn((event) => {
      events.push(`${event.kind}:${event.stage}`);
    });
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

    await loadRemoteFromManifest('remoteApp/Button', manifestUrl, {
      hooks: {
        telemetry,
      },
    });

    expect(events).toEqual([
      'remote-register:before',
      'manifest-fetch:before',
      'manifest-fetch:after',
      'remote-register:after',
      'remote-load:before',
      'remote-load:after',
    ]);
    expect(telemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMs: expect.any(Number),
        kind: 'remote-load',
        stage: 'after',
        status: 'success',
      }),
    );
  });

  it('resolves expose assets from federation manifests', () => {
    const manifest = {
      name: 'remoteApp',
      metaData: {
        publicPath: 'https://cdn.example/assets/',
      },
      exposes: [
        {
          name: 'Button',
          path: './Button',
          assets: {
            css: {
              sync: ['Button.css'],
              async: ['Button.async.css'],
            },
            js: {
              sync: ['Button.js'],
              async: ['Button.async.js'],
            },
          },
        },
      ],
    } as any;

    expect(findFederationManifestExpose(manifest, 'Button')).toMatchObject({
      path: './Button',
    });

    expect(
      collectFederationManifestExposeAssets(
        'https://remote.example/mf-manifest.json',
        manifest,
        './Button',
      ),
    ).toMatchObject({
      css: {
        all: [
          'https://cdn.example/assets/Button.css',
          'https://cdn.example/assets/Button.async.css',
        ],
        async: ['https://cdn.example/assets/Button.async.css'],
        sync: ['https://cdn.example/assets/Button.css'],
      },
      js: {
        all: ['https://cdn.example/assets/Button.js', 'https://cdn.example/assets/Button.async.js'],
        async: ['https://cdn.example/assets/Button.async.js'],
        sync: ['https://cdn.example/assets/Button.js'],
      },
    });
  });

  it('collects SSR-oriented preload links from federation manifests', () => {
    const manifest = {
      name: 'remoteApp',
      metaData: {
        publicPath: 'https://cdn.example/assets/',
      },
      exposes: [
        {
          name: 'Button',
          path: './Button',
          assets: {
            css: {
              sync: ['shared.css', 'Button.css'],
              async: ['Button.async.css'],
            },
            js: {
              sync: ['Button.js'],
              async: ['Button.async.js'],
            },
          },
        },
        {
          name: 'Card',
          path: './Card',
          assets: {
            css: {
              sync: ['shared.css'],
            },
            js: {
              sync: ['Card.js'],
            },
          },
        },
      ],
    } as any;

    expect(
      collectFederationManifestPreloadLinks('https://remote.example/mf-manifest.json', manifest, [
        './Button',
        './Card',
      ]),
    ).toEqual([
      {
        assetType: 'css',
        expose: manifest.exposes[0],
        exposePath: './Button',
        href: 'https://cdn.example/assets/shared.css',
        loading: 'sync',
        rel: 'stylesheet',
      },
      {
        assetType: 'css',
        expose: manifest.exposes[0],
        exposePath: './Button',
        href: 'https://cdn.example/assets/Button.css',
        loading: 'sync',
        rel: 'stylesheet',
      },
      {
        assetType: 'css',
        expose: manifest.exposes[0],
        exposePath: './Button',
        href: 'https://cdn.example/assets/Button.async.css',
        loading: 'async',
        rel: 'stylesheet',
      },
      {
        assetType: 'js',
        crossorigin: 'anonymous',
        expose: manifest.exposes[0],
        exposePath: './Button',
        href: 'https://cdn.example/assets/Button.js',
        loading: 'sync',
        rel: 'modulepreload',
      },
      {
        assetType: 'js',
        crossorigin: 'anonymous',
        expose: manifest.exposes[1],
        exposePath: './Card',
        href: 'https://cdn.example/assets/Card.js',
        loading: 'sync',
        rel: 'modulepreload',
      },
    ]);
  });

  it('respects manifest preload link collection options', () => {
    const manifest = {
      name: 'remoteApp',
      metaData: {},
      exposes: [
        {
          name: 'Button',
          path: './Button',
          assets: {
            css: {
              sync: ['Button.css'],
            },
            js: {
              sync: ['Button.js'],
              async: ['Button.async.js'],
            },
          },
        },
      ],
    } as any;

    expect(
      collectFederationManifestPreloadLinks(
        'https://remote.example/nested/mf-manifest.json',
        manifest,
        'Button',
        {
          crossorigin: false,
          includeAsyncJs: true,
          includeCss: false,
        },
      ),
    ).toEqual([
      {
        assetType: 'js',
        expose: manifest.exposes[0],
        exposePath: 'Button',
        href: 'https://remote.example/nested/Button.js',
        loading: 'sync',
        rel: 'modulepreload',
      },
      {
        assetType: 'js',
        expose: manifest.exposes[0],
        exposePath: 'Button',
        href: 'https://remote.example/nested/Button.async.js',
        loading: 'async',
        rel: 'modulepreload',
      },
    ]);
  });

  it('creates route-level preload plans with async chunk policy and manifest hints', () => {
    const manifest = {
      name: 'remoteApp',
      metaData: {
        publicPath: 'https://cdn.example/assets/',
      },
      preload: {
        assets: {
          js: ['runtime-shared.js'],
        },
        routes: [
          {
            route: '/checkout',
            expose: './Button',
            assets: {
              css: ['checkout-critical.css'],
            },
          },
        ],
      },
      exposes: [
        {
          name: 'Button',
          path: './Button',
          assets: {
            css: {
              sync: ['Button.css'],
              async: ['Button.async.css'],
            },
            js: {
              sync: ['Button.js'],
              async: ['Button.async.js'],
            },
          },
        },
      ],
    } as any;

    const plan = createFederationManifestPreloadPlan(
      'https://remote.example/mf-manifest.json',
      manifest,
      {
        '/checkout': './Button',
      },
      {
        asyncChunkPolicy: 'all',
      },
    );

    expect(plan).toMatchObject({
      manifestUrl: 'https://remote.example/mf-manifest.json',
      remoteName: 'remoteApp',
      routes: [
        {
          exposes: ['./Button'],
          route: '/checkout',
        },
      ],
    });
    expect(plan.links.map((link) => `${link.loading}:${link.href}`)).toEqual([
      'sync:https://cdn.example/assets/Button.css',
      'async:https://cdn.example/assets/Button.async.css',
      'sync:https://cdn.example/assets/Button.js',
      'async:https://cdn.example/assets/Button.async.js',
      'sync:https://cdn.example/assets/runtime-shared.js',
      'sync:https://cdn.example/assets/checkout-critical.css',
    ]);
  });

  it('throws a federation error when manifest expose assets are missing', () => {
    expect(() =>
      collectFederationManifestExposeAssets(
        'https://remote.example/mf-manifest.json',
        {
          name: 'remoteApp',
          metaData: {},
          exposes: [],
        },
        './Missing',
      ),
    ).toThrow('MFV-005');
  });

  it('publishes runtime debug snapshots to the devtools hook', () => {
    const dispatchEvent = vi.fn();
    class MockCustomEvent {
      constructor(
        public type: string,
        public init?: { detail?: unknown },
      ) {}
    }

    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal('CustomEvent', MockCustomEvent as any);

    registerRemotes([{ name: 'remoteApp', entry: 'http://localhost/remoteEntry.js' }] as any);

    const devtoolsHook = (globalThis as any).__VITE_PLUGIN_FEDERATION_DEVTOOLS__;
    expect(devtoolsHook.contractVersion).toBe('1.0.0');
    expect(devtoolsHook.eventLimit).toBe(50);
    expect(devtoolsHook.exportSnapshot()).toMatchObject({
      contractVersion: '1.0.0',
    });
    expect(devtoolsHook.runtime).toBeTruthy();
    expect(devtoolsHook.events.at(-1)).toMatchObject({
      event: 'register-remotes',
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0][0]).toMatchObject({
      type: 'vite-plugin-federation:debug',
    });
  });

  it('retains devtools runtime events up to the contract event limit', () => {
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    class MockCustomEvent {
      constructor(
        public type: string,
        public init?: { detail?: unknown },
      ) {}
    }
    vi.stubGlobal('CustomEvent', MockCustomEvent as any);

    for (let index = 0; index < 55; index += 1) {
      registerRemotes([
        { name: `remoteApp${index}`, entry: `http://localhost/${index}/remoteEntry.js` },
      ] as any);
    }

    const devtoolsHook = (globalThis as any).__VITE_PLUGIN_FEDERATION_DEVTOOLS__;
    expect(devtoolsHook.events).toHaveLength(50);
    expect(devtoolsHook.exportSnapshot().events).toHaveLength(50);
    expect(devtoolsHook.events[0]).toMatchObject({
      event: 'register-remotes',
    });
  });
});
