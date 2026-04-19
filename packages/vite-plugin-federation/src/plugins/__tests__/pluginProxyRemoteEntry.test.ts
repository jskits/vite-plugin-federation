import { describe, expect, it, vi } from 'vitest';
import pluginProxyRemoteEntry from '../pluginProxyRemoteEntry';

describe('pluginProxyRemoteEntry', () => {
  it('serves an absolute-url SSR remote entry in dev mode', async () => {
    const middlewares: Array<(req: any, res: any, next: () => void) => void | Promise<void>> = [];
    const plugin = pluginProxyRemoteEntry({
      options: {
        exposes: {
          './Button': { import: './src/Button.tsx' },
        },
        filename: 'remoteEntry.js',
      } as any,
      remoteEntryId: 'virtual:mf-REMOTE_ENTRY_ID:remote',
      ssrRemoteEntryId: 'virtual:mf-SSR_REMOTE_ENTRY_ID:remote',
      virtualExposesId: 'virtual:mf-exposes:remote',
    });

    plugin.config?.({} as any, { command: 'serve', mode: 'development' });
    plugin.configResolved?.({
      base: '/',
      root: '/repo',
    } as any);
    plugin.configureServer?.({
      config: {
        base: '/',
        server: {
          host: '127.0.0.1',
          https: false,
          port: 4174,
        },
      },
      middlewares: {
        use(handler: (req: any, res: any, next: () => void) => void | Promise<void>) {
          middlewares.push(handler);
        },
      },
      transformRequest: vi.fn(async () => ({
        code: [
          'import "/node_modules/.vite/deps/@module-federation_runtime.js?v=123";',
          'const entry = () => import("/@id/virtual:mf-exposes:remote");',
          'export { default } from "/src/Button.tsx";',
        ].join('\n'),
      })),
    } as any);

    expect(middlewares).toHaveLength(1);

    const next = vi.fn();
    const res = {
      end: vi.fn(),
      setHeader: vi.fn(),
    };

    await middlewares[0](
      {
        headers: {
          host: '127.0.0.1:4174',
        },
        url: '/remoteEntry.ssr.js?import',
      },
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/javascript');
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    expect(res.end).toHaveBeenCalledWith(
      expect.stringContaining(
        'import "http://127.0.0.1:4174/node_modules/.vite/deps/@module-federation_runtime.js?v=123&mf_target=node";'
      )
    );
    expect(res.end).toHaveBeenCalledWith(
      expect.stringContaining(
        'import("http://127.0.0.1:4174/@id/virtual:mf-exposes:remote?mf_target=node")'
      )
    );
    expect(res.end).toHaveBeenCalledWith(
      expect.stringContaining('from "http://127.0.0.1:4174/src/Button.tsx?mf_target=node"')
    );
  });

  it('rewrites node-targeted follow-up module requests recursively', async () => {
    const middlewares: Array<(req: any, res: any, next: () => void) => void | Promise<void>> = [];
    const transformRequest = vi.fn(async () => ({
      code: 'export const component = () => import("/src/Button.tsx");',
    }));
    const plugin = pluginProxyRemoteEntry({
      options: {
        exposes: {
          './Button': { import: './src/Button.tsx' },
        },
        filename: 'remoteEntry.js',
      } as any,
      remoteEntryId: 'virtual:mf-REMOTE_ENTRY_ID:remote',
      ssrRemoteEntryId: 'virtual:mf-SSR_REMOTE_ENTRY_ID:remote',
      virtualExposesId: 'virtual:mf-exposes:remote',
    });

    plugin.config?.({} as any, { command: 'serve', mode: 'development' });
    plugin.configResolved?.({
      base: '/',
      root: '/repo',
    } as any);
    plugin.configureServer?.({
      config: {
        base: '/',
        server: {
          host: '127.0.0.1',
          https: false,
          port: 4174,
        },
      },
      middlewares: {
        use(handler: (req: any, res: any, next: () => void) => void | Promise<void>) {
          middlewares.push(handler);
        },
      },
      transformRequest,
    } as any);

    const next = vi.fn();
    const res = {
      end: vi.fn(),
      setHeader: vi.fn(),
    };

    await middlewares[0](
      {
        headers: {
          host: '127.0.0.1:4174',
        },
        url: '/@id/virtual:mf-exposes:remote?mf_target=node',
      },
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(transformRequest).toHaveBeenCalledWith('virtual:mf-exposes:remote', { ssr: true });
    expect(res.end).toHaveBeenCalledWith(
      'export const component = () => import("http://127.0.0.1:4174/src/Button.tsx?mf_target=node");'
    );
  });
});
