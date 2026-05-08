import { describe, expect, it, vi } from 'vitest';
import pluginProxyRemoteEntry from '../pluginProxyRemoteEntry';
import { getHostAutoInitPath } from '../../virtualModules';
import { normalizeModuleFederationOptions } from '../../utils/normalizeModuleFederationOptions';

describe('pluginProxyRemoteEntry', () => {
  it('awaits dev host auto init before loading the app entry', async () => {
    const options = normalizeModuleFederationOptions({
      filename: 'remoteEntry.js',
      name: 'host',
    });
    const plugin = pluginProxyRemoteEntry({
      options,
      remoteEntryId: 'virtual:mf-REMOTE_ENTRY_ID:remote',
      ssrRemoteEntryId: 'virtual:mf-SSR_REMOTE_ENTRY_ID:remote',
      virtualExposesId: 'virtual:mf-exposes:remote',
    });

    plugin.config?.({} as any, { command: 'serve', mode: 'development' });
    plugin.configResolved?.({
      base: '/',
      root: '/repo',
      server: {
        host: '127.0.0.1',
        port: 4173,
      },
    } as any);

    const result = await plugin.transform?.call({} as any, '', getHostAutoInitPath());

    expect(result && 'code' in result ? result.code : result).toContain(
      'const remoteEntry = await import(origin + "/remoteEntry.js")',
    );
    expect(result && 'code' in result ? result.code : result).toContain('await remoteEntry.init()');
    expect(result && 'code' in result ? result.code : result).not.toContain(
      '.then(remoteEntry.init)',
    );
  });

  it('normalizes vite ssr helpers into standard node-loadable esm in dev mode', async () => {
    const middlewares: Array<(req: any, res: any, next: () => void) => void | Promise<void>> = [];
    const transformRequest = vi.fn(async () => ({
      code: [
        '__vite_ssr_exportName__("init", () => { try { return init } catch {} });',
        'const __vite_ssr_import_0__ = await __vite_ssr_import__("/node_modules/.vite/deps/@module-federation_runtime.js?v=123", {"importedNames":["init"]});',
        'const entry = () => __vite_ssr_dynamic_import__("/@id/virtual:mf-exposes:remote");',
        'const metaUrl = __vite_ssr_import_meta__.url;',
        'function init() { return __vite_ssr_import_0__; }',
        'export { __vite_ssr_import_0__.init as runtimeInit };',
      ].join('\n'),
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
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(transformRequest).toHaveBeenCalledWith('virtual:mf-SSR_REMOTE_ENTRY_ID:remote', {
      ssr: true,
    });
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/javascript');
    expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    expect(res.end).toHaveBeenCalledWith(
      expect.stringContaining(
        'const __vite_ssr_import_0__ = await import("http://127.0.0.1:4174/node_modules/.vite/deps/@module-federation_runtime.js?v=123&mf_target=node");',
      ),
    );
    expect(res.end).toHaveBeenCalledWith(
      expect.stringContaining(
        'const entry = () => import("http://127.0.0.1:4174/@id/virtual:mf-exposes:remote?mf_target=node");',
      ),
    );
    expect(res.end).toHaveBeenCalledWith(
      expect.stringContaining('const metaUrl = import.meta.url;'),
    );
    expect(res.end).toHaveBeenCalledWith(expect.stringContaining('export { init as init };'));
    expect(res.end).toHaveBeenCalledWith(
      expect.stringContaining('const __mf_export_0__ = __vite_ssr_import_0__.init;'),
    );
    expect(res.end).toHaveBeenCalledWith(
      expect.stringContaining('export { __mf_export_0__ as runtimeInit };'),
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
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(transformRequest).toHaveBeenCalledWith('virtual:mf-exposes:remote', { ssr: true });
    expect(res.end).toHaveBeenCalledWith(
      'export const component = () => import("http://127.0.0.1:4174/src/Button.tsx?mf_target=node");',
    );
  });

  it('decodes encoded dev ids before forwarding them to vite ssr transforms', async () => {
    const middlewares: Array<(req: any, res: any, next: () => void) => void | Promise<void>> = [];
    const transformRequest = vi.fn(async () => ({
      code: 'export * from "/src/shared.js";',
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
        url: '/%40fs/repo/node_modules/pkg/index.js?mf_target=node',
      },
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(transformRequest).toHaveBeenCalledWith('/@fs/repo/node_modules/pkg/index.js', {
      ssr: true,
    });
    expect(res.end).toHaveBeenCalledWith(
      'export * from "http://127.0.0.1:4174/src/shared.js?mf_target=node";',
    );
  });

  it('keeps bare package dev ids on the @id path for vite to resolve', async () => {
    const middlewares: Array<(req: any, res: any, next: () => void) => void | Promise<void>> = [];
    const resolveId = vi.fn(async (id: string) => {
      if (id === '@module-federation/runtime-core') {
        return {
          id: '/repo/node_modules/.pnpm/@module-federation/runtime-core/dist/index.js',
        };
      }
      if (id === 'react') {
        return {
          id: '/repo/node_modules/.pnpm/react/index.js',
        };
      }
      return null;
    });
    const transformRequest = vi.fn(async () => ({
      code: 'const runtimeCore = await __vite_ssr_import__("react", {"importedNames":["version"]});',
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
      pluginContainer: {
        resolveId,
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
        url: '/@id/@module-federation/runtime-core?mf_target=node',
      },
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(resolveId).toHaveBeenCalledWith('@module-federation/runtime-core', undefined, {
      ssr: true,
    });
    expect(transformRequest).toHaveBeenCalledWith(
      '/repo/node_modules/.pnpm/@module-federation/runtime-core/dist/index.js',
      {
        ssr: true,
      },
    );
    expect(res.end).toHaveBeenCalledWith(
      'const runtimeCore = await import("http://127.0.0.1:4174/@fs/repo/node_modules/.pnpm/react/index.js?mf_target=node");',
    );
  });

  it('falls back to the original @id request path when vite cannot resolve a bare package id', async () => {
    const middlewares: Array<(req: any, res: any, next: () => void) => void | Promise<void>> = [];
    const resolveId = vi.fn(async () => null);
    const transformRequest = vi.fn(async () => ({
      code: 'const runtimeCore = await __vite_ssr_import__("react", {"importedNames":["version"]});',
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
      pluginContainer: {
        resolveId,
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
        url: '/@id/@module-federation/runtime-core?mf_target=node',
      },
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(transformRequest).toHaveBeenCalledWith('/@id/@module-federation/runtime-core', {
      ssr: true,
    });
    expect(res.end).toHaveBeenCalledWith(
      'const runtimeCore = await import("http://127.0.0.1:4174/@id/react?mf_target=node");',
    );
  });

  it('short-circuits style requests to an empty module for node target', async () => {
    const middlewares: Array<(req: any, res: any, next: () => void) => void | Promise<void>> = [];
    const transformRequest = vi.fn();
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
        url: '/src/Button.css?mf_target=node',
      },
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(transformRequest).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledWith('export default {};');
  });
});
