import {
  createInstance,
  getInstance,
  getRemoteEntry,
  getRemoteInfo,
  loadRemote,
  loadScript,
  loadScriptNode,
  loadShare,
  loadShareSync,
  preloadRemote,
  registerGlobalPlugins,
  registerPlugins,
  registerRemotes,
  registerShared,
} from '@module-federation/runtime';

export {
  getInstance,
  getRemoteEntry,
  getRemoteInfo,
  loadRemote,
  loadScript,
  loadScriptNode,
  loadShare,
  loadShareSync,
  preloadRemote,
  registerGlobalPlugins,
  registerPlugins,
  registerRemotes,
  registerShared,
};

export const createFederationInstance = createInstance;

export function getFederationDebugInfo() {
  try {
    return getInstance();
  } catch {
    return null;
  }
}
