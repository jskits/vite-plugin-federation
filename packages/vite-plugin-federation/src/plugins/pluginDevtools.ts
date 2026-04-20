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
  manifest: NormalizedModuleFederationOptions['manifest'],
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
  return JSON.stringify(value)
    .replace(/</g, '\\u003C')
    .replace(/\u2028/g, '\\u2028');
}

function getDevtoolsBootstrapCode(payloadCode: string) {
  return `(function(){var root=globalThis.__VITE_PLUGIN_FEDERATION_DEVTOOLS__||(globalThis.__VITE_PLUGIN_FEDERATION_DEVTOOLS__={});root.apps=root.apps||{};root.events=root.events||[];var payload=${payloadCode};root.apps[payload.name]=payload;root.activeApp=payload.name;root.lastUpdatedAt=new Date().toISOString();function pushEvent(kind,detail){root.events.push({kind:kind,detail:detail,timestamp:new Date().toISOString()});if(root.events.length>50){root.events.shift()}root.lastUpdatedAt=new Date().toISOString();renderOverlay()}function formatEvent(entry){if(!entry)return'No federation activity yet.';var detail=entry.detail||{};var label=entry.kind;if(detail.event){label=detail.event}else if(detail.action){label=detail.action}else if(detail.remote){label=label+':'+detail.remote}var target=detail.remote||detail.remoteId||detail.expose||payload.name;return'['+entry.timestamp.slice(11,19)+'] '+label+' '+target}function ensureOverlay(){if(typeof document==='undefined'||!document.body)return null;var overlay=document.getElementById('__vite_plugin_federation_devtools_overlay');if(overlay)return overlay;overlay=document.createElement('details');overlay.id='__vite_plugin_federation_devtools_overlay';overlay.open=false;overlay.style.cssText='position:fixed;right:16px;bottom:16px;z-index:2147483647;width:min(360px,calc(100vw - 24px));border:1px solid rgba(15,23,42,.16);border-radius:16px;background:rgba(15,23,42,.92);color:#f8fafc;box-shadow:0 16px 48px rgba(15,23,42,.24);font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;backdrop-filter:blur(12px)';overlay.innerHTML='<summary style=\"cursor:pointer;list-style:none;padding:12px 14px;border-radius:16px;display:flex;align-items:center;justify-content:space-between;gap:12px\"><span data-mf-title style=\"font-weight:700\">Module Federation</span><span data-mf-role style=\"opacity:.72;text-transform:uppercase;font-size:11px\"></span></summary><div style=\"padding:0 14px 14px\"><div data-mf-meta style=\"opacity:.82;margin-bottom:10px\"></div><div data-mf-links style=\"display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px\"></div><pre data-mf-events style=\"margin:0;padding:10px 12px;border-radius:12px;background:rgba(148,163,184,.12);white-space:pre-wrap;word-break:break-word\"></pre></div>';document.body.appendChild(overlay);return overlay}function renderOverlay(){var overlay=ensureOverlay();if(!overlay)return;var meta=overlay.querySelector('[data-mf-meta]');var title=overlay.querySelector('[data-mf-title]');var role=overlay.querySelector('[data-mf-role]');var links=overlay.querySelector('[data-mf-links]');var events=overlay.querySelector('[data-mf-events]');if(title)title.textContent='MF '+payload.name;if(role)role.textContent=payload.role;if(meta)meta.textContent='shared:'+payload.shared.length+' remotes:'+payload.remotes.length+' exposes:'+payload.exposes.length;if(links){var items=[];if(payload.manifestUrl)items.push('<a href=\"'+payload.manifestUrl+'\" target=\"_blank\" rel=\"noreferrer\" style=\"color:#f8fafc\">manifest</a>');if(payload.debugUrl)items.push('<a href=\"'+payload.debugUrl+'\" target=\"_blank\" rel=\"noreferrer\" style=\"color:#f8fafc\">debug</a>');if(payload.remoteHmrUrl)items.push('<a href=\"'+payload.remoteHmrUrl+'\" target=\"_blank\" rel=\"noreferrer\" style=\"color:#f8fafc\">hmr</a>');links.innerHTML=items.join('')}if(events){events.textContent=root.events.slice(-6).map(formatEvent).join('\\n')}}function scheduleRender(){if(typeof window==='undefined'||typeof window.requestAnimationFrame!=='function'){renderOverlay();return}window.requestAnimationFrame(renderOverlay)}if(typeof window!=='undefined'&&window.addEventListener){window.addEventListener('vite-plugin-federation:debug',function(event){pushEvent('runtime',event.detail)});window.addEventListener('vite-plugin-federation:remote-update',function(event){pushEvent('remote',event.detail)});window.addEventListener('vite-plugin-federation:remote-style-update',function(event){pushEvent('remote-style',event.detail)});window.addEventListener('vite-plugin-federation:remote-types-update',function(event){pushEvent('remote-types',event.detail)})}if(typeof document!=='undefined'){if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',scheduleRender,{once:true})}else{scheduleRender()}}if(typeof window!=='undefined'&&window.dispatchEvent&&typeof CustomEvent==='function'){window.dispatchEvent(new CustomEvent('vite-plugin-federation:devtools-ready',{detail:payload}))}})();`;
}

function buildPayload(options: NormalizedModuleFederationOptions, config: ResolvedConfig) {
  const manifestFileName = getManifestFileName(options.manifest);
  const debugFileName = manifestFileName
    ? [manifestFileName.split('/').slice(0, -1).join('/'), 'mf-debug.json']
        .filter(Boolean)
        .join('/')
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
          children: getDevtoolsBootstrapCode(payloadCode),
        },
      ];
    },
  };
}
