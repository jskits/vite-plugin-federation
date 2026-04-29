import { spawnSync } from 'node:child_process';
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
const matrix = [
  ['vite-5', '5.4.21'],
  ['vite-6', '6.4.2'],
  ['vite-7', '7.3.2'],
  ['vite-8', '8.0.10'],
];

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

async function writeMatrixApp(appDir, viteVersion, tarballUrl) {
  await mkdir(path.join(appDir, 'src'), { recursive: true });
  await writeFile(
    path.join(appDir, 'package.json'),
    JSON.stringify(
      {
        name: `vite-plugin-federation-${viteVersion.replaceAll('.', '-')}-smoke`,
        private: true,
        type: 'module',
        packageManager: 'pnpm@10.33.0',
        pnpm: {
          onlyBuiltDependencies: ['esbuild'],
        },
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
    path.join(appDir, 'index.html'),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>vite peer matrix smoke</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`,
  );
  await writeFile(
    path.join(appDir, 'vite.config.js'),
    `import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

export default defineConfig({
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
    path.join(appDir, 'src', 'shared-value.js'),
    `export const sharedValue = 'matrix-shared-value';
`,
  );
  await writeFile(
    path.join(appDir, 'src', 'value.js'),
    `import { sharedValue } from './shared-value.js';

export function getMatrixValue() {
  return sharedValue;
}
`,
  );
  await writeFile(
    path.join(appDir, 'src', 'async-value.js'),
    `export const asyncValue = 'async-matrix-value';
`,
  );
  await writeFile(
    path.join(appDir, 'src', 'main.js'),
    `import { getFederationDebugInfo } from 'vite-plugin-federation/runtime';
import { getMatrixValue } from './value.js';

document.querySelector('#app').textContent = getMatrixValue();
globalThis.__VITE_MATRIX_DEBUG__ = getFederationDebugInfo();
void import('./async-value.js');
`,
  );
}

async function main() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'vite-plugin-federation-vite-matrix-'));
  const packDir = path.join(tempRoot, 'pack');
  const storeDir = path.join(tempRoot, 'pnpm-store');

  try {
    console.log('Building workspace package for Vite peer matrix...');
    run('pnpm', ['--filter', 'vite-plugin-federation', 'build'], repoRoot);

    await mkdir(packDir, { recursive: true });
    const packInfo = JSON.parse(
      run('pnpm', ['pack', '--json', '--pack-destination', packDir], packageDir, {
        captureOutput: true,
      }),
    );
    const tarballUrl = pathToFileURL(packInfo.filename).href;

    for (const [label, viteVersion] of matrix) {
      const appDir = path.join(tempRoot, label);
      console.log(`\nTesting ${packageJson.name} against vite@${viteVersion}...`);
      await writeMatrixApp(appDir, viteVersion, tarballUrl);
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
        appDir,
        { timeoutMs: Number(process.env.VITE_MATRIX_INSTALL_TIMEOUT_MS || 300_000) },
      );
      run('pnpm', ['build'], appDir);

      const expectedOutputs = [
        path.join(appDir, 'dist', 'index.html'),
        path.join(appDir, 'dist', 'mf-manifest.json'),
      ];
      const missingOutputs = expectedOutputs.filter((file) => !existsSync(file));
      if (missingOutputs.length > 0) {
        throw new Error(
          `vite@${viteVersion} smoke build is missing outputs: ${missingOutputs.join(', ')}`,
        );
      }
    }

    console.log('\nVite peer matrix smoke passed.');
  } finally {
    if (!process.env.KEEP_VITE_PLUGIN_FEDERATION_MATRIX_TMP) {
      await rm(tempRoot, { force: true, recursive: true });
    }
  }
}

await main();
