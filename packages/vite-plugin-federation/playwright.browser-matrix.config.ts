import { fileURLToPath } from 'node:url';
import path from 'pathe';
import { defineConfig, devices } from '@playwright/test';
import { getE2eLocalhostUrl, getE2ePort } from '../../examples/e2ePorts.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '../..');
const litRemotePort = getE2ePort('LIT_REMOTE');
const multiRemoteHostPort = getE2ePort('MULTI_REMOTE_HOST');
const reactRemotePort = getE2ePort('REACT_REMOTE');

export default defineConfig({
  testDir: './e2e',
  testMatch: /multi-remote\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  outputDir: './test-results/browser-matrix',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  use: {
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
      command: `corepack pnpm --filter example-lit-remote exec vite preview --host localhost --port ${litRemotePort}`,
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: getE2eLocalhostUrl('LIT_REMOTE'),
    },
    {
      command: `corepack pnpm --filter example-multi-remote-host exec vite preview --host localhost --port ${multiRemoteHostPort}`,
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: getE2eLocalhostUrl('MULTI_REMOTE_HOST'),
    },
  ],
});
