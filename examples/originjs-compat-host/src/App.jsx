import { startTransition, useEffect, useState } from 'react';
import {
  __federation_method_ensure,
  __federation_method_getRemote,
  __federation_method_setRemote,
  __federation_method_unwrapDefault,
  __federation_method_wrapDefault,
} from 'virtual:__federation__';
import './app.css';

const VAR_REMOTE_URL = 'http://localhost:4174/remoteEntry.var.js';

export default function App() {
  const [status, setStatus] = useState('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [compatDebug, setCompatDebug] = useState(null);
  const [EsmButton, setEsmButton] = useState(null);
  const [VarButton, setVarButton] = useState(null);

  useEffect(() => {
    let active = true;

    const loadCompatRemotes = async () => {
      const esmContainer = await __federation_method_ensure('reactRemote');
      const esmModule = await __federation_method_getRemote('reactRemote', './Button');
      const wrappedNamespace = __federation_method_wrapDefault(esmModule, true);
      const unwrappedEsmModule = __federation_method_unwrapDefault(wrappedNamespace);

      __federation_method_setRemote('reactRemoteVar', {
        url: async () => VAR_REMOTE_URL,
        format: 'var',
        from: 'vite',
        entryGlobalName: 'reactRemote',
        shareScope: 'default',
      });

      const varContainer = await __federation_method_ensure('reactRemoteVar');
      const varModule = await __federation_method_getRemote('reactRemoteVar', './Button');
      const unwrappedVarModule = __federation_method_unwrapDefault(
        __federation_method_wrapDefault(varModule, true),
      );
      const helperWrapped = __federation_method_wrapDefault({ named: true }, true);
      const helperUnwrapped = __federation_method_unwrapDefault({
        __esModule: true,
        default: 'compat-ok',
      });

      const nextDebug = {
        esm: {
          containerReady: typeof esmContainer?.get === 'function',
          entry: 'http://localhost:4174/remoteEntry.js',
          request: 'reactRemote/Button',
          resolvedType: typeof unwrappedEsmModule,
        },
        helpers: {
          unwrapValue: helperUnwrapped,
          wrappedHasDefault: Boolean(helperWrapped.default),
        },
        var: {
          containerReady: typeof varContainer?.get === 'function',
          entry: VAR_REMOTE_URL,
          request: 'reactRemoteVar/Button',
          resolvedType: typeof unwrappedVarModule,
        },
      };

      if (!active) {
        return;
      }

      window.__ORIGINJS_COMPAT_DEBUG__ = nextDebug;

      startTransition(() => {
        setCompatDebug(nextDebug);
        setEsmButton(() => unwrappedEsmModule);
        setVarButton(() => unwrappedVarModule);
        setStatus('ready');
      });
    };

    loadCompatRemotes().catch((error) => {
      if (!active) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      startTransition(() => {
        setStatus('error');
        setErrorMessage(message);
      });
    });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="compat-shell">
      <section className="compat-card">
        <p className="compat-label">OriginJS Compatibility</p>
        <h1 style={{ fontSize: '2.4rem', margin: '0 0 0.5rem' }}>remoteEntry-first shim</h1>
        <p style={{ color: '#475569', lineHeight: 1.6, marginTop: 0 }}>
          This page verifies the browser-side migration shim from
          <code> virtual:__federation__</code> against real remoteEntry assets.
        </p>

        <div className="compat-grid">
          <article className="compat-panel">
            <div className="compat-label">Status</div>
            <div data-testid="status">{status}</div>
          </article>
          <article className="compat-panel">
            <div className="compat-label">Helper Wrap</div>
            <div data-testid="helper-wrap">
              {compatDebug?.helpers?.wrappedHasDefault ? 'default' : 'raw'}
            </div>
          </article>
          <article className="compat-panel">
            <div className="compat-label">Helper Unwrap</div>
            <div data-testid="helper-unwrap">
              {compatDebug?.helpers?.unwrapValue || errorMessage}
            </div>
          </article>
          <article className="compat-panel">
            <div className="compat-label">ESM Ensure</div>
            <div data-testid="esm-ensure">
              {compatDebug?.esm?.containerReady ? 'container-ready' : 'pending'}
            </div>
          </article>
          <article className="compat-panel">
            <div className="compat-label">VAR Ensure</div>
            <div data-testid="var-ensure">
              {compatDebug?.var?.containerReady ? 'container-ready' : 'pending'}
            </div>
          </article>
        </div>

        <div className="compat-remote-row">
          {EsmButton ? <EsmButton label="OriginJS ESM Button" /> : <p>Loading ESM remote…</p>}
          {VarButton ? <VarButton label="OriginJS VAR Button" /> : <p>Loading VAR remote…</p>}
        </div>
      </section>
    </main>
  );
}
