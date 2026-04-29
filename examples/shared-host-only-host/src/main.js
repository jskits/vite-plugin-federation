import {
  createFederationInstance,
  getFederationDebugInfo,
  loadRemoteFromManifest,
} from 'vite-plugin-federation/runtime';
import './style.css';

const remoteManifestUrl = __MF_HOST_ONLY_REMOTE_MANIFEST_URL__;

function setText(testId, value) {
  document.querySelector(`[data-testid="${testId}"]`).textContent = value;
}

async function boot() {
  createFederationInstance({
    inBrowser: true,
    name: 'hostOnlyHost',
    plugins: [],
    remotes: [],
    shared: {},
  });

  try {
    await loadRemoteFromManifest('hostOnlyRemote/Widget', remoteManifestUrl, {
      force: true,
    });
    setText('status', 'unexpected success');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setText('status', message);
    window.__HOST_ONLY_SHARED_DEBUG__ = getFederationDebugInfo();
  }
}

boot().catch((error) => {
  setText('status', `error: ${error instanceof Error ? error.message : String(error)}`);
  throw error;
});
