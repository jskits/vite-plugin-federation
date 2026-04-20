import VirtualModule from '../utils/VirtualModule';
import {
  getRuntimeInitBootstrapCode,
  getRuntimeInitPromiseBootstrapCode,
  virtualRuntimeInitStatus,
} from './virtualRuntimeInitStatus';

const cacheRemoteMap: {
  [remote: string]: VirtualModule;
} = {};
export const LOAD_REMOTE_TAG = '__loadRemote__';
export function getRemoteVirtualModule(remote: string, command: string, isRolldown: boolean) {
  if (!cacheRemoteMap[remote]) {
    const ext = isRolldown ? '.mjs' : '.js';
    cacheRemoteMap[remote] = new VirtualModule(remote, LOAD_REMOTE_TAG, ext);
    cacheRemoteMap[remote].writeSync(generateRemotes(remote, command, isRolldown));
  }
  const virtual = cacheRemoteMap[remote];
  return virtual;
}
const usedRemotesMap: Record<string, Set<string>> = {
  // remote1: {remote1/App, remote1, remote1/Button}
};
export function addUsedRemote(remoteKey: string, remoteModule: string) {
  if (!usedRemotesMap[remoteKey]) usedRemotesMap[remoteKey] = new Set();
  usedRemotesMap[remoteKey].add(remoteModule);
}
export function getUsedRemotesMap() {
  return usedRemotesMap;
}
export function generateRemotes(id: string, command: string, isRolldown: boolean) {
  const useESM = command === 'build' || isRolldown;
  const useDevRefreshBridge = command === 'serve' && useESM;
  const importLine =
    command === 'build'
      ? getRuntimeInitPromiseBootstrapCode()
      : useESM
        ? `${getRuntimeInitBootstrapCode()}
    const { initPromise } = globalThis[globalKey];`
        : `const {initPromise} = require("${virtualRuntimeInitStatus.getImportId()}")`;
  const devRefreshImportLine = useDevRefreshBridge
    ? 'import { refreshRemote as __mf_refreshRemote } from "vite-plugin-federation/runtime";'
    : '';
  const devRefreshFlagLine = useDevRefreshBridge
    ? 'const __mf_shouldRefreshRemote = /(?:\\?|&)t=/.test(import.meta.url);'
    : '';
  const devHmrAcceptLine = useDevRefreshBridge
    ? 'if (import.meta.hot) {\n      import.meta.hot.accept();\n    }'
    : '';
  const awaitOrPlaceholder = useESM
    ? 'await '
    : '/*mf top-level-await placeholder replacement mf*/';
  // In dev+ESM mode (Vite 8+), unwrap the module namespace to avoid
  // double-wrapping: loadRemote returns {default: Component}, and
  // "export default exportModule" would make import() return
  // {default: {default: Component}}, breaking React.lazy.
  // In build mode, the module-federation-esm-shims plugin handles this.
  // In dev+ESM mode (rolldown/Vite 8), export __moduleExports alongside
  // default so that the consumer-side transform plugin can extract named
  // exports (Rolldown does not support syntheticNamedExports).
  const exportLine =
    command === 'serve' && useESM
      ? 'export const __moduleExports = exportModule;\nexport default exportModule.default ?? exportModule'
      : useESM
        ? 'export default exportModule'
        : 'module.exports = exportModule';
  const loadRemoteLine = useDevRefreshBridge
    ? `const res = initPromise.then(async (runtime) => {
      if (__mf_shouldRefreshRemote) {
        await __mf_refreshRemote(${JSON.stringify(id)});
      }
      return runtime.loadRemote(${JSON.stringify(id)});
    })`
    : `const res = initPromise.then(runtime => runtime.loadRemote(${JSON.stringify(id)}))`;

  return `
    ${devRefreshImportLine}
    ${importLine}
    ${devRefreshFlagLine}
    ${loadRemoteLine}
    const exportModule = ${awaitOrPlaceholder}initPromise.then(_ => res)
    ${exportLine}
    ${devHmrAcceptLine}
  `;
}
