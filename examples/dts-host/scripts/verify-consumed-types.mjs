import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const hostDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(hostDir, '../..');
const remoteDistDir = path.resolve(repoRoot, 'examples/dts-remote/dist');
const remotePort = Number(process.env.DTS_REMOTE_PORT || 4176);
const remoteBaseUrl = `http://127.0.0.1:${remotePort}`;

const requiredRemoteArtifacts = ['mf-manifest.json', '@mf-types.zip', '@mf-types.d.ts'];

for (const artifact of requiredRemoteArtifacts) {
  const artifactPath = path.join(remoteDistDir, artifact);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      `Missing remote artifact ${artifactPath}. Run "pnpm --filter example-dts-remote test:artifacts" first.`,
    );
  }
}

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: hostDir,
      env: {
        ...process.env,
        DTS_HOST_CONSUME_TYPES: 'true',
        DTS_REMOTE_BASE_URL: remoteBaseUrl,
      },
      shell: process.platform === 'win32',
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });

const contentTypes = new Map([
  ['.d.ts', 'text/plain; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.zip', 'application/zip'],
]);

const createRemoteServer = () =>
  http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', remoteBaseUrl);
      const relativePath =
        decodeURIComponent(requestUrl.pathname.replace(/^\/+/, '')) || 'index.html';
      const filePath = path.resolve(remoteDistDir, relativePath);

      if (!filePath.startsWith(remoteDistDir)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }

      const body = await readFile(filePath);
      const suffix = filePath.endsWith('.d.ts') ? '.d.ts' : path.extname(filePath);
      response.writeHead(200, {
        'Content-Type': contentTypes.get(suffix) || 'application/octet-stream',
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });

const listen = (server) =>
  new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(remotePort, '127.0.0.1', () => resolve());
  });

const close = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

const server = createRemoteServer();

try {
  await listen(server);
  await fs.promises.rm(path.join(hostDir, 'dist'), { recursive: true, force: true });
  await fs.promises.rm(path.join(hostDir, '@mf-types'), { recursive: true, force: true });
  await run('pnpm', ['build']);
  await run('pnpm', ['exec', 'tsc', '--project', 'tsconfig.json', '--noEmit']);

  const consumedDeclarationPath = path.join(hostDir, '@mf-types/dtsRemote/answer.d.ts');
  if (!fs.existsSync(consumedDeclarationPath)) {
    throw new Error(`Expected consumed declaration ${consumedDeclarationPath} to exist`);
  }
  const compiledDeclarationPath = path.join(
    hostDir,
    '@mf-types/dtsRemote/compiled-types/src/answer.d.ts',
  );
  if (!fs.existsSync(compiledDeclarationPath)) {
    throw new Error(`Expected compiled declaration ${compiledDeclarationPath} to exist`);
  }

  const consumedDeclaration = await readFile(consumedDeclarationPath, 'utf8');
  if (!consumedDeclaration.includes("export * from './compiled-types/src/answer'")) {
    throw new Error('Expected consumed remote declaration to re-export compiled declarations');
  }

  const compiledDeclaration = await readFile(compiledDeclarationPath, 'utf8');
  if (
    !compiledDeclaration.includes('FederationAnswer') ||
    !compiledDeclaration.includes('formatAnswer')
  ) {
    throw new Error('Expected consumed remote declaration to include the exposed API types');
  }

  console.log('DTS host consumption verified.');
} finally {
  await close(server);
}
