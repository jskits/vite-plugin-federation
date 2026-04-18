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
  getModuleFederationDebugState,
  type ModuleFederationErrorCode,
} from '../utils/logger';

const MODULE_FEDERATION_RUNTIME_DEBUG_SYMBOL = Symbol.for('vite-plugin-federation.runtime.debug');

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

export function getFederationDebugInfo() {
  return {
    diagnostics: getModuleFederationDebugState(),
    instance: snapshotInstance(getRuntimeInstance()),
    runtime: {
      ...getRuntimeDebugState(),
      registeredRemotes: getRuntimeDebugState().registeredRemotes.map((remote) => ({ ...remote })),
      registeredSharedKeys: [...getRuntimeDebugState().registeredSharedKeys],
    },
  };
}
