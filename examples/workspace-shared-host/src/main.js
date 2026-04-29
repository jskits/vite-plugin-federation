import { createWorkspaceReport } from '@mf-examples/workspace-shared/report';
import {
  getFederationDebugInfo,
  loadRemoteFromManifest,
  loadShare,
} from 'vite-plugin-federation/runtime';
import './style.css';

const remoteManifestUrl = __MF_WORKSPACE_REMOTE_MANIFEST_URL__;

function setText(testId, value) {
  document.querySelector(`[data-testid="${testId}"]`).textContent = value;
}

async function unwrapSharedModule(sharedFactory) {
  const sharedModule = await (typeof sharedFactory === 'function'
    ? sharedFactory()
    : sharedFactory);
  return sharedModule.default?.createWorkspaceReport ? sharedModule.default : sharedModule;
}

async function waitForFederationInstance() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (globalThis.__FEDERATION__?.__INSTANCES__?.length > 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error('Timed out waiting for the generated federation host init.');
}

async function boot() {
  const hostReport = createWorkspaceReport('workspace-host');
  setText('host-report', `${hostReport.packageName}@${hostReport.version}`);

  await waitForFederationInstance();

  const sharedFactory = await loadShare('@mf-examples/workspace-shared/report', {
    customShareInfo: {
      shareConfig: {
        allowNodeModulesSuffixMatch: true,
        requiredVersion: '*',
        singleton: true,
      },
    },
  });
  const sharedModule = await unwrapSharedModule(sharedFactory);
  const preloadReport = sharedModule.createWorkspaceReport('host-preload');
  setText('host-preload', `${preloadReport.resolvedFrom}:${preloadReport.consumer}`);

  const remoteModule = await loadRemoteFromManifest(
    'workspaceSharedRemote/Widget',
    remoteManifestUrl,
    { force: true },
  );
  const getWorkspaceSharedReport = remoteModule.getWorkspaceSharedReport || remoteModule.default;
  const remoteReport = getWorkspaceSharedReport();

  setText('remote-report', `${remoteReport.resolvedFrom}:${remoteReport.consumer}`);
  window.__WORKSPACE_SHARED_DEBUG__ = getFederationDebugInfo();
}

boot().catch((error) => {
  setText('remote-report', `error: ${error instanceof Error ? error.message : String(error)}`);
  throw error;
});
