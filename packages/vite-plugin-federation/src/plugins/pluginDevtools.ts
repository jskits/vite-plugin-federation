import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import type { NormalizedModuleFederationOptions } from '../utils/normalizeModuleFederationOptions';

const DEVTOOLS_ENDPOINT = '__mf_devtools';
const DEVTOOLS_CONTRACT_VERSION = '1.0.0';
const DEVTOOLS_EVENT_LIMIT = 50;

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
  return `(function(){
var CONTRACT_VERSION=${JSON.stringify(DEVTOOLS_CONTRACT_VERSION)};
var EVENT_LIMIT=${DEVTOOLS_EVENT_LIMIT};
var root=globalThis.__VITE_PLUGIN_FEDERATION_DEVTOOLS__||(globalThis.__VITE_PLUGIN_FEDERATION_DEVTOOLS__={});
root.apps=root.apps||{};
root.events=root.events||[];
root.contractVersion=CONTRACT_VERSION;
root.eventLimit=EVENT_LIMIT;
var payload=${payloadCode};
root.apps[payload.name]=payload;
root.activeApp=payload.name;
root.lastUpdatedAt=new Date().toISOString();
function trimEvents(){while(root.events.length>EVENT_LIMIT){root.events.shift()}}
function getRuntime(){return root.runtime&&root.runtime.runtime?root.runtime.runtime:{}}
function safeText(value){return value===undefined||value===null?'':String(value)}
function shortUrl(value){var text=safeText(value);return text.length>88?text.slice(0,85)+'...':text}
function exportSnapshot(){return{activeApp:root.activeApp||payload.name,apps:root.apps||{},contractVersion:root.contractVersion,events:(root.events||[]).slice(),lastUpdatedAt:root.lastUpdatedAt||null,runtime:root.runtime||null}}
root.exportSnapshot=exportSnapshot;
root.copySnapshot=function(){var text=JSON.stringify(exportSnapshot(),null,2);var clipboard=typeof navigator!=='undefined'&&navigator.clipboard;if(clipboard&&clipboard.writeText){return clipboard.writeText(text).then(function(){return text})}return Promise.resolve(text)};
function pushEvent(kind,detail){var entry={kind:kind,detail:detail,timestamp:new Date().toISOString()};if(detail&&detail.event){entry.event=detail.event}root.events.push(entry);trimEvents();if(detail&&detail.snapshot){root.runtime=detail.snapshot}root.lastUpdatedAt=new Date().toISOString();renderOverlay()}
function formatEvent(entry){if(!entry)return'No federation activity yet.';var detail=entry.detail||entry;var label=entry.event||detail.event||entry.kind||'event';if(detail.action){label=label+':'+detail.action}var target=detail.remote||detail.remoteId||detail.expose||detail.manifestUrl||payload.name;return'['+entry.timestamp.slice(11,19)+'] '+label+' '+target}
function formatRuntimeError(runtime){var error=runtime.lastLoadError;if(!error)return'No runtime errors.';var lines=[(error.code||'error')+' '+(error.remoteId||error.remoteAlias||''),error.manifestUrl?shortUrl(error.manifestUrl):'',error.entry?shortUrl(error.entry):'',error.message||''].filter(Boolean);return lines.join('\\n')}
function formatRemotes(runtime){var manifestRemotes=runtime.registeredManifestRemotes||[];var plainRemotes=runtime.registeredRemotes||[];var rows=manifestRemotes.map(function(remote){return(remote.alias||remote.name)+' '+remote.target+' '+remote.shareScope+'\\n  '+shortUrl(remote.entry)});plainRemotes.forEach(function(remote){rows.push((remote.alias||remote.name||'remote')+' runtime\\n  '+shortUrl(remote.entry))});return rows.length?rows.join('\\n'):'No registered remotes.'}
function formatManifestTimeline(runtime){var fetches=(runtime.manifestFetches||[]).slice(-8);if(!fetches.length)return'No manifest fetches.';return fetches.map(function(entry){return'['+entry.timestamp.slice(11,19)+'] '+entry.status+' #'+entry.attempt+' '+shortUrl(entry.manifestUrl)+(entry.durationMs!==undefined?' '+entry.durationMs+'ms':'')+(entry.statusCode?' '+entry.statusCode:'')}).join('\\n')}
function formatSharedGraph(runtime){var graph=(runtime.sharedResolutionGraph||[]).slice(-8);if(!graph.length)return'No shared resolutions.';return graph.map(function(entry){var selected=entry.selected?entry.selected.provider+'@'+entry.selected.version:entry.fallbackSource;return entry.pkgName+' '+entry.status+' '+selected+'\\n  '+entry.reason}).join('\\n')}
function formatPreload(runtime){if(!runtime.lastPreloadRemote)return'No preload calls.';try{return JSON.stringify(runtime.lastPreloadRemote,null,2)}catch{return String(runtime.lastPreloadRemote)}}
function ensureOverlay(){if(typeof document==='undefined'||!document.body)return null;var overlay=document.getElementById('__vite_plugin_federation_devtools_overlay');if(overlay)return overlay;overlay=document.createElement('details');overlay.id='__vite_plugin_federation_devtools_overlay';overlay.open=false;overlay.style.cssText='position:fixed;right:16px;bottom:16px;z-index:2147483647;width:min(520px,calc(100vw - 24px));max-height:min(78vh,760px);overflow:auto;border:1px solid rgba(15,23,42,.18);border-radius:12px;background:rgba(8,13,23,.94);color:#f8fafc;box-shadow:0 18px 58px rgba(15,23,42,.30);font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;backdrop-filter:blur(12px)';overlay.innerHTML='<summary style="cursor:pointer;list-style:none;padding:12px 14px;border-radius:12px;display:flex;align-items:center;justify-content:space-between;gap:12px"><span data-mf-title style="font-weight:700">Module Federation</span><span data-mf-role style="opacity:.72;text-transform:uppercase;font-size:11px"></span></summary><div style="padding:0 14px 14px;display:grid;gap:10px"><div data-mf-meta style="opacity:.82"></div><div data-mf-links style="display:flex;gap:8px;flex-wrap:wrap"></div><button type="button" data-mf-copy style="justify-self:start;border:1px solid rgba(226,232,240,.24);background:rgba(148,163,184,.12);color:#f8fafc;border-radius:8px;padding:5px 8px;font:inherit;cursor:pointer">Copy snapshot</button><pre data-mf-error style="margin:0;padding:9px 10px;border-radius:8px;background:rgba(248,113,113,.13);white-space:pre-wrap;word-break:break-word"></pre><pre data-mf-remotes style="margin:0;padding:9px 10px;border-radius:8px;background:rgba(148,163,184,.10);white-space:pre-wrap;word-break:break-word"></pre><pre data-mf-manifest-timeline style="margin:0;padding:9px 10px;border-radius:8px;background:rgba(148,163,184,.10);white-space:pre-wrap;word-break:break-word"></pre><pre data-mf-shared-graph style="margin:0;padding:9px 10px;border-radius:8px;background:rgba(148,163,184,.10);white-space:pre-wrap;word-break:break-word"></pre><pre data-mf-preload-graph style="margin:0;padding:9px 10px;border-radius:8px;background:rgba(148,163,184,.10);white-space:pre-wrap;word-break:break-word"></pre><pre data-mf-events style="margin:0;padding:9px 10px;border-radius:8px;background:rgba(148,163,184,.10);white-space:pre-wrap;word-break:break-word"></pre></div>';document.body.appendChild(overlay);return overlay}
function renderOverlay(){var overlay=ensureOverlay();if(!overlay)return;var runtime=getRuntime();var meta=overlay.querySelector('[data-mf-meta]');var title=overlay.querySelector('[data-mf-title]');var role=overlay.querySelector('[data-mf-role]');var links=overlay.querySelector('[data-mf-links]');var error=overlay.querySelector('[data-mf-error]');var remotes=overlay.querySelector('[data-mf-remotes]');var manifests=overlay.querySelector('[data-mf-manifest-timeline]');var shared=overlay.querySelector('[data-mf-shared-graph]');var preload=overlay.querySelector('[data-mf-preload-graph]');var events=overlay.querySelector('[data-mf-events]');var copy=overlay.querySelector('[data-mf-copy]');if(title)title.textContent='MF '+payload.name;if(role)role.textContent=payload.role;if(meta)meta.textContent='contract:'+root.contractVersion+' shared:'+payload.shared.length+' remotes:'+payload.remotes.length+' exposes:'+payload.exposes.length;if(links){var items=[];if(payload.manifestUrl)items.push('<a href="'+payload.manifestUrl+'" target="_blank" rel="noreferrer" style="color:#f8fafc">manifest</a>');if(payload.debugUrl)items.push('<a href="'+payload.debugUrl+'" target="_blank" rel="noreferrer" style="color:#f8fafc">debug</a>');if(payload.remoteHmrUrl)items.push('<a href="'+payload.remoteHmrUrl+'" target="_blank" rel="noreferrer" style="color:#f8fafc">hmr</a>');links.innerHTML=items.join('')}if(error)error.textContent='Errors\\n'+formatRuntimeError(runtime);if(remotes)remotes.textContent='Remotes\\n'+formatRemotes(runtime);if(manifests)manifests.textContent='Manifest fetches\\n'+formatManifestTimeline(runtime);if(shared)shared.textContent='Shared graph\\n'+formatSharedGraph(runtime);if(preload)preload.textContent='Preload\\n'+formatPreload(runtime);if(events)events.textContent='Events\\n'+root.events.slice(-8).map(formatEvent).join('\\n');if(copy&&!copy.__mfBound){copy.__mfBound=true;copy.addEventListener('click',function(){root.copySnapshot().then(function(){copy.textContent='Copied'}).catch(function(){copy.textContent='Copy failed'})})}}
function scheduleRender(){if(typeof window==='undefined'||typeof window.requestAnimationFrame!=='function'){renderOverlay();return}window.requestAnimationFrame(renderOverlay)}
trimEvents();
if(typeof window!=='undefined'&&window.addEventListener){window.addEventListener('vite-plugin-federation:debug',function(event){pushEvent('runtime',event.detail)});window.addEventListener('vite-plugin-federation:remote-update',function(event){pushEvent('remote',event.detail)});window.addEventListener('vite-plugin-federation:remote-style-update',function(event){pushEvent('remote-style',event.detail)});window.addEventListener('vite-plugin-federation:remote-types-update',function(event){pushEvent('remote-types',event.detail)})}
if(typeof document!=='undefined'){if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',scheduleRender,{once:true})}else{scheduleRender()}}
if(typeof window!=='undefined'&&window.dispatchEvent&&typeof CustomEvent==='function'){window.dispatchEvent(new CustomEvent('vite-plugin-federation:devtools-ready',{detail:payload}))}
})();`;
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
    capabilities: {
      copySnapshot: true,
      manifestTimeline: true,
      preloadGraph: true,
      remoteRegistry: true,
      runtimeErrors: true,
      sharedGraph: true,
    },
    contractVersion: DEVTOOLS_CONTRACT_VERSION,
    debugUrl: debugFileName ? `${basePath.replace(/\/?$/, '/')}${debugFileName}` : null,
    endpoint: getEndpointPath(config.base, DEVTOOLS_ENDPOINT),
    eventLimit: DEVTOOLS_EVENT_LIMIT,
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
