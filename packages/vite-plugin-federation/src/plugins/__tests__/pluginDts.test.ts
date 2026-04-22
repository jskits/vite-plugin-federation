import { describe, expect, it, vi } from 'vitest';
import type { ResolvedConfig } from 'vite';
import { normalizeModuleFederationOptions } from '../../utils/normalizeModuleFederationOptions';
import pluginDts, {
  applyManifestRemoteTypeUrls,
  resolveManifestRemoteTypeUrls,
} from '../pluginDts';

describe('pluginDts build', () => {
  it('does not throw when dts options are invalid', async () => {
    const normalized = normalizeModuleFederationOptions({
      name: 'test-module',
      shareStrategy: 'loaded-first',
    });
    normalized.dts = {
      displayErrorInTerminal: false,
      consumeTypes: 123,
    } as unknown as typeof normalized.dts;

    const plugins = pluginDts(normalized);
    const buildPlugin = plugins.find((plugin) => plugin.name === 'module-federation-dts-build');
    expect(buildPlugin).toBeTruthy();

    const config = {
      root: process.cwd(),
      build: { outDir: 'dist' },
    } as ResolvedConfig;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    buildPlugin?.configResolved?.(config);
    await expect(buildPlugin?.generateBundle?.()).resolves.toBeUndefined();
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('derives remote type urls from manifest metadata', async () => {
    const normalized = normalizeModuleFederationOptions({
      name: 'host',
      remotes: {
        dtsRemote: 'https://cdn.example.com/remotes/dtsRemote/mf-manifest.json',
      },
      shareStrategy: 'loaded-first',
    });

    const fetchManifest = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        metaData: {
          types: {
            path: 'types',
            name: 'remote-types.zip',
            api: 'remote-types.d.ts',
          },
        },
      }),
    }));

    await expect(resolveManifestRemoteTypeUrls(normalized, fetchManifest)).resolves.toEqual({
      dtsRemote: {
        alias: 'dtsRemote',
        api: 'https://cdn.example.com/remotes/dtsRemote/types/remote-types.d.ts',
        zip: 'https://cdn.example.com/remotes/dtsRemote/types/remote-types.zip',
      },
    });
    expect(fetchManifest).toHaveBeenCalledWith(
      'https://cdn.example.com/remotes/dtsRemote/mf-manifest.json',
    );
  });

  it('preserves explicit remote type urls over manifest-derived urls', async () => {
    const normalized = normalizeModuleFederationOptions({
      name: 'host',
      remotes: {
        dtsRemote: 'https://cdn.example.com/mf-manifest.json',
      },
      shareStrategy: 'loaded-first',
    });

    const fetchManifest = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        metaData: {
          types: {
            name: '@mf-types.zip',
            api: '@mf-types.d.ts',
          },
        },
      }),
    }));
    const host = {
      remoteTypeUrls: {
        dtsRemote: {
          alias: 'dtsRemote',
          api: 'https://types.example.com/api.d.ts',
          zip: 'https://types.example.com/types.zip',
        },
      },
    };

    await applyManifestRemoteTypeUrls(host, normalized, fetchManifest);

    expect(host.remoteTypeUrls).toEqual({
      dtsRemote: {
        alias: 'dtsRemote',
        api: 'https://types.example.com/api.d.ts',
        zip: 'https://types.example.com/types.zip',
      },
    });
  });

  it('merges manifest-derived urls into remote type url factories', async () => {
    const normalized = normalizeModuleFederationOptions({
      name: 'host',
      remotes: {
        dtsRemote: 'https://cdn.example.com/mf-manifest.json',
      },
      shareStrategy: 'loaded-first',
    });

    const fetchManifest = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        metaData: {
          types: {
            path: 'types',
            name: '@mf-types.zip',
            api: '@mf-types.d.ts',
          },
        },
      }),
    }));
    const host = {
      remoteTypeUrls: async () => ({
        anotherRemote: {
          alias: 'anotherRemote',
          api: 'https://types.example.com/another.d.ts',
          zip: 'https://types.example.com/another.zip',
        },
      }),
    };

    await applyManifestRemoteTypeUrls(host, normalized, fetchManifest);

    await expect(host.remoteTypeUrls()).resolves.toEqual({
      dtsRemote: {
        alias: 'dtsRemote',
        api: 'https://cdn.example.com/types/@mf-types.d.ts',
        zip: 'https://cdn.example.com/types/@mf-types.zip',
      },
      anotherRemote: {
        alias: 'anotherRemote',
        api: 'https://types.example.com/another.d.ts',
        zip: 'https://types.example.com/another.zip',
      },
    });
  });
});
