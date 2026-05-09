import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const packageDir = path.join(repoRoot, 'packages', 'vite-plugin-federation');
const packageJson = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
const packageName = packageJson.name;
const localPackageVersion = packageJson.version;
const rawPackageSpec = process.env.P0_P1_SMOKE_PACKAGE_SPEC || 'latest';
const packageSpec = normalizePackageSpec(rawPackageSpec);
const commandTimeoutMs = Number(process.env.P0_P1_SMOKE_COMMAND_TIMEOUT_MS || 240_000);
const installTimeoutMs = Number(process.env.P0_P1_SMOKE_INSTALL_TIMEOUT_MS || 300_000);
const serverTimeoutMs = Number(process.env.P0_P1_SMOKE_SERVER_TIMEOUT_MS || 60_000);
const browserTimeoutMs = Number(process.env.P0_P1_SMOKE_BROWSER_TIMEOUT_MS || 60_000);
const configuredStoreDir = process.env.P0_P1_SMOKE_STORE_DIR;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripPackageName(spec) {
  return spec.startsWith(`${packageName}@`) ? spec.slice(packageName.length + 1) : spec;
}

function normalizePackageSpec(spec) {
  const packageSpec = stripPackageName(spec);
  if (packageSpec.startsWith('file:')) {
    const filePath = packageSpec.slice('file:'.length);
    return path.isAbsolute(filePath) ? packageSpec : `file:${path.resolve(repoRoot, filePath)}`;
  }
  if (
    packageSpec.startsWith('./') ||
    packageSpec.startsWith('../') ||
    packageSpec.startsWith('~/') ||
    path.isAbsolute(packageSpec) ||
    packageSpec.endsWith('.tgz')
  ) {
    return path.isAbsolute(packageSpec) ? packageSpec : path.resolve(repoRoot, packageSpec);
  }
  return packageSpec;
}

function isRegistryPackageSpec(spec) {
  if (
    spec.startsWith('file:') ||
    spec.startsWith('link:') ||
    spec.startsWith('workspace:') ||
    spec.startsWith('./') ||
    spec.startsWith('../') ||
    spec.startsWith('~/') ||
    path.isAbsolute(spec) ||
    spec.endsWith('.tgz')
  ) {
    return false;
  }
  return !/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(spec);
}

function getNpmViewVersion(metadata) {
  const item = Array.isArray(metadata) ? metadata.at(-1) : metadata;
  if (typeof item === 'string') return item;
  return typeof item?.version === 'string' ? item.version : undefined;
}

function run(command, args, cwd, options = {}) {
  const captureOutput = options.captureOutput ?? false;
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: process.env.CI || '1',
      ...options.env,
    },
    shell: process.platform === 'win32',
    stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    timeout: options.timeoutMs ?? commandTimeoutMs,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    if (captureOutput) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }

  return captureOutput ? result.stdout.trim() : '';
}

function startProcess(label, command, args, cwd, options = {}) {
  const logs = [];
  const child = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      CI: process.env.CI || '1',
      ...options.env,
    },
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const appendLog = (stream, chunk) => {
    const text = chunk.toString();
    logs.push(`[${label}:${stream}] ${text}`);
    if (logs.length > 160) {
      logs.shift();
    }
    if (process.env.P0_P1_SMOKE_VERBOSE) {
      process.stdout.write(`[${label}:${stream}] ${text}`);
    }
  };

  child.stdout?.on('data', (chunk) => appendLog('stdout', chunk));
  child.stderr?.on('data', (chunk) => appendLog('stderr', chunk));

  return {
    child,
    getLogs: () => logs.join(''),
    label,
  };
}

async function stopProcess(handle) {
  if (!handle || handle.child.exitCode !== null) return;

  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    handle.child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    handle.child.kill('SIGTERM');
  });

  if (handle.child.exitCode === null) {
    handle.child.kill('SIGKILL');
  }
}

async function getFreePort(usedPorts) {
  return new Promise((resolve, reject) => {
    const allocate = () => {
      const server = net.createServer();
      server.unref();
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port: 0 }, () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : undefined;
        server.close(() => {
          if (!port) {
            reject(new Error('Failed to allocate a free TCP port.'));
            return;
          }
          if (usedPorts.has(port)) {
            allocate();
            return;
          }
          usedPorts.add(port);
          resolve(port);
        });
      });
    };

    allocate();
  });
}

async function waitForUrl(url, handle) {
  const deadline = Date.now() + serverTimeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    if (handle?.child.exitCode !== null) {
      throw new Error(`${handle.label} exited before ${url} became ready.\n${handle.getLogs()}`);
    }

    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.ok) {
        return;
      }
      lastError = new Error(`Unexpected status ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(250);
  }

  throw new Error(
    `Timed out waiting for ${url}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }\n${handle?.getLogs() || ''}`,
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeSharedPackage(root, dirname, version, origin) {
  const dir = path.join(root, 'deps', dirname);
  await mkdir(dir, { recursive: true });
  await writeJson(path.join(dir, 'package.json'), {
    name: '@mf-smoke/shared-value',
    version,
    type: 'module',
    main: './index.js',
  });
  await writeFile(
    path.join(dir, 'index.js'),
    `const value = {
  label: '${origin}@${version}',
  origin: '${origin}',
  version: '${version}',
};

export default value;
export const sharedValue = value;
`,
  );
}

async function writeRuntimeWorkspace(root) {
  const runtimeRoot = path.join(root, 'runtime-workspace');
  const remoteDir = path.join(runtimeRoot, 'remote');
  const hostDir = path.join(runtimeRoot, 'host');

  await mkdir(path.join(remoteDir, 'src'), { recursive: true });
  await mkdir(path.join(hostDir, 'src'), { recursive: true });
  await writeSharedPackage(runtimeRoot, 'shared-v1', '1.0.0', 'host');
  await writeSharedPackage(runtimeRoot, 'shared-v2', '2.0.0', 'remote');

  await writeJson(path.join(runtimeRoot, 'package.json'), {
    name: 'vite-plugin-federation-p0-p1-runtime-smoke',
    private: true,
    packageManager: 'pnpm@10.33.0',
    pnpm: {
      onlyBuiltDependencies: ['esbuild'],
    },
  });
  await writeFile(
    path.join(runtimeRoot, 'pnpm-workspace.yaml'),
    'packages:\n  - remote\n  - host\n',
  );

  await writeJson(path.join(remoteDir, 'package.json'), {
    name: 'p0-p1-smoke-remote',
    private: true,
    type: 'module',
    scripts: {
      build: 'vite build',
    },
    dependencies: {
      '@mf-smoke/shared-value': 'file:../deps/shared-v2',
      react: '19.2.4',
      [packageName]: packageSpec,
    },
    devDependencies: {
      '@vitejs/plugin-react': '6.0.1',
      vite: '8.0.10',
    },
  });
  await writeFile(
    path.join(remoteDir, 'index.html'),
    `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>P0/P1 remote smoke</title></head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`,
  );
  await writeFile(
    path.join(remoteDir, 'vite.config.js'),
    `import { fileURLToPath } from 'node:url';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

const port = Number(process.env.MF_SMOKE_REMOTE_PORT);
if (!port) throw new Error('MF_SMOKE_REMOTE_PORT is required.');
const packageDir = path.dirname(fileURLToPath(import.meta.url));
const sharedValuePath = path.join(packageDir, 'node_modules/@mf-smoke/shared-value/index.js');
const enableReactHmr = process.env.MF_SMOKE_ENABLE_REACT_HMR === '1';
const reactExposes = enableReactHmr
  ? {
      './ReactWidget': './src/ReactWidget.jsx',
    }
  : {};
const reactShared = enableReactHmr
  ? {
      react: {
        singleton: true,
        requiredVersion: '^19.2.4',
      },
      'react/': {
        singleton: true,
        requiredVersion: '^19.2.4',
      },
    }
  : {};

export default defineConfig({
  server: {
    origin: \`http://localhost:\${port}\`,
    port,
  },
  preview: {
    port,
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/src/manual-chunk.js')) {
            return 'p0-p1-manual-chunk';
          }
        },
      },
    },
  },
  plugins: [
    ...(enableReactHmr ? [react()] : []),
    federation({
      name: 'p0p1Remote',
      filename: 'remoteEntry.js',
      varFilename: 'remoteEntry.var.js',
      manifest: true,
      publicPath: \`http://localhost:\${port}/\`,
      dts: false,
      dev: {
        remoteHmr: true,
      },
      shareStrategy: 'loaded-first',
      exposes: {
        './Widget': './src/widget.js',
        './Named': './src/named.js',
        './ServerWidget': './src/server-widget.js',
        ...reactExposes,
      },
      shared: {
        '@mf-smoke/shared-value': {
          import: sharedValuePath,
          singleton: true,
          requiredVersion: '*',
          version: '2.0.0',
        },
        ...reactShared,
      },
    }),
  ],
});
`,
  );
  await writeFile(
    path.join(remoteDir, 'src', 'main.js'),
    `document.querySelector('#app').textContent = 'remote ready';
`,
  );
  await writeFile(
    path.join(remoteDir, 'src', 'manual-chunk.js'),
    `export const manualChunkValue = 'manual-chunk-ok';
`,
  );
  await writeFile(
    path.join(remoteDir, 'src', 'async-named.js'),
    `export const asyncNamedValue = 'async-chunk-ok';
`,
  );
  await writeFile(
    path.join(remoteDir, 'src', 'named.js'),
    `import { manualChunkValue } from './manual-chunk.js';

export const namedStatus = 'named-export-ok';

export async function computeNamedValue() {
  const mod = await import('./async-named.js');
  return \`\${manualChunkValue}|\${mod.asyncNamedValue}\`;
}
`,
  );
  await writeFile(
    path.join(remoteDir, 'src', 'widget.js'),
    `import sharedValue from '@mf-smoke/shared-value';

export const hmrVersion = 'initial';

export function getWidgetReport() {
  return {
    hmrVersion,
    renderedBy: 'p0p1Remote',
    sharedLabel: sharedValue.label,
    sharedOrigin: sharedValue.origin,
    sharedVersion: sharedValue.version,
  };
}

export default getWidgetReport;
`,
  );
  await writeFile(
    path.join(remoteDir, 'src', 'ReactWidget.jsx'),
    `export default function ReactWidget({ label }) {
  return <button type="button">{label} / initial</button>;
}
`,
  );
  await writeFile(
    path.join(remoteDir, 'src', 'server-widget.js'),
    `export function getServerWidgetReport() {
  return {
    renderedBy: 'p0p1Remote',
    target: 'node',
  };
}

export default getServerWidgetReport;
`,
  );

  await writeJson(path.join(hostDir, 'package.json'), {
    name: 'p0-p1-smoke-host',
    private: true,
    type: 'module',
    scripts: {
      build: 'vite build',
      ssr: 'node --experimental-vm-modules ./ssr-check.mjs',
    },
    dependencies: {
      '@mf-smoke/shared-value': 'file:../deps/shared-v1',
      react: '19.2.4',
      'react-dom': '19.2.4',
      [packageName]: packageSpec,
    },
    devDependencies: {
      '@vitejs/plugin-react': '6.0.1',
      vite: '8.0.10',
    },
  });
  await writeFile(
    path.join(hostDir, 'index.html'),
    `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>P0/P1 host smoke</title></head>
  <body>
    <main>
      <div id="status" data-testid="status">booting</div>
      <div id="widget" data-testid="widget"></div>
      <div id="react-widget" data-testid="react-widget"></div>
    </main>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`,
  );
  await writeFile(
    path.join(hostDir, 'vite.config.js'),
    `import { fileURLToPath } from 'node:url';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

const port = Number(process.env.MF_SMOKE_HOST_PORT);
const remoteManifestUrl = process.env.MF_SMOKE_REMOTE_MANIFEST_URL;
if (!port) throw new Error('MF_SMOKE_HOST_PORT is required.');
if (!remoteManifestUrl) throw new Error('MF_SMOKE_REMOTE_MANIFEST_URL is required.');
const packageDir = path.dirname(fileURLToPath(import.meta.url));
const sharedValuePath = path.join(packageDir, 'node_modules/@mf-smoke/shared-value/index.js');
const enableReactHmr = process.env.MF_SMOKE_ENABLE_REACT_HMR === '1';
const reactShared = enableReactHmr
  ? {
      react: {
        singleton: true,
        requiredVersion: '^19.2.4',
      },
      'react/': {
        singleton: true,
        requiredVersion: '^19.2.4',
      },
      'react-dom': {
        singleton: true,
        requiredVersion: '^19.2.4',
      },
      'react-dom/': {
        singleton: true,
        requiredVersion: '^19.2.4',
      },
    }
  : {};

export default defineConfig({
  server: {
    port,
  },
  preview: {
    port,
  },
  build: {
    target: 'esnext',
  },
  define: {
    __MF_SMOKE_REMOTE_MANIFEST_URL__: JSON.stringify(remoteManifestUrl),
  },
  plugins: [
    ...(enableReactHmr ? [react()] : []),
    federation({
      name: 'p0p1Host',
      dts: false,
      dev: {
        remoteHmr: true,
      },
      shareStrategy: 'loaded-first',
      compat: {
        originjs: true,
        virtualFederationShim: true,
      },
      remotes: {
        p0p1Remote: remoteManifestUrl,
      },
      shared: {
        '@mf-smoke/shared-value': {
          import: sharedValuePath,
          singleton: true,
          requiredVersion: '*',
          version: '1.0.0',
        },
        ...reactShared,
      },
    }),
  ],
});
`,
  );
  await writeFile(
    path.join(hostDir, 'src', 'main.js'),
    `import {
  __federation_method_ensure,
  __federation_method_getRemote,
  __federation_method_setRemote,
  __federation_method_unwrapDefault,
  __federation_method_wrapDefault,
} from 'virtual:__federation__';
import {
  createFederationManifestPreloadPlan,
  fetchFederationManifest,
  getFederationDebugInfo,
  loadRemoteFromManifest,
  loadShare,
  refreshRemote,
  warmFederationRemotes,
} from 'vite-plugin-federation/runtime';

const remoteManifestUrl = __MF_SMOKE_REMOTE_MANIFEST_URL__;
const remoteOrigin = new URL(remoteManifestUrl).origin;
const status = document.querySelector('#status');
const widget = document.querySelector('#widget');
const reactWidgetMount = document.querySelector('#react-widget');
const telemetryEvents = [];
let reactRoot;

const hooks = {
  telemetry(event) {
    telemetryEvents.push(\`\${event.kind}:\${event.stage}:\${event.status || 'pending'}\`);
  },
};

function setStatus(value) {
  status.textContent = value;
  status.dataset.status = value;
}

async function readShareFactory(factory) {
  const mod = typeof factory === 'function' ? factory() : factory;
  return mod.default ?? mod;
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

async function renderWidget(force = false) {
  const module = import.meta.env.DEV
    ? await import('p0p1Remote/Widget')
    : await loadRemoteFromManifest('p0p1Remote/Widget', remoteManifestUrl, {
        force,
        remoteName: 'p0p1Remote',
      });
  const report = (module.getWidgetReport || module.default)();
  widget.textContent = \`\${report.sharedLabel}|\${report.hmrVersion}\`;
  return report;
}

async function renderReactWidget() {
  if (!import.meta.env.DEV) {
    return null;
  }

  const [reactModule, reactDomClientModule, remoteModule] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('p0p1Remote/ReactWidget'),
  ]);
  const React = reactModule.default ?? reactModule;
  const Component = remoteModule.default ?? remoteModule.ReactWidget;
  reactRoot ||= reactDomClientModule.createRoot(reactWidgetMount);
  reactRoot.render(React.createElement(Component, { label: 'React remote HMR' }));
  return true;
}

window.__P0_P1_SMOKE_HMR__ = {
  count: 0,
  lastReport: null,
  reactVersion: null,
};

window.addEventListener('vite-plugin-federation:remote-expose-update', async (event) => {
  const detail = event.detail || {};
  if (detail.hostRemote !== 'p0p1Remote') {
    return;
  }

  if (detail.expose === './ReactWidget') {
    await refreshRemote(detail.remoteRequestId || 'p0p1Remote/ReactWidget', {
      invalidateManifest: true,
    });
    await renderReactWidget();
    window.__P0_P1_SMOKE_HMR__.count += 1;
    window.__P0_P1_SMOKE_HMR__.reactVersion = 'event-received';
    return;
  }

  if (detail.expose !== './Widget') {
    return;
  }

  await refreshRemote(detail.remoteRequestId || 'p0p1Remote/Widget', {
    invalidateManifest: true,
  });
  const report = await renderWidget(true);
  window.__P0_P1_SMOKE_HMR__.count += 1;
  window.__P0_P1_SMOKE_HMR__.lastReport = report;
});

async function runRuntimeSmoke() {
  await waitForFederationInstance();

  const hostShare = await readShareFactory(
    await loadShare('@mf-smoke/shared-value', {
      customShareInfo: {
        shareConfig: {
          requiredVersion: '*',
          singleton: true,
        },
      },
    }),
  );
  const widgetReport = await renderWidget();

  if (import.meta.env.DEV) {
    const reactWidgetVersion = await renderReactWidget();
    window.__P0_P1_SMOKE_RESULT__ = {
      debugInfo: getFederationDebugInfo(),
      hostShare,
      reactWidgetVersion,
      status: 'ready',
      widgetReport,
    };
    setStatus('ready');
    return;
  }

  const namedModule = await import('p0p1Remote/Named');
  const namedValue = await namedModule.computeNamedValue();

  const primaryMissingManifestUrl = \`\${remoteOrigin}/missing-mf-manifest.json\`;
  const fallbackManifest = await fetchFederationManifest(primaryMissingManifestUrl, {
    fallbackUrls: [remoteManifestUrl],
    force: true,
    hooks,
  });
  const fallbackRemoteModule = await loadRemoteFromManifest(
    'p0p1FallbackRemote/Named',
    primaryMissingManifestUrl,
    {
      fallbackUrls: [remoteManifestUrl],
      force: true,
      hooks,
      remoteName: 'p0p1FallbackRemote',
    },
  );
  const staleManifest = await fetchFederationManifest(remoteManifestUrl, {
    cacheTtl: 1,
    force: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const staleResult = await fetchFederationManifest(remoteManifestUrl, {
    cacheTtl: 1,
    staleWhileRevalidate: true,
  });
  const preloadPlan = createFederationManifestPreloadPlan(
    remoteManifestUrl,
    fallbackManifest,
    {
      '/catalog': ['./Widget', './Named'],
    },
    {
      asyncChunkPolicy: 'all',
    },
  );
  await warmFederationRemotes(
    {
      p0p1WarmRemote: {
        manifestUrl: remoteManifestUrl,
        preload: false,
        target: 'web',
      },
    },
    {
      hooks,
    },
  );
  const runtimeNamedModule = await loadRemoteFromManifest(
    'p0p1RuntimeRemote/Named',
    remoteManifestUrl,
    {
      force: true,
      hooks,
      integrity: {
        mode: 'both',
      },
      remoteName: 'p0p1RuntimeRemote',
    },
  );

  __federation_method_setRemote('p0p1EsmRemote', {
    url: async () => \`\${remoteOrigin}/remoteEntry.js\`,
    format: 'esm',
    from: 'vite',
    shareScope: 'default',
  });
  const esmContainer = await __federation_method_ensure('p0p1EsmRemote');
  const esmWidgetModule = await __federation_method_getRemote('p0p1EsmRemote', './Widget');
  const esmWidget = __federation_method_unwrapDefault(
    __federation_method_wrapDefault(esmWidgetModule, true),
  );

  __federation_method_setRemote('p0p1VarRemote', {
    url: async () => \`\${remoteOrigin}/remoteEntry.var.js\`,
    format: 'var',
    from: 'vite',
    entryGlobalName: 'p0p1Remote',
    shareScope: 'default',
  });
  const varContainer = await __federation_method_ensure('p0p1VarRemote');
  const varWidgetModule = await __federation_method_getRemote('p0p1VarRemote', './Widget');
  const varWidget = __federation_method_unwrapDefault(
    __federation_method_wrapDefault(varWidgetModule, true),
  );

  let circuitBreakerMessage = '';
  try {
    await fetchFederationManifest(primaryMissingManifestUrl, {
      cache: false,
      circuitBreaker: {
        cooldownMs: 30_000,
        failureThreshold: 1,
      },
      force: true,
    });
  } catch {
    // Expected: this first miss opens the circuit.
  }
  try {
    await fetchFederationManifest(primaryMissingManifestUrl, {
      cache: false,
      circuitBreaker: {
        cooldownMs: 30_000,
        failureThreshold: 1,
      },
    });
  } catch (error) {
    circuitBreakerMessage = error instanceof Error ? error.message : String(error);
  }

  const debugInfo = getFederationDebugInfo();
  const result = {
    circuitBreakerMessage,
    compat: {
      esmContainerReady: typeof esmContainer?.get === 'function',
      esmWidgetType: typeof esmWidget,
      varContainerReady: typeof varContainer?.get === 'function',
      varWidgetType: typeof varWidget,
    },
    debugInfo,
    fallbackManifestName: fallbackManifest.name,
    fallbackNamedStatus: fallbackRemoteModule.namedStatus,
    hostShare,
    namedStatus: namedModule.namedStatus,
    namedValue,
    preloadLinkCount: preloadPlan.links.length,
    runtimeNamedStatus: runtimeNamedModule.namedStatus,
    staleWhileRevalidateServedStale: staleManifest.name === staleResult.name,
    status: 'ready',
    telemetryEvents,
    widgetReport,
  };

  window.__P0_P1_SMOKE_RESULT__ = result;
  setStatus('ready');
}

runRuntimeSmoke().catch((error) => {
  window.__P0_P1_SMOKE_RESULT__ = {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    status: 'error',
  };
  setStatus('error');
  throw error;
});
`,
  );
  await writeFile(
    path.join(hostDir, 'ssr-check.mjs'),
    `import assert from 'node:assert/strict';
import {
  createServerFederationInstance,
  fetchFederationManifest,
  getFederationDebugInfo,
  loadRemoteFromManifest,
} from 'vite-plugin-federation/runtime';

const manifestUrl = process.env.MF_SMOKE_REMOTE_MANIFEST_URL;
if (!manifestUrl) throw new Error('MF_SMOKE_REMOTE_MANIFEST_URL is required.');

createServerFederationInstance({
  name: 'p0p1SsrSmokeHost',
  remotes: [],
  shared: {
    '@mf-smoke/shared-value': {
      version: '1.0.0',
      lib: () => ({
        default: {
          label: 'host@1.0.0',
          origin: 'host',
          version: '1.0.0',
        },
      }),
      shareConfig: {
        requiredVersion: false,
        singleton: true,
      },
    },
  },
  plugins: [],
  shareStrategy: 'loaded-first',
});

const manifest = await fetchFederationManifest(manifestUrl, { force: true });
assert.equal(manifest.name, 'p0p1Remote');
assert.ok(manifest.metaData?.ssrRemoteEntry?.name, 'manifest must advertise ssrRemoteEntry');

const remoteModule = await loadRemoteFromManifest('p0p1Remote/ServerWidget', manifestUrl, {
  force: true,
  target: 'node',
});
const report = (remoteModule.getServerWidgetReport || remoteModule.default)();
assert.equal(report.renderedBy, 'p0p1Remote');
assert.equal(report.target, 'node');

const debugInfo = getFederationDebugInfo();
const ssrRegistration = debugInfo.runtime.registeredManifestRemotes
  .filter((remote) => remote.alias === 'p0p1Remote' && remote.target === 'node')
  .at(-1);

assert.equal(ssrRegistration?.target, 'node');
assert.ok(
  ssrRegistration?.entry?.includes(manifest.metaData.ssrRemoteEntry.name),
  'node target should select ssrRemoteEntry',
);

console.log('SSR manifest runtime smoke passed.');
`,
  );

  return { hostDir, remoteDir, runtimeRoot };
}

async function writeDtsWorkspace(root) {
  const dtsRoot = path.join(root, 'dts-workspace');
  const remoteDir = path.join(dtsRoot, 'remote');
  const hostDir = path.join(dtsRoot, 'host');

  await mkdir(path.join(remoteDir, 'src'), { recursive: true });
  await mkdir(path.join(hostDir, 'src'), { recursive: true });
  await writeJson(path.join(dtsRoot, 'package.json'), {
    name: 'vite-plugin-federation-p0-p1-dts-smoke',
    private: true,
    packageManager: 'pnpm@10.33.0',
    pnpm: {
      onlyBuiltDependencies: ['esbuild'],
    },
  });
  await writeFile(path.join(dtsRoot, 'pnpm-workspace.yaml'), 'packages:\n  - remote\n  - host\n');

  const tsconfig = {
    compilerOptions: {
      baseUrl: '.',
      declaration: true,
      declarationMap: false,
      esModuleInterop: true,
      jsx: 'react-jsx',
      lib: ['DOM', 'ES2023'],
      module: 'ESNext',
      moduleResolution: 'Bundler',
      outDir: 'dist',
      skipLibCheck: true,
      strict: true,
      target: 'ES2023',
    },
  };

  await writeJson(path.join(remoteDir, 'package.json'), {
    name: 'p0-p1-smoke-dts-remote',
    private: true,
    type: 'module',
    scripts: {
      build: 'vite build',
    },
    dependencies: {
      [packageName]: packageSpec,
    },
    devDependencies: {
      '@types/node': '25.6.0',
      typescript: '5.9.3',
      vite: '8.0.10',
    },
  });
  await writeJson(path.join(remoteDir, 'tsconfig.json'), {
    ...tsconfig,
    include: ['src', 'vite.config.ts'],
  });
  await writeFile(
    path.join(remoteDir, 'index.html'),
    `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>DTS remote smoke</title></head>
  <body><div id="app"></div><script type="module" src="/src/main.ts"></script></body>
</html>
`,
  );
  await writeFile(
    path.join(remoteDir, 'src', 'answer.ts'),
    `export interface FederationAnswer {
  id: string;
  label: string;
  score: number;
}

export const answer: FederationAnswer = {
  id: 'p0-p1-dts-answer',
  label: 'P0/P1 type-safe answer',
  score: 42,
};

export function formatAnswer(value: FederationAnswer): string {
  return \`\${value.label}: \${value.score}\`;
}
`,
  );
  await writeFile(
    path.join(remoteDir, 'src', 'main.ts'),
    `document.querySelector<HTMLDivElement>('#app')!.textContent = 'dts remote ready';
`,
  );
  await writeFile(
    path.join(remoteDir, 'vite.config.ts'),
    `import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

export default defineConfig({
  plugins: [
    federation({
      name: 'dtsRemote',
      filename: 'remoteEntry.js',
      manifest: true,
      exposes: {
        './answer': './src/answer.ts',
      },
      dts: {
        generateTypes: {
          abortOnError: true,
          generateAPITypes: true,
          typesFolder: '@mf-types',
        },
        consumeTypes: false,
      },
      shared: {},
    }),
  ],
  build: {
    target: 'es2022',
  },
});
`,
  );

  await writeJson(path.join(hostDir, 'package.json'), {
    name: 'p0-p1-smoke-dts-host',
    private: true,
    type: 'module',
    scripts: {
      build: 'vite build',
      typecheck: 'tsc --project tsconfig.json --noEmit',
    },
    dependencies: {
      [packageName]: packageSpec,
    },
    devDependencies: {
      '@types/node': '25.6.0',
      typescript: '5.9.3',
      vite: '8.0.10',
    },
  });
  await writeJson(path.join(hostDir, 'tsconfig.json'), {
    compilerOptions: {
      ...tsconfig.compilerOptions,
      paths: {
        'dtsRemote/*': ['@mf-types/dtsRemote/*'],
      },
    },
    include: ['src', 'vite.config.ts', '@mf-types/**/*.d.ts'],
  });
  await writeFile(
    path.join(hostDir, 'index.html'),
    `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>DTS host smoke</title></head>
  <body><div id="app"></div><script type="module" src="/src/main.ts"></script></body>
</html>
`,
  );
  await writeFile(
    path.join(hostDir, 'src', 'main.ts'),
    `import { answer, formatAnswer, type FederationAnswer } from 'dtsRemote/answer';

const typedAnswer: FederationAnswer = {
  ...answer,
  score: answer.score + 1,
};

document.querySelector<HTMLDivElement>('#app')!.textContent = formatAnswer(typedAnswer);
`,
  );
  await writeFile(
    path.join(hostDir, 'vite.config.ts'),
    `import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

const remoteBaseUrl = process.env.DTS_REMOTE_BASE_URL;
if (!remoteBaseUrl) throw new Error('DTS_REMOTE_BASE_URL is required.');

export default defineConfig({
  plugins: [
    federation({
      name: 'dtsHost',
      manifest: true,
      remotes: {
        dtsRemote: \`\${remoteBaseUrl}/mf-manifest.json\`,
      },
      dts: {
        generateTypes: false,
        consumeTypes: {
          abortOnError: true,
          consumeAPITypes: true,
          family: 4,
          maxRetries: 1,
          remoteTypeUrls: {
            dtsRemote: {
              alias: 'dtsRemote',
              api: \`\${remoteBaseUrl}/@mf-types.d.ts\`,
              zip: \`\${remoteBaseUrl}/@mf-types.zip\`,
            },
          },
          timeout: 30000,
          typesOnBuild: true,
        },
      },
      shared: {},
    }),
  ],
  build: {
    target: 'es2022',
  },
});
`,
  );

  return { dtsRoot, hostDir, remoteDir };
}

function createStaticServer(rootDir, port) {
  const contentTypes = new Map([
    ['.d.ts', 'text/plain; charset=utf-8'],
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.zip', 'application/zip'],
  ]);

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', `http://127.0.0.1:${port}`);
      const relativePath =
        decodeURIComponent(requestUrl.pathname.replace(/^\/+/, '')) || 'index.html';
      const filePath = path.resolve(rootDir, relativePath);

      if (!filePath.startsWith(rootDir)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }

      const body = await readFile(filePath);
      const suffix = filePath.endsWith('.d.ts') ? '.d.ts' : path.extname(filePath);
      response.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        Connection: 'close',
        'Content-Type': contentTypes.get(suffix) || 'application/octet-stream',
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
  server.keepAliveTimeout = 1;
  server.headersTimeout = 2_000;

  return {
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    listen: () =>
      new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => resolve());
      }),
  };
}

async function assertBrowserRuntime(hostUrl, remoteManifestUrl) {
  const { chromium } = await import('@playwright/test');
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    throw new Error(
      `Unable to launch Playwright Chromium for the P0/P1 smoke. Run "pnpm exec playwright install chromium" and retry.\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const page = await browser.newPage();
  const diagnostics = [];
  page.on('console', (message) => {
    diagnostics.push(`[console:${message.type()}] ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    diagnostics.push(`[pageerror] ${error.message}`);
  });
  page.on('requestfailed', (request) => {
    diagnostics.push(
      `[requestfailed] ${request.url()} ${request.failure()?.errorText || ''}`.trim(),
    );
  });

  try {
    await page.goto(hostUrl);
    await page.waitForFunction(() => globalThis.__P0_P1_SMOKE_RESULT__?.status, null, {
      timeout: browserTimeoutMs,
    });
    const result = await page.evaluate(() => globalThis.__P0_P1_SMOKE_RESULT__);

    if (result.status !== 'ready') {
      throw new Error(`runtime status=${result.status}: ${result.message || 'unknown failure'}`);
    }

    if (result.hostShare?.label !== 'host@1.0.0') {
      throw new Error(`Expected host share host@1.0.0, received ${result.hostShare?.label}`);
    }
    if (result.widgetReport?.sharedLabel !== 'host@1.0.0') {
      throw new Error(
        `Expected loaded-first widget share host@1.0.0, received ${result.widgetReport?.sharedLabel}`,
      );
    }
    if (result.namedStatus !== 'named-export-ok') {
      throw new Error(`Expected named export status, received ${result.namedStatus}`);
    }
    if (result.namedValue !== 'manual-chunk-ok|async-chunk-ok') {
      throw new Error(`Expected named async chunk value, received ${result.namedValue}`);
    }
    if (result.runtimeNamedStatus !== 'named-export-ok') {
      throw new Error(
        `Expected runtime named export status, received ${result.runtimeNamedStatus}`,
      );
    }
    if (result.fallbackManifestName !== 'p0p1Remote') {
      throw new Error(
        `Expected fallback manifest p0p1Remote, received ${result.fallbackManifestName}`,
      );
    }
    if (result.fallbackNamedStatus !== 'named-export-ok') {
      throw new Error(
        `Expected fallback remote named export, received ${result.fallbackNamedStatus}`,
      );
    }
    if (!result.staleWhileRevalidateServedStale) {
      throw new Error('Expected staleWhileRevalidate to serve the expired cached manifest.');
    }
    if (!result.circuitBreakerMessage.includes('circuit breaker is open')) {
      throw new Error(
        `Expected open circuit breaker message, received ${result.circuitBreakerMessage}`,
      );
    }
    if (result.preloadLinkCount < 1) {
      throw new Error(`Expected at least one preload link, received ${result.preloadLinkCount}`);
    }
    if (!result.compat.esmContainerReady || result.compat.esmWidgetType !== 'function') {
      throw new Error(`ESM compatibility path did not load: ${JSON.stringify(result.compat)}`);
    }
    if (!result.compat.varContainerReady || result.compat.varWidgetType !== 'function') {
      throw new Error(`VAR compatibility path did not load: ${JSON.stringify(result.compat)}`);
    }

    const integrityCheck = result.debugInfo.runtime.manifestIntegrityChecks.at(-1);
    if (
      !integrityCheck ||
      integrityCheck.status !== 'success' ||
      integrityCheck.mode !== 'both' ||
      !integrityCheck.verifiedWith.includes('integrity') ||
      !integrityCheck.verifiedWith.includes('contentHash')
    ) {
      throw new Error(
        `Expected successful remoteEntry integrity check, received ${JSON.stringify(integrityCheck)}`,
      );
    }
    const fallbackRegistration = result.debugInfo.runtime.registeredManifestRemotes.find((remote) =>
      remote.manifestUrl.endsWith('/missing-mf-manifest.json'),
    );
    if (!fallbackRegistration?.sourceUrl || fallbackRegistration.sourceUrl !== remoteManifestUrl) {
      throw new Error('Expected fallback registration to record the winning sourceUrl.');
    }
    const sharedResolution = result.debugInfo.runtime.sharedResolutionGraph
      .filter((entry) => entry.pkgName === '@mf-smoke/shared-value')
      .at(-1);
    if (
      !sharedResolution ||
      !['loaded', 'resolved'].includes(sharedResolution.status) ||
      sharedResolution.selected?.version !== '1.0.0'
    ) {
      throw new Error(
        `Expected shared graph to select host@1.0.0, received ${JSON.stringify(sharedResolution)}`,
      );
    }
    if (!result.telemetryEvents.includes('remote-load:after:success')) {
      throw new Error(
        `Expected remote-load telemetry, received ${result.telemetryEvents.join(', ')}`,
      );
    }
  } catch (error) {
    throw new Error(
      `P0/P1 published package browser smoke failed: ${
        error instanceof Error ? error.message : String(error)
      }\n${diagnostics.join('\n')}`,
    );
  } finally {
    await browser.close();
  }
}

async function assertDevtoolsAndRemoteDevLoad(hostUrl, hostDir) {
  const { chromium, expect } = await import('@playwright/test');
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    throw new Error(
      `Unable to launch Playwright Chromium for the P0/P1 dev smoke. Run "pnpm exec playwright install chromium" and retry.\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const page = await browser.newPage();
  const diagnostics = [];
  page.on('console', (message) => {
    diagnostics.push(`[console:${message.type()}] ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    diagnostics.push(`[pageerror] ${error.message}`);
  });

  try {
    const devtoolsResponse = await fetch(`${hostUrl}__mf_devtools`);
    if (!devtoolsResponse.ok) {
      throw new Error(`Devtools endpoint returned ${devtoolsResponse.status}`);
    }
    const devtoolsPayload = await devtoolsResponse.json();
    if (
      devtoolsPayload.contractVersion !== '1.0.0' ||
      devtoolsPayload.name !== 'p0p1Host' ||
      devtoolsPayload.role !== 'host'
    ) {
      throw new Error(`Unexpected devtools payload: ${JSON.stringify(devtoolsPayload)}`);
    }

    await page.goto(hostUrl);
    await page.waitForFunction(() => globalThis.__P0_P1_SMOKE_RESULT__?.status === 'ready', null, {
      timeout: browserTimeoutMs,
    });
    await expect(page.locator('#__vite_plugin_federation_devtools_overlay')).toHaveCount(1);

    const devtoolsContract = await page.evaluate(() => {
      const hook = globalThis.__VITE_PLUGIN_FEDERATION_DEVTOOLS__;
      return {
        appRole: hook?.apps?.p0p1Host?.role,
        contractVersion: hook?.contractVersion,
        exportSnapshotType: typeof hook?.exportSnapshot,
      };
    });
    if (
      devtoolsContract.contractVersion !== '1.0.0' ||
      devtoolsContract.appRole !== 'host' ||
      devtoolsContract.exportSnapshotType !== 'function'
    ) {
      throw new Error(`Unexpected devtools contract: ${JSON.stringify(devtoolsContract)}`);
    }

    await expect(page.locator('#react-widget')).toContainText('React remote HMR / initial');
  } catch (error) {
    throw new Error(
      `P0/P1 published package devtools/dev-remote smoke failed: ${
        error instanceof Error ? error.message : String(error)
      }\nHost: ${hostDir}\n${diagnostics.join('\n')}`,
    );
  } finally {
    await browser.close();
  }
}

async function verifyPackageSpec() {
  if (!isRegistryPackageSpec(packageSpec)) {
    console.log(`Using explicit ${packageName} package spec: ${packageSpec}`);
    return;
  }

  const viewTarget = packageSpec === 'latest' ? packageName : `${packageName}@${packageSpec}`;
  const metadata = JSON.parse(
    run('npm', ['view', viewTarget, 'version', 'dist-tags', '--json'], repoRoot, {
      captureOutput: true,
      timeoutMs: 60_000,
    }),
  );
  const resolvedVersion = getNpmViewVersion(metadata);

  if (!resolvedVersion) {
    throw new Error(`Could not resolve npm package spec ${viewTarget}`);
  }

  if (packageSpec === 'latest' && metadata['dist-tags']?.latest !== resolvedVersion) {
    throw new Error(
      `Expected npm latest dist-tag to resolve to ${resolvedVersion}, received ${metadata['dist-tags']?.latest}`,
    );
  }

  if (packageSpec === 'latest' && resolvedVersion !== localPackageVersion) {
    console.warn(
      `npm latest resolves to ${packageName}@${resolvedVersion}, while the local package version is ${localPackageVersion}. ` +
        'Set P0_P1_SMOKE_PACKAGE_SPEC to a release candidate, dist-tag, or packed tarball to validate a pending release.',
    );
  }

  console.log(
    `Verified npm package spec ${viewTarget} resolves to ${packageName}@${resolvedVersion}.`,
  );
}

async function runRuntimeSmoke(tempRoot, usedPorts, storeDir) {
  const { hostDir, remoteDir, runtimeRoot } = await writeRuntimeWorkspace(tempRoot);
  const remotePort = await getFreePort(usedPorts);
  const hostPort = await getFreePort(usedPorts);
  const hostDevPort = await getFreePort(usedPorts);
  const remoteManifestUrl = `http://localhost:${remotePort}/mf-manifest.json`;
  const hostUrl = `http://localhost:${hostPort}/`;
  const hostDevUrl = `http://localhost:${hostDevPort}/`;
  const runtimeEnv = {
    MF_SMOKE_HOST_PORT: String(hostPort),
    MF_SMOKE_REMOTE_MANIFEST_URL: remoteManifestUrl,
    MF_SMOKE_REMOTE_PORT: String(remotePort),
  };

  console.log('\nCreating and installing temporary runtime/devtools/compat workspace...');
  run(
    'pnpm',
    [
      'install',
      '--prefer-offline',
      '--no-frozen-lockfile',
      '--reporter',
      'append-only',
      '--store-dir',
      storeDir,
    ],
    runtimeRoot,
    { timeoutMs: installTimeoutMs },
  );

  console.log('Building temporary remote and host production apps...');
  run('pnpm', ['--filter', 'p0-p1-smoke-remote', 'build'], runtimeRoot, {
    env: runtimeEnv,
  });
  run('pnpm', ['--filter', 'p0-p1-smoke-host', 'build'], runtimeRoot, {
    env: runtimeEnv,
  });

  const requiredOutputs = [
    path.join(remoteDir, 'dist', 'mf-manifest.json'),
    path.join(remoteDir, 'dist', 'mf-stats.json'),
    path.join(remoteDir, 'dist', 'mf-debug.json'),
    path.join(remoteDir, 'dist', 'remoteEntry.js'),
    path.join(remoteDir, 'dist', 'remoteEntry.var.js'),
    path.join(hostDir, 'dist', 'index.html'),
  ];
  const missingOutputs = requiredOutputs.filter((file) => !existsSync(file));
  if (missingOutputs.length > 0) {
    throw new Error(
      `Temporary runtime smoke build is missing outputs: ${missingOutputs.join(', ')}`,
    );
  }

  const manifest = JSON.parse(
    await readFile(path.join(remoteDir, 'dist', 'mf-manifest.json'), 'utf8'),
  );
  if (
    manifest.schemaVersion !== '1.0.0' ||
    manifest.metaData?.remoteEntry?.integrity === undefined ||
    manifest.metaData?.remoteEntry?.contentHash === undefined ||
    !manifest.metaData?.ssrRemoteEntry?.name
  ) {
    throw new Error('Temporary remote manifest is missing schema/integrity/SSR metadata.');
  }

  let remotePreview;
  let hostPreview;
  try {
    remotePreview = startProcess(
      'p0-p1-remote-preview',
      'pnpm',
      [
        '--filter',
        'p0-p1-smoke-remote',
        'exec',
        'vite',
        'preview',
        '--host',
        'localhost',
        '--port',
        String(remotePort),
        '--strictPort',
      ],
      runtimeRoot,
      { env: runtimeEnv },
    );
    hostPreview = startProcess(
      'p0-p1-host-preview',
      'pnpm',
      [
        '--filter',
        'p0-p1-smoke-host',
        'exec',
        'vite',
        'preview',
        '--host',
        'localhost',
        '--port',
        String(hostPort),
        '--strictPort',
      ],
      runtimeRoot,
      { env: runtimeEnv },
    );
    await waitForUrl(remoteManifestUrl, remotePreview);
    await waitForUrl(hostUrl, hostPreview);
    await assertBrowserRuntime(hostUrl, remoteManifestUrl);
    run('pnpm', ['--filter', 'p0-p1-smoke-host', 'ssr'], runtimeRoot, {
      env: runtimeEnv,
    });
  } finally {
    await stopProcess(hostPreview);
    await stopProcess(remotePreview);
  }

  console.log('Running temporary devtools and dev remote load smoke...');
  let remoteDev;
  let hostDev;
  try {
    const devEnv = {
      ...runtimeEnv,
      MF_SMOKE_ENABLE_REACT_HMR: '1',
      MF_SMOKE_HOST_PORT: String(hostDevPort),
    };
    remoteDev = startProcess(
      'p0-p1-remote-dev',
      'pnpm',
      [
        '--filter',
        'p0-p1-smoke-remote',
        'exec',
        'vite',
        '--host',
        'localhost',
        '--port',
        String(remotePort),
        '--strictPort',
      ],
      runtimeRoot,
      { env: devEnv },
    );
    hostDev = startProcess(
      'p0-p1-host-dev',
      'pnpm',
      [
        '--filter',
        'p0-p1-smoke-host',
        'exec',
        'vite',
        '--host',
        'localhost',
        '--port',
        String(hostDevPort),
        '--strictPort',
      ],
      runtimeRoot,
      { env: devEnv },
    );
    await waitForUrl(remoteManifestUrl, remoteDev);
    await waitForUrl(hostDevUrl, hostDev);
    await assertDevtoolsAndRemoteDevLoad(hostDevUrl, hostDir);
  } finally {
    await stopProcess(hostDev);
    await stopProcess(remoteDev);
  }

  console.log(
    'Runtime, SSR, compatibility, DevTools, dev remote loading, resilience, and compiler smoke passed.',
  );
}

async function runDtsSmoke(tempRoot, usedPorts, storeDir) {
  const { dtsRoot, hostDir, remoteDir } = await writeDtsWorkspace(tempRoot);
  const remotePort = await getFreePort(usedPorts);
  const remoteBaseUrl = `http://127.0.0.1:${remotePort}`;

  console.log('\nCreating and installing temporary DTS workspace...');
  run(
    'pnpm',
    [
      'install',
      '--prefer-offline',
      '--no-frozen-lockfile',
      '--reporter',
      'append-only',
      '--store-dir',
      storeDir,
    ],
    dtsRoot,
    { timeoutMs: installTimeoutMs },
  );

  console.log('Building temporary DTS remote and verifying type artifacts...');
  run('pnpm', ['--filter', 'p0-p1-smoke-dts-remote', 'build'], dtsRoot);

  const requiredRemoteArtifacts = [
    path.join(remoteDir, 'dist', 'mf-manifest.json'),
    path.join(remoteDir, 'dist', '@mf-types.zip'),
    path.join(remoteDir, 'dist', '@mf-types.d.ts'),
    path.join(remoteDir, 'dist', '@mf-types', 'answer.d.ts'),
    path.join(remoteDir, 'dist', '@mf-types', 'compiled-types', 'src', 'answer.d.ts'),
  ];
  const missingArtifacts = requiredRemoteArtifacts.filter((file) => !existsSync(file));
  if (missingArtifacts.length > 0) {
    throw new Error(`Temporary DTS remote is missing artifacts: ${missingArtifacts.join(', ')}`);
  }

  const remoteManifest = JSON.parse(
    await readFile(path.join(remoteDir, 'dist', 'mf-manifest.json'), 'utf8'),
  );
  if (
    remoteManifest.metaData?.types?.name !== '@mf-types.zip' ||
    remoteManifest.metaData?.types?.api !== '@mf-types.d.ts'
  ) {
    throw new Error('Temporary DTS remote manifest does not advertise type artifacts.');
  }

  const dtsServer = createStaticServer(path.join(remoteDir, 'dist'), remotePort);
  try {
    await dtsServer.listen();
    console.log('Building temporary DTS host with remote type consumption enabled...');
    const dtsHostEnv = {
      DTS_REMOTE_BASE_URL: remoteBaseUrl,
    };
    await runDtsHostBuildUntilArtifacts(dtsRoot, hostDir, dtsHostEnv);
    run('pnpm', ['--filter', 'p0-p1-smoke-dts-host', 'typecheck'], dtsRoot, {
      env: dtsHostEnv,
    });

    const consumedDeclarationPath = path.join(hostDir, '@mf-types/dtsRemote/answer.d.ts');
    const compiledDeclarationPath = path.join(
      hostDir,
      '@mf-types/dtsRemote/compiled-types/src/answer.d.ts',
    );
    if (!existsSync(consumedDeclarationPath) || !existsSync(compiledDeclarationPath)) {
      throw new Error('Temporary DTS host did not materialize consumed remote declarations.');
    }
    const compiledDeclaration = await readFile(compiledDeclarationPath, 'utf8');
    if (
      !compiledDeclaration.includes('FederationAnswer') ||
      !compiledDeclaration.includes('formatAnswer')
    ) {
      throw new Error('Temporary DTS host consumed declarations do not include exposed API types.');
    }
  } finally {
    await dtsServer.close();
  }

  console.log('DTS generation and consumption smoke passed.');
}

async function runDtsHostBuildUntilArtifacts(dtsRoot, hostDir, env) {
  const consumedDeclarationPath = path.join(hostDir, '@mf-types/dtsRemote/answer.d.ts');
  const compiledDeclarationPath = path.join(
    hostDir,
    '@mf-types/dtsRemote/compiled-types/src/answer.d.ts',
  );
  const distIndexPath = path.join(hostDir, 'dist/index.html');
  const handle = startProcess(
    'p0-p1-dts-host-build',
    'pnpm',
    ['--filter', 'p0-p1-smoke-dts-host', 'build'],
    dtsRoot,
    { env },
  );
  const deadline = Date.now() + commandTimeoutMs;

  try {
    while (Date.now() < deadline) {
      if (
        existsSync(consumedDeclarationPath) &&
        existsSync(compiledDeclarationPath) &&
        existsSync(distIndexPath)
      ) {
        await sleep(2_000);
        if (handle.child.exitCode === null) {
          console.warn(
            'DTS host build produced consumed declarations but did not exit promptly; terminating the temporary build process before running tsc.',
          );
          await stopProcess(handle);
        }
        if (handle.child.exitCode && handle.child.exitCode !== 0) {
          throw new Error(
            `DTS host build exited with code ${handle.child.exitCode}.\n${handle.getLogs()}`,
          );
        }
        return;
      }

      if (handle.child.exitCode !== null) {
        throw new Error(
          `DTS host build exited before expected artifacts were created.\n${handle.getLogs()}`,
        );
      }

      await sleep(250);
    }

    throw new Error(`Timed out waiting for DTS host consumed declarations.\n${handle.getLogs()}`);
  } finally {
    await stopProcess(handle);
  }
}

async function main() {
  await verifyPackageSpec();

  const tempRoot = await mkdtemp(path.join(tmpdir(), 'vite-plugin-federation-p0-p1-smoke-'));
  const storeDir = configuredStoreDir || path.join(tempRoot, 'pnpm-store');
  const usedPorts = new Set();

  try {
    await runRuntimeSmoke(tempRoot, usedPorts, storeDir);
    await runDtsSmoke(tempRoot, usedPorts, storeDir);
    console.log(`\nP0/P1 feature smoke passed against ${packageName}@${packageSpec}.`);
  } finally {
    if (!process.env.KEEP_VITE_PLUGIN_FEDERATION_P0_P1_SMOKE_TMP) {
      await rm(tempRoot, { force: true, recursive: true });
    } else {
      console.log(`Preserved temporary smoke workspace at ${tempRoot}`);
    }
  }
}

await main();
