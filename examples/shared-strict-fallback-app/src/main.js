import {
  createFederationInstance,
  getFederationDebugInfo,
  loadShare,
} from 'vite-plugin-federation/runtime';
import './style.css';

function setText(testId, value) {
  document.querySelector(`[data-testid="${testId}"]`).textContent = value;
}

async function boot() {
  createFederationInstance({
    inBrowser: true,
    name: 'strictFallbackApp',
    plugins: [],
    remotes: [],
    shared: {},
  });

  const result = await loadShare('@mf-e2e/strict-fallback', {
    customShareInfo: {
      shareConfig: {
        requiredVersion: '^9.0.0',
        resolvedImportSource: '/virtual/local-fallback.js',
        singleton: true,
        strictVersion: true,
      },
      sourcePath: '/virtual/local-fallback.js',
      strategy: 'version-first',
    },
  });

  const fallbackModule =
    result === false
      ? await import('./local-fallback.js')
      : typeof result === 'function'
        ? result()
        : result;
  const value = fallbackModule.default ?? fallbackModule;

  setText('result', `local fallback ${value.origin}@${value.version}`);
  window.__SHARED_FALLBACK_DEBUG__ = {
    result: result === false ? false : typeof result,
    runtime: getFederationDebugInfo(),
  };
}

boot().catch((error) => {
  setText('result', `error: ${error instanceof Error ? error.message : String(error)}`);
  throw error;
});
