import { describe, expect, it, vi } from 'vitest';
import pluginDevtools from '../pluginDevtools';

function createServer(base = '/') {
  const middlewares: Array<(req: any, res: any, next: () => void) => void> = [];

  return {
    server: {
      config: {
        base,
      },
      middlewares: {
        use: vi.fn((handler: (req: any, res: any, next: () => void) => void) => {
          middlewares.push(handler);
        }),
      },
    },
    middlewares,
  };
}

describe('pluginDevtools', () => {
  it('serves a devtools payload endpoint in dev', () => {
    const { server, middlewares } = createServer('/app/');
    const plugin = pluginDevtools({
      name: 'remote-app',
      manifest: true,
      dev: { remoteHmr: true },
      exposes: {
        './Button': {
          import: './src/Button.tsx',
          css: { inject: 'manual' },
        },
      },
      remotes: {},
      shared: {
        react: {} as any,
      },
    } as any);

    plugin.configResolved?.({
      base: '/app/',
    } as any);
    plugin.configureServer?.(server as any);

    expect(middlewares).toHaveLength(1);

    const res = {
      end: vi.fn(),
      setHeader: vi.fn(),
    };
    const next = vi.fn();

    middlewares[0]({ url: '/app/__mf_devtools?x=1' }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({
      debugUrl: '/app/mf-debug.json',
      endpoint: '/app/__mf_devtools',
      exposes: [
        {
          cssMode: 'manual',
          exposeName: './Button',
          import: './src/Button.tsx',
        },
      ],
      manifestUrl: '/app/mf-manifest.json',
      name: 'remote-app',
      remoteHmrUrl: '/app/__mf_hmr',
      remotes: [],
      role: 'remote',
      shared: ['react'],
    });
  });

  it('injects a window hook bootstrap into html', () => {
    const plugin = pluginDevtools({
      name: 'host-app',
      manifest: {
        fileName: 'federation/manifest.json',
      },
      dev: {
        devtools: true,
      },
      exposes: {},
      remotes: {
        remoteApp: {
          entry: 'http://remote.example/mf-manifest.json',
          name: 'remoteApp',
          type: 'module',
        },
      },
      shared: {},
    } as any);

    plugin.configResolved?.({
      base: 'https://host.example/app/',
    } as any);

    const tags = plugin.transformIndexHtml?.('') as Array<Record<string, string>>;
    expect(tags).toHaveLength(1);
    expect(tags[0].tag).toBe('script');
    expect(tags[0].children).toContain('__VITE_PLUGIN_FEDERATION_DEVTOOLS__');
    expect(tags[0].children).toContain('vite-plugin-federation:devtools-ready');
    expect(tags[0].children).toContain('"manifestUrl":"/app/federation/manifest.json"');
  });

  it('can be disabled explicitly', () => {
    const { server, middlewares } = createServer();
    const plugin = pluginDevtools({
      name: 'disabled-app',
      manifest: true,
      dev: {
        devtools: false,
      },
      exposes: {},
      remotes: {},
      shared: {},
    } as any);

    plugin.configResolved?.({
      base: '/',
    } as any);
    plugin.configureServer?.(server as any);

    expect(middlewares).toHaveLength(0);
    expect(plugin.transformIndexHtml?.('')).toBeUndefined();
  });
});
