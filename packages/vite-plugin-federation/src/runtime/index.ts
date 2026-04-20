import {
  getInstance as getRuntimeInstance,
  getRemoteEntry,
  getRemoteInfo,
  init as initRuntimeInstance,
  loadRemote as loadRuntimeRemote,
  loadScript,
  loadScriptNode,
  loadShare,
  loadShareSync,
  preloadRemote as preloadRuntimeRemote,
  registerGlobalPlugins,
  registerPlugins as registerRuntimePlugins,
  registerRemotes as registerRuntimeRemotes,
  registerShared as registerRuntimeShared,
} from '@module-federation/runtime';
import type { ModuleFederation } from '@module-federation/runtime';
import type { UserOptions } from '@module-federation/runtime/types';
import type * as NodeVm from 'node:vm';
import {
  createModuleFederationError,
  getModuleFederationDebugState,
  type ModuleFederationErrorCode,
} from '../utils/logger';

const MODULE_FEDERATION_RUNTIME_DEBUG_SYMBOL = Symbol.for('vite-plugin-federation.runtime.debug');
const NODE_TARGET_QUERY_KEY = 'mf_target';
const NODE_TARGET_QUERY_VALUE = 'node';
const STYLE_REQUEST_RE = /\.(css|less|sass|scss|styl|stylus|pcss|postcss)$/i;
const NODE_RUNTIME_ENTRY_LOADER_PLUGIN_NAME = 'vite-plugin-federation:node-entry-loader';
const ABSOLUTE_URL_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;
const NODE_VM_IMPORT_GLOBAL_KEY = '__VITE_PLUGIN_FEDERATION_IMPORT_NODE_VM__';
const MANIFEST_URL_RE = /(?:^|\/)(?:mf-)?manifest(?:\.[\w-]+)?\.json(?:$|[?#])/i;

export type FederationRuntimeTarget = 'web' | 'node';

export interface FederationRemoteManifestEntry {
  name?: string;
  path?: string;
  type?: string;
}

export interface FederationRemoteManifest {
  id?: string;
  name: string;
  metaData: {
    name?: string;
    globalName?: string;
    publicPath?: string;
    remoteEntry?: FederationRemoteManifestEntry;
    ssrRemoteEntry?: FederationRemoteManifestEntry;
    types?: {
      path?: string;
      name?: string;
    };
  };
  exposes?: unknown;
  shared?: unknown;
  [key: string]: unknown;
}

export interface RegisterManifestRemoteOptions {
  fetch?: typeof fetch;
  fetchInit?: RequestInit;
  force?: boolean;
  remoteName?: string;
  shareScope?: string;
  target?: FederationRuntimeTarget;
}

interface RuntimeDebugState {
  lastLoadError: {
    code: ModuleFederationErrorCode;
    message: string;
    remoteId: string;
    timestamp: string;
  } | null;
  lastLoadRemote: {
    remoteId: string;
    timestamp: string;
  } | null;
  lastPreloadRemote: unknown[] | null;
  registeredRemotes: Array<Record<string, unknown>>;
  registeredSharedKeys: string[];
  manifestCache: Map<string, FederationRemoteManifest>;
  manifestRequests: Map<string, Promise<FederationRemoteManifest>>;
  registrationRequests: Map<string, Promise<Record<string, unknown>>>;
  registeredManifestRemotes: Map<
    string,
    {
      alias: string;
      entry: string;
      entryGlobalName: string;
      manifestUrl: string;
      name: string;
      shareScope: string;
      target: FederationRuntimeTarget;
      type: string;
    }
  >;
}

interface FederationRuntimePluginLike {
  name: string;
  loadEntry?: (args: {
    remoteInfo?: {
      entry?: string;
      type?: string;
    };
    remoteEntryExports?: unknown;
  }) => Promise<unknown> | unknown;
}

type FederationRuntimePlugins = NonNullable<UserOptions['plugins']>;
const nodeRuntimeModuleCache = new Map<string, Promise<any>>();
type NodeVmModule = typeof NodeVm;
type RuntimeInstanceWithInternals = ModuleFederation & {
  options?: {
    remotes?: Array<Record<string, unknown>>;
  };
};

async function importNodeVmModule(): Promise<NodeVmModule> {
  const globalImportHook = (
    globalThis as typeof globalThis & {
      [NODE_VM_IMPORT_GLOBAL_KEY]?: () => Promise<NodeVmModule>;
    }
  )[NODE_VM_IMPORT_GLOBAL_KEY];

  if (globalImportHook) {
    return globalImportHook();
  }

  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<NodeVmModule>;
  return dynamicImport('node:vm');
}

type RuntimeDebugEventName =
  | 'create-instance'
  | 'register-remotes'
  | 'register-shared'
  | 'load-remote'
  | 'refresh-remote'
  | 'load-error'
  | 'manifest-fetched'
  | 'manifest-registered'
  | 'clear-caches';

function getRuntimeDebugState(): RuntimeDebugState {
  const state = globalThis as typeof globalThis & {
    [MODULE_FEDERATION_RUNTIME_DEBUG_SYMBOL]?: RuntimeDebugState;
  };

  state[MODULE_FEDERATION_RUNTIME_DEBUG_SYMBOL] ||= {
    lastLoadError: null,
    lastLoadRemote: null,
    lastPreloadRemote: null,
    registeredRemotes: [],
    registeredSharedKeys: [],
    manifestCache: new Map(),
    manifestRequests: new Map(),
    registrationRequests: new Map(),
    registeredManifestRemotes: new Map(),
  };

  return state[MODULE_FEDERATION_RUNTIME_DEBUG_SYMBOL];
}

function toNodeTargetUrl(origin: string, requestPath: string) {
  const resolved = new URL(
    !requestPath.startsWith('.') &&
      !requestPath.startsWith('/') &&
      !ABSOLUTE_URL_RE.test(requestPath)
      ? `/@id/${requestPath}`
      : requestPath,
    origin,
  );
  resolved.searchParams.set(NODE_TARGET_QUERY_KEY, NODE_TARGET_QUERY_VALUE);
  return resolved.toString();
}

function normalizeNodeTargetModuleCode(code: string, requestUrl: string) {
  if (STYLE_REQUEST_RE.test(new URL(requestUrl).pathname)) {
    return 'export default {};';
  }

  const exportStatements: string[] = [];
  let exportAliasIndex = 0;
  let normalized = code.replace(
    /^__vite_ssr_exportName__\("([^"]+)", \(\) => \{ try \{ return ([^ }]+) \} catch \{\} \}\);\s*$/gm,
    (_match, exportName: string, localName: string) => {
      exportStatements.push(
        exportName === 'default'
          ? `export default ${localName};`
          : `export { ${localName} as ${exportName} };`,
      );
      return '';
    },
  );

  normalized = normalized
    .replace(
      /await\s+__vite_ssr_import__\("([^"]+)"(?:,\s*\{[^)]*\})?\)/g,
      (_match, specifier: string) =>
        `await import(${JSON.stringify(toNodeTargetUrl(requestUrl, specifier))})`,
    )
    .replace(
      /__vite_ssr_dynamic_import__\("([^"]+)"\)/g,
      (_match, specifier: string) =>
        `import(${JSON.stringify(toNodeTargetUrl(requestUrl, specifier))})`,
    )
    .replace(/\b__vite_ssr_import_meta__\.url\b/g, 'import.meta.url')
    .replace(/\b__vite_ssr_import_meta__\b/g, 'import.meta')
    .replace(
      /export\s*\{\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s+as\s+([A-Za-z_$][\w$]*)\s*\};?/g,
      (_statement, localExpression: string, exportName: string) => {
        const localAlias = `__mf_export_${exportAliasIndex++}__`;
        return `const ${localAlias} = ${localExpression};\nexport { ${localAlias} as ${exportName} };`;
      },
    )
    .replace(/(from\s+["'])(\/[^"']+)(["'])/g, (_match, before, target, after) => {
      return `${before}${toNodeTargetUrl(requestUrl, target)}${after}`;
    })
    .replace(/(import\s+["'])(\/[^"']+)(["'])/g, (_match, before, target, after) => {
      return `${before}${toNodeTargetUrl(requestUrl, target)}${after}`;
    })
    .replace(/(import\(\s*["'])(\/[^"']+)(["']\s*\))/g, (_match, before, target, after) => {
      return `${before}${toNodeTargetUrl(requestUrl, target)}${after}`;
    });

  if (exportStatements.length > 0) {
    normalized = `${normalized.trim()}\n${exportStatements.join('\n')}\n`;
  }

  return normalized;
}

async function loadNodeRuntimeModule(url: string): Promise<any> {
  const cachedModule = nodeRuntimeModuleCache.get(url);
  if (cachedModule) {
    return cachedModule;
  }

  const modulePromise = (async () => {
    if (!globalThis.fetch) {
      throw createModuleFederationError(
        'MFV-004',
        'global fetch is unavailable. Provide a fetch implementation before loading node federation entries.',
      );
    }

    const response = await globalThis.fetch(url);
    if (!response.ok) {
      throw createModuleFederationError(
        'MFV-004',
        `Failed to fetch node federation module "${url}" with status ${response.status}.`,
      );
    }

    const vm = await importNodeVmModule();
    const code = normalizeNodeTargetModuleCode(await response.text(), url);
    const module = new vm.SourceTextModule(code, {
      identifier: url,
      importModuleDynamically: async (specifier) => {
        const importedModule = await loadNodeRuntimeModule(new URL(specifier, url).href);
        await importedModule.evaluate();
        return importedModule;
      },
    });

    await module.link(async (specifier) => {
      return loadNodeRuntimeModule(new URL(specifier, url).href);
    });

    return module;
  })();

  nodeRuntimeModuleCache.set(url, modulePromise);

  try {
    return await modulePromise;
  } catch (error) {
    nodeRuntimeModuleCache.delete(url);
    throw error;
  }
}

async function loadNodeRuntimeModuleNamespace(url: string) {
  const module = await loadNodeRuntimeModule(url);
  await module.evaluate();
  return module.namespace;
}

function createNodeRuntimeEntryLoaderPlugin(): FederationRuntimePluginLike {
  return {
    name: NODE_RUNTIME_ENTRY_LOADER_PLUGIN_NAME,
    async loadEntry({ remoteInfo, remoteEntryExports }) {
      if (
        typeof (globalThis as typeof globalThis & { window?: unknown }).window !== 'undefined' ||
        remoteEntryExports
      ) {
        return remoteEntryExports;
      }

      if (!remoteInfo?.entry) {
        return undefined;
      }

      if (remoteInfo.type && !['module', 'esm'].includes(remoteInfo.type)) {
        return undefined;
      }

      return loadNodeRuntimeModuleNamespace(remoteInfo.entry);
    },
  };
}

function withNodeRuntimePlugins(options: UserOptions) {
  const plugins = [...(options.plugins || [])];
  if (
    typeof (globalThis as typeof globalThis & { window?: unknown }).window === 'undefined' &&
    !plugins.some((plugin) => plugin?.name === NODE_RUNTIME_ENTRY_LOADER_PLUGIN_NAME)
  ) {
    plugins.push(createNodeRuntimeEntryLoaderPlugin() as FederationRuntimePlugins[number]);
  }

  return {
    ...options,
    plugins,
  };
}

function getDevtoolsGlobal() {
  const state = globalThis as typeof globalThis & {
    __VITE_PLUGIN_FEDERATION_DEVTOOLS__?: {
      apps?: Record<string, unknown>;
      events?: Array<Record<string, unknown>>;
      lastUpdatedAt?: string;
      runtime?: unknown;
    };
  };

  state.__VITE_PLUGIN_FEDERATION_DEVTOOLS__ ||= {};
  state.__VITE_PLUGIN_FEDERATION_DEVTOOLS__.events ||= [];

  return state.__VITE_PLUGIN_FEDERATION_DEVTOOLS__;
}

function snapshotInstance(instance: ModuleFederation | null) {
  if (!instance) {
    return null;
  }

  const runtimeInstance = instance as ModuleFederation & {
    name?: string;
    options?: Record<string, unknown>;
  };

  return {
    name: runtimeInstance.name ?? runtimeInstance.options?.name ?? null,
    options: runtimeInstance.options ?? null,
  };
}

function syncRegisteredRemoteDebugState() {
  const debugState = getRuntimeDebugState();
  const runtimeInstance = getRuntimeInstance() as RuntimeInstanceWithInternals | null;

  const remotes = runtimeInstance?.options?.remotes;
  if (!Array.isArray(remotes)) {
    return;
  }

  debugState.registeredRemotes = remotes.map((remote) => ({ ...remote }));
}

export {
  getRemoteEntry,
  getRemoteInfo,
  loadScript,
  loadScriptNode,
  loadShare,
  loadShareSync,
  registerGlobalPlugins,
};

export function getInstance() {
  return getRuntimeInstance();
}

export function createFederationInstance(options: UserOptions) {
  const instance = initRuntimeInstance(withNodeRuntimePlugins(options));
  publishRuntimeDebugUpdate('create-instance');
  return instance;
}

export function createServerFederationInstance(options: UserOptions) {
  const instance = initRuntimeInstance({
    ...withNodeRuntimePlugins(options),
    inBrowser: false,
  } as UserOptions);
  publishRuntimeDebugUpdate('create-instance');
  return instance;
}

export function registerPlugins(...args: Parameters<ModuleFederation['registerPlugins']>) {
  return registerRuntimePlugins(...args);
}

export function registerRemotes(...args: Parameters<ModuleFederation['registerRemotes']>) {
  const result = registerRuntimeRemotes(...args);
  syncRegisteredRemoteDebugState();
  publishRuntimeDebugUpdate('register-remotes');
  return result;
}

function findRegisteredRuntimeRemote(
  runtimeInstance: RuntimeInstanceWithInternals | null,
  remoteIdentifier: string | undefined,
) {
  if (!remoteIdentifier || !Array.isArray(runtimeInstance?.options?.remotes)) {
    return undefined;
  }

  return runtimeInstance.options.remotes.find((remote) => {
    return remote?.name === remoteIdentifier || remote?.alias === remoteIdentifier;
  });
}

function registerRuntimeRemoteWithReplace(
  remote: Parameters<ModuleFederation['registerRemotes']>[0][number],
  options: {
    force?: boolean;
    remoteIdentifier?: string;
  } = {},
) {
  if (!options.force) {
    return registerRemotes([remote]);
  }

  const runtimeInstance = getRuntimeInstance() as RuntimeInstanceWithInternals | null;
  const registeredRemote =
    findRegisteredRuntimeRemote(runtimeInstance, options.remoteIdentifier) ||
    findRegisteredRuntimeRemote(
      runtimeInstance,
      typeof remote.alias === 'string' ? remote.alias : undefined,
    ) ||
    findRegisteredRuntimeRemote(
      runtimeInstance,
      typeof remote.name === 'string' ? remote.name : undefined,
    );
  const remoteHandler = (runtimeInstance as { remoteHandler?: { removeRemote?: unknown } } | null)
    ?.remoteHandler;
  const removeRemote = remoteHandler?.removeRemote;

  if (registeredRemote && typeof removeRemote === 'function') {
    removeRemote.call(remoteHandler, registeredRemote);
    return registerRemotes([remote]);
  }

  return registerRemotes([remote], { force: true });
}

export function registerShared(...args: Parameters<ModuleFederation['registerShared']>) {
  const [shared] = args;
  const debugState = getRuntimeDebugState();

  debugState.registeredSharedKeys = shared ? Object.keys(shared) : [];
  const result = registerRuntimeShared(...args);
  publishRuntimeDebugUpdate('register-shared');
  return result;
}

export async function loadRemote<T>(...args: Parameters<ModuleFederation['loadRemote']>) {
  const [remoteId] = args;
  const debugState = getRuntimeDebugState();

  try {
    const result = await loadRuntimeRemote<T>(...args);
    debugState.lastLoadRemote = {
      remoteId,
      timestamp: new Date().toISOString(),
    };
    publishRuntimeDebugUpdate('load-remote');
    return result;
  } catch (error) {
    debugState.lastLoadError = {
      code: 'MFV-004',
      message: error instanceof Error ? error.message : String(error),
      remoteId,
      timestamp: new Date().toISOString(),
    };
    publishRuntimeDebugUpdate('load-error');
    throw error;
  }
}

export function preloadRemote(...args: Parameters<ModuleFederation['preloadRemote']>) {
  const debugState = getRuntimeDebugState();
  debugState.lastPreloadRemote = [...args];
  return preloadRuntimeRemote(...args);
}

function getDefaultTarget(target?: FederationRuntimeTarget): FederationRuntimeTarget {
  if (target) return target;
  return typeof (globalThis as { window?: unknown }).window === 'undefined' ? 'node' : 'web';
}

function getManifestRequestKey(
  remoteAlias: string,
  manifestUrl: string,
  target: FederationRuntimeTarget,
) {
  return `${target}:${remoteAlias}:${manifestUrl}`;
}

function getManifestFetchImplementation(fetchOverride?: typeof fetch) {
  const fetchImplementation = fetchOverride ?? globalThis.fetch;
  if (!fetchImplementation) {
    throw createModuleFederationError(
      'MFV-004',
      'global fetch is unavailable. Provide `options.fetch` when registering manifest remotes.',
    );
  }
  return fetchImplementation;
}

function isAbsoluteUrl(value: string) {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value) || value.startsWith('//');
}

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, '');
}

function joinUrlPath(...parts: Array<string | undefined>) {
  const filteredParts = parts
    .map((part) => (part || '').trim())
    .filter(Boolean)
    .map((part) => trimSlashes(part));
  return filteredParts.join('/');
}

function resolveManifestAssetUrl(
  manifestUrl: string,
  entry: FederationRemoteManifestEntry,
  publicPath?: string,
) {
  const entryPath = joinUrlPath(entry.path, entry.name);
  if (!entryPath) {
    return manifestUrl;
  }
  if (isAbsoluteUrl(entryPath)) {
    return entryPath;
  }
  if (publicPath && publicPath !== 'auto') {
    return new URL(entryPath, new URL(publicPath, manifestUrl)).toString();
  }
  return new URL(entryPath, manifestUrl).toString();
}

function appendEntryRefreshTimestamp(
  entryUrl: string,
  target: FederationRuntimeTarget,
  enabled: boolean | undefined,
) {
  if (!enabled || target !== 'web') {
    return entryUrl;
  }

  const refreshedUrl = new URL(entryUrl);
  refreshedUrl.searchParams.set('t', String(Date.now()));
  return refreshedUrl.toString();
}

function getManifestEntryForTarget(
  manifestUrl: string,
  manifest: FederationRemoteManifest,
  target: FederationRuntimeTarget,
) {
  const { metaData } = manifest;
  if (!metaData) {
    throw createModuleFederationError(
      'MFV-004',
      `Federation manifest "${manifestUrl}" is invalid: missing metaData.`,
    );
  }

  if (target === 'node') {
    const nodeEntry = metaData.ssrRemoteEntry || metaData.remoteEntry;
    if (!nodeEntry?.name) {
      throw createModuleFederationError(
        'MFV-006',
        `Federation manifest "${manifestUrl}" does not declare a usable ssrRemoteEntry.`,
      );
    }
    return nodeEntry;
  }

  const browserEntry = metaData.remoteEntry || metaData.ssrRemoteEntry;
  if (!browserEntry?.name) {
    throw createModuleFederationError(
      'MFV-004',
      `Federation manifest "${manifestUrl}" does not declare a usable remoteEntry.`,
    );
  }
  return browserEntry;
}

function validateManifest(manifestUrl: string, manifest: FederationRemoteManifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw createModuleFederationError(
      'MFV-004',
      `Federation manifest "${manifestUrl}" is invalid: expected a JSON object.`,
    );
  }

  if (!manifest.name || !manifest.metaData) {
    throw createModuleFederationError(
      'MFV-004',
      `Federation manifest "${manifestUrl}" is invalid: missing name or metaData.`,
    );
  }
}

export async function fetchFederationManifest(
  manifestUrl: string,
  options: Pick<RegisterManifestRemoteOptions, 'fetch' | 'fetchInit'> = {},
) {
  const debugState = getRuntimeDebugState();
  const cachedManifest = debugState.manifestCache.get(manifestUrl);
  if (cachedManifest) {
    return cachedManifest;
  }

  const pendingManifest = debugState.manifestRequests.get(manifestUrl);
  if (pendingManifest) {
    return pendingManifest;
  }

  const fetchManifestPromise = (async () => {
    try {
      const response = await getManifestFetchImplementation(options.fetch)(
        manifestUrl,
        options.fetchInit,
      );
      if (!response.ok) {
        throw createModuleFederationError(
          'MFV-004',
          `Failed to fetch federation manifest "${manifestUrl}" with status ${response.status}.`,
        );
      }

      const manifest = (await response.json()) as FederationRemoteManifest;
      validateManifest(manifestUrl, manifest);
      debugState.manifestCache.set(manifestUrl, manifest);
      publishRuntimeDebugUpdate('manifest-fetched');
      return manifest;
    } catch (error) {
      debugState.lastLoadError = {
        code: 'MFV-004',
        message: error instanceof Error ? error.message : String(error),
        remoteId: manifestUrl,
        timestamp: new Date().toISOString(),
      };
      throw error;
    } finally {
      debugState.manifestRequests.delete(manifestUrl);
    }
  })();

  debugState.manifestRequests.set(manifestUrl, fetchManifestPromise);
  return fetchManifestPromise;
}

export async function registerManifestRemote(
  remoteAlias: string,
  manifestUrl: string,
  options: RegisterManifestRemoteOptions = {},
) {
  const debugState = getRuntimeDebugState();
  const target = getDefaultTarget(options.target);
  const requestKey = getManifestRequestKey(remoteAlias, manifestUrl, target);

  if (!options.force) {
    const pendingRegistration = debugState.registrationRequests.get(requestKey);
    if (pendingRegistration) {
      return pendingRegistration;
    }
  }

  const registerPromise = (async () => {
    const manifest = await fetchFederationManifest(manifestUrl, options);
    const selectedEntry = getManifestEntryForTarget(manifestUrl, manifest, target);
    const remoteName = options.remoteName || manifest.name || remoteAlias;
    const shareScope = options.shareScope || 'default';
    const remoteEntryUrl = resolveManifestAssetUrl(
      manifestUrl,
      selectedEntry,
      manifest.metaData.publicPath,
    );
    const registration = {
      alias: remoteAlias === remoteName ? undefined : remoteAlias,
      entry: appendEntryRefreshTimestamp(remoteEntryUrl, target, options.force),
      entryGlobalName: manifest.metaData.globalName || remoteName,
      name: remoteName,
      shareScope,
      type: selectedEntry.type || 'module',
    };

    registerRuntimeRemoteWithReplace(registration, {
      force: options.force,
      remoteIdentifier: remoteAlias,
    });

    debugState.registeredManifestRemotes.set(requestKey, {
      alias: remoteAlias,
      entry: registration.entry,
      entryGlobalName: registration.entryGlobalName,
      manifestUrl,
      name: registration.name,
      shareScope: registration.shareScope,
      target,
      type: registration.type,
    });
    publishRuntimeDebugUpdate('manifest-registered');

    return registration;
  })().finally(() => {
    debugState.registrationRequests.delete(requestKey);
  });

  debugState.registrationRequests.set(requestKey, registerPromise);
  return registerPromise;
}

export interface RefreshRemoteOptions extends RegisterManifestRemoteOptions {
  invalidateManifest?: boolean;
  manifestUrl?: string;
}

function getRegisteredManifestRemote(remoteAlias: string, target: FederationRuntimeTarget) {
  const debugState = getRuntimeDebugState();
  return [...debugState.registeredManifestRemotes.entries()].find(([, remote]) => {
    return remote.alias === remoteAlias && remote.target === target;
  });
}

function getRegisteredRuntimeRemote(remoteAlias: string) {
  const runtimeInstance = getRuntimeInstance() as RuntimeInstanceWithInternals | null;
  const remotes = runtimeInstance?.options?.remotes;

  if (!Array.isArray(remotes)) {
    return undefined;
  }

  return remotes.find((remote) => {
    return remote?.name === remoteAlias || remote?.alias === remoteAlias;
  });
}

function isManifestRemoteEntry(entry: unknown) {
  return typeof entry === 'string' && MANIFEST_URL_RE.test(entry);
}

export async function refreshRemote(remoteIdOrAlias: string, options: RefreshRemoteOptions = {}) {
  const remoteAlias = remoteIdOrAlias.split('/')[0];
  if (!remoteAlias) {
    throw createModuleFederationError('MFV-004', `Invalid remote id "${remoteIdOrAlias}".`);
  }

  const target = getDefaultTarget(options.target);
  const registeredManifestRemote = getRegisteredManifestRemote(remoteAlias, target);
  const manifestUrl = options.manifestUrl || registeredManifestRemote?.[1].manifestUrl;

  if (manifestUrl) {
    const debugState = getRuntimeDebugState();
    const requestKey =
      registeredManifestRemote?.[0] || getManifestRequestKey(remoteAlias, manifestUrl, target);

    if (options.invalidateManifest !== false) {
      debugState.manifestCache.delete(manifestUrl);
    }
    debugState.manifestRequests.delete(manifestUrl);
    debugState.registrationRequests.delete(requestKey);
    debugState.registeredManifestRemotes.delete(requestKey);

    const registration = await registerManifestRemote(remoteAlias, manifestUrl, {
      ...options,
      force: true,
      remoteName: options.remoteName || registeredManifestRemote?.[1].name,
      shareScope: options.shareScope || registeredManifestRemote?.[1].shareScope,
      target,
    });

    syncRegisteredRemoteDebugState();
    publishRuntimeDebugUpdate('refresh-remote');
    return registration;
  }

  const runtimeRemote = getRegisteredRuntimeRemote(remoteAlias);
  if (!runtimeRemote) {
    throw createModuleFederationError(
      'MFV-004',
      `Remote "${remoteAlias}" is not registered in the current federation runtime instance.`,
    );
  }

  const runtimeRemoteRecord = runtimeRemote as unknown as Record<string, unknown>;
  const runtimeRemoteEntry =
    typeof runtimeRemoteRecord.entry === 'string' ? runtimeRemoteRecord.entry : undefined;

  if (runtimeRemoteEntry && isManifestRemoteEntry(runtimeRemoteEntry)) {
    const registration = await registerManifestRemote(remoteAlias, runtimeRemoteEntry, {
      ...options,
      force: true,
      remoteName:
        typeof runtimeRemoteRecord.name === 'string'
          ? (runtimeRemoteRecord.name as string)
          : options.remoteName,
      shareScope:
        typeof runtimeRemoteRecord.shareScope === 'string'
          ? (runtimeRemoteRecord.shareScope as string)
          : options.shareScope,
      target,
    });

    syncRegisteredRemoteDebugState();
    publishRuntimeDebugUpdate('refresh-remote');
    return registration;
  }

  const refreshedRuntimeRemote = {
    ...runtimeRemoteRecord,
    ...(typeof runtimeRemoteRecord.entry === 'string'
      ? {
          entry: appendEntryRefreshTimestamp(runtimeRemoteRecord.entry, target, true),
        }
      : {}),
  } as Parameters<ModuleFederation['registerRemotes']>[0][number];

  registerRuntimeRemoteWithReplace(refreshedRuntimeRemote, {
    force: true,
    remoteIdentifier: remoteAlias,
  });
  syncRegisteredRemoteDebugState();
  publishRuntimeDebugUpdate('refresh-remote');
  return runtimeRemote;
}

export async function registerManifestRemotes(
  remotes: Record<string, string | (RegisterManifestRemoteOptions & { manifestUrl: string })>,
  target?: FederationRuntimeTarget,
) {
  const registrations = await Promise.all(
    Object.entries(remotes).map(([remoteAlias, remoteConfig]) => {
      if (typeof remoteConfig === 'string') {
        return registerManifestRemote(remoteAlias, remoteConfig, { target });
      }
      return registerManifestRemote(remoteAlias, remoteConfig.manifestUrl, {
        ...remoteConfig,
        target: remoteConfig.target || target,
      });
    }),
  );

  return registrations;
}

export async function loadRemoteFromManifest<T>(
  remoteId: string,
  manifestUrl: string,
  options: RegisterManifestRemoteOptions &
    Partial<NonNullable<Parameters<ModuleFederation['loadRemote']>[1]>> = {},
) {
  const [remoteAlias] = remoteId.split('/');
  if (!remoteAlias) {
    throw createModuleFederationError('MFV-004', `Invalid remote id "${remoteId}".`);
  }

  const { fetch, fetchInit, force, remoteName, shareScope, target, ...loadRemoteOptions } = options;

  await registerManifestRemote(remoteAlias, manifestUrl, {
    fetch,
    fetchInit,
    force,
    remoteName,
    shareScope,
    target,
  });

  const runtimeLoadOptions = {
    from: 'runtime',
    ...loadRemoteOptions,
  } as Parameters<ModuleFederation['loadRemote']>[1];

  return loadRemote<T>(remoteId, runtimeLoadOptions);
}

export function clearFederationRuntimeCaches() {
  const debugState = getRuntimeDebugState();
  nodeRuntimeModuleCache.clear();
  debugState.lastLoadError = null;
  debugState.lastLoadRemote = null;
  debugState.lastPreloadRemote = null;
  debugState.registeredRemotes = [];
  debugState.registeredSharedKeys = [];
  debugState.manifestCache.clear();
  debugState.manifestRequests.clear();
  debugState.registrationRequests.clear();
  debugState.registeredManifestRemotes.clear();
  publishRuntimeDebugUpdate('clear-caches');
}

export function getFederationDebugInfo() {
  const debugState = getRuntimeDebugState();

  return {
    diagnostics: getModuleFederationDebugState(),
    instance: snapshotInstance(getRuntimeInstance()),
    runtime: {
      lastLoadError: debugState.lastLoadError,
      lastLoadRemote: debugState.lastLoadRemote,
      lastPreloadRemote: debugState.lastPreloadRemote,
      manifestCacheKeys: [...debugState.manifestCache.keys()],
      pendingManifestRequests: [...debugState.manifestRequests.keys()],
      pendingRemoteRegistrations: [...debugState.registrationRequests.keys()],
      registeredManifestRemotes: [...debugState.registeredManifestRemotes.values()].map(
        (remote) => ({ ...remote }),
      ),
      registeredRemotes: debugState.registeredRemotes.map((remote) => ({ ...remote })),
      registeredSharedKeys: [...debugState.registeredSharedKeys],
    },
  };
}

function publishRuntimeDebugUpdate(event: RuntimeDebugEventName) {
  const payload = {
    event,
    snapshot: getFederationDebugInfo(),
    timestamp: new Date().toISOString(),
  };

  const devtoolsGlobal = getDevtoolsGlobal();
  devtoolsGlobal.runtime = payload.snapshot;
  devtoolsGlobal.events ||= [];
  devtoolsGlobal.events.push(payload);
  if (devtoolsGlobal.events.length > 20) {
    devtoolsGlobal.events.shift();
  }
  devtoolsGlobal.lastUpdatedAt = payload.timestamp;

  const browserWindow = (globalThis as { window?: { dispatchEvent?: (event: unknown) => void } })
    .window;
  const CustomEventCtor = (
    globalThis as { CustomEvent?: new (type: string, init?: { detail?: unknown }) => unknown }
  ).CustomEvent;
  if (browserWindow?.dispatchEvent && typeof CustomEventCtor === 'function') {
    browserWindow.dispatchEvent(
      new CustomEventCtor('vite-plugin-federation:debug', {
        detail: payload,
      }),
    );
  }
}
