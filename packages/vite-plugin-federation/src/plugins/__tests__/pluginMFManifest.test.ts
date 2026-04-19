import { beforeEach, describe, expect, it, vi } from 'vitest';

import manifestPlugin from '../pluginMFManifest';

const {
  getNormalizeModuleFederationOptions,
  getUsedRemotesMap,
  getUsedShares,
  getNormalizeShareItem,
  getConcreteSharedImportSource,
  getInstalledPackageEntry,
  getPreBuildLibImportId,
  getSsrRemoteEntryFileName,
} = vi.hoisted(() => ({
  getNormalizeModuleFederationOptions: vi.fn(),
  getUsedRemotesMap: vi.fn(),
  getUsedShares: vi.fn(),
  getNormalizeShareItem: vi.fn(),
  getConcreteSharedImportSource: vi.fn(() => undefined),
  getInstalledPackageEntry: vi.fn(() => undefined),
  getPreBuildLibImportId: vi.fn((shareKey: string) => shareKey),
  getSsrRemoteEntryFileName: vi.fn((filename: string) => filename.replace('.js', '.ssr.js')),
}));

vi.mock('../../utils/normalizeModuleFederationOptions', () => ({
  getNormalizeModuleFederationOptions,
  getNormalizeShareItem,
}));

vi.mock('../../virtualModules', () => ({
  getConcreteSharedImportSource,
  getUsedRemotesMap,
  getUsedShares,
  getPreBuildLibImportId,
  getSsrRemoteEntryFileName,
}));

vi.mock('../../utils/packageUtils', () => ({
  getInstalledPackageEntry,
}));

const makeBundle = () => ({
  'remoteEntry.js': {
    type: 'chunk',
    fileName: 'remoteEntry.js',
    code: 'const a = 1;',
    modules: {
      '/src/exposed.js': {},
    },
  },
  'remoteEntry.ssr.js': {
    type: 'chunk',
    name: 'ssrRemoteEntry',
    fileName: 'remoteEntry.ssr.js',
    code: 'const a = 1;',
    modules: {
      '/src/exposed.js': {},
    },
  },
  'styles.css': {
    type: 'asset',
    fileName: 'styles.css',
    source: 'body {}',
  },
});

async function runGenerateBundleWithManifest(
  manifestOptions: unknown,
  runtime: {
    usedShares?: Set<string>;
    usedRemotes?: Map<string, Set<string>>;
    exposePaths?: Record<string, { import: string; css?: { inject?: string | boolean } }>;
    dts?: unknown;
    shared?: Record<string, unknown>;
    remotes?: Record<string, unknown>;
  } = {},
  command: 'serve' | 'build' = 'build'
): Promise<Record<string, string>> {
  getNormalizeModuleFederationOptions.mockReturnValue({
    name: 'basicRemote',
    filename: 'remoteEntry.js',
    getPublicPath: undefined,
    varFilename: undefined,
    manifest: manifestOptions,
    exposes: runtime.exposePaths || {},
    remotes: runtime.remotes || {},
    shared: runtime.shared || {},
    dts: runtime.dts,
    bundleAllCSS: false,
    shareStrategy: 'version-first',
    implementation: 'module-federation-runtime',
    runtimePlugins: [],
    virtualModuleDir: '__mf__virtual',
    hostInitInjectLocation: 'html',
    moduleParseTimeout: 10,
    ignoreOrigin: false,
  } as any);
  getUsedRemotesMap.mockReturnValue(runtime.usedRemotes || new Map());
  getUsedShares.mockReturnValue(runtime.usedShares || new Set());
  getNormalizeShareItem.mockImplementation((shareKey: string) => {
    const sharedConfig = (runtime.shared as Record<string, any> | undefined)?.[shareKey] || {};
    return {
      version: sharedConfig.version || '1.0.0',
      shareConfig: {
        import: sharedConfig.import,
        requiredVersion: sharedConfig.requiredVersion || '*',
        singleton: sharedConfig.singleton || false,
        strictVersion: sharedConfig.strictVersion || false,
      },
    };
  });

  const [, buildPlugin] = manifestPlugin();
  const emitted: Record<string, string> = {};

  buildPlugin.config?.({}, { command, mode: 'test' });
  buildPlugin.configResolved?.({
    root: '/',
    base: '/',
    build: {},
    server: { origin: 'http://localhost' },
  } as any);

  const ctx = {
    emitFile: vi.fn((asset: { fileName: string; source: string }) => {
      emitted[asset.fileName] = asset.source;
      return `id:${asset.fileName}`;
    }),
    resolve: vi.fn(async () => ({ id: '/node_modules/react/index.js' })),
  };

  await buildPlugin.generateBundle?.call(ctx as any, {}, makeBundle() as any);
  return emitted;
}

describe('pluginMFManifest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits manifest and mf-stats artifacts by default', async () => {
    const emitted = await runGenerateBundleWithManifest(true);

    const manifest = JSON.parse(emitted['mf-manifest.json']);
    const stats = JSON.parse(emitted['mf-stats.json']);
    const debug = JSON.parse(emitted['mf-debug.json']);

    expect(manifest).toHaveProperty('metaData');
    expect(stats).toHaveProperty('buildOutput');
    expect(debug).toHaveProperty('snapshot');
    expect(stats).toHaveProperty('diagnostics');
    expect(debug).toHaveProperty('diagnostics');
    expect(debug.metaData.pluginName).toBe('vite-plugin-federation');
    expect(debug.capabilities.debugArtifacts).toBe(true);
    expect(manifest.metaData.ssrRemoteEntry).toEqual({
      name: 'remoteEntry.ssr.js',
      path: '',
      type: 'module',
    });
    expect(manifest.metaData.types).toEqual({
      path: '',
      name: '@mf-types.zip',
      api: '@mf-types.d.ts',
    });
    expect(stats.diagnostics).toMatchObject({
      controlChunks: expect.any(Array),
      remoteAliases: expect.any(Array),
      sharedResolution: expect.any(Array),
      ssr: expect.objectContaining({
        hasSsrRemoteEntry: true,
        remoteEntryFile: 'remoteEntry.js',
        ssrRemoteEntryFile: 'remoteEntry.ssr.js',
      }),
    });
    expect(
      stats.buildOutput.find((chunk: any) => chunk.fileName === 'remoteEntry.js')
    ).toBeTruthy();
  });

  it('emits companion stats file using manifest fileName suffix', async () => {
    const emitted = await runGenerateBundleWithManifest({
      fileName: 'path/custom-manifest.json',
    } as any);

    const manifest = emitted['path/custom-manifest.json'];
    const stats = emitted['path/custom-manifest-stats.json'];
    const debug = emitted['path/mf-debug.json'];

    expect(manifest).toBeDefined();
    expect(stats).toBeDefined();
    expect(debug).toBeDefined();
  });

  it('defaults disableAssetsAnalyze to true in serve when project is consumer-only', async () => {
    const emitted = await runGenerateBundleWithManifest(
      {},
      {
        usedShares: new Set(['react']),
        usedRemotes: new Map([['remote-app', new Set(['remote-app/Button'])]]),
      },
      'serve'
    );

    const manifest = JSON.parse(emitted['mf-manifest.json']);
    const stats = JSON.parse(emitted['mf-stats.json']);

    expect(manifest).not.toHaveProperty('shared');
    expect(manifest).not.toHaveProperty('exposes');
    expect(stats).not.toHaveProperty('assetAnalysis');
  });

  it('respects explicit disableAssetsAnalyze false in serve even for consumer-only', async () => {
    const emitted = await runGenerateBundleWithManifest(
      {
        disableAssetsAnalyze: false,
      } as any,
      {
        usedShares: new Set(['react']),
        usedRemotes: new Map([['remote-app', new Set(['remote-app/Button'])]]),
      },
      'serve'
    );

    const manifest = JSON.parse(emitted['mf-manifest.json']);
    const stats = JSON.parse(emitted['mf-stats.json']);

    expect(manifest).toHaveProperty('shared');
    expect(manifest).toHaveProperty('exposes');
    expect(stats).toHaveProperty('assetAnalysis');
  });

  it('omits shared/exposes from manifest and stats when disableAssetsAnalyze is true', async () => {
    const emitted = await runGenerateBundleWithManifest(
      {
        fileName: 'disabled-manifest.json',
        disableAssetsAnalyze: true,
      } as any,
      {
        exposePaths: {
          './exposed': { import: './src/exposed.js' },
        },
        usedShares: new Set(['react']),
        usedRemotes: new Map([['remote-app', new Set(['remote-app/Button'])]]),
      }
    );

    const manifest = JSON.parse(emitted['disabled-manifest.json']);
    const stats = JSON.parse(emitted['disabled-manifest-stats.json']);

    expect(manifest).not.toHaveProperty('shared');
    expect(manifest).not.toHaveProperty('exposes');
    expect(stats).not.toHaveProperty('assetAnalysis');
  });

  it('preserves publicPath "auto" in manifest metaData', async () => {
    getNormalizeModuleFederationOptions.mockReturnValue({
      name: 'basicRemote',
      filename: 'remoteEntry.js',
      getPublicPath: undefined,
      varFilename: undefined,
      manifest: true,
      exposes: {},
      remotes: {},
      shared: {},
      publicPath: 'auto',
      bundleAllCSS: false,
      shareStrategy: 'version-first',
      implementation: 'module-federation-runtime',
      runtimePlugins: [],
      virtualModuleDir: '__mf__virtual',
      hostInitInjectLocation: 'html',
      moduleParseTimeout: 10,
      ignoreOrigin: false,
    } as any);
    getUsedRemotesMap.mockReturnValue(new Map());
    getUsedShares.mockReturnValue(new Set());

    const [, buildPlugin] = manifestPlugin();
    const emitted: Record<string, string> = {};

    buildPlugin.config?.({}, { command: 'build', mode: 'test' });
    buildPlugin.configResolved?.({
      root: '/',
      base: '/',
      build: {},
      server: { origin: 'http://localhost' },
    } as any);

    const ctx = {
      emitFile: vi.fn((asset: { fileName: string; source: string }) => {
        emitted[asset.fileName] = asset.source;
        return `id:${asset.fileName}`;
      }),
      resolve: vi.fn(async () => ({ id: '/node_modules/react/index.js' })),
    };

    await buildPlugin.generateBundle?.call(ctx as any, {}, makeBundle() as any);

    const manifest = JSON.parse(emitted['mf-manifest.json']);
    expect(manifest.metaData.publicPath).toBe('auto');
  });

  it('emits expose css mode and custom types artifact names in manifest', async () => {
    const emitted = await runGenerateBundleWithManifest(
      true,
      {
        exposePaths: {
          './Button': {
            import: './src/exposed.js',
            css: { inject: 'manual' },
          },
        },
        dts: {
          generateTypes: {
            typesFolder: '@custom-types',
          },
        },
      }
    );

    const manifest = JSON.parse(emitted['mf-manifest.json']);

    expect(manifest.metaData.types).toEqual({
      path: '',
      name: '@custom-types.zip',
      api: '@custom-types.d.ts',
    });
    expect(manifest.exposes).toEqual([
      expect.objectContaining({
        name: 'Button',
        css: {
          mode: 'manual',
        },
      }),
    ]);
  });

  it('clears manifest types metadata when dts is disabled', async () => {
    const emitted = await runGenerateBundleWithManifest(true, {
      dts: false,
    });

    const manifest = JSON.parse(emitted['mf-manifest.json']);

    expect(manifest.metaData.types).toEqual({
      path: '',
      name: '',
      api: '',
    });
  });

  it('serves dev manifest with a dedicated ssr remote entry name', () => {
    getNormalizeModuleFederationOptions.mockReturnValue({
      name: 'basicRemote',
      filename: 'remoteEntry.js',
      getPublicPath: undefined,
      varFilename: undefined,
      manifest: true,
      exposes: {
        './Button': { import: './src/exposed.js' },
      },
      remotes: {},
      shared: {},
      bundleAllCSS: false,
      shareStrategy: 'version-first',
      implementation: 'module-federation-runtime',
      runtimePlugins: [],
      virtualModuleDir: '__mf__virtual',
      hostInitInjectLocation: 'html',
      moduleParseTimeout: 10,
      ignoreOrigin: false,
    } as any);
    getUsedRemotesMap.mockReturnValue(new Map());
    getUsedShares.mockReturnValue(new Set());
    getNormalizeShareItem.mockImplementation(() => ({
      version: '1.0.0',
      shareConfig: { requiredVersion: '*', singleton: false, strictVersion: false },
    }));

    const [servePlugin, buildPlugin] = manifestPlugin();
    const middlewares: Array<(req: any, res: any, next: () => void) => void> = [];

    buildPlugin.config?.({}, { command: 'serve', mode: 'test' });
    buildPlugin.configResolved?.({
      root: '/',
      base: '/',
      build: {},
      server: { origin: 'http://localhost:4174' },
    } as any);
    servePlugin.configResolved?.({
      base: '/',
      server: { origin: 'http://localhost:4174' },
    } as any);
    servePlugin.configureServer?.({
      middlewares: {
        use: (handler: (req: any, res: any, next: () => void) => void) => {
          middlewares.push(handler);
        },
      },
    } as any);

    expect(middlewares).toHaveLength(1);

    const res = {
      end: vi.fn(),
      setHeader: vi.fn(),
    };
    const next = vi.fn();

    middlewares[0](
      {
        headers: {
          host: '127.0.0.1:4174',
        },
        url: '/mf-manifest.json',
      },
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    const manifest = JSON.parse(res.end.mock.calls[0][0]);
    expect(manifest.metaData.publicPath).toBe('http://127.0.0.1:4174/');
    expect(manifest.metaData.remoteEntry.name).toBe('remoteEntry.js');
    expect(manifest.metaData.ssrRemoteEntry.name).toBe('remoteEntry.ssr.js');
  });

  it('emits share and remote diagnostics in stats/debug artifacts', async () => {
    getConcreteSharedImportSource.mockImplementation((shareKey: string) =>
      shareKey === 'react' ? '/workspace/packages/react/index.js' : undefined
    );
    getInstalledPackageEntry.mockImplementation((pkg: string) =>
      pkg === 'scheduler' ? '/repo/node_modules/.pnpm/scheduler/index.js' : undefined
    );

    const emitted = await runGenerateBundleWithManifest(true, {
      shared: {
        react: {
          import: '/workspace/packages/react/index.js',
          requiredVersion: '^19.0.0',
          singleton: true,
          strictVersion: true,
        },
        'lit/': {
          requiredVersion: '^3.0.0',
        },
        'host-only': {
          import: false,
          singleton: true,
        },
      },
      remotes: {
        scheduler: {
          entry: 'http://remote.example/assets/remoteEntry.js',
          name: 'scheduler',
          shareScope: 'default',
          type: 'module',
        },
      },
      usedShares: new Set(['react', 'lit/directives/class-map.js']),
    });

    const stats = JSON.parse(emitted['mf-stats.json']);
    const debug = JSON.parse(emitted['mf-debug.json']);

    expect(stats.diagnostics.remoteAliases).toEqual([
      expect.objectContaining({
        alias: 'scheduler',
        collidesWithInstalledPackage: true,
        installedPackageEntry: '/repo/node_modules/.pnpm/scheduler/index.js',
      }),
    ]);
    expect(stats.diagnostics.sharedResolution).toEqual([
      expect.objectContaining({
        key: 'react',
        fallbackMode: 'concrete-import',
        matchType: 'exact',
        used: true,
      }),
      expect.objectContaining({
        key: 'lit/',
        fallbackMode: 'prebuild',
        matchType: 'prefix',
        used: true,
      }),
      expect.objectContaining({
        key: 'host-only',
        fallbackMode: 'host-only',
        importDisabled: true,
        used: false,
      }),
    ]);
    expect(debug.diagnostics.ssr).toMatchObject({
      hasSsrRemoteEntry: true,
      remoteEntryFile: 'remoteEntry.js',
      ssrRemoteEntryFile: 'remoteEntry.ssr.js',
    });
  });
});
