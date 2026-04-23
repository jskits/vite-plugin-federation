import {
  getFederationDebugInfo,
  loadRemoteFromManifest,
  loadShare,
} from 'vite-plugin-federation/runtime';
import './style.css';

const scenario = __MF_SHARE_SCENARIO__;
const remoteManifestUrl = __MF_REMOTE_MANIFEST_URL__;

function setText(testId, value) {
  document.querySelector(`[data-testid="${testId}"]`).textContent = value;
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

async function preloadHostShareWhenNeeded() {
  if (scenario !== 'loaded-first') {
    setText('host-preload', 'host preload skipped');
    return;
  }

  const sharedFactory = await loadShare('@mf-e2e/shared-value', {
    customShareInfo: {
      shareConfig: {
        requiredVersion: '*',
        singleton: true,
      },
    },
  });
  const sharedModule = typeof sharedFactory === 'function' ? sharedFactory() : sharedFactory;
  const sharedValue = sharedModule.default ?? sharedModule;
  setText('host-preload', `host preloaded ${sharedValue.origin}@${sharedValue.version}`);
}

async function boot() {
  setText('scenario', scenario);
  await waitForFederationInstance();
  await preloadHostShareWhenNeeded();

  const remoteModule = await loadRemoteFromManifest('sharedRemote/Widget', remoteManifestUrl, {
    force: true,
  });
  const getSharedReport = remoteModule.getSharedReport || remoteModule.default;
  const report = getSharedReport();

  setText('remote-report', `remote resolved ${report.origin}@${report.version}`);
  window.__SHARED_NEGOTIATION_DEBUG__ = getFederationDebugInfo();
}

boot().catch((error) => {
  setText('remote-report', `error: ${error instanceof Error ? error.message : String(error)}`);
  throw error;
});
