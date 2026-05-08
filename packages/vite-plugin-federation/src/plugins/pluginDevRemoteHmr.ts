import path from 'pathe';
import type { Plugin, ViteDevServer } from 'vite';
import { clearDevRemoteVersions, setDevRemoteVersion } from '../utils/devRemoteVersionState';
import { mfWarn } from '../utils/logger';
import type { NormalizedModuleFederationOptions } from '../utils/normalizeModuleFederationOptions';
import { packageNameDecode, packageNameEncode } from '../utils/packageUtils';

const REMOTE_HMR_ENDPOINT = '__mf_hmr';
const REMOTE_HMR_EVENT = 'mf:remote-update';
const HOST_REMOTE_HMR_CLIENT_ID = 'virtual:vite-plugin-federation/remote-hmr-client';
const RESOLVED_HOST_REMOTE_HMR_CLIENT_ID = `\0${HOST_REMOTE_HMR_CLIENT_ID}`;
const HOST_REMOTE_HMR_CLIENT_IMPORT_ID = `/@id/${HOST_REMOTE_HMR_CLIENT_ID}`;
const HOST_EXPOSE_UPDATE_EVENT = 'vite-plugin-federation:remote-expose-update';
const HOST_STYLE_UPDATE_EVENT = 'vite-plugin-federation:remote-style-update';
const HOST_TYPES_UPDATE_EVENT = 'vite-plugin-federation:remote-types-update';
const HOST_REMOTE_UPDATE_EVENT = 'vite-plugin-federation:remote-update';
const REMOTE_HMR_CONNECT_RETRY_DELAY_MS = 1000;
const REMOTE_HMR_CONNECT_MAX_RETRIES = 10;
const REMOTE_HMR_BROADCAST_DEBOUNCE_MS = 25;
const STYLE_FILE_RE = /\.(css|less|sass|scss|styl|stylus|pcss|postcss)$/i;
const TYPES_FILE_RE = /\.d\.[cm]?ts$/i;
const ENCODED_LOAD_REMOTE_TAG = packageNameEncode('__loadRemote__');

type RemoteUpdateAction = 'full-reload' | 'partial-reload' | 'style-update' | 'types-update';
type RemoteUpdateStrategy = 'full' | 'partial' | 'style' | 'types';

type RemoteExposeDependencyGraph = {
  expose?: string;
  file: string;
  importers: string[];
  matchedBy: 'direct-expose' | 'importer-graph' | 'none' | 'style' | 'types';
};

type RemoteUpdatePayload = {
  action: RemoteUpdateAction;
  batchId?: string;
  dependencyGraph?: RemoteExposeDependencyGraph;
  expose?: string;
  file: string;
  kind: 'boundary' | 'expose' | 'style' | 'types';
  reason: string;
  remote: string;
  strategy: RemoteUpdateStrategy;
  ts: number;
};

type RemoteUpdateMessage = {
  data?: RemoteUpdatePayload;
  event?: string;
  type?: string;
};

type ModuleGraphNode = {
  id?: string | null;
  importers?: Set<ModuleGraphNode>;
  url?: string;
};

type HostRemoteUpdatePayload = RemoteUpdatePayload & {
  fallbackReason?: string;
  hostRemote: string;
  remoteOrigin?: string;
  remoteRequestId?: string;
};

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

function getRemoteHmrPath(base: string) {
  return `${getBasePath(base).replace(/\/?$/, '/')}${REMOTE_HMR_ENDPOINT}`.replace(/\/{2,}/g, '/');
}

function getHmrWsPath(base: string, hmrPath?: string) {
  const normalizedBase = getBasePath(base);
  const normalizedPath = getBasePath(hmrPath || '');
  if (!normalizedPath || normalizedPath === '/') return normalizedBase;
  const trimmedBase = normalizedBase.endsWith('/') ? normalizedBase.slice(0, -1) : normalizedBase;
  const trimmedPath = normalizedPath.startsWith('/') ? normalizedPath.slice(1) : normalizedPath;
  return `${trimmedBase}/${trimmedPath}`;
}

function shouldIgnoreFile(file: string, options: NormalizedModuleFederationOptions) {
  return (
    file.includes('/node_modules/') ||
    file.includes('\\node_modules\\') ||
    file.includes(`/${options.virtualModuleDir}/`) ||
    file.includes(`\\${options.virtualModuleDir}\\`) ||
    file.includes('/.vite/') ||
    file.includes('\\.vite\\') ||
    file.includes('/.__mf__temp/') ||
    file.includes('\\.__mf__temp\\')
  );
}

function getRemoteHmrWsUrl(server: ViteDevServer) {
  const hmr = server.config.server.hmr;
  const protocol =
    hmr && typeof hmr === 'object' && hmr.protocol
      ? hmr.protocol
      : server.config.server.https
        ? 'wss'
        : 'ws';
  const hostname =
    hmr && typeof hmr === 'object' && hmr.host
      ? hmr.host
      : typeof server.config.server.host === 'string' && server.config.server.host !== '0.0.0.0'
        ? server.config.server.host
        : 'localhost';
  const port =
    hmr && typeof hmr === 'object' && (hmr.clientPort || hmr.port)
      ? hmr.clientPort || hmr.port
      : server.config.server.port;
  return `${protocol}://${hostname}:${port}${getHmrWsPath(server.config.base, hmr && typeof hmr === 'object' ? hmr.path : '')}?token=${server.config.webSocketToken}`;
}

function getLocalFallbackOrigin(server: ViteDevServer) {
  const protocol = server.config.server.https ? 'https' : 'http';
  const host =
    typeof server.config.server.host === 'string' &&
    server.config.server.host !== '0.0.0.0' &&
    server.config.server.host !== '::'
      ? server.config.server.host
      : 'localhost';
  const port = server.config.server.port || 5173;
  return `${protocol}://${host}:${port}`;
}

function getRemoteHmrEndpoint(remoteEntry: string, server: ViteDevServer) {
  try {
    const remoteManifestUrl = new URL(remoteEntry, getLocalFallbackOrigin(server));
    const parts = remoteManifestUrl.pathname.split('/').filter(Boolean);
    remoteManifestUrl.pathname = `/${parts.slice(0, -1).join('/')}`;
    if (!remoteManifestUrl.pathname.endsWith('/')) {
      remoteManifestUrl.pathname += '/';
    }
    remoteManifestUrl.search = '';
    remoteManifestUrl.hash = '';
    return new URL(REMOTE_HMR_ENDPOINT, remoteManifestUrl).toString();
  } catch {
    return null;
  }
}

function parseRemoteHmrMessage(rawData: unknown) {
  if (typeof rawData !== 'string') return null;
  try {
    const parsed = JSON.parse(rawData);
    if (parsed?.type !== 'custom' || typeof parsed?.event !== 'string') return null;
    return parsed as RemoteUpdateMessage;
  } catch {
    return null;
  }
}

function getStringPreview(value: unknown, max = 180) {
  let rawValue = '';
  if (typeof value === 'string') rawValue = value;
  else if (value instanceof Error) rawValue = `${value.name}: ${value.message}`;
  else if (typeof value === 'object' && value !== null) {
    try {
      rawValue = JSON.stringify(value);
    } catch {
      rawValue = '[unserializable]';
    }
  }
  return rawValue.slice(0, max);
}

function isRemoteHmrEnabled(dev: NormalizedModuleFederationOptions['dev']) {
  return typeof dev === 'object' && dev !== null && dev.remoteHmr === true;
}

function normalizeFilePath(value: string) {
  return value.replace(/\\/g, '/').replace(/[?#].*$/, '');
}

function getExposeImportMap(server: ViteDevServer, options: NormalizedModuleFederationOptions) {
  const root = server.config.root || process.cwd();

  return new Map(
    Object.entries(options.exposes)
      .filter(([, expose]) => typeof expose.import === 'string')
      .map(([exposeName, expose]) => [
        normalizeFilePath(path.resolve(root, expose.import)),
        exposeName,
      ]),
  );
}

function findExposeNameForFile(
  server: ViteDevServer,
  options: NormalizedModuleFederationOptions,
  file: string,
) {
  const exposeImportMap = getExposeImportMap(server, options);
  const normalizedFile = normalizeFilePath(file);

  if (exposeImportMap.has(normalizedFile)) {
    return exposeImportMap.get(normalizedFile);
  }

  const getModulesByFile = (
    server.moduleGraph as
      | { getModulesByFile?: (file: string) => Set<ModuleGraphNode> | undefined }
      | undefined
  )?.getModulesByFile;
  if (typeof getModulesByFile !== 'function') return;

  const visited = new Set<ModuleGraphNode>();
  const queue = [
    ...(getModulesByFile.call(server.moduleGraph, normalizedFile) || []),
    ...(getModulesByFile.call(server.moduleGraph, file) || []),
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const currentId = typeof current.id === 'string' ? normalizeFilePath(current.id) : '';
    const matchedExpose = exposeImportMap.get(currentId);
    if (matchedExpose) {
      return matchedExpose;
    }

    current.importers?.forEach((importer) => {
      if (!visited.has(importer)) {
        queue.push(importer);
      }
    });
  }
}

function collectImporterIdsForFile(server: ViteDevServer, file: string, limit = 12) {
  const getModulesByFile = (
    server.moduleGraph as
      | { getModulesByFile?: (file: string) => Set<ModuleGraphNode> | undefined }
      | undefined
  )?.getModulesByFile;
  if (typeof getModulesByFile !== 'function') return [];

  const normalizedFile = normalizeFilePath(file);
  const modules = [
    ...(getModulesByFile.call(server.moduleGraph, normalizedFile) || []),
    ...(getModulesByFile.call(server.moduleGraph, file) || []),
  ];
  const importers = new Set<string>();
  const visited = new Set<ModuleGraphNode>();
  const queue = modules.flatMap((moduleNode) => [...(moduleNode.importers || [])]);

  while (queue.length > 0 && importers.size < limit) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const id = current.id || current.url;
    if (typeof id === 'string') {
      importers.add(normalizeFilePath(id));
    }

    current.importers?.forEach((importer) => {
      if (!visited.has(importer)) {
        queue.push(importer);
      }
    });
  }

  return [...importers];
}

function getExposeMatchType(
  server: ViteDevServer,
  options: NormalizedModuleFederationOptions,
  file: string,
  exposeName: string | undefined,
): RemoteExposeDependencyGraph['matchedBy'] {
  if (!exposeName) return 'none';
  const exposeImportMap = getExposeImportMap(server, options);
  return exposeImportMap.has(normalizeFilePath(file)) ? 'direct-expose' : 'importer-graph';
}

function createDependencyGraph(
  server: ViteDevServer,
  options: NormalizedModuleFederationOptions,
  file: string,
  exposeName: string | undefined,
  matchedBy: RemoteExposeDependencyGraph['matchedBy'],
): RemoteExposeDependencyGraph {
  return {
    expose: exposeName,
    file,
    importers: collectImporterIdsForFile(server, file),
    matchedBy,
  };
}

function classifyRemoteUpdate(
  server: ViteDevServer,
  options: NormalizedModuleFederationOptions,
  file: string,
): RemoteUpdatePayload {
  const normalizedFile = normalizeFilePath(file);
  const exposeName = findExposeNameForFile(server, options, normalizedFile);
  const matchedBy = getExposeMatchType(server, options, normalizedFile, exposeName);

  if (TYPES_FILE_RE.test(normalizedFile)) {
    return {
      action: 'types-update',
      dependencyGraph: createDependencyGraph(server, options, normalizedFile, undefined, 'types'),
      file: normalizedFile,
      kind: 'types',
      reason: 'Type declaration changed; host type sync can update without reloading the page.',
      remote: options.name,
      strategy: 'types',
      ts: Date.now(),
    };
  }

  if (STYLE_FILE_RE.test(normalizedFile) && exposeName) {
    return {
      action: 'style-update',
      dependencyGraph: createDependencyGraph(server, options, normalizedFile, exposeName, 'style'),
      expose: exposeName,
      file: normalizedFile,
      kind: 'style',
      reason: 'Stylesheet belongs to a known remote expose; host can refresh matching CSS links.',
      remote: options.name,
      strategy: 'style',
      ts: Date.now(),
    };
  }

  if (exposeName) {
    return {
      action: 'partial-reload',
      dependencyGraph: createDependencyGraph(
        server,
        options,
        normalizedFile,
        exposeName,
        matchedBy,
      ),
      expose: exposeName,
      file: normalizedFile,
      kind: 'expose',
      reason:
        matchedBy === 'direct-expose'
          ? 'Changed file is a configured expose entry; host virtual modules can reload directly.'
          : 'Changed file is inside a known expose importer graph; host virtual modules can reload partially.',
      remote: options.name,
      strategy: 'partial',
      ts: Date.now(),
    };
  }

  return {
    action: 'full-reload',
    dependencyGraph: createDependencyGraph(server, options, normalizedFile, undefined, 'none'),
    file: normalizedFile,
    kind: 'boundary',
    reason: 'Changed file is outside the known expose graph; falling back to a full reload.',
    remote: options.name,
    strategy: 'full',
    ts: Date.now(),
  };
}

function getRemoteOrigin(remoteEntry: string, server: ViteDevServer) {
  try {
    return new URL(remoteEntry, getLocalFallbackOrigin(server)).origin;
  } catch {
    return null;
  }
}

function toRemoteRequestId(remoteName: string, expose?: string) {
  if (!expose || expose === '.' || expose === './') {
    return remoteName;
  }

  const normalizedExpose = expose.replace(/^\.\//, '');
  return normalizedExpose ? `${remoteName}/${normalizedExpose}` : remoteName;
}

function getRemoteRequestCandidates(remoteNames: string[], expose?: string) {
  const candidates = new Set<string>();

  for (const remoteName of remoteNames) {
    if (!remoteName) continue;
    candidates.add(toRemoteRequestId(remoteName, expose));

    if (expose === '.' || expose === './') {
      candidates.add(remoteName);
    }
  }

  return candidates;
}

function getVirtualRemoteRequestId(moduleId: string) {
  const normalizedId = normalizeFilePath(moduleId);
  const startIndex = normalizedId.indexOf(ENCODED_LOAD_REMOTE_TAG);

  if (startIndex === -1) return;

  const encodedRemoteRequest = normalizedId.slice(startIndex + ENCODED_LOAD_REMOTE_TAG.length);
  const endIndex = encodedRemoteRequest.indexOf(ENCODED_LOAD_REMOTE_TAG);

  if (endIndex === -1) return;

  return packageNameDecode(encodedRemoteRequest.slice(0, endIndex));
}

function collectModuleGraphNodes(server: ViteDevServer) {
  const moduleGraph = server.moduleGraph as {
    idToModuleMap?: Map<string, ModuleGraphNode>;
    urlToModuleMap?: Map<string, ModuleGraphNode>;
  };
  const collectedModules = new Set<ModuleGraphNode>();

  for (const moduleMap of [moduleGraph.idToModuleMap, moduleGraph.urlToModuleMap]) {
    if (!(moduleMap instanceof Map)) continue;

    for (const moduleNode of moduleMap.values()) {
      if (moduleNode) {
        collectedModules.add(moduleNode);
      }
    }
  }

  return collectedModules;
}

function getExpectedRemoteVirtualModuleFiles(
  server: ViteDevServer,
  options: NormalizedModuleFederationOptions,
  remoteRequestIds: Iterable<string>,
) {
  if (!options.internalName) {
    return [];
  }

  const root = server.config.root || process.cwd();
  const virtualModuleRoot = path.resolve(root, 'node_modules', options.virtualModuleDir);
  const remoteLoadTag = '__loadRemote__';

  return [...remoteRequestIds].flatMap((remoteRequestId) => {
    const baseFileName = packageNameEncode(
      `${options.internalName}${remoteLoadTag}${remoteRequestId}${remoteLoadTag}`,
    );
    return ['.mjs', '.js'].map((ext) =>
      normalizeFilePath(path.resolve(virtualModuleRoot, `${baseFileName}${ext}`)),
    );
  });
}

function collectModuleGraphNodesByFile(server: ViteDevServer, fileIds: Iterable<string>) {
  const moduleGraph = server.moduleGraph as {
    getModuleById?: (id: string) => ModuleGraphNode | undefined;
    getModulesByFile?: (file: string) => Set<ModuleGraphNode> | undefined;
  };
  const collectedModules = new Set<ModuleGraphNode>();

  for (const fileId of fileIds) {
    if (typeof moduleGraph.getModuleById === 'function') {
      const moduleNode = moduleGraph.getModuleById(fileId);
      if (moduleNode) {
        collectedModules.add(moduleNode);
      }
    }

    if (typeof moduleGraph.getModulesByFile === 'function') {
      const fileModules = moduleGraph.getModulesByFile(fileId);
      if (fileModules) {
        for (const moduleNode of fileModules) {
          if (moduleNode) {
            collectedModules.add(moduleNode);
          }
        }
      }
    }
  }

  return collectedModules;
}

function findHostRemoteModules(
  server: ViteDevServer,
  options: NormalizedModuleFederationOptions,
  remoteNames: string[],
  expose?: string,
) {
  const candidates = getRemoteRequestCandidates(remoteNames, expose);
  const moduleNodes = new Set<ModuleGraphNode>(collectModuleGraphNodes(server));
  const expectedVirtualModuleFiles = getExpectedRemoteVirtualModuleFiles(
    server,
    options,
    candidates,
  );

  for (const moduleNode of collectModuleGraphNodesByFile(server, expectedVirtualModuleFiles)) {
    moduleNodes.add(moduleNode);
  }

  if (moduleNodes.size === 0) {
    return [];
  }

  const matchedModules: ModuleGraphNode[] = [];

  for (const moduleNode of moduleNodes.values()) {
    const remoteRequestId = [moduleNode?.id, moduleNode?.url]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => getVirtualRemoteRequestId(value))
      .find((value): value is string => typeof value === 'string');

    if (remoteRequestId && candidates.has(remoteRequestId)) {
      matchedModules.push(moduleNode);
    }
  }

  return matchedModules;
}

function toHostRemotePayload(
  payload: RemoteUpdatePayload,
  configuredRemoteName: string,
  remoteOrigin: string | null,
): HostRemoteUpdatePayload {
  return {
    ...payload,
    hostRemote: configuredRemoteName,
    remote: payload.remote || configuredRemoteName,
    remoteOrigin: remoteOrigin || undefined,
    remoteRequestId: payload.expose
      ? toRemoteRequestId(configuredRemoteName, payload.expose)
      : undefined,
  };
}

async function triggerHostRemoteExposeUpdate(
  server: ViteDevServer,
  options: NormalizedModuleFederationOptions,
  payload: HostRemoteUpdatePayload,
) {
  server.ws.send({
    type: 'custom',
    event: HOST_EXPOSE_UPDATE_EVENT,
    data: payload,
  });

  const reloadModule = (
    server as ViteDevServer & {
      reloadModule?: (module: ModuleGraphNode) => Promise<void>;
    }
  ).reloadModule;

  if (typeof reloadModule !== 'function') {
    server.ws.send({
      type: 'custom',
      event: HOST_REMOTE_UPDATE_EVENT,
      data: {
        ...payload,
        action: 'full-reload',
        fallbackReason: 'Vite server.reloadModule is unavailable; falling back to full reload.',
        strategy: 'full',
      },
    });
    server.ws.send({ type: 'full-reload' });
    return;
  }

  const matchedModules = findHostRemoteModules(
    server,
    options,
    [payload.hostRemote, payload.remote].filter(Boolean),
    payload.expose,
  );

  if (matchedModules.length === 0) {
    mfWarn(
      `Remote expose update "${payload.remoteRequestId || payload.hostRemote}" had no matching host virtual modules. ` +
        'Emitting the runtime update event without reloading.',
    );
    return;
  }

  const reloadResults = await Promise.allSettled(
    matchedModules.map((moduleNode) => reloadModule.call(server, moduleNode)),
  );

  for (const [index, result] of reloadResults.entries()) {
    if (result.status === 'rejected') {
      mfWarn(
        `Failed to reload federated host module "${matchedModules[index]?.url || matchedModules[index]?.id || payload.remoteRequestId}": ${getStringPreview(result.reason)}`,
      );
    }
  }
}

function getHostRemoteHmrClientCode() {
  return `if (import.meta.hot) {
  const dispatchRemoteEvent = (eventName, payload) => {
    if (typeof window === "undefined" || !window.dispatchEvent || typeof CustomEvent !== "function") return;
    window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
  };
  const refreshRemoteStylesheets = (payload) => {
    if (typeof document === "undefined" || typeof window === "undefined") return false;
    const timestamp = String(payload?.ts || Date.now());
    const remoteOrigin = payload?.remoteOrigin;
    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'));
    let refreshedCount = 0;
    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href) continue;
      try {
        const currentUrl = new URL(href, window.location.href);
        if (remoteOrigin && currentUrl.origin !== remoteOrigin) continue;
        currentUrl.searchParams.set('t', timestamp);
        const nextLink = link.cloneNode();
        nextLink.href = currentUrl.toString();
        nextLink.onload = () => link.remove();
        nextLink.onerror = () => link.remove();
        link.after(nextLink);
        refreshedCount += 1;
      } catch {}
    }
    return refreshedCount > 0;
  };
  import.meta.hot.on("${HOST_STYLE_UPDATE_EVENT}", (payload) => {
    dispatchRemoteEvent("${HOST_REMOTE_UPDATE_EVENT}", payload);
    dispatchRemoteEvent("${HOST_STYLE_UPDATE_EVENT}", payload);
    if (!refreshRemoteStylesheets(payload)) {
      window.location.reload();
    }
  });
  import.meta.hot.on("${HOST_TYPES_UPDATE_EVENT}", (payload) => {
    dispatchRemoteEvent("${HOST_REMOTE_UPDATE_EVENT}", payload);
    dispatchRemoteEvent("${HOST_TYPES_UPDATE_EVENT}", payload);
  });
  import.meta.hot.on("${HOST_EXPOSE_UPDATE_EVENT}", (payload) => {
    dispatchRemoteEvent("${HOST_REMOTE_UPDATE_EVENT}", payload);
    dispatchRemoteEvent("${HOST_EXPOSE_UPDATE_EVENT}", payload);
  });
}`;
}

export default function pluginDevRemoteHmr(options: NormalizedModuleFederationOptions): Plugin {
  return {
    name: 'module-federation-dev-remote-hmr',
    apply: 'serve',
    resolveId(id) {
      if (id === HOST_REMOTE_HMR_CLIENT_ID) {
        return RESOLVED_HOST_REMOTE_HMR_CLIENT_ID;
      }
    },
    load(id) {
      if (id === RESOLVED_HOST_REMOTE_HMR_CLIENT_ID) {
        return getHostRemoteHmrClientCode();
      }
    },
    transformIndexHtml() {
      if (!isRemoteHmrEnabled(options.dev) || Object.keys(options.remotes).length === 0) return;

      return [
        {
          tag: 'script',
          injectTo: 'head',
          attrs: {
            type: 'module',
          },
          children: `import "${HOST_REMOTE_HMR_CLIENT_IMPORT_ID}";`,
        },
      ];
    },
    configureServer(server) {
      if (!isRemoteHmrEnabled(options.dev)) return;

      const isRemote = Object.keys(options.exposes).length > 0;
      const isHost = Object.keys(options.remotes).length > 0;

      clearDevRemoteVersions(options.internalName);

      if (isRemote) {
        const endpointPath = getRemoteHmrPath(server.config.base);
        const wsUrl = getRemoteHmrWsUrl(server);

        server.middlewares.use((req, res, next) => {
          if (req.url?.replace(/\?.*/, '') !== endpointPath) {
            next();
            return;
          }

          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(
            JSON.stringify({
              debounceMs: REMOTE_HMR_BROADCAST_DEBOUNCE_MS,
              remote: options.name,
              event: REMOTE_HMR_EVENT,
              exposes: Object.entries(options.exposes).map(([expose, exposeOptions]) => ({
                expose,
                import: exposeOptions.import,
              })),
              wsUrl,
            }),
          );
        });

        const pendingFiles = new Set<string>();
        let broadcastTimer: ReturnType<typeof setTimeout> | undefined;

        const flushBroadcasts = () => {
          const batchFiles = [...pendingFiles];
          pendingFiles.clear();
          broadcastTimer = undefined;
          if (batchFiles.length === 0) return;

          const batchId = `${options.name}:${Date.now()}:${batchFiles.length}`;
          for (const file of batchFiles) {
            server.ws.send({
              type: 'custom',
              event: REMOTE_HMR_EVENT,
              data: {
                ...classifyRemoteUpdate(server, options, file),
                batchId,
              },
            });
          }
        };

        const broadcast = (file: string) => {
          if (shouldIgnoreFile(file, options)) return;
          pendingFiles.add(file);
          if (broadcastTimer) clearTimeout(broadcastTimer);
          broadcastTimer = setTimeout(flushBroadcasts, REMOTE_HMR_BROADCAST_DEBOUNCE_MS);
        };

        server.watcher.on('change', broadcast);
        server.watcher.on('add', broadcast);
        server.watcher.on('unlink', broadcast);

        server.httpServer?.once('close', () => {
          if (broadcastTimer) clearTimeout(broadcastTimer);
          pendingFiles.clear();
          server.watcher.off('change', broadcast);
          server.watcher.off('add', broadcast);
          server.watcher.off('unlink', broadcast);
        });
      }

      if (isHost) {
        const connections = new Set<WebSocket>();
        const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
        let isTearingDown = false;

        const clearReconnectTimer = (remoteName: string) => {
          const timer = reconnectTimers.get(remoteName);
          if (!timer) return;
          clearTimeout(timer);
          reconnectTimers.delete(remoteName);
        };

        const scheduleReconnect = (
          remoteName: string,
          remote: { entry: string },
          attempt: number,
          reason: string,
        ) => {
          if (isTearingDown) return;
          if (attempt >= REMOTE_HMR_CONNECT_MAX_RETRIES) {
            mfWarn(
              `Remote "${remoteName}" full HMR reconnect skipped after ${REMOTE_HMR_CONNECT_MAX_RETRIES} attempts: ${reason}`,
            );
            return;
          }
          clearReconnectTimer(remoteName);
          const timer = setTimeout(() => {
            reconnectTimers.delete(remoteName);
            void connectRemote(remoteName, remote, attempt + 1);
          }, REMOTE_HMR_CONNECT_RETRY_DELAY_MS);
          reconnectTimers.set(remoteName, timer);
        };

        const connectRemote = async (
          remoteAlias: string,
          remote: { entry: string; name?: string },
          attempt = 0,
        ) => {
          if (isTearingDown) return;
          const configuredRemoteName = remote.name || remoteAlias;
          const endpoint = getRemoteHmrEndpoint(remote.entry, server);
          if (!endpoint) {
            mfWarn(`Failed to build HMR endpoint URL for remote "${configuredRemoteName}"`);
            return;
          }

          try {
            const metadataResponse = await fetch(endpoint);
            if (!metadataResponse.ok) {
              mfWarn(
                `Failed to fetch remote HMR metadata from "${configuredRemoteName}": ${metadataResponse.status}`,
              );
              scheduleReconnect(remoteAlias, remote, attempt, `HTTP ${metadataResponse.status}`);
              return;
            }

            const metadata = (await metadataResponse.json()) as {
              remote?: string;
              event?: string;
              wsUrl?: string;
            };
            if (metadata.event !== REMOTE_HMR_EVENT || !metadata.wsUrl) {
              mfWarn(`Remote "${configuredRemoteName}" returned unexpected HMR metadata shape`);
              return;
            }

            const ws = new WebSocket(metadata.wsUrl, 'vite-hmr');
            let hasOpened = false;
            ws.onmessage = (rawEvent: { data: unknown }) => {
              const message = parseRemoteHmrMessage(rawEvent.data);
              if (!message || message.event !== REMOTE_HMR_EVENT) return;
              const payload = message.data;
              if (!payload) {
                server.ws.send({ type: 'full-reload' });
                return;
              }

              if (payload.action === 'types-update') {
                server.ws.send({
                  type: 'custom',
                  event: HOST_TYPES_UPDATE_EVENT,
                  data: toHostRemotePayload(
                    payload,
                    configuredRemoteName,
                    getRemoteOrigin(remote.entry, server),
                  ),
                });
                return;
              }

              if (payload.action === 'style-update') {
                const remoteOrigin = getRemoteOrigin(remote.entry, server);
                if (!remoteOrigin) {
                  server.ws.send({ type: 'full-reload' });
                  return;
                }

                server.ws.send({
                  type: 'custom',
                  event: HOST_STYLE_UPDATE_EVENT,
                  data: toHostRemotePayload(payload, configuredRemoteName, remoteOrigin),
                });
                return;
              }

              if (payload.action === 'partial-reload') {
                const hostPayload = toHostRemotePayload(
                  payload,
                  configuredRemoteName,
                  getRemoteOrigin(remote.entry, server),
                );
                if (hostPayload.remoteRequestId) {
                  setDevRemoteVersion(
                    options.internalName,
                    hostPayload.remoteRequestId,
                    hostPayload.ts,
                  );
                }
                void triggerHostRemoteExposeUpdate(server, options, hostPayload);
                return;
              }

              server.ws.send({ type: 'full-reload' });
            };
            ws.onopen = () => {
              hasOpened = true;
              clearReconnectTimer(remoteAlias);
            };
            ws.onerror = (error) =>
              mfWarn(`Remote HMR socket error for "${configuredRemoteName}":`, error);
            ws.onclose = () => {
              connections.delete(ws);
              scheduleReconnect(remoteAlias, remote, hasOpened ? 0 : attempt, 'socket closed');
            };

            connections.add(ws);
          } catch (error) {
            mfWarn(
              `Failed to connect remote HMR for "${configuredRemoteName}" on attempt ${attempt + 1}: ${getStringPreview(error)}`,
            );
            scheduleReconnect(remoteAlias, remote, attempt, getStringPreview(error));
          }
        };

        const teardown = () => {
          isTearingDown = true;
          clearDevRemoteVersions(options.internalName);
          reconnectTimers.forEach((timer) => clearTimeout(timer));
          reconnectTimers.clear();
          connections.forEach((connection) => {
            if (
              connection.readyState !== connection.CLOSING &&
              connection.readyState !== connection.CLOSED
            )
              connection.close();
          });
          connections.clear();
        };

        for (const [remoteName, remote] of Object.entries(options.remotes)) {
          void connectRemote(remoteName, remote);
        }

        const triggerHostReload = (file: string) => {
          if (shouldIgnoreFile(file, options)) return;
          server.ws.send({ type: 'full-reload' });
        };

        server.watcher.on('change', triggerHostReload);
        server.watcher.on('add', triggerHostReload);
        server.watcher.on('unlink', triggerHostReload);

        server.httpServer?.once('close', teardown);
      }
    },
  };
}
