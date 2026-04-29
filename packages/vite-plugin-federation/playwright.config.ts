import { fileURLToPath } from 'node:url';
import path from 'pathe';
import { defineConfig } from '@playwright/test';
import { getE2eLocalhostUrl, getE2ePort } from '../../examples/e2ePorts.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '../..');
const reactHostPort = getE2ePort('REACT_HOST');
const reactRemotePort = getE2ePort('REACT_REMOTE');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  outputDir: './test-results',
  use: {
    baseURL: getE2eLocalhostUrl('REACT_HOST'),
    headless: true,
  },
  webServer: [
    {
      command: `corepack pnpm --filter example-react-remote exec vite --host localhost --port ${reactRemotePort}`,
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: getE2eLocalhostUrl('REACT_REMOTE'),
    },
    {
      command: `corepack pnpm --filter example-react-host exec vite --host localhost --port ${reactHostPort}`,
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: getE2eLocalhostUrl('REACT_HOST'),
    },
  ],
});
