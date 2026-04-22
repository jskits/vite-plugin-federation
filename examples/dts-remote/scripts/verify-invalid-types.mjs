import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const remoteDir = path.resolve(scriptDir, '..');

const cleanRemoteArtifacts = async () => {
  await fs.promises.rm(path.join(remoteDir, 'dist'), { recursive: true, force: true });
  await fs.promises.rm(path.join(remoteDir, 'node_modules/.cache/mf-types'), {
    recursive: true,
    force: true,
  });
};

const runBuildExpectingFailure = () =>
  new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['build'], {
      cwd: remoteDir,
      env: {
        ...process.env,
        DTS_REMOTE_INVALID_TYPES: 'true',
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
        reject(
          new Error(`Expected invalid DTS generation to fail, but build succeeded:\n${output}`),
        );
        return;
      }
      resolve(output);
    });
  });

await cleanRemoteArtifacts();

const output = await runBuildExpectingFailure();
if (!output.includes('TYPE-001') && !output.includes('Failed to generate declaration')) {
  throw new Error(`Expected invalid DTS generation diagnostic, received:\n${output}`);
}

console.log('DTS remote invalid TypeScript project verified.');
