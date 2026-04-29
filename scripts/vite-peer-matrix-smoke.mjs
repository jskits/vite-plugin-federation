import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const packageDir = path.join(repoRoot, 'packages', 'vite-plugin-federation');
const packageJson = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
const commandTimeoutMs = Number(process.env.VITE_MATRIX_COMMAND_TIMEOUT_MS || 240_000);
const installTimeoutMs = Number(process.env.VITE_MATRIX_INSTALL_TIMEOUT_MS || 300_000);
const previewTimeoutMs = Number(process.env.VITE_MATRIX_PREVIEW_TIMEOUT_MS || 45_000);
const browserTimeoutMs = Number(process.env.VITE_MATRIX_BROWSER_TIMEOUT_MS || 45_000);
const matrix = [
  ['vite-5', '5.4.21'],
  ['vite-6', '6.4.2'],
  ['vite-7', '7.3.2'],
  ['vite-8', '8.0.10'],
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    if (logs.length > 120) {
      logs.shift();
    }
    if (process.env.VITE_MATRIX_VERBOSE) {
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

function getFreePort(usedPorts) {
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
  const deadline = Date.now() + previewTimeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    if (handle.child.exitCode !== null) {
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
    }\n${handle.getLogs()}`,
  );
}

async function writeMatrixWorkspace(workspaceDir, label, viteVersion, tarballUrl) {
  const remoteName = `vite-matrix-${label}-remote`;
  const hostName = `vite-matrix-${label}-host`;
  const remoteDir = path.join(workspaceDir, 'remote');
  const hostDir = path.join(workspaceDir, 'host');

  await mkdir(path.join(remoteDir, 'src'), { recursive: true });
  await mkdir(path.join(hostDir, 'src'), { recursive: true });

  await writeFile(
    path.join(workspaceDir, 'package.json'),
    JSON.stringify(
      {
        name: `vite-plugin-federation-${label}-runtime-smoke`,
        private: true,
        packageManager: 'pnpm@10.33.0',
        pnpm: {
          onlyBuiltDependencies: ['esbuild'],
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(workspaceDir, 'pnpm-workspace.yaml'),
    'packages:\n  - remote\n  - host\n',
  );

  for (const [dir, name] of [
    [remoteDir, remoteName],
    [hostDir, hostName],
  ]) {
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify(
        {
          name,
          private: true,
          type: 'module',
          scripts: {
            build: 'vite build',
          },
          dependencies: {
            [packageJson.name]: tarballUrl,
          },
          devDependencies: {
            vite: viteVersion,
          },
        },
        null,
        2,
      ),
    );
    await writeFile(
      path.join(dir, 'index.html'),
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`,
    );
  }

  await writeFile(
    path.join(remoteDir, 'vite.config.js'),
    `import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

const port = Number(process.env.MATRIX_REMOTE_PORT);
if (!port) throw new Error('MATRIX_REMOTE_PORT is required.');

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
          if (id.includes('/src/shared-value.js')) {
            return 'matrix-shared-value';
          }
        },
      },
    },
  },
  plugins: [
    federation({
      name: 'viteMatrixRemote',
      filename: 'remoteEntry.js',
      manifest: true,
      publicPath: \`http://localhost:\${port}/\`,
      dts: false,
      exposes: {
        './value': './src/value.js',
      },
    }),
  ],
});
`,
  );
  await writeFile(
    path.join(remoteDir, 'src', 'shared-value.js'),
    `export const sharedValue = '${label}:matrix-shared-value';
`,
  );
  await writeFile(
    path.join(remoteDir, 'src', 'async-value.js'),
    `export const asyncValue = '${label}:async-matrix-value';
`,
  );
  await writeFile(
    path.join(remoteDir, 'src', 'value.js'),
    `import { sharedValue } from './shared-value.js';

export function getMatrixValue() {
  return sharedValue;
}

export async function getAsyncMatrixValue() {
  const mod = await import('./async-value.js');
  return mod.asyncValue;
}
`,
  );
  await writeFile(
    path.join(remoteDir, 'src', 'main.js'),
    `document.querySelector('#app').textContent = 'remote ready';
`,
  );

  await writeFile(
    path.join(hostDir, 'vite.config.js'),
    `import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

const port = Number(process.env.MATRIX_HOST_PORT);
const remoteManifestUrl = process.env.MATRIX_REMOTE_MANIFEST_URL;
if (!port) throw new Error('MATRIX_HOST_PORT is required.');
if (!remoteManifestUrl) throw new Error('MATRIX_REMOTE_MANIFEST_URL is required.');

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
  plugins: [
    federation({
      name: 'viteMatrixHost',
      dts: false,
      remotes: {
        viteMatrixRemote: remoteManifestUrl,
      },
    }),
  ],
});
`,
  );
  await writeFile(
    path.join(hostDir, 'src', 'local-async.js'),
    `export const localAsyncValue = '${label}:local-async-value';
`,
  );
  await writeFile(
    path.join(hostDir, 'src', 'main.js'),
    `import { getFederationDebugInfo } from 'vite-plugin-federation/runtime';

async function boot() {
  const remote = await import('viteMatrixRemote/value');
  const local = await import('./local-async.js');
  const value = remote.getMatrixValue();
  const asyncValue = await remote.getAsyncMatrixValue();
  const result = {
    asyncValue,
    localAsyncValue: local.localAsyncValue,
    status: 'ready',
    value,
    debug: getFederationDebugInfo(),
  };

  globalThis.__VITE_MATRIX_RESULT__ = result;
  const app = document.querySelector('#app');
  app.dataset.status = 'ready';
  app.textContent = [value, asyncValue, local.localAsyncValue].join(' | ');
}

boot().catch((error) => {
  globalThis.__VITE_MATRIX_RESULT__ = {
    message: error instanceof Error ? error.message : String(error),
    status: 'error',
  };
  document.querySelector('#app').textContent = globalThis.__VITE_MATRIX_RESULT__.message;
  throw error;
});
`,
  );

  return { hostName, remoteName };
}

async function assertRuntime(label, viteVersion, hostUrl, remoteManifestUrl) {
  const { chromium } = await import('@playwright/test');
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    throw new Error(
      `Unable to launch Playwright Chromium for the Vite peer runtime matrix. Run "pnpm exec playwright install chromium" and retry.\n${
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
    await page.waitForFunction(() => globalThis.__VITE_MATRIX_RESULT__?.status, null, {
      timeout: browserTimeoutMs,
    });
    const result = await page.evaluate(() => globalThis.__VITE_MATRIX_RESULT__);

    if (result.status !== 'ready') {
      throw new Error(`runtime status=${result.status}: ${result.message || 'unknown failure'}`);
    }

    const expected = {
      asyncValue: `${label}:async-matrix-value`,
      localAsyncValue: `${label}:local-async-value`,
      value: `${label}:matrix-shared-value`,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (result[key] !== value) {
        throw new Error(`Expected ${key}=${value}, received ${result[key]}`);
      }
    }

    const fetchedManifest = await page.evaluate((url) => {
      return performance
        .getEntriesByType('resource')
        .some((entry) => entry.name === url || entry.name.startsWith(`${url}?`));
    }, remoteManifestUrl);
    if (!fetchedManifest) {
      throw new Error(`vite@${viteVersion} did not request ${remoteManifestUrl}.`);
    }
  } catch (error) {
    throw new Error(
      `vite@${viteVersion} runtime smoke failed: ${
        error instanceof Error ? error.message : String(error)
      }\n${diagnostics.join('\n')}`,
    );
  } finally {
    await browser.close();
  }
}

async function main() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'vite-plugin-federation-vite-matrix-'));
  const packDir = path.join(tempRoot, 'pack');
  const storeDir = path.join(tempRoot, 'pnpm-store');
  const usedPorts = new Set();

  try {
    console.log('Building workspace package for Vite peer runtime matrix...');
    run('pnpm', ['--filter', 'vite-plugin-federation', 'build'], repoRoot);

    await mkdir(packDir, { recursive: true });
    const packInfo = JSON.parse(
      run('pnpm', ['pack', '--json', '--pack-destination', packDir], packageDir, {
        captureOutput: true,
      }),
    );
    const tarballUrl = pathToFileURL(packInfo.filename).href;

    for (const [label, viteVersion] of matrix) {
      const workspaceDir = path.join(tempRoot, label);
      const remotePort = await getFreePort(usedPorts);
      const hostPort = await getFreePort(usedPorts);
      const hostUrl = `http://localhost:${hostPort}/`;
      const remoteManifestUrl = `http://localhost:${remotePort}/mf-manifest.json`;
      let remoteServer;
      let hostServer;

      console.log(
        `\nTesting ${packageJson.name} runtime against vite@${viteVersion} on remote:${remotePort} host:${hostPort}...`,
      );
      const { hostName, remoteName } = await writeMatrixWorkspace(
        workspaceDir,
        label,
        viteVersion,
        tarballUrl,
      );
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
        workspaceDir,
        { timeoutMs: installTimeoutMs },
      );
      run('pnpm', ['--filter', remoteName, 'build'], workspaceDir, {
        env: { MATRIX_REMOTE_PORT: String(remotePort) },
      });
      run('pnpm', ['--filter', hostName, 'build'], workspaceDir, {
        env: {
          MATRIX_HOST_PORT: String(hostPort),
          MATRIX_REMOTE_MANIFEST_URL: remoteManifestUrl,
        },
      });

      const expectedOutputs = [
        path.join(workspaceDir, 'remote', 'dist', 'index.html'),
        path.join(workspaceDir, 'remote', 'dist', 'mf-manifest.json'),
        path.join(workspaceDir, 'host', 'dist', 'index.html'),
      ];
      const missingOutputs = expectedOutputs.filter((file) => !existsSync(file));
      if (missingOutputs.length > 0) {
        throw new Error(
          `vite@${viteVersion} smoke build is missing outputs: ${missingOutputs.join(', ')}`,
        );
      }

      try {
        remoteServer = startProcess(
          `${label}-remote`,
          'pnpm',
          [
            '--filter',
            remoteName,
            'exec',
            'vite',
            'preview',
            '--host',
            'localhost',
            '--port',
            String(remotePort),
            '--strictPort',
          ],
          workspaceDir,
          { env: { MATRIX_REMOTE_PORT: String(remotePort) } },
        );
        hostServer = startProcess(
          `${label}-host`,
          'pnpm',
          [
            '--filter',
            hostName,
            'exec',
            'vite',
            'preview',
            '--host',
            'localhost',
            '--port',
            String(hostPort),
            '--strictPort',
          ],
          workspaceDir,
          {
            env: {
              MATRIX_HOST_PORT: String(hostPort),
              MATRIX_REMOTE_MANIFEST_URL: remoteManifestUrl,
            },
          },
        );
        await waitForUrl(remoteManifestUrl, remoteServer);
        await waitForUrl(hostUrl, hostServer);
        await assertRuntime(label, viteVersion, hostUrl, remoteManifestUrl);
      } finally {
        await stopProcess(hostServer);
        await stopProcess(remoteServer);
      }
    }

    console.log('\nVite peer runtime matrix smoke passed.');
  } finally {
    if (!process.env.KEEP_VITE_PLUGIN_FEDERATION_MATRIX_TMP) {
      await rm(tempRoot, { force: true, recursive: true });
    }
  }
}

await main();
