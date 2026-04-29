import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const packageDir = path.join(repoRoot, 'packages', 'vite-plugin-federation');
const packageJson = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
const productionDevtoolsMarker = '__vite_plugin_federation_devtools_overlay';
const commandTimeoutMs = Number(process.env.PACKAGE_SMOKE_COMMAND_TIMEOUT_MS || 180_000);

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

async function readBuiltJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return readBuiltJavaScriptFiles(entryPath);
      }
      if (entry.isFile() && entry.name.endsWith('.js')) {
        return [await readFile(entryPath, 'utf8')];
      }
      return [];
    }),
  );
  return files.flat();
}

async function main() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'vite-plugin-federation-smoke-'));
  const packDir = path.join(tempRoot, 'pack');
  const appDir = path.join(tempRoot, 'app');
  const storeDir = path.join(tempRoot, 'pnpm-store');

  try {
    console.log('Building workspace package...');
    run('pnpm', ['--filter', 'vite-plugin-federation', 'build'], repoRoot);

    if (packageJson.sideEffects !== false) {
      throw new Error('package.json must declare "sideEffects": false for tree-shaking.');
    }

    console.log('Packing tarball with pnpm pack...');
    await mkdir(packDir, { recursive: true });
    const packInfo = JSON.parse(
      run('pnpm', ['pack', '--json', '--pack-destination', packDir], packageDir, {
        captureOutput: true,
      }),
    );
    const tarballPath = packInfo.filename;
    const tarballUrl = pathToFileURL(tarballPath).href;
    const packedFiles = new Set((packInfo.files || []).map((entry) => entry.path));
    const requiredFiles = [
      'dist/index.js',
      'dist/index.cjs',
      'dist/index.d.ts',
      'dist/runtime/index.js',
      'dist/runtime/index.cjs',
      'dist/runtime/index.d.ts',
      'package.json',
    ];

    const missingFiles = requiredFiles.filter((file) => !packedFiles.has(file));
    if (missingFiles.length > 0) {
      throw new Error(`Packed tarball is missing required files: ${missingFiles.join(', ')}`);
    }

    console.log('Creating temporary Vite app...');
    await mkdir(path.join(appDir, 'src'), { recursive: true });
    await writeFile(
      path.join(appDir, 'package.json'),
      JSON.stringify(
        {
          name: 'vite-plugin-federation-package-smoke',
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
            react: '19.2.4',
            'react-dom': '19.2.4',
            [packageJson.name]: tarballUrl,
          },
          devDependencies: {
            '@vitejs/plugin-react': '6.0.1',
            vite: '8.0.8',
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
    <title>vite-plugin-federation smoke</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
    );
    await writeFile(
      path.join(appDir, 'vite.config.js'),
      `import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'packageSmokeApp',
      manifest: true,
      dts: false,
    }),
  ],
});
`,
    );
    await writeFile(
      path.join(appDir, 'src', 'App.jsx'),
      `import { getFederationDebugInfo } from 'vite-plugin-federation/runtime';

const debugInfo = getFederationDebugInfo();

export default function App() {
  return (
    <main data-testid="package-smoke" data-remotes={debugInfo.runtime.registeredRemotes.length}>
      package smoke ok
    </main>
  );
}
`,
    );
    await writeFile(
      path.join(appDir, 'src', 'main.jsx'),
      `import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.querySelector('#app')).render(<App />);
`,
    );

    console.log('Installing tarball into temporary app...');
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
      { timeoutMs: Number(process.env.PACKAGE_SMOKE_INSTALL_TIMEOUT_MS || 240_000) },
    );

    console.log('Building temporary app...');
    run('pnpm', ['build'], appDir);

    const expectedBuildOutputs = [
      path.join(appDir, 'dist', 'index.html'),
      path.join(appDir, 'dist', 'mf-manifest.json'),
    ];
    const missingOutputs = expectedBuildOutputs.filter((file) => !existsSync(file));
    if (missingOutputs.length > 0) {
      throw new Error(
        `Temporary app build is missing expected outputs: ${missingOutputs.join(', ')}`,
      );
    }

    const productionJs = (await readBuiltJavaScriptFiles(path.join(appDir, 'dist'))).join('\n');

    if (productionJs.includes(productionDevtoolsMarker)) {
      throw new Error('Production build unexpectedly includes the devtools overlay bootstrap.');
    }

    console.log(`Package smoke test passed using ${path.basename(tarballPath)}`);
  } finally {
    if (!process.env.KEEP_VITE_PLUGIN_FEDERATION_SMOKE_TMP) {
      await rm(tempRoot, { force: true, recursive: true });
    }
  }
}

await main();
