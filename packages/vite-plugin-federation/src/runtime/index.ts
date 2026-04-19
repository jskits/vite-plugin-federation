import {
  createInstance as createRuntimeInstance,
  getInstance as getRuntimeInstance,
  getRemoteEntry,
  getRemoteInfo,
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
import {
  createModuleFederationError,
  getModuleFederationDebugState,
  type ModuleFederationErrorCode,
} from '../utils/logger';

const MODULE_FEDERATION_RUNTIME_DEBUG_SYMBOL = Symbol.for('vite-plugin-federation.runtime.debug');

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
  return createRuntimeInstance(options);
}

export function createServerFederationInstance(options: UserOptions) {
  return createRuntimeInstance({
    ...options,
    inBrowser: false,
  } as UserOptions);
}

export function registerPlugins(...args: Parameters<ModuleFederation['registerPlugins']>) {
  return registerRuntimePlugins(...args);
}

export function registerRemotes(...args: Parameters<ModuleFederation['registerRemotes']>) {
  const [remotes] = args;
  const debugState = getRuntimeDebugState();

  debugState.registeredRemotes = (remotes || []).map((remote) => ({ ...remote }));
  return registerRuntimeRemotes(...args);
}

export function registerShared(...args: Parameters<ModuleFederation['registerShared']>) {
  const [shared] = args;
  const debugState = getRuntimeDebugState();

  debugState.registeredSharedKeys = shared ? Object.keys(shared) : [];
  return registerRuntimeShared(...args);
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
    return result;
  } catch (error) {
    debugState.lastLoadError = {
      code: 'MFV-004',
      message: error instanceof Error ? error.message : String(error),
      remoteId,
      timestamp: new Date().toISOString(),
    };
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
  target: FederationRuntimeTarget
) {
  return `${target}:${remoteAlias}:${manifestUrl}`;
}

function getManifestFetchImplementation(fetchOverride?: typeof fetch) {
  const fetchImplementation = fetchOverride ?? globalThis.fetch;
  if (!fetchImplementation) {
    throw createModuleFederationError(
      'MFV-004',
      'global fetch is unavailable. Provide `options.fetch` when registering manifest remotes.'
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
  publicPath?: string
) {
  const entryPath = joinUrlPath(entry.path, entry.name);
  if (!entryPath) {
    return manifestUrl;
  }
  if (isAbsoluteUrl(entryPath)) {
    return entryPath;
  }
  if (publicPath && publicPath !== 'auto') {
    return new URL(entryPath, publicPath).toString();
  }
  return new URL(entryPath, manifestUrl).toString();
}

function getManifestEntryForTarget(
  manifestUrl: string,
  manifest: FederationRemoteManifest,
  target: FederationRuntimeTarget
) {
  const { metaData } = manifest;
  if (!metaData) {
    throw createModuleFederationError(
      'MFV-004',
      `Federation manifest "${manifestUrl}" is invalid: missing metaData.`
    );
  }

  if (target === 'node') {
    const nodeEntry = metaData.ssrRemoteEntry || metaData.remoteEntry;
    if (!nodeEntry?.name) {
      throw createModuleFederationError(
        'MFV-006',
        `Federation manifest "${manifestUrl}" does not declare a usable ssrRemoteEntry.`
      );
    }
    return nodeEntry;
  }

  const browserEntry = metaData.remoteEntry || metaData.ssrRemoteEntry;
  if (!browserEntry?.name) {
    throw createModuleFederationError(
      'MFV-004',
      `Federation manifest "${manifestUrl}" does not declare a usable remoteEntry.`
    );
  }
  return browserEntry;
}

function validateManifest(manifestUrl: string, manifest: FederationRemoteManifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw createModuleFederationError(
      'MFV-004',
      `Federation manifest "${manifestUrl}" is invalid: expected a JSON object.`
    );
  }

  if (!manifest.name || !manifest.metaData) {
    throw createModuleFederationError(
      'MFV-004',
      `Federation manifest "${manifestUrl}" is invalid: missing name or metaData.`
    );
  }
}

export async function fetchFederationManifest(
  manifestUrl: string,
  options: Pick<RegisterManifestRemoteOptions, 'fetch' | 'fetchInit'> = {}
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
        options.fetchInit
      );
      if (!response.ok) {
        throw createModuleFederationError(
          'MFV-004',
          `Failed to fetch federation manifest "${manifestUrl}" with status ${response.status}.`
        );
      }

      const manifest = (await response.json()) as FederationRemoteManifest;
      validateManifest(manifestUrl, manifest);
      debugState.manifestCache.set(manifestUrl, manifest);
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
  options: RegisterManifestRemoteOptions = {}
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
      manifest.metaData.publicPath
    );
    const registration = {
      alias: remoteAlias === remoteName ? undefined : remoteAlias,
      entry: remoteEntryUrl,
      entryGlobalName: manifest.metaData.globalName || remoteName,
      name: remoteName,
      shareScope,
      type: selectedEntry.type || 'module',
    };

    registerRemotes([registration], { force: options.force });

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

    return registration;
  })().finally(() => {
    debugState.registrationRequests.delete(requestKey);
  });

  debugState.registrationRequests.set(requestKey, registerPromise);
  return registerPromise;
}

export async function registerManifestRemotes(
  remotes: Record<string, string | (RegisterManifestRemoteOptions & { manifestUrl: string })>,
  target?: FederationRuntimeTarget
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
    })
  );

  return registrations;
}

export async function loadRemoteFromManifest<T>(
  remoteId: string,
  manifestUrl: string,
  options: RegisterManifestRemoteOptions &
    Partial<NonNullable<Parameters<ModuleFederation['loadRemote']>[1]>> = {}
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
  debugState.lastLoadError = null;
  debugState.lastLoadRemote = null;
  debugState.lastPreloadRemote = null;
  debugState.registeredRemotes = [];
  debugState.registeredSharedKeys = [];
  debugState.manifestCache.clear();
  debugState.manifestRequests.clear();
  debugState.registrationRequests.clear();
  debugState.registeredManifestRemotes.clear();
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
        (remote) => ({ ...remote })
      ),
      registeredRemotes: debugState.registeredRemotes.map((remote) => ({ ...remote })),
      registeredSharedKeys: [...debugState.registeredSharedKeys],
    },
  };
}
