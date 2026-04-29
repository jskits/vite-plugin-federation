import { fileURLToPath } from 'node:url';
import path from 'pathe';
import { defineConfig } from '@playwright/test';
import { getE2eLocalhostUrl, getE2ePort } from '../../examples/e2ePorts.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '../..');
const originjsHostPort = getE2ePort('ORIGINJS_HOST');
const reactRemotePort = getE2ePort('REACT_REMOTE');
const webpackSystemRemotePort = getE2ePort('WEBPACK_SYSTEM_REMOTE');

export default defineConfig({
  testDir: './e2e',
  testMatch: /originjs-compat\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  outputDir: './test-results/compat',
  use: {
    baseURL: getE2eLocalhostUrl('ORIGINJS_HOST'),
    headless: true,
  },
  webServer: [
    {
      command: `corepack pnpm --filter example-react-remote exec vite preview --host localhost --port ${reactRemotePort}`,
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: getE2eLocalhostUrl('REACT_REMOTE'),
    },
    {
      command: `NODE_OPTIONS=--no-deprecation corepack pnpm --filter example-webpack-systemjs-remote exec http-server dist -a localhost -p ${webpackSystemRemotePort} -c-1 --cors`,
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: getE2eLocalhostUrl('WEBPACK_SYSTEM_REMOTE', '/remoteEntry.js'),
    },
    {
      command: `corepack pnpm --filter example-originjs-compat-host exec vite preview --host localhost --port ${originjsHostPort}`,
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: getE2eLocalhostUrl('ORIGINJS_HOST'),
    },
  ],
});
