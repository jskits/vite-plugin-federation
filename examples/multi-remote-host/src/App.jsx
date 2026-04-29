import { startTransition, useEffect, useState } from 'react';
import { getFederationDebugInfo, loadRemoteFromManifest } from 'vite-plugin-federation/runtime';
import './style.css';

/* global __MF_LIT_REMOTE_MANIFEST_URL__, __MF_REACT_REMOTE_MANIFEST_URL__ */
const REACT_REMOTE_MANIFEST_URL = __MF_REACT_REMOTE_MANIFEST_URL__;
const LIT_REMOTE_MANIFEST_URL = __MF_LIT_REMOTE_MANIFEST_URL__;

if (typeof window !== 'undefined') {
  window.__MF_SECURITY_E2E__ = {
    getDebugInfo() {
      return getFederationDebugInfo();
    },
    async loadReactButtonWithIntegrity(manifestUrl, integrity) {
      const module = await loadRemoteFromManifest('reactRemote/Button', manifestUrl, {
        force: true,
        integrity,
        remoteName: 'reactRemote',
      });
      return {
        debugInfo: getFederationDebugInfo(),
        exportType: typeof (module.default ?? module),
      };
    },
  };
}

export default function App() {
  const [ReactButton, setReactButton] = useState(null);
  const [litReady, setLitReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let active = true;

    const loadRuntimeRemotes = async () => {
      const [reactButtonModule] = await Promise.all([
        loadRemoteFromManifest('reactRemote/Button', REACT_REMOTE_MANIFEST_URL, {
          remoteName: 'reactRemote',
        }),
        loadRemoteFromManifest('litRemote/RemoteLitCard', LIT_REMOTE_MANIFEST_URL, {
          remoteName: 'litRemote',
        }),
      ]);

      if (active) {
        startTransition(() => {
          setReactButton(() => reactButtonModule.default ?? reactButtonModule);
          setLitReady(true);
        });
      }
    };

    loadRuntimeRemotes().catch((error) => {
      if (!active) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      startTransition(() => {
        setErrorMessage(message);
      });
    });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="multi-shell">
      <section className="hero">
        <p className="eyebrow">Multi-remote host</p>
        <h1>One host consuming React and Lit remotes</h1>
        <p>
          This host validates that independent manifest remotes can coexist in one runtime and keep
          their shared package graphs separate.
        </p>
      </section>

      <section className="remote-grid">
        <article className="panel" data-testid="react-remote-panel">
          <h2>React manifest remote</h2>
          {errorMessage ? <p className="error">{errorMessage}</p> : null}
          {ReactButton ? (
            <ReactButton label="Loaded from reactRemote/Button" />
          ) : (
            <p>Loading React remote...</p>
          )}
        </article>

        <article className="panel" data-testid="lit-remote-panel">
          <h2>Lit manifest remote</h2>
          {litReady ? (
            <remote-lit-card title="Loaded from litRemote/RemoteLitCard"></remote-lit-card>
          ) : (
            <p>Loading Lit remote...</p>
          )}
        </article>
      </section>
    </main>
  );
}
