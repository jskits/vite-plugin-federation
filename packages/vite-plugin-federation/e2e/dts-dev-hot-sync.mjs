import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');
const remoteDir = path.resolve(repoRoot, 'examples/dts-remote');
const hostDir = path.resolve(repoRoot, 'examples/dts-host');
const remoteSourceFile = path.join(remoteDir, 'src/answer.ts');
const hostProofFile = path.join(hostDir, 'src/dev-hot-sync-proof.ts');
const hostTypesFile = path.join(hostDir, '@mf-types/dtsRemote/compiled-types/src/answer.d.ts');
const remoteTypesFile = path.join(remoteDir, 'dist/.dev-server/compiled-types/src/answer.d.ts');
const remoteDevZip = path.join(remoteDir, 'dist/.dev-server.zip');
const remoteDevApi = path.join(remoteDir, 'dist/.dev-server.d.ts');
const remotePublicZip = path.join(remoteDir, 'dist/@mf-types.zip');
const remotePublicApi = path.join(remoteDir, 'dist/@mf-types.d.ts');
const remotePort = 4176;
const hostPort = 4177;
const remoteBaseUrl = `http://127.0.0.1:${remotePort}`;
const hostBaseUrl = `http://127.0.0.1:${hostPort}`;
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, description, timeoutMs = 60_000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(intervalMs);
  }

  throw new Error(
    lastError instanceof Error
      ? `${description}: ${lastError.message}`
      : `${description} timed out after ${timeoutMs}ms`,
  );
}

async function waitForHttp(url, description) {
  return waitFor(async () => {
    const response = await fetch(url);
    if (!response.ok) {
      return false;
    }
    return response;
  }, description);
}

async function waitForZipResponse(url, description) {
  return waitFor(async () => {
    const response = await fetch(url);
    if (!response.ok) {
      return false;
    }

    const contentType = response.headers.get('content-type') || '';
    return contentType.includes('application/zip') ? response : false;
  }, description);
}

async function waitForFileContent(filePath, needle, description) {
  return waitFor(async () => {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return content.includes(needle) ? content : false;
    } catch {
      return false;
    }
  }, description);
}

function createProcess(command, args, options) {
  const logs = [];
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: options.env,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const onData = (chunk) => {
    const text = chunk.toString();
    logs.push(text);
    if (logs.length > 200) {
      logs.shift();
    }
    process.stdout.write(text);
  };

  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);

  return {
    child,
    getLogs() {
      return logs.join('');
    },
    async stop() {
      if (child.exitCode !== null) {
        return;
      }

      child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        delay(5_000).then(() => {
          if (child.exitCode === null) {
            child.kill('SIGKILL');
          }
        }),
      ]);
    },
  };
}

async function runHostTypecheck() {
  await new Promise((resolve, reject) => {
    const child = spawn(pnpmCommand, ['exec', 'tsc', '--project', 'tsconfig.json', '--noEmit'], {
      cwd: hostDir,
      env: process.env,
      shell: process.platform === 'win32',
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Host typecheck failed with exit code ${code}`));
    });
  });
}

let remoteServer;
let hostServer;
const originalRemoteSource = await fs.readFile(remoteSourceFile, 'utf8');

try {
  await fs.rm(path.join(hostDir, '@mf-types'), { recursive: true, force: true });
  await fs.rm(path.join(remoteDir, 'dist/.dev-server'), { recursive: true, force: true });
  await fs.rm(remoteDevZip, { force: true });
  await fs.rm(remoteDevApi, { force: true });
  await fs.rm(remotePublicZip, { force: true });
  await fs.rm(remotePublicApi, { force: true });
  await fs.rm(hostProofFile, { force: true });

  remoteServer = createProcess(
    pnpmCommand,
    [
      '--filter',
      'example-dts-remote',
      'exec',
      'vite',
      '--host',
      '127.0.0.1',
      '--port',
      String(remotePort),
    ],
    {
      env: process.env,
    },
  );

  await waitForHttp(`${remoteBaseUrl}/`, 'remote dev server startup');
  await waitForFileContent(remoteTypesFile, 'score: number;', 'remote live DTS generation');

  const manifestResponse = await waitForHttp(
    `${remoteBaseUrl}/mf-manifest.json`,
    'remote dev manifest availability',
  );
  const manifest = await manifestResponse.json();

  if (manifest?.metaData?.types?.path !== 'dist') {
    throw new Error('Expected dev manifest to publish live DTS artifacts from dist/');
  }
  if (manifest?.metaData?.types?.name !== '.dev-server.zip') {
    throw new Error('Expected dev manifest to publish .dev-server.zip');
  }
  if (manifest?.metaData?.types?.api !== '.dev-server.d.ts') {
    throw new Error('Expected dev manifest to publish .dev-server.d.ts');
  }

  const liveZipResponse = await waitForZipResponse(
    `${remoteBaseUrl}/dist/.dev-server.zip`,
    'remote live .dev-server.zip availability',
  );
  const contentType = liveZipResponse.headers.get('content-type') || '';
  if (!contentType.includes('application/zip')) {
    throw new Error(`Expected remote live types zip, received content-type "${contentType}"`);
  }

  hostServer = createProcess(
    pnpmCommand,
    [
      '--filter',
      'example-dts-host',
      'exec',
      'vite',
      '--host',
      '127.0.0.1',
      '--port',
      String(hostPort),
    ],
    {
      env: {
        ...process.env,
        DTS_HOST_CONSUME_TYPES: 'true',
        DTS_REMOTE_BASE_URL: remoteBaseUrl,
      },
    },
  );

  await waitForHttp(`${hostBaseUrl}/`, 'host dev server startup');
  await waitForFileContent(hostTypesFile, 'score: number;', 'host initial DTS consumption');

  const updatedRemoteSource = originalRemoteSource.replace(
    '  score: number;\n}',
    '  score: number;\n  updatedAt: string;\n}',
  );
  if (updatedRemoteSource === originalRemoteSource) {
    throw new Error('Failed to inject the updatedAt field into the remote DTS source');
  }

  await fs.writeFile(remoteSourceFile, updatedRemoteSource, 'utf8');

  await waitForFileContent(
    remoteTypesFile,
    'updatedAt: string;',
    'remote live DTS refresh after source change',
  );
  await waitForFileContent(
    hostTypesFile,
    'updatedAt: string;',
    'host DTS hot sync after remote source change',
  );

  await fs.writeFile(
    hostProofFile,
    `import type { FederationAnswer } from 'dtsRemote/answer';

export const proofAnswer: FederationAnswer = {
  id: 'proof-answer',
  label: 'Proof answer',
  score: 7,
  updatedAt: '2026-04-25T00:00:00.000Z',
};
`,
    'utf8',
  );

  await runHostTypecheck();

  console.log('DTS dev hot sync verified.');
} catch (error) {
  const remoteLogs = remoteServer?.getLogs?.() || '';
  const hostLogs = hostServer?.getLogs?.() || '';
  console.error('\n[DTS dev hot sync] Remote logs:\n', remoteLogs);
  console.error('\n[DTS dev hot sync] Host logs:\n', hostLogs);
  throw error;
} finally {
  await hostServer?.stop?.();
  await remoteServer?.stop?.();
  await fs.writeFile(remoteSourceFile, originalRemoteSource, 'utf8');
  await fs.rm(hostProofFile, { force: true });
  await fs.rm(path.join(hostDir, '@mf-types'), { recursive: true, force: true });
  await fs.rm(path.join(remoteDir, 'dist/.dev-server'), { recursive: true, force: true });
  await fs.rm(remoteDevZip, { force: true });
  await fs.rm(remoteDevApi, { force: true });
}
