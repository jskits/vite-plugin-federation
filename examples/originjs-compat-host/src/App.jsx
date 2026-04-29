import { startTransition, useEffect, useState } from 'react';
import {
  __federation_method_ensure,
  __federation_method_getRemote,
  __federation_method_setRemote,
  __federation_method_unwrapDefault,
  __federation_method_wrapDefault,
} from 'virtual:__federation__';
import { getFederationDebugInfo, loadRemoteFromManifest } from 'vite-plugin-federation/runtime';
import systemJsRuntimeUrl from 'systemjs/dist/system.min.js?url';
import './app.css';

/* global __MF_ORIGINJS_REACT_REMOTE_ORIGIN__, __MF_ORIGINJS_WEBPACK_SYSTEM_REMOTE_ORIGIN__ */
const VAR_REMOTE_URL = `${__MF_ORIGINJS_REACT_REMOTE_ORIGIN__}/remoteEntry.var.js`;
const MANIFEST_REMOTE_URL = `${__MF_ORIGINJS_REACT_REMOTE_ORIGIN__}/mf-manifest.json`;
const WEBPACK_SYSTEM_REMOTE_URL = `${__MF_ORIGINJS_WEBPACK_SYSTEM_REMOTE_ORIGIN__}/remoteEntry.js`;
const MANUAL_CSS_BUCKET_KEY = 'css__reactRemote__./ManualCssButton';
const SYSTEM_JS_RUNTIME_DATA_ATTR = 'data-mf-systemjs-runtime';

let systemJsRuntimePromise;

async function appendManualCssLink(href) {
  if (!href || typeof document === 'undefined') {
    return false;
  }

  const existingLink = document.querySelector(`link[rel="stylesheet"][data-mf-href="${href}"]`);
  if (existingLink) {
    return true;
  }

  await new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-mf-href', href);
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`Failed to load manual CSS asset: ${href}`));
    document.head.appendChild(link);
  });

  return Boolean(document.querySelector(`link[rel="stylesheet"][data-mf-href="${href}"]`));
}

async function ensureSystemJsRuntime() {
  if (typeof document === 'undefined') {
    return false;
  }

  if (globalThis.System?.import) {
    return true;
  }

  if (!systemJsRuntimePromise) {
    systemJsRuntimePromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector(
        `script[${SYSTEM_JS_RUNTIME_DATA_ATTR}="true"]`,
      );
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(Boolean(globalThis.System?.import)), {
          once: true,
        });
        existingScript.addEventListener(
          'error',
          () => reject(new Error('Failed to load SystemJS runtime asset')),
          { once: true },
        );
        return;
      }

      const script = document.createElement('script');
      script.src = systemJsRuntimeUrl;
      script.async = false;
      script.setAttribute(SYSTEM_JS_RUNTIME_DATA_ATTR, 'true');
      script.onload = () => {
        if (globalThis.System?.import) {
          resolve(true);
          return;
        }

        reject(new Error('SystemJS runtime loaded without registering globalThis.System.import'));
      };
      script.onerror = () => reject(new Error('Failed to load SystemJS runtime asset'));
      document.head.appendChild(script);
    });
  }

  return systemJsRuntimePromise;
}

export default function App() {
  const [status, setStatus] = useState('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [compatDebug, setCompatDebug] = useState(null);
  const [EsmButton, setEsmButton] = useState(null);
  const [ManualCssButton, setManualCssButton] = useState(null);
  const [ManifestButton, setManifestButton] = useState(null);
  const [VarButton, setVarButton] = useState(null);
  const [WebpackSystemValue, setWebpackSystemValue] = useState('');

  useEffect(() => {
    let active = true;

    const loadCompatRemotes = async () => {
      const systemRuntimeReady = await ensureSystemJsRuntime();
      const esmContainer = await __federation_method_ensure('reactRemote');
      const manualCssModule = await __federation_method_getRemote(
        'reactRemote',
        './ManualCssButton',
      );
      const unwrappedManualCssModule = __federation_method_unwrapDefault(
        __federation_method_wrapDefault(manualCssModule, true),
      );
      const manualCssHrefs = globalThis[MANUAL_CSS_BUCKET_KEY] || [];
      const manualCssHref =
        manualCssHrefs.find((href) => href.includes('ManualCssButton')) ||
        manualCssHrefs[0] ||
        null;
      const manualCssLinkBeforeInject = manualCssHref
        ? document.querySelector(`link[rel="stylesheet"][data-mf-href="${manualCssHref}"]`)
        : null;
      const manualCssInjected = await appendManualCssLink(manualCssHref);

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

      __federation_method_setRemote('webpackSystemRemote', {
        url: async () => WEBPACK_SYSTEM_REMOTE_URL,
        format: 'systemjs',
        from: 'webpack',
        entryGlobalName: 'webpackCompatRemote',
        shareScope: 'default',
      });

      const webpackSystemContainer = await __federation_method_ensure('webpackSystemRemote');
      const webpackSystemModule = await __federation_method_getRemote(
        'webpackSystemRemote',
        './message',
      );
      const unwrappedWebpackSystemModule = __federation_method_unwrapDefault(
        __federation_method_wrapDefault(webpackSystemModule, true),
      );
      const manifestModule = await loadRemoteFromManifest(
        'reactManifest/Button',
        MANIFEST_REMOTE_URL,
        {
          remoteName: 'reactManifest',
        },
      );
      const unwrappedManifestModule = __federation_method_unwrapDefault(
        __federation_method_wrapDefault(manifestModule, true),
      );
      const helperWrapped = __federation_method_wrapDefault({ named: true }, true);
      const helperUnwrapped = __federation_method_unwrapDefault({
        __esModule: true,
        default: 'compat-ok',
      });
      const runtimeDebug = getFederationDebugInfo();
      const manifestRegistration = runtimeDebug.runtime.registeredManifestRemotes.find(
        (remote) => remote.alias === 'reactManifest',
      );

      const nextDebug = {
        esm: {
          containerReady: typeof esmContainer?.get === 'function',
          entry: `${__MF_ORIGINJS_REACT_REMOTE_ORIGIN__}/remoteEntry.js`,
          request: 'reactRemote/Button',
          resolvedType: typeof unwrappedEsmModule,
        },
        helpers: {
          unwrapValue: helperUnwrapped,
          wrappedHasDefault: Boolean(helperWrapped.default),
        },
        manualCss: {
          autoInjectedBeforeManual: Boolean(manualCssLinkBeforeInject),
          bucketKey: MANUAL_CSS_BUCKET_KEY,
          href: manualCssHref,
          hrefCount: manualCssHrefs.length,
          manualInjectedAfterHost: manualCssInjected,
        },
        manifest: {
          entry: MANIFEST_REMOTE_URL,
          registeredAlias: manifestRegistration?.alias || null,
          registeredEntry: manifestRegistration?.entry || null,
          request: 'reactManifest/Button',
          resolvedType: typeof unwrappedManifestModule,
        },
        systemjs: {
          containerReady: typeof webpackSystemContainer?.get === 'function',
          entry: WEBPACK_SYSTEM_REMOTE_URL,
          format: 'systemjs',
          from: 'webpack',
          request: 'webpackSystemRemote/message',
          resolvedValue: String(unwrappedWebpackSystemModule),
          runtimeReady: systemRuntimeReady,
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
        setManualCssButton(() => unwrappedManualCssModule);
        setManifestButton(() => unwrappedManifestModule);
        setVarButton(() => unwrappedVarModule);
        setWebpackSystemValue(String(unwrappedWebpackSystemModule));
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
          <article className="compat-panel">
            <div className="compat-label">SystemJS Ensure</div>
            <div data-testid="systemjs-ensure">
              {compatDebug?.systemjs?.containerReady ? 'container-ready' : 'pending'}
            </div>
          </article>
          <article className="compat-panel">
            <div className="compat-label">Manifest Remote</div>
            <div data-testid="manifest-registration">
              {compatDebug?.manifest?.registeredAlias ? 'manifest-registered' : 'pending'}
            </div>
          </article>
          <article className="compat-panel">
            <div className="compat-label">Manual CSS</div>
            <div data-testid="manual-css">
              {compatDebug?.manualCss?.manualInjectedAfterHost ? 'host-injected' : 'pending'}
            </div>
          </article>
        </div>

        <div className="compat-remote-row">
          {EsmButton ? <EsmButton label="OriginJS ESM Button" /> : <p>Loading ESM remote…</p>}
          {ManualCssButton ? (
            <ManualCssButton label="OriginJS Manual CSS Button" />
          ) : (
            <p>Loading manual CSS remote…</p>
          )}
          {ManifestButton ? (
            <ManifestButton label="Manifest Button" />
          ) : (
            <p>Loading manifest remote…</p>
          )}
          {VarButton ? <VarButton label="OriginJS VAR Button" /> : <p>Loading VAR remote…</p>}
          {WebpackSystemValue ? (
            <p data-testid="webpack-systemjs-message">{WebpackSystemValue}</p>
          ) : (
            <p>Loading webpack SystemJS remote…</p>
          )}
        </div>
      </section>
    </main>
  );
}
