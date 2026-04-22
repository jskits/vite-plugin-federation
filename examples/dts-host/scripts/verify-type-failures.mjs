import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const hostDir = path.resolve(scriptDir, '..');
const corruptRemotePort = Number(process.env.DTS_CORRUPT_REMOTE_PORT || 4177);
const corruptRemoteBaseUrl = `http://127.0.0.1:${corruptRemotePort}`;

const runBuildExpectingFailure = (remoteBaseUrl) =>
  new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['build'], {
      cwd: hostDir,
      env: {
        ...process.env,
        DTS_HOST_CONSUME_TYPES: 'true',
        DTS_REMOTE_BASE_URL: remoteBaseUrl,
      },
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        reject(new Error(`Expected DTS consumption to fail, but build succeeded:\n${output}`));
        return;
      }
      resolve(output);
    });
  });

const cleanHostArtifacts = async () => {
  await fs.promises.rm(path.join(hostDir, 'dist'), { recursive: true, force: true });
  await fs.promises.rm(path.join(hostDir, '@mf-types'), { recursive: true, force: true });
};

const expectMissingTypesFailure = async (name, remoteBaseUrl) => {
  await cleanHostArtifacts();
  const output = await runBuildExpectingFailure(remoteBaseUrl);
  if (!output.includes('Missing consumed federated types for "dtsRemote"')) {
    throw new Error(`Expected ${name} to report missing consumed types, received:\n${output}`);
  }
};

const createCorruptTypeServer = () =>
  http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', corruptRemoteBaseUrl);

    if (requestUrl.pathname === '/mf-manifest.json') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(
        JSON.stringify({
          metaData: {
            types: {
              path: '',
              name: '@mf-types.zip',
              api: '@mf-types.d.ts',
            },
          },
        }),
      );
      return;
    }

    if (requestUrl.pathname === '/@mf-types.zip') {
      response.writeHead(200, { 'Content-Type': 'application/zip' });
      response.end('not a zip archive');
      return;
    }

    if (requestUrl.pathname === '/@mf-types.d.ts') {
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('export type RemoteKeys = never;');
      return;
    }

    response.writeHead(404);
    response.end('Not found');
  });

const listen = (server) =>
  new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(corruptRemotePort, '127.0.0.1', () => resolve());
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

await expectMissingTypesFailure('unavailable remote type artifacts', 'http://127.0.0.1:59999');

const corruptTypeServer = createCorruptTypeServer();
try {
  await listen(corruptTypeServer);
  await expectMissingTypesFailure('corrupt remote type archive', corruptRemoteBaseUrl);
} finally {
  await close(corruptTypeServer);
}

console.log('DTS host failure modes verified.');
