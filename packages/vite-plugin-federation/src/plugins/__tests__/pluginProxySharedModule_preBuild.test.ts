import { beforeEach, describe, expect, it, vi } from 'vitest';

const { hasPackageDependencyMock, existsSyncMock, readFileSyncMock } = vi.hoisted(() => ({
  hasPackageDependencyMock: vi.fn(),
  existsSyncMock: vi.fn(() => false),
  readFileSyncMock: vi.fn(() => '{}'),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: existsSyncMock,
    readFileSync: readFileSyncMock,
  };
});

vi.mock('../../utils/packageUtils', () => ({
  hasPackageDependency: hasPackageDependencyMock,
  setPackageDetectionCwd: vi.fn(),
  getPackageDetectionCwd: vi.fn(() => '/repo/apps/remote'),
  getIsRolldown: () => false,
  removePathFromNpmPackage: (pkg: string) => {
    const match = pkg.match(/^(?:@[^/]+\/)?[^/]+/);
    return match ? match[0] : pkg;
  },
}));

vi.mock('../../utils/VirtualModule', () => ({
  default: class MockVirtualModule {
    getPath() {
      return '/mock/path.js';
    }
    getImportId() {
      return 'mock-import-id';
    }
    writeSync() {}
  },
  assertModuleFound: (_tag: string, value: string) => ({
    name: value.startsWith('transitive-no-override')
      ? 'transitive-no-override'
      : value.startsWith('transitive') || value.startsWith('transitive/')
        ? 'transitive'
        : value,
  }),
}));

import { proxySharedModule } from '../pluginProxySharedModule_preBuild';
import type { NormalizedShared } from '../../utils/normalizeModuleFederationOptions';

const preBuildShareItemMap = new Map<string, NormalizedShared[string]>();

vi.mock('../../virtualModules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../virtualModules')>();
  return {
    ...actual,
    writePreBuildLibPath: (pkg: string, shareItem?: NormalizedShared[string]) => {
      preBuildShareItemMap.set(pkg, shareItem);
    },
    writeLocalSharedImportMap: vi.fn(),
    getPreBuildShareItem: (pkg: string) => preBuildShareItemMap.get(pkg),
    getConcreteSharedImportSource: (pkg: string, shareItem?: NormalizedShared[string]) =>
      typeof shareItem?.shareConfig.import === 'string'
        ? shareItem.shareConfig.import
        : pkg === 'transitive-no-override'
          ? '/workspace/packages/transitive-no-override/dist/index.js'
          : undefined,
  };
});

function makeShared(): NormalizedShared {
  return {
    react: {
      name: 'react',
      from: '',
      version: '19.2.4',
      scope: 'default',
      shareConfig: {
        singleton: true,
        requiredVersion: '^19.2.4',
        strictVersion: false,
      },
    },
    'react/': {
      name: 'react/',
      from: '',
      version: '19.2.4',
      scope: 'default',
      shareConfig: {
        singleton: true,
        requiredVersion: '^19.2.4',
        strictVersion: false,
      },
    },
    'react-dom/': {
      name: 'react-dom/',
      from: '',
      version: '19.2.4',
      scope: 'default',
      shareConfig: {
        singleton: true,
        requiredVersion: '^19.2.4',
        strictVersion: false,
      },
    },
    vue: {
      name: 'vue',
      from: '',
      version: '3.4.0',
      scope: 'default',
      shareConfig: {
        singleton: false,
        requiredVersion: '^3.4.0',
        strictVersion: false,
      },
    },
    transitive: {
      name: 'transitive',
      from: '',
      version: '1.0.0',
      scope: 'default',
      shareConfig: {
        import: '/abs/transitive/index.js',
        singleton: false,
        requiredVersion: '^1.0.0',
        strictVersion: false,
      },
    },
    'transitive-no-override': {
      name: 'transitive-no-override',
      from: '',
      version: '1.0.0',
      scope: 'default',
      shareConfig: {
        singleton: false,
        requiredVersion: '^1.0.0',
        strictVersion: false,
      },
    },
  };
}

describe('pluginProxySharedModule_preBuild', () => {
  beforeEach(() => {
    hasPackageDependencyMock.mockReset();
    preBuildShareItemMap.clear();
  });

  function createServeProxyPlugin(shared: NormalizedShared) {
    const plugins = proxySharedModule({ shared });
    const proxyPlugin = plugins[1];
    const config = {
      resolve: {
        alias: [] as any[],
      },
    };

    proxyPlugin.config?.call(
      {
        meta: {},
        resolve: async (id: string) => ({ id: `/resolved/${id}` }),
      },
      config as any,
      {
        command: 'serve',
        mode: 'development',
      },
    );

    return { config, proxyPlugin };
  }

  for (const testCase of [
    {
      name: 'does not proxy react through loadShare in serve mode when vinext is enabled',
      source: 'react',
      hasVinext: true,
      hasAstro: false,
      expected: undefined,
    },
    {
      name: 'does not proxy react through loadShare in serve mode when astro is enabled',
      source: 'react',
      hasVinext: false,
      hasAstro: true,
      expected: undefined,
    },
    {
      name: 'proxies react through loadShare in serve mode when vinext is disabled',
      source: 'react',
      hasVinext: false,
      hasAstro: false,
      expected: { id: expect.stringContaining('/resolved/') },
    },
    {
      name: 'proxies non-react shared modules through loadShare in serve mode when vinext is enabled',
      source: 'vue',
      hasVinext: true,
      hasAstro: false,
      expected: { id: expect.stringContaining('/resolved/') },
    },
    {
      name: 'proxies non-react shared modules through loadShare in serve mode when vinext is disabled',
      source: 'vue',
      hasVinext: false,
      hasAstro: false,
      expected: { id: expect.stringContaining('/resolved/') },
    },
    {
      name: 'proxies prefix shared subpaths through loadShare in serve mode',
      source: 'react-dom/client',
      hasVinext: false,
      hasAstro: false,
      expected: { id: expect.stringContaining('/resolved/') },
    },
  ]) {
    it(testCase.name, async () => {
      hasPackageDependencyMock.mockImplementation((pkg: string) => {
        if (pkg === 'vinext') return testCase.hasVinext;
        if (pkg === 'astro') return testCase.hasAstro;
        return false;
      });

      const { config, proxyPlugin } = createServeProxyPlugin(makeShared());
      const resolution = await proxyPlugin.resolveId?.call(
        {
          meta: {},
          resolve: async (id: string) => ({ id: `/resolved/${id}` }),
        },
        testCase.source,
        '/src/main.ts',
      );

      expect(config.resolve.alias).toEqual([]);
      if (typeof testCase.expected === 'undefined') {
        expect(resolution).toBeUndefined();
      } else {
        expect(resolution).toEqual(testCase.expected);
      }
    });
  }

  it('skips prebuild for import: false shared deps in configResolved', () => {
    hasPackageDependencyMock.mockReturnValue(false);

    const shared: NormalizedShared = {
      ...makeShared(),
      'host-only': {
        name: 'host-only',
        from: '',
        version: undefined,
        scope: 'default',
        shareConfig: {
          import: false,
          singleton: true,
          requiredVersion: '*',
          strictVersion: false,
        },
      },
    };

    const plugins = proxySharedModule({ shared });
    const proxyPlugin = plugins[1];
    const config = {
      resolve: { alias: [] as any[] },
    };

    proxyPlugin.config?.call(
      { meta: {}, resolve: async (id: string) => ({ id: `/resolved/${id}` }) },
      config as any,
      { command: 'serve', mode: 'development' },
    );
    proxyPlugin.configResolved?.({
      cacheDir: '/vite/deps',
      experimental: { rolldownDev: false },
    } as any);

    // import: false dep should not have a prebuild entry
    expect(preBuildShareItemMap.has('host-only')).toBe(false);
    // Normal deps should still have prebuild entries
    expect(preBuildShareItemMap.has('react')).toBe(true);
    expect(preBuildShareItemMap.has('vue')).toBe(true);
  });

  it('resolves prebuild aliases to configured share import sources in build mode', async () => {
    hasPackageDependencyMock.mockReturnValue(false);

    const plugins = proxySharedModule({ shared: makeShared() });
    const proxyPlugin = plugins[1];
    proxyPlugin.config?.call({ meta: {} }, { resolve: { alias: [] as any[] } } as any, {
      command: 'build',
      mode: 'production',
    });

    preBuildShareItemMap.set('transitive', makeShared().transitive);

    const resolution = await proxyPlugin.resolveId?.call(
      {
        resolve: async (id: string) => ({ id: `/resolved/${id}` }),
      } as any,
      'transitive__prebuild__',
      '/src/main.ts',
    );

    expect(resolution).toEqual({ id: '/resolved//abs/transitive/index.js' });
  });

  it('resolves prebuild aliases from the original shared key, not just pkg name', async () => {
    hasPackageDependencyMock.mockReturnValue(false);

    const shared = makeShared();
    shared['transitive/'] = {
      ...shared.transitive,
      shareConfig: {
        ...shared.transitive.shareConfig,
        import: '/abs/transitive/slash-entry.js',
      },
    };
    delete shared.transitive;

    const plugins = proxySharedModule({ shared });
    const proxyPlugin = plugins[1];
    proxyPlugin.config?.call(
      {
        meta: {},
        resolve: async (id: string) => ({ id: `/resolved/${id}` }),
      },
      { resolve: { alias: [] as any[] } } as any,
      {
        command: 'build',
        mode: 'production',
      },
    );

    preBuildShareItemMap.set('transitive', shared['transitive/']);

    const resolution = await proxyPlugin.resolveId?.call(
      {
        resolve: async (id: string) => ({ id: `/resolved/${id}` }),
      } as any,
      'transitive__prebuild__',
      '/src/main.ts',
    );

    expect(resolution).toEqual({ id: '/resolved//abs/transitive/slash-entry.js' });
  });

  it('resolves prebuild aliases to auto-detected workspace sources without explicit share.import', async () => {
    hasPackageDependencyMock.mockReturnValue(false);

    const plugins = proxySharedModule({ shared: makeShared() });
    const proxyPlugin = plugins[1];
    proxyPlugin.config?.call({ meta: {} }, { resolve: { alias: [] as any[] } } as any, {
      command: 'build',
      mode: 'production',
    });

    preBuildShareItemMap.set('transitive-no-override', makeShared()['transitive-no-override']);

    const resolution = await proxyPlugin.resolveId?.call(
      {
        resolve: async (id: string) => ({ id: `/resolved/${id}` }),
      } as any,
      'transitive-no-override__prebuild__',
      '/src/main.ts',
    );

    expect(resolution).toEqual({
      id: '/resolved//workspace/packages/transitive-no-override/dist/index.js',
    });
  });

  it('excludes shared sub-dependencies in dev mode and warns', () => {
    hasPackageDependencyMock.mockReturnValue(false);

    // Simulate "lit" having lit-html, lit-element, @lit/reactive-element as dependencies
    existsSyncMock.mockImplementation(
      (p: string) => p === '/repo/apps/remote/node_modules/lit/package.json',
    );
    readFileSyncMock.mockImplementation((p: string) => {
      if (p === '/repo/apps/remote/node_modules/lit/package.json') {
        return JSON.stringify({
          name: 'lit',
          dependencies: {
            'lit-html': '^3.0.0',
            'lit-element': '^4.0.0',
            '@lit/reactive-element': '^2.0.0',
          },
        });
      }
      return '{}';
    });

    const shared: NormalizedShared = {
      lit: {
        name: 'lit',
        from: '',
        version: '3.3.2',
        scope: 'default',
        shareConfig: { singleton: true, requiredVersion: '^3.3.2', strictVersion: false },
      },
      'lit-html': {
        name: 'lit-html',
        from: '',
        version: '3.3.2',
        scope: 'default',
        shareConfig: { singleton: true, requiredVersion: '^3.3.2', strictVersion: false },
      },
      'lit-element': {
        name: 'lit-element',
        from: '',
        version: '4.2.2',
        scope: 'default',
        shareConfig: { singleton: true, requiredVersion: '^4.2.2', strictVersion: false },
      },
      '@lit/reactive-element': {
        name: '@lit/reactive-element',
        from: '',
        version: '2.1.0',
        scope: 'default',
        shareConfig: { singleton: true, requiredVersion: '^2.1.0', strictVersion: false },
      },
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const plugins = proxySharedModule({ shared });
    const proxyPlugin = plugins[1];
    const config = { resolve: { alias: [] as any[] } };

    proxyPlugin.config?.call({ meta: {} }, config as any, {
      command: 'serve',
      mode: 'development',
    });

    // Sub-dependencies should be removed from shared
    expect(shared).toHaveProperty('lit');
    expect(shared).not.toHaveProperty('lit-html');
    expect(shared).not.toHaveProperty('lit-element');
    expect(shared).not.toHaveProperty('@lit/reactive-element');

    // Warnings should have been emitted
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"lit-html" is a dependency of shared package "lit"'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"lit-element" is a dependency of shared package "lit"'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"@lit/reactive-element" is a dependency of shared package "lit"'),
    );

    warnSpy.mockRestore();
    existsSyncMock.mockReset().mockReturnValue(false);
    readFileSyncMock.mockReset().mockReturnValue('{}');
  });

  it('does not exclude shared sub-dependencies in build mode', () => {
    hasPackageDependencyMock.mockReturnValue(false);

    existsSyncMock.mockImplementation(
      (p: string) => p === '/repo/apps/remote/node_modules/lit/package.json',
    );
    readFileSyncMock.mockImplementation((p: string) => {
      if (p === '/repo/apps/remote/node_modules/lit/package.json') {
        return JSON.stringify({
          name: 'lit',
          dependencies: { 'lit-html': '^3.0.0' },
        });
      }
      return '{}';
    });

    const shared: NormalizedShared = {
      lit: {
        name: 'lit',
        from: '',
        version: '3.3.2',
        scope: 'default',
        shareConfig: { singleton: true, requiredVersion: '^3.3.2', strictVersion: false },
      },
      'lit-html': {
        name: 'lit-html',
        from: '',
        version: '3.3.2',
        scope: 'default',
        shareConfig: { singleton: true, requiredVersion: '^3.3.2', strictVersion: false },
      },
    };

    const plugins = proxySharedModule({ shared });
    const proxyPlugin = plugins[1];
    const config = { resolve: { alias: [] as any[] } };

    proxyPlugin.config?.call({ meta: {} }, config as any, {
      command: 'build',
      mode: 'production',
    });

    // In build mode, sub-dependencies should NOT be excluded
    expect(shared).toHaveProperty('lit');
    expect(shared).toHaveProperty('lit-html');

    existsSyncMock.mockReset().mockReturnValue(false);
    readFileSyncMock.mockReset().mockReturnValue('{}');
  });

  it('uses auto-detected workspace sources in serve prebuild resolution without null deref', async () => {
    hasPackageDependencyMock.mockReturnValue(false);

    const { config, proxyPlugin } = createServeProxyPlugin(makeShared());
    proxyPlugin.configResolved?.({
      cacheDir: '/vite/deps',
      experimental: { rolldownDev: false },
    } as any);

    preBuildShareItemMap.set('transitive-no-override', makeShared()['transitive-no-override']);

    const resolution = await proxyPlugin.resolveId?.call(
      {
        meta: {},
        resolve: async (id: string) => ({ id: `/resolved/${id}` }),
      },
      'transitive-no-override__prebuild__',
      '/src/main.ts',
    );

    expect(config.resolve.alias).toEqual([]);
    expect(resolution).toEqual({
      id: '/resolved//resolved//workspace/packages/transitive-no-override/dist/index.js',
    });
  });
});
