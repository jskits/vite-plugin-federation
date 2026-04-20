import { describe, expect, it } from 'vitest';
import { getDefaultMockOptions } from '../../utils/__tests__/helpers';
import pluginOriginjsCompat from '../pluginOriginjsCompat';

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
});
