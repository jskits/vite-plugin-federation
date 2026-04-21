import { fileURLToPath } from 'node:url';
import path from 'pathe';
import { defineConfig } from '@playwright/test';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '../..');

export default defineConfig({
  testDir: './e2e',
  testMatch: /ssr-manifest\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  outputDir: './test-results/ssr',
  use: {
    baseURL: 'http://127.0.0.1:4180',
    headless: true,
  },
  webServer: [
    {
      command: 'corepack pnpm --filter example-react-remote preview -- --host localhost',
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: 'http://localhost:4174/',
    },
    {
      command: 'corepack pnpm --filter example-react-ssr-host serve',
      cwd: repoRoot,
      env: {
        ...process.env,
        PORT: '4180',
        REACT_REMOTE_MANIFEST_URL: 'http://localhost:4174/mf-manifest.json',
      },
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: 'http://127.0.0.1:4180/healthz',
    },
  ],
});
