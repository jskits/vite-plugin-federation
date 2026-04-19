import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import type { NormalizedModuleFederationOptions } from '../utils/normalizeModuleFederationOptions';

const DEVTOOLS_ENDPOINT = '__mf_devtools';

function getBasePath(base: string) {
  if (!base) return '/';
  if (base.startsWith('http://') || base.startsWith('https://')) {
    try {
      return new URL(base).pathname || '/';
    } catch {
      return '/';
    }
  }
  return base;
}

function getEndpointPath(base: string, endpoint: string) {
  return `${getBasePath(base).replace(/\/?$/, '/')}${endpoint}`.replace(/\/{2,}/g, '/');
}

function getManifestFileName(
  manifest: NormalizedModuleFederationOptions['manifest']
): string | undefined {
  if (!manifest) return;
  if (manifest === true) return 'mf-manifest.json';
  return [manifest.filePath, manifest.fileName || 'mf-manifest.json'].filter(Boolean).join('/');
}

function getProjectRole(options: NormalizedModuleFederationOptions) {
  const hasExposes = Object.keys(options.exposes).length > 0;
  const hasRemotes = Object.keys(options.remotes).length > 0;

  if (hasExposes && hasRemotes) return 'hybrid';
  if (hasExposes) return 'remote';
  if (hasRemotes) return 'host';
  return 'isolated';
}

function isDevtoolsEnabled(dev: NormalizedModuleFederationOptions['dev']) {
  if (dev === false) return false;
  if (dev === true || typeof dev === 'undefined') return true;
  return dev.devtools !== false;
}

function escapeInlineScriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003C').replace(/\u2028/g, '\\u2028');
}

function buildPayload(options: NormalizedModuleFederationOptions, config: ResolvedConfig) {
  const manifestFileName = getManifestFileName(options.manifest);
  const debugFileName = manifestFileName
    ? [manifestFileName.split('/').slice(0, -1).join('/'), 'mf-debug.json'].filter(Boolean).join('/')
    : undefined;
  const basePath = getBasePath(config.base);

  return {
    debugUrl: debugFileName ? `${basePath.replace(/\/?$/, '/')}${debugFileName}` : null,
    endpoint: getEndpointPath(config.base, DEVTOOLS_ENDPOINT),
    exposes: Object.entries(options.exposes).map(([exposeName, expose]) => ({
      cssMode: expose.css?.inject || 'head',
      exposeName,
      import: expose.import,
    })),
    manifestUrl: manifestFileName ? `${basePath.replace(/\/?$/, '/')}${manifestFileName}` : null,
    name: options.name,
    remoteHmrUrl:
      typeof options.dev === 'object' && options.dev.remoteHmr
        ? getEndpointPath(config.base, '__mf_hmr')
        : null,
    remotes: Object.entries(options.remotes).map(([alias, remote]) => ({
      alias,
      entry: remote.entry,
      name: remote.name,
      type: remote.type,
    })),
    role: getProjectRole(options),
    shared: Object.keys(options.shared),
  };
}

export default function pluginDevtools(options: NormalizedModuleFederationOptions): Plugin {
  let resolvedConfig: ResolvedConfig | undefined;

  return {
    name: 'module-federation-devtools',
    apply: 'serve',
    configResolved(config) {
      resolvedConfig = config;
    },
    configureServer(server: ViteDevServer) {
      const config = resolvedConfig;
      if (!config || !isDevtoolsEnabled(options.dev)) return;

      const endpointPath = getEndpointPath(server.config.base, DEVTOOLS_ENDPOINT);

      server.middlewares.use((req, res, next) => {
        if (req.url?.replace(/\?.*/, '') !== endpointPath) {
          next();
          return;
        }

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(JSON.stringify(buildPayload(options, config)));
      });
    },
    transformIndexHtml() {
      const config = resolvedConfig;
      if (!config || !isDevtoolsEnabled(options.dev)) return;

      const payload = buildPayload(options, config);
      const payloadCode = escapeInlineScriptJson(payload);

      return [
        {
          tag: 'script',
          injectTo: 'head',
          children: `(function(){var root=globalThis.__VITE_PLUGIN_FEDERATION_DEVTOOLS__||(globalThis.__VITE_PLUGIN_FEDERATION_DEVTOOLS__={});root.apps=root.apps||{};var payload=${payloadCode};root.apps[payload.name]=payload;root.lastUpdatedAt=new Date().toISOString();if(typeof window!=="undefined"&&window.dispatchEvent&&typeof CustomEvent==="function"){window.dispatchEvent(new CustomEvent("vite-plugin-federation:devtools-ready",{detail:payload}));}})();`,
        },
      ];
    },
  };
}
