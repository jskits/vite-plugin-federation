import { describe, expect, it, vi } from 'vitest';
import { getDefaultMockOptions } from '../../utils/__tests__/helpers';
import pluginOriginjsCompat from '../pluginOriginjsCompat';

const RESOLVED_ORIGINJS_VIRTUAL_ID = '\0vite-plugin-federation:originjs-compat';

function createShimHarness(code: string) {
  const loadRemoteCalls: string[] = [];
  const registerRemotesCalls: unknown[] = [];
  const runtime = {
    loadRemote: async (request: string) => {
      loadRemoteCalls.push(request);
      return {
        request,
      };
    },
    registerRemotes: (remotes: unknown, options: unknown) => {
      registerRemotesCalls.push({
        remotes,
        options,
      });
    },
  };
  const factory = new Function(
    'runtime',
    code
      .replace(
        'import { loadRemote, registerRemotes } from "@module-federation/runtime";',
        'const { loadRemote, registerRemotes, loadRemoteCalls, registerRemotesCalls } = runtime;',
      )
      .replace(
        /export\s+\{([\s\S]*?)\};/,
        'return {$1, __loadRemoteCalls: loadRemoteCalls, __registerRemotesCalls: registerRemotesCalls};',
      ),
  );

  return {
    exports: factory({
      ...runtime,
      loadRemoteCalls,
      registerRemotesCalls,
    }) as Record<string, any>,
    loadRemoteCalls,
    registerRemotesCalls,
  };
}

describe('pluginOriginjsCompat', () => {
  it('provides the virtual:__federation__ shim with initial remote metadata', () => {
    const plugin = pluginOriginjsCompat(
      getDefaultMockOptions({
        remotes: {
          remoteApp: {
            name: 'remoteApp',
            entry: 'http://localhost:4173/remoteEntry.js',
            type: 'module',
            format: 'esm',
            from: 'webpack',
            shareScope: 'default',
          },
        },
      }),
    );

    expect(plugin.resolveId?.('virtual:__federation__')).toBe(
      '\0vite-plugin-federation:originjs-compat',
    );

    const code = plugin.load?.('\0vite-plugin-federation:originjs-compat');

    expect(code).toContain('__federation_method_ensure');
    expect(code).toContain('__federation_method_getRemote');
    expect(code).toContain('"remoteApp"');
    expect(code).toContain('"webpack"');
  });

  it('does not expose the shim when originjs compatibility is disabled', () => {
    const plugin = pluginOriginjsCompat(
      getDefaultMockOptions({
        compat: {
          originjs: false,
          virtualFederationShim: false,
        },
      }),
    );

    expect(plugin.resolveId?.('virtual:__federation__')).toBeUndefined();
  });

  it('executes OriginJS remote registration and remote loading APIs', async () => {
    const plugin = pluginOriginjsCompat(
      getDefaultMockOptions({
        remotes: {
          remoteApp: {
            name: 'remoteApp',
            entry: 'http://localhost:4173/remoteEntry.js',
            type: 'module',
            format: 'esm',
            from: 'vite',
            entryGlobalName: 'remoteApp',
            shareScope: 'default',
          },
        },
      }),
    );
    const code = plugin.load?.(RESOLVED_ORIGINJS_VIRTUAL_ID);
    expect(typeof code).toBe('string');

    const { exports, loadRemoteCalls, registerRemotesCalls } = createShimHarness(code as string);
    const container = await exports.__federation_method_ensure('remoteApp');
    const loaded = await exports.__federation_method_getRemote('remoteApp', './Button');

    expect(typeof container.get).toBe('function');
    expect(loaded).toEqual({
      request: 'remoteApp/Button',
    });
    expect(loadRemoteCalls).toEqual(['remoteApp/Button']);
    expect(registerRemotesCalls[0]).toEqual({
      remotes: [
        {
          name: 'remoteApp',
          entry: 'http://localhost:4173/remoteEntry.js',
          type: 'module',
          entryGlobalName: 'remoteApp',
          shareScope: 'default',
        },
      ],
      options: {
        force: true,
      },
    });
  });

  it('executes OriginJS dynamic setRemote and default wrapping APIs', async () => {
    const plugin = pluginOriginjsCompat(getDefaultMockOptions());
    const code = plugin.load?.(RESOLVED_ORIGINJS_VIRTUAL_ID);
    expect(typeof code).toBe('string');

    const { exports, registerRemotesCalls } = createShimHarness(code as string);
    exports.__federation_method_setRemote('legacyRemote', {
      url: async () => 'http://localhost:4174/remoteEntry.js',
      format: 'var',
      entryGlobalName: 'LegacyRemote',
      shareScope: 'legacy',
    });

    await exports.__federation_method_ensure('legacyRemote');

    expect(registerRemotesCalls[0]).toEqual({
      remotes: [
        {
          name: 'legacyRemote',
          entry: 'http://localhost:4174/remoteEntry.js',
          type: 'var',
          entryGlobalName: 'LegacyRemote',
          shareScope: 'legacy',
        },
      ],
      options: {
        force: true,
      },
    });
    expect(exports.__federation_method_unwrapDefault({ __esModule: true, default: 'value' })).toBe(
      'value',
    );
    expect(exports.__federation_method_wrapDefault({ named: true }, true)).toEqual({
      default: {
        named: true,
      },
      __esModule: true,
    });
    expect(exports.__federation_method_wrapDefault({ default: 'kept' }, true)).toEqual({
      default: 'kept',
    });
  });

  it('throws a clear error for unsupported legacy remote formats', async () => {
    const plugin = pluginOriginjsCompat(getDefaultMockOptions());
    const code = plugin.load?.(RESOLVED_ORIGINJS_VIRTUAL_ID);
    expect(typeof code).toBe('string');

    const { exports } = createShimHarness(code as string);
    expect(() =>
      exports.__federation_method_setRemote('legacyRemote', {
        url: 'http://localhost:4174/remoteEntry.cjs',
        format: 'commonjs',
        from: 'vite',
      }),
    ).toThrow(
      '[Module Federation] MFV-005 Legacy remote "legacyRemote" uses unsupported format "commonjs"',
    );
  });

  it('throws a clear error when systemjs runtime support is unavailable', async () => {
    const plugin = pluginOriginjsCompat(getDefaultMockOptions());
    const code = plugin.load?.(RESOLVED_ORIGINJS_VIRTUAL_ID);
    expect(typeof code).toBe('string');

    const { exports } = createShimHarness(code as string);
    const previousSystem = (globalThis as typeof globalThis & { System?: unknown }).System;

    try {
      Reflect.deleteProperty(globalThis as typeof globalThis & { System?: unknown }, 'System');
      expect(() =>
        exports.__federation_method_setRemote('systemRemote', {
          url: 'http://localhost:4174/remoteEntry.system.js',
          format: 'systemjs',
          from: 'vite',
        }),
      ).toThrow(
        '[Module Federation] MFV-005 Legacy remote "systemRemote" uses format "systemjs" but globalThis.System.import is unavailable.',
      );
    } finally {
      if (previousSystem === undefined) {
        Reflect.deleteProperty(globalThis as typeof globalThis & { System?: unknown }, 'System');
      } else {
        (globalThis as typeof globalThis & { System?: unknown }).System = previousSystem;
      }
    }
  });

  it('warns once for unsupported from values and still registers the remote', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plugin = pluginOriginjsCompat(getDefaultMockOptions());
    const code = plugin.load?.(RESOLVED_ORIGINJS_VIRTUAL_ID);
    expect(typeof code).toBe('string');

    const { exports, registerRemotesCalls } = createShimHarness(code as string);
    exports.__federation_method_setRemote('legacyRemote', {
      url: 'http://localhost:4174/remoteEntry.js',
      format: 'esm',
      from: 'legacy-bundler',
      shareScope: 'legacy',
    });

    await exports.__federation_method_ensure('legacyRemote');
    await exports.__federation_method_ensure('legacyRemote');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'MFV-007 Legacy remote "legacyRemote" uses unsupported from "legacy-bundler"',
      ),
    );
    expect(registerRemotesCalls[0]).toEqual({
      remotes: [
        {
          name: 'legacyRemote',
          entry: 'http://localhost:4174/remoteEntry.js',
          type: 'module',
          entryGlobalName: 'legacyRemote',
          shareScope: 'legacy',
        },
      ],
      options: {
        force: true,
      },
    });

    warnSpy.mockRestore();
  });
});
