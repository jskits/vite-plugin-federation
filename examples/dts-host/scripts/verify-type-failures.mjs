import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const hostDir = path.resolve(scriptDir, '..');

const runBuildExpectingFailure = () =>
  new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['build'], {
      cwd: hostDir,
      env: {
        ...process.env,
        DTS_HOST_CONSUME_TYPES: 'true',
        DTS_REMOTE_BASE_URL: 'http://127.0.0.1:59999',
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

await fs.promises.rm(path.join(hostDir, 'dist'), { recursive: true, force: true });
await fs.promises.rm(path.join(hostDir, '@mf-types'), { recursive: true, force: true });

const output = await runBuildExpectingFailure();
if (!output.includes('Missing consumed federated types for "dtsRemote"')) {
  throw new Error(`Expected missing consumed types diagnostic, received:\n${output}`);
}

console.log('DTS host failure modes verified.');
